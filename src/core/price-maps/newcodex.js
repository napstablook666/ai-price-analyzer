// NewCodex（newcodex.cn）的价格映射。
//
// 报文和 TokenFlux 同构（data / group_ratio / usable_group / vendors / supported_endpoint），
// 规则整份复用 tokenflux，只改一处：倍率类的 model_ratio 要乘 2。
//
// 为什么乘 2：New API 的 model_ratio 1 = $2/百万 token，而这个站把部分模型的价格写进
// billing_expr（系数就是美元/百万 token），两套写法在同一份报文里必须对得上。
// 实测 gemini-3.8-flash 的 ratio 0.375 / completion_ratio 5 / cache_ratio 0.1，
// 乘 2 得 输入 0.75、输出 3.75、缓存读 0.075，与同站 gemini-3.8-flash-high 的
// 表达式 p*0.75 + c*3.75 + cr*0.075 逐个数字吻合。tokenflux 那份映射按 ratio 1 = $1 取，
// 会把所有倍率类模型的价格报低一半。
//
// 表达式类、按次类、按张类不受影响，照抄 tokenflux。

import { tokenfluxPriceMap } from "./tokenflux.js";

// 倍率类报价的换算：站点 ratio × 2 才是美元/百万 token。
const DOUBLED_RATIO = {
  input: "model_ratio * 2",
  output: "model_ratio * 2 * completion_ratio",
  cacheRead: "model_ratio * 2 * cache_ratio",
  cacheWrite: "model_ratio * 2 * create_cache_ratio",
  // 写回 model_ratio 字段时按 2 折算，跟输入价保持同一口径。
  ratioBase: 2
};

export const newcodexPriceMap = {
  ...tokenfluxPriceMap,
  source: "newcodex",
  rules: tokenfluxPriceMap.rules.map(rule => rule.kind === "token" ? { ...rule, ...DOUBLED_RATIO } : rule)
};
