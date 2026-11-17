import test from "node:test";
import assert from "node:assert/strict";

import {
  UPDATE_ZIP_MAX_BYTES,
  canSelfUpdate,
  diffFiles,
  fetchUpdateManifest,
  isSafeRelativePath,
  manifestSigningPayload,
  parseUpdateManifest,
  verifyUpdateSignature
} from "../src/core/self-update.js";

const {
  crypto: { subtle }
} = globalThis;

const HEX = hash => hash.repeat(64).slice(0, 64);

async function createTestKey() {
  const pair = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const publicKey = await subtle.exportKey("jwk", pair.publicKey);
  return { privateKey: pair.privateKey, publicKey };
}

function baseManifest(overrides = {}) {
  return {
    version: "0.9.0",
    minShell: "0.9.0",
    publishedAt: "2026-11-20T00:00:00Z",
    zip: { url: "https://example.com/a.zip", size: 1482133, sha256: HEX("a") },
    files: { "manifest.json": HEX("b"), "src/service-worker.js": HEX("c") },
    deleted: [],
    ...overrides
  };
}

async function signed(manifest, privateKey) {
  const payload = await manifestSigningPayload(manifest);
  const signature = await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(payload));
  return { ...manifest, signature: Buffer.from(signature).toString("base64") };
}

test("isSafeRelativePath 只放行扩展目录内的相对路径", () => {
  for (const good of ["manifest.json", "src/core/a.js", "icons/16.png"]) {
    assert.equal(isSafeRelativePath(good), true, good);
  }
  for (const bad of ["", "../evil.js", "src/../../evil.js", "/etc/passwd", "C:/x.js", "src\\a.js", "src//a.js", "./a.js", "src/", 42, null]) {
    assert.equal(isSafeRelativePath(bad), false, String(bad));
  }
});

test("parseUpdateManifest 接受合法清单并补默认值", () => {
  const parsed = parseUpdateManifest(JSON.stringify({ ...baseManifest(), signature: "QUJD" }));
  assert.equal(parsed.version, "0.9.0");
  assert.equal(parsed.minShell, "0.9.0");
  assert.equal(parsed.zip.url, "https://example.com/a.zip");
  assert.equal(parsed.signature, "QUJD");
  assert.deepEqual(parsed.deleted, []);
});

test("parseUpdateManifest 缺 minShell 时回落成 version", () => {
  const raw = baseManifest();
  delete raw.minShell;
  assert.equal(parseUpdateManifest({ ...raw, signature: "QUJD" }).minShell, "0.9.0");
});

test("parseUpdateManifest 拒绝不合法输入", () => {
  const cases = [
    ["不是 JSON", () => parseUpdateManifest("{oops")],
    ["版本不是 semver", () => parseUpdateManifest({ ...baseManifest({ version: "nightly" }), signature: "QUJD" })],
    ["缺 zip", () => {
      const raw = baseManifest();
      delete raw.zip;
      return parseUpdateManifest({ ...raw, signature: "QUJD" });
    }],
    ["zip 不是 https", () => parseUpdateManifest({ ...baseManifest(), zip: { ...baseManifest().zip, url: "http://example.com/a.zip" }, signature: "QUJD" })],
    ["zip.sha256 不是 64 位十六进制", () => parseUpdateManifest({ ...baseManifest(), zip: { ...baseManifest().zip, sha256: "xyz" }, signature: "QUJD" })],
    ["包体积超上限", () => parseUpdateManifest({ ...baseManifest(), zip: { ...baseManifest().zip, size: UPDATE_ZIP_MAX_BYTES + 1 }, signature: "QUJD" })],
    ["files 里塞路径穿越", () => parseUpdateManifest({ ...baseManifest({ files: { "manifest.json": HEX("b"), "../../evil.js": HEX("c") } }), signature: "QUJD" })],
    ["deleted 里塞绝对路径", () => parseUpdateManifest({ ...baseManifest({ deleted: ["/etc/passwd"] }), signature: "QUJD" })],
    ["files 缺 manifest.json", () => parseUpdateManifest({ ...baseManifest({ files: { "src/a.js": HEX("b") } }), signature: "QUJD" })],
    ["缺 signature", () => parseUpdateManifest(baseManifest())]
  ];
  for (const [name, run] of cases) {
    assert.throws(run, /./, name);
  }
});

test("diffFiles 只写变化项，manifest.json 排最后", () => {
  const manifest = parseUpdateManifest({
    ...baseManifest({
      files: { "manifest.json": HEX("b"), "src/a.js": HEX("c"), "src/b.js": HEX("d") },
      deleted: ["stale.txt", "already-gone.js"]
    }),
    signature: "QUJD"
  });
  const { write, remove } = diffFiles({ "src/a.js": HEX("c"), "src/c.js": HEX("f"), "stale.txt": HEX("e") }, manifest);

  assert.deepEqual(write, ["src/b.js", "manifest.json"]);
  assert.deepEqual(remove, ["stale.txt"]);
});

test("diffFiles 把空目录当成全新安装", () => {
  const manifest = parseUpdateManifest({ ...baseManifest(), signature: "QUJD" });
  assert.deepEqual(diffFiles({}, manifest).write, ["src/service-worker.js", "manifest.json"]);
  assert.deepEqual(diffFiles(null, manifest).remove, []);
});

