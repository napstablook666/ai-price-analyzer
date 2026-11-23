// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { NEXA_CHANNEL_CATALOG_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

const preset = {
  id: "man8out",
  name: "Man8Out",
  baseUrl: "https://ai.man8out.com/modelsmarket",
  preserveRechargeRateVerification: true,
  rechargeRateVerified: false,
  rechargeRateNote: "站点充值折算尚未核验：/api/v1/payment/config 与 /api/v1/payment/limits 匿名返回 401 Authorization header is required，需登录后补一次收银台金额。当前仅保留站点原始报价，不用于已验证人民币成本比价。",
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { endpoint: NEXA_CHANNEL_CATALOG_ENDPOINT, method: "GET", responseFormat: "auto" }
};

const pluginSource = {
  preservePriceCurrency: true,
  preserveRechargeRateVerification: true,
  id: "man8out",
  host: "ai.man8out.com",
  matches: ({ hostname }) => hostname === "ai.man8out.com",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/modelsmarket`,
    rechargeRateVerified: stationInput.rechargeRateVerified === true,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), endpoint: NEXA_CHANNEL_CATALOG_ENDPOINT, method: "GET", responseFormat: "auto" }
  }),
  mode: "direct",
  responseFormat: "auto",
  authType: "none",
  rationale: "Man8Out 的渠道目录接口匿名可读，直连采集",
  preset,
  request: requestPolicy(() => NEXA_CHANNEL_CATALOG_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
