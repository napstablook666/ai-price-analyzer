// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 深空API 取证（2026-11-23，匿名直连 /api/pricing，不需要登录）：
//   billing_expr 52 个、按次 7 个，形状与 kuaipao 同族，model_ratio 基准 1 单位 = 2 美元/百万。
//   它比其他同族站多一个 peak_offpeak 字段（高峰期/谷时两套价），基座不消费，
//   当前采到的是基础档价，高峰期加价不体现在比价表里。
//   分组名带 × 倍率的写法（如「Gemini  x0.4」「【Claude】max外接分组可蒸馏 x 1.5」），
//   实际倍率仍以 group_ratio 为准，不从名字里解析。
// 报文形状归到 tokenflux 基座，站点差异只有基座选择与充值口径。
const PRICE_MAP = { base: "tokenflux" };

const HOSTS = ["xkrelay.com","www.xkrelay.com"];
const PATHS = ["/","/pricing","/console/topup"];

const preset = {
  id: "xkrelay",
  name: "深空API",
  baseUrl: "https://xkrelay.com/pricing",
  rechargeAuto: false,
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "站点 /api/status：quota_display_type = CUSTOM、custom_currency_symbol = ¥、price = 1、usd_exchange_rate = 1、custom_currency_exchange_rate = 1，判定 ¥1 = 1 美元额度。公告与收银台档位要登录，档位表留空。",
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "额度计价，1 元 = 1 美元额度；报价 = 官方价 × 分组倍率（0.08–1.5）。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "xkrelay",
  host: "xkrelay.com",
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
  rationale: "深空API 的 /api/pricing 匿名可读，71 个模型 26 个分组，充值口径按站点自报字段核过",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
