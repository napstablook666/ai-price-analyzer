import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { verifyUpdateSignature } from "../src/core/self-update.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const UNITS = ["shared-rs", "price-fields-rs", "exchange-rate-rs", "billing-tiers-rs"];

// Node 能导入带顶层 await 的模块，MV3 service worker 不能；这里只约束生成的薄 shim。
function assertWorkerShim(source) {
  const code = source.split("\n").filter(line => !line.trimStart().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /\bawait\b/, "MV3 wasm shim 不允许异步初始化");
  assert.match(code, /^\s*wasm\.initSync\(\{\s*module:\s*decodeBase64\(wasmBase64\)\s*\}\);?\s*$/m,
    "MV3 wasm shim 必须调用命名导出 initSync，并使用内联字节");
}

for (const unit of UNITS) {
  test(`${unit} 生成入口可同步初始化，不依赖 Node 放行顶层 await`, () => {
    const source = readFileSync(new URL(`../rust-dist/${unit}/index.js`, import.meta.url), "utf8");
    assertWorkerShim(source);
  });
}

test("拒绝曾导致 MV3 worker 注册失败的顶层 await shim", () => {
  const source = `import init from "./unit.js";
await init(new URL("./unit_bg.wasm", import.meta.url));
export * from "./unit.js";`;
  assert.throws(() => assertWorkerShim(source), /不允许异步初始化/);
});

test("拒绝把异步默认导出 init 当作同步初始化调用", () => {
  const source = `import init from "./unit.js";
init({ module: decodeBase64(wasmBase64) });`;
  assert.throws(() => assertWorkerShim(source), /必须调用命名导出 initSync/);
});

test("说明 MV3 限制的整行注释不会被误判为异步初始化", () => {
  assertWorkerShim(`// service worker 不允许顶层 await
wasm.initSync({ module: decodeBase64(wasmBase64) });`);
});

test("Release 运行包必须覆盖 Wasm 入口的目录", () => {
  const workflow = readFileSync(join(ROOT, ".github/workflows/release.yml"), "utf8");
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex(line => line.includes('zip -qr "../../dist/ai-relay-price-extension-${version}.zip"'));
  assert.notEqual(start, -1, "找不到实际运行包的 zip 命令");
  const command = [lines[start]];
  while (command.at(-1).trimEnd().endsWith("\\")) command.push(lines[start + command.length]);
  const entries = command.slice(1).join(" ").replaceAll("\\", "").trim().split(/\s+/);
  for (const unit of UNITS) {
    const entry = `rust-dist/${unit}/index.js`;
    assert.ok(entries.some(path => entry === path || entry.startsWith(`${path}/`)), `运行包漏掉 ${entry}`);
  }
});

test("签名更新清单包含全部 Wasm 运行文件及其真实摘要", async t => {
  const directory = mkdtempSync(join(tmpdir(), "ai-price-wasm-release-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const zipPath = join(directory, "fixture.zip");
  writeFileSync(zipPath, Buffer.from("504b0506000000000000000000000000000000000000", "hex"));
  const outPath = join(directory, "update.json");
  const { version } = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  execFileSync(process.execPath, [join(ROOT, "scripts/build-update-manifest.mjs"),
    "--source", ROOT, "--zip", zipPath, "--version", version,
    "--url", `https://example.com/extension-v${version}.zip`, "--out", outPath
  ], { cwd: ROOT, env: { ...process.env, SIGNING_KEY: privateKey.export({ type: "pkcs8", format: "pem" }) } });
  const manifest = JSON.parse(readFileSync(outPath, "utf8"));
  for (const unit of UNITS) {
    const prefix = `rust-dist/${unit}`;
    for (const name of readdirSync(join(ROOT, prefix)).filter(name => /\.(?:js|wasm)$/.test(name))) {
      const path = `${prefix}/${name}`;
      const hash = createHash("sha256").update(readFileSync(join(ROOT, path))).digest("hex");
      assert.equal(manifest.files[path], hash, `更新清单遗漏或摘要错误：${path}`);
    }
  }
  assert.equal(await verifyUpdateSignature(manifest, { publicKey: publicKey.export({ format: "jwk" }) }), true);
});
