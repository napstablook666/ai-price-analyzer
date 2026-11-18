// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { NEXA_CHANNEL_CATALOG_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

const preset = {
  id: "nexavlinks",
  name: "NexaVlinks",
  baseUrl: "https://www.nexavlinks.com/modelsmarket",
  rechargeRateVerified: false,
  rechargeRateNote: "站点充值折算尚未核验，当前仅保留站点原始报价，不用于已验证人民币成本比价。",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { endpoint: NEXA_CHANNEL_CATALOG_ENDPOINT, method: "GET", responseFormat: "auto" }
};

const pluginSource = {
  id: "nexavlinks",
  preserveRechargeRateVerification: true,
  host: "nexavlinks.com",
  matches: ({ hostname }) => hostname === "nexavlinks.com",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/modelsmarket`,
    mode: "page",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), endpoint: NEXA_CHANNEL_CATALOG_ENDPOINT, method: "GET", responseFormat: "auto" }
  }),
  mode: "page",
  openTemporaryPage: true,
  rationale: "NexaVlinks 通过已登录页面读取模型渠道",
  preset,
  request: requestPolicy(() => NEXA_CHANNEL_CATALOG_ENDPOINT, { credentials: "include" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
