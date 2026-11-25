import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Node 能导入带顶层 await 的模块，MV3 service worker 不能；这里只约束生成的薄 shim。
function assertWorkerShim(source) {
  const code = source.split("\n").filter(line => !line.trimStart().startsWith("//")).join("\n");
  assert.doesNotMatch(code, /\bawait\b/, "MV3 wasm shim 不允许异步初始化");
  assert.match(code, /^\s*wasm\.initSync\(\{\s*module:\s*decodeBase64\(wasmBase64\)\s*\}\);?\s*$/m,
    "MV3 wasm shim 必须调用命名导出 initSync，并使用内联字节");
}

for (const unit of ["shared-rs", "price-fields-rs", "exchange-rate-rs"]) {
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
