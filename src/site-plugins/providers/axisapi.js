// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测）：
//   /api/pricing 匿名 200，tokenflux 形状：35 个模型、13 个分组。分组名都是渠道名：
//   claude-kiro 0.2、claude-max 0.8、codex 0.25、ds 0.3、gemini-Antigravity 0.5、gml 0.2、
//   minmax 0.2、video 1、生图 0.2、福利分组 0.001，另有「勿选测试渠道」10 倍。
//   67 条「模型 × 分组」里 61 条文本 token 价、6 条按次，没有按张；35 个模型全部带 billing_expr。
//   DeepSeek 三个走分时双倍（这批里和三家里写法一样）：
//   (tier("base", p*1 + c*4 + cr*0.02)) * (hour("Asia/Shanghai") 9-12 时 2 倍) * (14-18 时 2 倍)。
//   注意别和已装的 axis（api.axis.fan 元流）混了：那家是另一个站，id 不同、报文不同。
//   充值：/api/status 里 price = 1、quota_per_unit = 500000、quota_display_type = CNY、system_name = Axis Api，
//   即 1 元买 1 单位额度；没有真实付款，未核实。
// 站点差异只有这一句：报文形状归到 allrouter 基座。
const PRICE_MAP = { base: "allrouter" };

const preset = {
  id: "axisapi",
  name: "Axis API",
  baseUrl: "https://axisapi.cn/",
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

const HOSTS = ["axisapi.cn"];

const pluginSource = {
  id: "axisapi",
  host: "axisapi.cn",
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
  rationale: "Axis API 的 /api/pricing 匿名可读，在售模型、分组倍率、表达式都不需要登录",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
