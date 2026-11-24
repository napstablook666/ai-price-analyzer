// 调用 rust-dist/exchange-rate-rs 的 wasm 导出。编码层在 src/shared/rust-wire.js。
// `fetchExchangeRate` 不在里面：它要 fetch + AbortSignal + 超时，留在 src/core/exchange-rate.js。
import * as wasm from "../../rust-dist/exchange-rate-rs/index.js";
import { callWith } from "../shared/rust-wire.js";

export function exchangeRateInfo(settings, references, now) {
  // 三个参数都要原样传下去：源码里默认参数只对 undefined 生效，null 会被当成 0 参与减法。
  return callWith(wasm, "exchangeRateInfo", [settings, references, now]);
}
