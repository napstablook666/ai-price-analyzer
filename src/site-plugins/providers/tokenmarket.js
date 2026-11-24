// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测）：
//   /api/pricing 匿名 200，tokenflux 形状：100 个模型、20 个分组、倍率 0.08 到 3.6。
//   255 条「模型 × 分组」里 201 条文本 token 价、47 条按次、7 条按张。
//   61 个模型带 billing_expr，图片类带 img / img_cr 系数：
//   tier("standard", p*5 + cr*1.25 + img*8 + img_cr*2 + c*30)，按张的价现有解析器只算文本 token 部分。
//   1 条解析不了的是 MiniMax-H3 视频：u("resolution") == "768P" ? ... u("seconds") * 0.15 : ... u("seconds") * 0.24，
//   按秒计费用的是 u() 单位变量，不在这套表达式的支持范围里，只影响这一个视频模型。
//   充值：/api/status 里 price = 1、quota_per_unit = 500000、quota_display_type = CNY、system_name = TokenMarket，
//   即 1 元买 1 单位额度；没有真实付款，未核实。
// 站点差异只有这一句：报文形状归到 allrouter 基座。
const PRICE_MAP = { base: "allrouter" };

const preset = {
  id: "tokenmarket",
  name: "TokenMarket",
  baseUrl: "https://tokenmarket.cheap/",
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

const HOSTS = ["tokenmarket.cheap"];

const pluginSource = {
  id: "tokenmarket",
  host: "tokenmarket.cheap",
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
  rationale: "TokenMarket 的 /api/pricing 匿名可读，在售模型、分组倍率、表达式都不需要登录",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