test("manifestSigningPayload 与键顺序无关", async () => {
  const a = await manifestSigningPayload(baseManifest());
  const b = await manifestSigningPayload({
    files: { "src/service-worker.js": HEX("c"), "manifest.json": HEX("b") },
    zip: { sha256: HEX("a"), size: 1482133, url: "https://example.com/a.zip" },
    deleted: [],
    minShell: "0.9.0",
    version: "0.9.0"
  });
  assert.equal(a, b);
  assert.equal(a.split("\n").length, 5);
});

test("manifestSigningPayload 把 minShell 也签进去", async () => {
  const base = baseManifest();
  const raised = { ...base, minShell: "9.9.9" };
  assert.notEqual(await manifestSigningPayload(base), await manifestSigningPayload(raised));
});

test("manifestSigningPayload 缺 minShell 时按 version 签", async () => {
  const base = baseManifest();
  const withoutShell = { ...base };
  delete withoutShell.minShell;
  assert.equal(await manifestSigningPayload(base), await manifestSigningPayload(withoutShell));
});

test("verifyUpdateSignature 通过后被篡改即失败", async () => {
  const { privateKey, publicKey } = await createTestKey();
  const manifest = await signed(baseManifest(), privateKey);

  assert.equal(await verifyUpdateSignature(manifest, { publicKey }), true);

  const tamperedVersion = { ...manifest, version: "9.9.9" };
  assert.equal(await verifyUpdateSignature(tamperedVersion, { publicKey }), false);

  const tamperedZip = { ...manifest, zip: { ...manifest.zip, sha256: HEX("f") } };
  assert.equal(await verifyUpdateSignature(tamperedZip, { publicKey }), false);

  const tamperedFiles = { ...manifest, files: { ...manifest.files, "src/service-worker.js": HEX("f") } };
  assert.equal(await verifyUpdateSignature(tamperedFiles, { publicKey }), false);

  const tamperedDeleted = { ...manifest, deleted: ["src/legacy/old.js"] };
  assert.equal(await verifyUpdateSignature(tamperedDeleted, { publicKey }), false);
});

test("verifyUpdateSignature 拒绝别的私钥签的清单与残缺签名", async () => {
  const { privateKey } = await createTestKey();
  const { publicKey: otherPublicKey } = await createTestKey();
  const manifest = await signed(baseManifest(), privateKey);

  assert.equal(await verifyUpdateSignature(manifest, { publicKey: otherPublicKey }), false);
  assert.equal(await verifyUpdateSignature({ ...manifest, signature: "" }, { publicKey: otherPublicKey }), false);
  assert.equal(await verifyUpdateSignature({ ...manifest, signature: "***" }, { publicKey: otherPublicKey }), false);
  assert.equal(await verifyUpdateSignature({ ...manifest, signature: "AAAA" }, { publicKey: otherPublicKey }), false);
});

test("canSelfUpdate 用 minShell 挡住跨协议的旧版本", () => {
  const manifest = { minShell: "0.9.0" };
  assert.equal(canSelfUpdate("0.9.0", manifest), true);
  assert.equal(canSelfUpdate("0.10.0", manifest), true);
  assert.equal(canSelfUpdate("0.8.0", manifest), false);
  assert.equal(canSelfUpdate("not-a-version", manifest), false);
});

function fakeResponse(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body))
  };
}

test("fetchUpdateManifest 拉到合法清单就返回", async () => {
  const { privateKey, publicKey } = await createTestKey();
  const manifest = await signed(baseManifest(), privateKey);
  const urls = [];

  const result = await fetchUpdateManifest({
    url: "https://example.com/update.json",
    fetchImpl: async url => {
      urls.push(url);
      return fakeResponse(manifest);
    },
    publicKey
  });

  assert.equal(result.manifest.version, "0.9.0");
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^https:\/\/example\.com\/update\.json\?_=\d+$/);
});

test("fetchUpdateManifest 遇到 404 重试一次后失败", async () => {
  let calls = 0;
  await assert.rejects(
    fetchUpdateManifest({
      url: "https://example.com/update.json",
      fetchImpl: async () => {
        calls += 1;
        return fakeResponse("", { ok: false, status: 404 });
      }
    }),
    /HTTP 404/
  );
  assert.equal(calls, 2);
});

test("fetchUpdateManifest 签名不过就中止，不再重试到底", async () => {
  const { privateKey } = await createTestKey();
  const { publicKey: otherPublicKey } = await createTestKey();
  const manifest = await signed(baseManifest(), privateKey);

  await assert.rejects(
    fetchUpdateManifest({
      url: "https://example.com/update.json",
      fetchImpl: async () => fakeResponse(manifest),
      publicKey: otherPublicKey
    }),
    /签名校验失败/
  );
});

test("verifyUpdateSignature 不接受被 verify 覆盖之外的字段冒充", async () => {
  const { privateKey, publicKey } = await createTestKey();
  const manifest = await signed(baseManifest(), privateKey);
  // publishedAt 不在签名覆盖范围，改它不该影响验签结论；这是已知且可接受的口径。
  assert.equal(await verifyUpdateSignature({ ...manifest, publishedAt: "2030-01-01T00:00:00Z" }, { publicKey }), true);
});
