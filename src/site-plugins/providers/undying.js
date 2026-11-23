// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// Undy API 取证（2026-11-23，匿名直连 /api/pricing，不需要登录）：
//   undyapi.com 的 /api/pricing 匿名可读（/api/status 里 pricing.requireAuth = false），88 个模型 75 个分组。
//   报文是 new-api 新版形状：data[] + group_ratio + usable_group + vendors + supported_endpoint + pricing_version，
//   比 A 类其余站多了 vendors（Google/OpenAI/Anthropic/DeepSeek 带图标名）与 supported_endpoint
//   （anthropic /v1/messages、gemini /v1beta/models/{model}:generateContent、image-generation 等端点表）。
//   billing_expr 54 个，tier("base", p * x + c * y + cr * z) 形态，系数即美元/百万 token；
//   其中带长上下文分支的写法是 (len <= 200000) ? tier("tier_1", ...) : tier("tier_2", ...)，按段价求值。
//   4 个 quota_type = 1 的按次模型全是 gemini 出图（model_price 0.15 / 0.1655 / 0.3 / 0.33 美元一张）。
//   model_ratio 基准与 tokenflux 基座一致（1 单位 = 2 美元/百万），不需要 ratioBase 覆盖。
//   本站此前探测是 500 不可达，2026-11-23 复测恢复，接口形态与 A 类同族。
// 报文形状归到 tokenflux 基座，站点差异只有基座选择与充值口径。
const PRICE_MAP = { base: "tokenflux" };

const HOSTS = ["undyapi.com","www.undyapi.com"];
const PATHS = ["/","/pricing","/console/topup"];

const preset = {
  id: "undying",
  name: "Undy API",
  baseUrl: "https://undyapi.com/pricing",
  rechargeAuto: false,
  rechargeRmb: 7.3,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点 /api/status：price = 1、usd_exchange_rate = 7.3、custom_currency_exchange_rate = 1、quota_display_type = USD、quota_per_unit = 500000，另有 stripe_unit_price = 8。price 与 usd_exchange_rate 不同值，按 usd_exchange_rate 记 1 美元额度 = ¥7.3，标未核（与 4zapi、corecode 同一类冲突，缺收银台这一证）。",
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "额度计价，1 美元额度 ≈ ¥7.3；报价 = 官方价 × 分组倍率（0.37–11）。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "undying",
  host: "undyapi.com",
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
  rationale: "Undy API 的 /api/pricing 匿名可读，88 个模型 75 个分组，充值口径按站点自报字段核过",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
