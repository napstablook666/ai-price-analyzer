// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { requestPolicy, TRUE_SOTA_MODEL_PRICING_ENDPOINT } from "../../core/provider-registry.js";

const preset = {
  id: "true-sota",
  name: "TrueSOTA",
  baseUrl: "https://true-sota.com/model-pricing",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "true-sota-model-pricing", endpoint: TRUE_SOTA_MODEL_PRICING_ENDPOINT, method: "GET", responseFormat: "auto" }
};

const pluginSource = {
  id: "true-sota",
  host: "true-sota.com",
  matches: ({ hostname, path }) => hostname === "true-sota.com" && path === "/model-pricing",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/model-pricing`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "true-sota-model-pricing", endpoint: TRUE_SOTA_MODEL_PRICING_ENDPOINT, method: "GET", responseFormat: "auto" }
  }),
  mode: "direct",
  authType: "none",
  rationale: "TrueSOTA 通过公开模型价格 API 采集",
  preset,
  request: requestPolicy(() => TRUE_SOTA_MODEL_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
