// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { requestPolicy, SUB2API_MODEL_PLAZA_ENDPOINT } from "../../core/provider-registry.js";

const RECHARGE_NOTE = "站点自述「充值 1:1」，另有 GPT / Claude 月卡档位；月卡是订阅不是充值，不并入按量比例。未核验第三方收银台实付。";

const preset = {
  id: "axis",
  name: "元流 API",
  baseUrl: "https://api.axis.fan/model-plaza",
  rechargeRmb: 1,
  rechargeCurrency: "CNY",
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: RECHARGE_NOTE,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "广场按美元 / 百万 token 标价，实付 = 标价 × 分组倍率；长上下文档位真实生效，全部保留。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "sub2api-model-plaza", endpoint: SUB2API_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "sub2api-model-plaza" }
};

const pluginSource = {
  id: "axis",
  host: "api.axis.fan",
  preserveRechargeRateVerification: true,
  preservePriceCurrency: true,
  matches: ({ hostname, path }) => hostname === "api.axis.fan" && path === "/model-plaza",
  prepareMatches: ({ hostname }) => hostname === "api.axis.fan",
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
  rationale: "元流 API 的模型广场接口匿名可读，直连采集分组价",
  preset,
  request: requestPolicy(() => SUB2API_MODEL_PLAZA_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
