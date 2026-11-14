// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { requestPolicy, SEVENAI_MODEL_PLAZA_ENDPOINT } from "../../core/provider-registry.js";

const preset = {
  id: "sevenai",
  name: "SevenAI",
  baseUrl: "https://sevenai.moe/model-plaza?embedded=1",
  rechargeRateVerified: false,
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "sevenai-model-plaza", endpoint: SEVENAI_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "sevenai-model-plaza" }
};

const pluginSource = {
  id: "sevenai",
  preserveRechargeRateVerification: true,
  host: "sevenai.moe",
  matches: ({ hostname, path }) => hostname === "sevenai.moe" && path === "/model-plaza",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/model-plaza?embedded=1`,
    rechargeRateVerified: stationInput.rechargeRateVerified === true,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "sevenai-model-plaza", endpoint: SEVENAI_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "sevenai-model-plaza" }
  }),
  mode: "direct",
  responseFormat: "sevenai-model-plaza",
  authType: "none",
  rationale: "SevenAI 通过公开模型广场 API 直连采集",
  preset,
  request: requestPolicy(() => SEVENAI_MODEL_PLAZA_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
