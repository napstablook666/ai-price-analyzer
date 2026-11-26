// 调用 rust-dist/billing-tiers-rs 的 wasm 导出。编码层与 src/shared 的 shim 共用 src/shared/rust-wire.js。
// 导出名与 src/core/billing-tiers.js 的同名函数一一对应，实现换成 Rust。
import * as wasm from "../../rust-dist/billing-tiers-rs/index.js";
import { callWith } from "../shared/rust-wire.js";

export function parseBillingTiers(expression) {
  return callWith(wasm, "parseBillingTiers", [expression]);
}
