// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { NODEAI_MODEL_PLAZA_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

const preset = {
  id: "nodeai",
  name: "NodeAI",
  baseUrl: "https://nodeai.cc/model-plaza",
  rechargeRmb: 1,
  rechargeCurrency: "CNY",
  rechargeCredits: 1,
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "nodeai-model-plaza", endpoint: NODEAI_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "nodeai-model-plaza" }
};

const pluginSource = {
  id: "nodeai",
  host: "nodeai.cc",
  matches: ({ hostname, path }) => hostname === "nodeai.cc" && path === "/model-plaza",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: preset.baseUrl,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "nodeai-model-plaza", endpoint: NODEAI_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "nodeai-model-plaza" }
  }),
  mode: "direct",
  responseFormat: "nodeai-model-plaza",
  authType: "none",
  rationale: "NodeAI 通过公开模型广场 API 直连采集",
  preset,
  request: requestPolicy(() => NODEAI_MODEL_PLAZA_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
