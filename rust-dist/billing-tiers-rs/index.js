// 由 scripts/rust-build.mjs 生成，不要手改。
// MV3 的 module service worker 不允许顶层 await：wasm 必须同步实例化，字节以 base64 内联在本目录。
import * as wasm from "./billing_tiers_rs.js";
import { wasmBase64 } from "./billing_tiers_rs_wasm.js";
import { decodeBase64 } from "../decode-base64.js";

// initSync 是命名导出，默认导出是异步的 __wbg_init：service worker 里只认前者。
wasm.initSync({ module: decodeBase64(wasmBase64) });

export * from "./billing_tiers_rs.js";
export default wasm;
