// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { CENTOS_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

const preset = {
  id: "centos",
  name: "ai.centos.hk",
  baseUrl: "https://ai.centos.hk/pricing",
  rechargeRateVerified: false,
  rechargeRateNote: "ai.centos.hk 充值折算尚未核验，当前不参与已验证比价推荐。",
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "tokenflux", endpoint: CENTOS_PRICING_ENDPOINT, method: "GET", responseFormat: "tokenflux" }
};

const pluginSource = {
  id: "centos",
  host: "ai.centos.hk",
  preserveRechargeRateVerification: true,
  matches: ({ hostname, path, url }) => hostname === "ai.centos.hk" && url?.hostname === "ai.centos.hk" && path === "/pricing",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/pricing`,
    rechargeRateVerified: stationInput.rechargeRateVerified === true,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "tokenflux", endpoint: CENTOS_PRICING_ENDPOINT, method: "GET", responseFormat: "tokenflux" }
  }),
  mode: "direct",
  responseFormat: "tokenflux",
  authType: "none",
  rationale: "ai.centos.hk 通过公开定价 API 直连采集",
  preset,
  request: requestPolicy(() => CENTOS_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
