// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { localStoragePageAuth, requestPolicy, SUB2API_MODEL_PLAZA_ENDPOINT } from "../../core/provider-registry.js";

const RECHARGE_NOTE = "站点标价 1 元 = 1 美元额度，另按充值金额分档赠送（自述 33%~100%），赠送档位随时间调整，不并入按量比例；未核验第三方收银台实付。";

const preset = {
  id: "initapi",
  name: "初元 API",
  baseUrl: "https://initapi.ai/model-plaza",
  rechargeRmb: 1,
  rechargeCurrency: "CNY",
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: RECHARGE_NOTE,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "广场按美元 / 百万 token 标价，实付 = 标价 × 分组倍率；13 个分组从 0.05 到 1，长上下文档位全部保留。",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { kind: "sub2api-model-plaza", endpoint: SUB2API_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "sub2api-model-plaza" }
};

// 模型广场要求登录：匿名请求返回 401。登录态只在 localStorage，auth_token 过期后用 refresh_token
// 调 /api/v1/auth/refresh 换一对新的，refresh_token 每次轮换。和克劳德 APi 同一套 sub2api 面板。
const pageAuth = localStoragePageAuth("auth_token", "Authorization", "未找到初元 API 登录凭据，请先在当前 Chrome 配置文件登录后重试", "Bearer", [401], {
  endpoint: "/api/v1/auth/refresh",
  credentials: "same-origin",
  requestTokenKey: "refresh_token",
  responsePath: "data",
  accessTokenKey: "access_token",
  refreshTokenStorageKey: "refresh_token",
  refreshTokenKey: "refresh_token",
  expiresInKey: "expires_in",
  expiresAtStorageKey: "token_expires_at",
  statuses: [401]
});

const pluginSource = {
  id: "initapi",
  host: "initapi.ai",
  preserveRechargeRateVerification: true,
  preservePriceCurrency: true,
  matches: ({ hostname, path }) => hostname === "initapi.ai" && path === "/model-plaza",
  prepareMatches: ({ hostname }) => hostname === "initapi.ai",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/model-plaza`,
    mode: "page",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "sub2api-model-plaza", endpoint: SUB2API_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "sub2api-model-plaza" }
  }),
  mode: "page",
  openTemporaryPage: true,
  responseFormat: "sub2api-model-plaza",
  authType: "none",
  rationale: "初元 API 的模型广场要求登录，扩展复用当前 Chrome 配置文件的登录态，token 过期后用 refresh_token 自动续期",
  preset,
  request: requestPolicy(() => SUB2API_MODEL_PLAZA_ENDPOINT, {
    credentials: "include",
    pageAuth
  })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
