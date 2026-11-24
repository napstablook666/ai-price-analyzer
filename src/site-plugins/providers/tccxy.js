// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测）：
//   /api/pricing 匿名 200，tokenflux 形状：103 个模型、24 个 group_ratio 键、17 个分组，倍率 0.02 到 3。
//   318 条「模型 × 分组」里 313 条都是文本 token 价，按次只有 1 条、按张 4 条，是全批最密的一家。
//   54 个模型带 billing_expr，除了长度分段，还有按 service_tier 加价的写法：
//   (tier("standard", p*0.4 + cr*0.1 + c*1.6)) * (service_tier 是 priority/fast 时 2 倍) * (ultrafast 时 6 倍)。
//   分组里有一个 0.01 倍率的福利组（帖子里写的限时 0.01 倍）。
//   充值：/api/status 里 price = 1、quota_per_unit = 500000、quota_display_type = USD，
//   即 1 元买 1 美元额度；没有真实付款，未核实。
// 站点差异只有这一句：报文形状归到 allrouter 基座（tokenflux 映射 + 图片端点规则 + billing_expr 求解）。
const PRICE_MAP = { base: "allrouter" };

const preset = {
  id: "tccxy",
  name: "甜菜程序猿",
  baseUrl: "https://api.tccxy.top/",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点 /api/status：price = 1、quota_per_unit = 500000、quota_display_type = USD、usd_exchange_rate = 1。按 New API 口径 price 是「1 美元额度的人民币价」，即 1 元 = 1 美元额度；只读了配置，没有真实付款，所以 rechargeRateVerified 为 false，也不列赠送档位。",
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "报价由 /api/pricing 的 model_ratio × 分组倍率折算成美元每百万 token（倍率 1 = $2/M），带 billing_expr 的模型以表达式为准；站内按 USD 显示额度，不影响这里的价格。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const HOSTS = ["api.tccxy.top"];

const pluginSource = {
  id: "tccxy",
  host: "api.tccxy.top",
  preset,
  matches: ({ hostname, path }) => HOSTS.includes(hostname) && ["/","/pricing","/console","/console/topup"].includes(path),
  prepareMatches: ({ hostname }) => HOSTS.includes(hostname),
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
  }),
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "甜菜程序猿 的 /api/pricing 匿名可读，在售模型、分组倍率、表达式都不需要登录",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [
  {
    "alias": "gpt-5.6-sol-openai-compact",
    "canonicalId": "gpt-5-6-sol"
  },
  {
    "alias": "claude-haiku-5-5[1m]",
    "canonicalId": "claude-haiku-5-5"
  },
  {
    "alias": "claude-haiku-5.5[1m]",
    "canonicalId": "claude-haiku-5-5"
  },
  {
    "alias": "gpt-5.5-openai-compact",
    "canonicalId": "gpt-5-5"
  },
  {
    "alias": "gpt-5.4-openai-compact",
    "canonicalId": "gpt-5-4"
  }
];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
