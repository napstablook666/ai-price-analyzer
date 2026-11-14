// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { requestPolicy, WINDHUB_PRICING_ENDPOINT } from "../../core/provider-registry.js";

const preset = {
  id: "windhub",
  name: "WindHub",
  category: "public",
  baseUrl: "https://windhub.cc/pricing",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "仅站点积分/额度 1:1 展示基准，不代表人民币成本。",
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "站点积分/额度；默认展示比例 1:1",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "windhub", endpoint: WINDHUB_PRICING_ENDPOINT, method: "GET", responseFormat: "windhub" }
};

const pluginSource = {
  id: "windhub",
  host: "windhub.cc",
  preserveRechargeRateVerification: true,
  matches: ({ hostname, path }) => hostname === "windhub.cc" && path === "/pricing",
  prepareMatches: ({ hostname }) => hostname === "windhub.cc",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/pricing`,
    category: "public",
    rechargeRateVerified: false,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "windhub", endpoint: WINDHUB_PRICING_ENDPOINT, method: "GET", responseFormat: "windhub" }
  }),
  mode: "direct",
  responseFormat: "windhub",
  authType: "none",
  rationale: "WindHub 通过公开 /api/pricing 接口直连采集",
  preset,
  request: requestPolicy(() => WINDHUB_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
