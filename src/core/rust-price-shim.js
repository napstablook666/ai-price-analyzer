// 调用 rust-dist/price-fields-rs 的 wasm 导出。编码层与 src/shared 的 shim 共用 src/shared/rust-wire.js。
// 这里的导出名与 src/core/price-fields.js 的同名函数一一对应，实现换成 Rust。
import * as wasm from "../../rust-dist/price-fields-rs/index.js";
import { callWith } from "../shared/rust-wire.js";

export function rawPriceValue(item, field) {
  return callWith(wasm, "rawPriceValue", [item, field]);
}
