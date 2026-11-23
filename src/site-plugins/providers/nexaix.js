// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// NexAIX 取证（2026-11-23，登录态 /api/pricing）：7 个模型，分组 default 倍率 0.9、vip 倍率 1。
//   站是标准 new-api，报文与 kuaipao / pqh 同族，归 tokenflux 基座。
//   本机直连 nexaix.ai 期间返回 ERR_CONNECTION_CLOSED，充值口径与实际实付没取到，
//   所以 rechargeRateVerified 保持 false，倍率留给用户按实测填。
const PRICE_MAP = { base: "tokenflux" };

const RECHARGE_NOTE = "充值方案未取到：探测期间本机直连 nexaix.ai 返回 ERR_CONNECTION_CLOSED，/api/status 与收银台都没读到，倍率需按实际到手额度手填。";

const preset = {
  id: "nexaix",
  name: "NexAIX",
  baseUrl: "https://nexaix.ai/pricing",
  rechargeAuto: false,
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: RECHARGE_NOTE,
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "按站点 /api/pricing 的 model_ratio 换算，1 单位 = 2 美元/百万；分组 default 0.9、vip 1。币种未经二次核验。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "nexaix",
  host: "nexaix.ai",
  preset,
  matches: ({ hostname, path }) => hostname === "nexaix.ai" && path === "/pricing",
  prepareMatches: ({ hostname }) => hostname === "nexaix.ai",
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
  rationale: "NexAIX 的 /api/pricing 返回标准 new-api 形状，7 个模型两个分组，充值口径未取到故不锁倍率",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
