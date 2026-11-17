import test from "node:test";
import assert from "node:assert/strict";

import { extractZip, readZipEntries } from "../src/core/zip-extract.js";
import { applyUpdate, isExtensionDirectory, readLocalHashes, restoreBackup } from "../src/core/self-update-apply.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function concat(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

async function deflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// 手搓一个够用的 zip：不写 CRC，我们的读取器不校验它。
async function makeZip(files, { deflate = false } = {}) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [path, value] of Object.entries(files)) {
    const name = encoder.encode(path);
    const data = typeof value === "string" ? encoder.encode(value) : value;
    const stored = deflate ? await deflateRaw(data) : data;
    const method = deflate ? 8 : 0;

    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, method, true);
    localView.setUint32(18, stored.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);

    const entry = new Uint8Array(46 + name.length);
    const entryView = new DataView(entry.buffer);
    entryView.setUint32(0, 0x02014b50, true);
    entryView.setUint16(4, 20, true);
    entryView.setUint16(6, 20, true);
    entryView.setUint16(10, method, true);
    entryView.setUint32(20, stored.length, true);
    entryView.setUint32(24, data.length, true);
    entryView.setUint16(28, name.length, true);
    entryView.setUint32(42, offset, true);
    entry.set(name, 46);

    chunks.push(local, stored);
    central.push(entry);
    offset += local.length + stored.length;
  }

  const directoryOffset = offset;
  const directorySize = central.reduce((sum, entry) => sum + entry.length, 0);
  chunks.push(...central);

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, central.length, true);
  eocdView.setUint16(10, central.length, true);
  eocdView.setUint32(12, directorySize, true);
  eocdView.setUint32(16, directoryOffset, true);
  chunks.push(eocd);

  return concat(chunks);
}

