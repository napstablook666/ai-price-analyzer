// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// Orbitix AI 取证（2026-11-25，匿名直连 /api/pricing + /api/status，不需要登录）：
//   11 个模型 4 个分组（CodeX-不降智 0.2、CodeX-特惠 0.08、国模 0.2、生图 1），全部带 billing_expr。
//   deepseek-v4-flash 在「国模」组出现两条不同价（$0.4 与 $0.2），是站点同时挂了两条同名的倍率记录，照报文出行。
//   2 条按张的生图（gpt-image-2.5-flare-1K / sunburst-1K，$0.009/张），1K 是分辨率后缀，归到 gpt-image-2-5。
//   group_display 里带每组的高亮与配色（CodeX-不降智 带 highlight、CodeX-特惠 带 color #008080），比价表用不到，只在组名上取 group_ratio 的键。
//   codex-auto-review 自成一个规范 id 之外的名字，没有对应模型，不给别名，让它单独出现。

const PRICE_MAP = { base: "allrouter" };

const HOSTS = ["newapi.orbitix.site"];
const PATHS = ["/","/pricing","/console/topup"];

const preset = {
  id: "orbitix",
  name: "Orbitix AI",
  baseUrl: "https://newapi.orbitix.site/pricing",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "price = 1 即「1 元 = 1 美元额度」。quota_display_type = CNY 只影响控制台额度显示，报价口径仍是美元额度。",
  rechargePlansVerified: false,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "报文里的倍率与 billing_expr 系数都是美元额度价，报价 = 官方价 × 分组倍率；price = 1、quota_per_unit = 500000、quota_display_type = CNY、usd_exchange_rate = 1、stripe_unit_price = 8。控制台按站点设置的币种显示额度，不影响这里的价格。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "orbitix",
  host: "newapi.orbitix.site",
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
  rationale: "Orbitix AI 的 /api/pricing 匿名可读，11 个模型 4 个分组、表达式全部可解析",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
