import { requestPolicy, TOKENFLUX_PRICING_ENDPOINT } from "@app/core/provider-registry.js";

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

export const sitePlugin = {
  id: "tokenflux",
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
