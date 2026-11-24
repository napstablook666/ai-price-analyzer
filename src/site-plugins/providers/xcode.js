// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测）：
//   /api/pricing 匿名 200，tokenflux 形状：89 个模型、26 个分组、倍率 0.15 到 3.1。
//   229 条「模型 × 分组」里 207 条文本 token 价、18 条按次、4 条按张。
//   41 个模型带 billing_expr，按次写成 tier("base", fixed(0.1)) 这种定值，按张同样走 fixed。
//   supported_endpoint 里带 deepseek-tools-search / deepseek-tools-fetch，国模工具调用也算在售项。
//   1 条解析不了的是 grok-imagine-video：tier("base", u("input_images")*0 + u("input_video_seconds")*0 + u("seconds")*0.05)，
//   按秒计费，同样卡在 u() 单位变量上，只影响这一个视频模型。
//   充值：/api/status 里 price = 1、quota_per_unit = 500000、quota_display_type = CNY、system_name = Xcode，
//   即 1 元买 1 单位额度；没有真实付款，未核实。
// 站点差异只有这一句：报文形状归到 allrouter 基座。
const PRICE_MAP = { base: "allrouter" };

const preset = {
  id: "xcode",
  name: "Xcode",
  baseUrl: "https://xcode.best/",
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

const HOSTS = ["xcode.best"];

const pluginSource = {
  id: "xcode",
  host: "xcode.best",
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
  rationale: "Xcode 的 /api/pricing 匿名可读，在售模型、分组倍率、表达式都不需要登录",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
