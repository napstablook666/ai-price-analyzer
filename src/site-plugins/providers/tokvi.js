// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// tokvi 取证（2026-11-25，匿名直连 /api/pricing + /api/status，不需要登录）：
//   25 个模型 32 个分组，分组倍率全部是 1：这站的分组是渠道路由标签（cg-f-* 是聚合通道、cg-model-* 是单模型通道），
//     同一模型在两个通道各一条报价行，价格相同，所以报价行 48 条多于模型的 25 个。
//   7 个模型带 billing_expr，其余走 model_ratio；其余模型的倍率基准与基座一致（1 单位 = 2 美元/百万）。
//   12 条按秒的 video 报价、2 条按张的生图报价，单位价按各自的 unit 出。
//   4 个算不出价：MiniMax-H3 是 u("seconds") 多项求和、wan2.7-image / wan2.7-image-pro 是 tier("image", u("image_count") * …)，
//     deepseek-v4.1-flash-1017 的表达式没有 tier() 外壳，解析器不认。都进 unresolved。
//   群组别名与展示色在 group_aliases / group_catalog 里，比价表按 group_ratio 的键出组名，用不到这两个字段。

const PRICE_MAP = { base: "allrouter" };

const HOSTS = ["tokvi.net"];
const PATHS = ["/","/pricing","/console/topup"];

const preset = {
  id: "tokvi",
  name: "tokvi",
  baseUrl: "https://tokvi.net/pricing",
  rechargeRmb: 7.3,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "price = 7.3、usd_exchange_rate = 7.3，判定 1 美元额度 = ¥7.3。quota_display_type = CNY 只影响控制台的额度显示。",
  rechargePlansVerified: false,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "报文里的倍率与 billing_expr 系数都是美元额度价，报价 = 官方价 × 分组倍率；price = 7.3、quota_per_unit = 500000、quota_display_type = CNY、usd_exchange_rate = 7.3、stripe_unit_price = 8。控制台按站点设置的币种显示额度，不影响这里的价格。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "tokvi",
  host: "tokvi.net",
  preset,
  matches: ({ hostname, path }) => HOSTS.includes(hostname) && PATHS.includes(path),
  prepareMatches: ({ hostname }) => HOSTS.includes(hostname),
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/pricing`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
  }),
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "tokvi 的 /api/pricing 匿名可读，25 个模型 32 个渠道分组、按秒与按张报价都能直采",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [
  {
    "alias": "kimi-k3.1-pro-highspeed",
    "canonicalId": "kimi-k3-1-pro"
  }
];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
