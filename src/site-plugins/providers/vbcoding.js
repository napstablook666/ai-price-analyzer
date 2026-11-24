// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测）：
//   /api/pricing 匿名 200，tokenflux 形状：49 个模型、9 个 group_ratio 键、倍率 0.14 到 5.6666。
//   96 条「模型 × 分组」里 82 条文本 token 价、14 条按次、没有按张。
//   12 个模型带 billing_expr，分档点是 100k 而不是 272k：
//   len <= 100000 ? tier("0_100k", p*0.1 + c*0.5 + cr*0.01 + cc*0.125 + cc1h*0.2) : tier("100k_plus", p*0.5 + c*2.5 + ...)，
//   超长上下文按 5 倍收，同时还单列 1 小时缓存写（cc1h）。
//   老域名 vbcoding.cc 2026-11-24 已打不开（fetch 与 curl 都不通），所以只挂 new.vbcoding.cc。
//   充值：/api/status 里 price = 1、quota_per_unit = 500000、quota_display_type = CNY，即 1 元买 1 单位额度；没有真实付款，未核实。
// 站点差异只有这一句：报文形状归到 allrouter 基座（tokenflux 映射 + 图片端点规则 + billing_expr 求解）。
const PRICE_MAP = { base: "allrouter" };

const preset = {
  id: "vbcoding",
  name: "VBCoding",
  baseUrl: "https://new.vbcoding.cc/",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点 /api/status：price = 1、quota_per_unit = 500000、quota_display_type = CNY、usd_exchange_rate = 1。按 New API 口径 price 是「1 美元额度的人民币价」，即 1 元 = 1 美元额度；只读了配置，没有真实付款，所以 rechargeRateVerified 为 false，也不列赠送档位。",
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "报价由 /api/pricing 的 model_ratio × 分组倍率折算成美元每百万 token（倍率 1 = $2/M），带 billing_expr 的模型以表达式为准；站内按 CNY 显示额度，不影响这里的价格。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const HOSTS = ["new.vbcoding.cc"];

const pluginSource = {
  id: "vbcoding",
  host: "new.vbcoding.cc",
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
  rationale: "VBCoding 的 /api/pricing 匿名可读，在售模型、分组倍率、表达式都不需要登录",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
