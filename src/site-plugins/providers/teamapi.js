// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测）：
//   /api/pricing 匿名 200，tokenflux 形状：77 个模型，group_ratio 只有 2 个键（0.95 与 1）。
//   190 条「模型 × 分组」里 178 条文本 token 价、12 条按次；完全没有按张。
//   71 个模型把价写在 billing_expr 里，系数是带小数的美元价（例如 p*0.801369863014 + c*2.40410958904 + cr*0.0267123287672），
//   说明站点直接按官方美元价乘倍率生成表达式，不是 ratio 换算。
//   报文额外带 channel_routes、reference_prices、tool_prices、claude_plus_offer、gemini_offer，解析器用不上，不做处理。
//   充值：/api/status 里 price = 7.3、quota_display_type = CNY、system_name = 糯米云，即 7.3 元买 1 美元额度；没有真实付款，未核实。
// 站点差异只有这一句：报文形状归到 allrouter 基座（tokenflux 映射 + 图片端点规则 + billing_expr 求解）。
const PRICE_MAP = { base: "allrouter" };

const preset = {
  id: "teamapi",
  name: "TeamAPI",
  baseUrl: "https://teamapi.chat/",
  rechargeRmb: 7.3,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点 /api/status：price = 7.3、quota_per_unit = 500000、quota_display_type = CNY、usd_exchange_rate = 7.3。按 New API 口径 price 是「1 美元额度的人民币价」，即 7.3 元 = 1 美元额度；只读了配置，没有真实付款，所以 rechargeRateVerified 为 false，也不列赠送档位。",
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "报价由 /api/pricing 的 model_ratio × 分组倍率折算成美元每百万 token（倍率 1 = $2/M），带 billing_expr 的模型以表达式为准；站内按 CNY 显示额度，不影响这里的价格。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const HOSTS = ["teamapi.chat"];

const pluginSource = {
  id: "teamapi",
  host: "teamapi.chat",
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
  rationale: "TeamAPI 的 /api/pricing 匿名可读，在售模型、分组倍率、表达式都不需要登录",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
