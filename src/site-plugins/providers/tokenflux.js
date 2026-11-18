// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { requestPolicy, TOKENFLUX_PRICING_ENDPOINT } from "../../core/provider-registry.js";

const preset = {
  id: "tokenflux",
  name: "TokenFlux",
  baseUrl: "https://tokenflux.cloud/pricing",
  rechargeRateVerified: false,
  rechargeRateNote: "TokenFlux 未公开充值折算，当前不参与已验证比价推荐。",
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "tokenflux", endpoint: TOKENFLUX_PRICING_ENDPOINT, method: "GET", responseFormat: "tokenflux" }
};

const pluginSource = {
  id: "tokenflux",
  preserveRechargeRateVerification: true,
  host: "tokenflux.cloud",
  matches: ({ hostname, path }) => hostname === "tokenflux.cloud" && ["/", "/pricing"].includes(path),
  prepareMatches: ({ hostname }) => hostname === "tokenflux.cloud",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/pricing`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "tokenflux", endpoint: TOKENFLUX_PRICING_ENDPOINT, method: "GET", responseFormat: "tokenflux" }
  }),
  mode: "direct",
  responseFormat: "tokenflux",
  authType: "none",
  rationale: "TokenFlux 通过公开定价 API 直连采集",
  preset,
  request: requestPolicy(() => TOKENFLUX_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
