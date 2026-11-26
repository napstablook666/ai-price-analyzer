// 计费表达式解析：从站点写的 `tier(...)` 表达式里拆出价格档位（token / 按次 / 按秒 / 按张）。
// 纯字符串处理，不依赖 DOM、网络或浏览器 API。实现已移植到 rust/billing-tiers-rs（wasm），
// 这里只保留对外入口，调用方（normalizers.js 与 test/billing-tiers.test.js）不用改。
import { parseBillingTiers as parseBillingTiersFromRust } from "./rust-billing-shim.js";

export function parseBillingTiers(expression) {
  return parseBillingTiersFromRust(expression);
}
