// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测）：
//   /api/pricing 匿名 200，tokenflux 形状：42 个模型、9 个 group_ratio 键、倍率 0.08 到 1.3。
//   99 条「模型 × 分组」里 95 条文本 token 价、4 条按张，没有按次。
//   26 个模型带 billing_expr：
//   len <= 272000 ? tier("standard", p*1 + c*6 + cr*0.1 + cc*1.2) : tier("long_context", p*2 + c*9 + cr*0.2 + cc*2.4)，
//   长上下文整体翻倍，缓存写按 cc 系数单列。
//   充值：/api/status 里 price = 1、quota_per_unit = 500000、quota_display_type = USD、system_name = 云续中转站，即 1 元买 1 美元额度；没有真实付款，未核实。
// 站点差异只有这一句：报文形状归到 allrouter 基座（tokenflux 映射 + 图片端点规则 + billing_expr 求解）。
const PRICE_MAP = { base: "allrouter" };

const preset = {
  id: "yunxuai",
  name: "云续AI",
  baseUrl: "https://api.yunxuai.cc/",
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

const HOSTS = ["api.yunxuai.cc"];

const pluginSource = {
  id: "yunxuai",
  host: "api.yunxuai.cc",
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
  rationale: "云续AI 的 /api/pricing 匿名可读，在售模型、分组倍率、表达式都不需要登录",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
