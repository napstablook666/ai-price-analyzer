// 由 scripts/rust-build.mjs 生成，不要手改。
import init, * as wasm from "./price_fields_rs.js";

const wasmSource = globalThis.process?.versions?.node
  ? await (await import("node:fs/promises")).readFile(new URL("./price_fields_rs_bg.wasm", import.meta.url))
  : undefined;
await init({ module_or_path: wasmSource });

export * from "./price_fields_rs.js";
export default wasm;
