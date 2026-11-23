// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { requestPolicy, SUB2API_MODEL_PLAZA_ENDPOINT } from "../../core/provider-registry.js";

const RECHARGE_NOTE = "站点标价 1 元 = 1 美元额度，单笔最低 10 元；未核验第三方收银台实付与赠送档位。";

const preset = {
  id: "crab",
  name: "Crab-AI",
  baseUrl: "https://crab-ai.net/model-plaza",
  rechargeRmb: 1,
  rechargeCurrency: "CNY",
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: RECHARGE_NOTE,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "广场按美元 / 百万 token 标价，实付 = 标价 × 分组倍率；codex-pro 组 0.12、bugteam 组 1。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "sub2api-model-plaza", endpoint: SUB2API_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "sub2api-model-plaza" }
};

const pluginSource = {
  id: "crab",
  host: "crab-ai.net",
  preserveRechargeRateVerification: true,
  preservePriceCurrency: true,
  matches: ({ hostname, path }) => hostname === "crab-ai.net" && path === "/model-plaza",
  prepareMatches: ({ hostname }) => hostname === "crab-ai.net",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/model-plaza`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "sub2api-model-plaza", endpoint: SUB2API_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "sub2api-model-plaza" }
  }),
  mode: "direct",
  responseFormat: "sub2api-model-plaza",
  authType: "none",
  rationale: "Crab-AI 的模型广场接口匿名可读，直连采集分组价",
  preset,
  request: requestPolicy(() => SUB2API_MODEL_PLAZA_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