// 只实现我们用到的那几个方法，行为对齐 FileSystemDirectoryHandle。
function createFakeDirectory(seed = {}) {
  const files = new Map(Object.entries(seed).map(([path, value]) => [path, typeof value === "string" ? encoder.encode(value) : value]));

  function makeHandle(prefix) {
    return {
      async getFileHandle(name, options = {}) {
        const path = prefix + name;
        if (!files.has(path)) {
          if (!options.create) throw new Error(`NotFoundError: ${path}`);
          files.set(path, new Uint8Array(0));
        }
        const bytes = files.get(path);
        return {
          getFile: async () => ({ arrayBuffer: async () => new Uint8Array(bytes).buffer }),
          createWritable: async () => {
            const chunks = [];
            return {
              write: async chunk => chunks.push(new Uint8Array(chunk)),
              close: async () => files.set(path, concat(chunks)),
              abort: async () => chunks.length = 0
            };
          }
        };
      },
      async getDirectoryHandle(name) {
        return makeHandle(`${prefix}${name}/`);
      },
      async removeEntry(name) {
        files.delete(prefix + name);
      }
    };
  }

  return { files, handle: makeHandle("") };
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function makeManifest(zipFiles, overrides = {}) {
  const files = {};
  for (const [path, value] of Object.entries(zipFiles)) {
    files[path] = await sha256Hex(typeof value === "string" ? encoder.encode(value) : value);
  }
  return {
    version: "0.9.0",
    minShell: "0.9.0",
    zip: { url: "https://example.com/a.zip", size: 1024, sha256: files[Object.keys(files)[0]] },
    files,
    deleted: [],
    signature: "QUJD",
    ...overrides
  };
}

test("readZipEntries 认得 stored 与 deflate 两种条目", async () => {
  for (const deflate of [false, true]) {
    const zip = await makeZip({ "manifest.json": "{\"version\":\"0.9.0\"}", "src/a.js": "console.log(1)" }, { deflate });
    const entries = readZipEntries(zip);
    assert.deepEqual(entries.map(entry => entry.path), ["manifest.json", "src/a.js"]);
    assert.equal(entries[0].method, deflate ? 8 : 0);

    const files = await extractZip(zip);
    assert.equal(decoder.decode(files.get("src/a.js")), "console.log(1)");
  }
});

test("readZipEntries 把反斜杠路径归一成正斜杠", async () => {
  const zip = await makeZip({ "src\\a.js": "x" });
  assert.deepEqual(readZipEntries(zip).map(entry => entry.path), ["src/a.js"]);
});

test("readZipEntries 拒绝不是 zip 的字节", () => {
  assert.throws(() => readZipEntries(new Uint8Array(64)), /找不到中央目录/);
});

test("isExtensionDirectory 只认目录里已经有 manifest.json 的", async () => {
  assert.equal(await isExtensionDirectory(createFakeDirectory().handle), false);
  assert.equal(await isExtensionDirectory(createFakeDirectory({ "manifest.json": "{}" }).handle), true);
  assert.equal(await isExtensionDirectory(null), false);
});

test("applyUpdate 只写变化的文件，manifest.json 排最后", async () => {
  const zipFiles = { "manifest.json": "{\"version\":\"0.9.0\"}", "src/a.js": "A", "src/b.js": "B" };
  const zip = await makeZip(zipFiles, { deflate: true });
  const manifest = await makeManifest(zipFiles);

  const { files, handle } = createFakeDirectory({ "manifest.json": "{\"version\":\"0.8.0\"}", "src/a.js": "A", "src/old.js": "OLD" });
  const result = await applyUpdate({
    dirHandle: handle,
    zipBuffer: zip,
    manifest: { ...manifest, deleted: ["src/old.js"] }
  });

  assert.deepEqual(result.written, ["src/b.js", "manifest.json"]);
  assert.deepEqual(result.removed, ["src/old.js"]);
  assert.equal(decoder.decode(files.get("manifest.json")), "{\"version\":\"0.9.0\"}");
  assert.equal(files.has("src/old.js"), false);
  assert.equal(result.backup["manifest.json"].bytes.byteLength > 0, true);
});

test("applyUpdate 在包里内容与清单摘要对不上时中止且不写盘", async () => {
  const zipFiles = { "manifest.json": "{\"version\":\"0.9.0\"}", "src/a.js": "A" };
  const zip = await makeZip(zipFiles);
  const manifest = await makeManifest(zipFiles);

  const { files, handle } = createFakeDirectory({ "manifest.json": "{\"version\":\"0.8.0\"}" });
  const tampered = { ...manifest, files: { ...manifest.files, "src/a.js": "0".repeat(64) } };

  await assert.rejects(applyUpdate({ dirHandle: handle, zipBuffer: zip, manifest: tampered }), /摘要对不上/);
  assert.equal(decoder.decode(files.get("manifest.json")), "{\"version\":\"0.8.0\"}");
  assert.equal(files.has("src/a.js"), false);
});

test("applyUpdate 拒绝缺文件的包和不安全的路径", async () => {
  const zipFiles = { "manifest.json": "{}" };
  const zip = await makeZip(zipFiles);
  const manifest = await makeManifest(zipFiles);

  await assert.rejects(
    applyUpdate({ dirHandle: createFakeDirectory({ "manifest.json": "{}" }).handle, zipBuffer: zip, manifest: { ...manifest, files: { ...manifest.files, "src/missing.js": "0".repeat(64) } } }),
    /缺少 src\/missing.js/
  );

  await assert.rejects(
    applyUpdate({ dirHandle: createFakeDirectory({ "manifest.json": "{}" }).handle, zipBuffer: zip, manifest: { ...manifest, files: { ...manifest.files, "../../evil.js": "0".repeat(64) } } }),
    /不安全的路径/
  );
});

test("readLocalHashes 读不到的文件不出现在结果里", async () => {
  const { handle } = createFakeDirectory({ "manifest.json": "{}" });
  const hashes = await readLocalHashes(handle, { files: { "manifest.json": "x", "src/gone.js": "y" } });
  assert.deepEqual(Object.keys(hashes), ["manifest.json"]);
});

test("restoreBackup 把旧 manifest.json 写回去", async () => {
  const { files, handle } = createFakeDirectory({ "manifest.json": "{\"version\":\"0.9.0\"}" });
  await restoreBackup(handle, { "manifest.json": { bytes: encoder.encode("{\"version\":\"0.8.0\"}").buffer } });
  assert.equal(decoder.decode(files.get("manifest.json")), "{\"version\":\"0.8.0\"}");
});
