// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { CHEAP_ROUTER_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

const preset = {
  id: "cheaprouter",
  preserveRechargeRateVerification: true,
  name: "cheaprouter.cc",
  baseUrl: "https://cheaprouter.cc/models",
  rechargeRateVerified: false,
  rechargeRateNote: "站点充值折算尚未核验，当前仅保留站点原始报价，不用于已验证人民币成本比价。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "cheaprouter", endpoint: CHEAP_ROUTER_PRICING_ENDPOINT, method: "GET", responseFormat: "auto" }
};

const pluginSource = {
  id: "cheaprouter",
  host: "cheaprouter.cc",
  matches: ({ hostname, path }) => hostname === "cheaprouter.cc" && path === "/models",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/models`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "cheaprouter", endpoint: CHEAP_ROUTER_PRICING_ENDPOINT, method: "GET", responseFormat: "auto" }
  }),
  mode: "direct",
  rationale: "CheapRouter 通过公开模型价格 API 直连采集",
  preset,
  request: requestPolicy(() => CHEAP_ROUTER_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
