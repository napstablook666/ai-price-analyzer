// 由 scripts/rust-build.mjs 生成，不要手改。
import init, * as wasm from "./exchange_rate_rs.js";

const wasmSource = globalThis.process?.versions?.node
  ? await (await import("node:fs/promises")).readFile(new URL("./exchange_rate_rs_bg.wasm", import.meta.url))
  : undefined;
await init({ module_or_path: wasmSource });

export * from "./exchange_rate_rs.js";
export default wasm;
