// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// AbuAPI 取证（2026-11-23，匿名直连 /api/pricing，不需要登录）：
//   /api/status 报 price = 1、recharge_rate = 1、usd_exchange_rate = 7.3、quota_per_unit = 500000，
//   即 1 元 = 1 美元额度，与 kuaipao / 91token 同档。
//   245 个模型 24 个分组，是全批最大的一家。sale_source 六种取值：ratio 115、fixed 54、
//   expression 31、official 7、fiat 3、unset 35，其中 fiat 那批带 pricing_currency: CNY
//   与 cny_per_usd: 1，换算成美元不变，不影响基座。
//   另有 34 个模型的 price 带 weekday / hour 时段分档，基座按单一价取，不区分峰谷。
//   报文形状与 kuaipao / pqh 同族，站点差异只有基座选择与充值口径。
const PRICE_MAP = { base: "tokenflux" };

const RECHARGE_NOTE = "站点 /api/status：price = 1、recharge_rate = 1、usd_exchange_rate = 7.3、quota_per_unit = 500000，判定 1 元 = 1 美元额度。充值赠送档位随时间调整，不并入按量比例。";

const preset = {
  id: "abuapi",
  name: "AbuAPI",
  baseUrl: "https://www.abuai.chat/pricing",
  rechargeAuto: false,
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: RECHARGE_NOTE,
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "额度计价，1 美元额度 = ¥1；报价 = 官方价 × 分组倍率（24 个分组，0.1–4.5）。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "abuapi",
  host: "www.abuai.chat",
  preset,
  matches: ({ hostname, path }) => hostname === "www.abuai.chat" && ["/pricing", "/console/topup"].includes(path),
  prepareMatches: ({ hostname }) => hostname === "www.abuai.chat",
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
  rationale: "AbuAPI 的 /api/pricing 匿名可读，245 个模型 24 个分组，充值口径按站点自报字段核过",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
