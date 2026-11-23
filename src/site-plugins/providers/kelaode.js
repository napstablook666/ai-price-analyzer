// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { KELAODE_MODEL_PLAZA_ENDPOINT, localStoragePageAuth, requestPolicy } from "../../core/provider-registry.js";

const preset = {
  id: "kelaode",
  name: "克劳德 APi",
  baseUrl: "https://api.kelaode.si/model-plaza",
  // 收银台实测：面额 100 元 → 支付金额 ¥100.00 + 手续费 (4%) ¥4.00 = 实付 ¥104.00，
  // 到账按面额 1:1 记美元额度（recharge_bonus_tiers 为空，没有赠送档位）。
  rechargeRmb: 1.04,
  rechargeCurrency: "CNY",
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "站点标价 1 元 = 1 美元额度，收银台另外收 4% 手续费：充 100 元实付 ¥104.00、到账 $100。折算 1 美元额度 = ¥1.04。单笔 20–2000 元，只有支付宝（easypay）一个渠道，没有赠送档位。",
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { kind: "kelaode-model-plaza", endpoint: KELAODE_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "kelaode-model-plaza" }
};

// 模型广场要求登录（settings/public 里 model_plaza_require_auth = true），登录态只在 localStorage：
// auth_token 过期后，前端拿 refresh_token 调 /api/v1/auth/refresh 换一对新的，refresh_token 每次轮换。
// 这里照同一套续期，用户在浏览器登录过一次之后，扩展自己就能续上。
const pageAuth = localStoragePageAuth("auth_token", "Authorization", "未找到克劳德 APi 登录凭据，请先在当前 Chrome 配置文件登录后重试", "Bearer", [401], {
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
  id: "kelaode",
  host: "api.kelaode.si",
  preserveRechargeRateVerification: true,
  preservePriceCurrency: true,
  matches: ({ hostname, path }) => hostname === "api.kelaode.si" && path.startsWith("/model-plaza"),
  prepareMatches: ({ hostname }) => hostname === "api.kelaode.si",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/model-plaza`,
    mode: "page",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "kelaode-model-plaza", endpoint: KELAODE_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "kelaode-model-plaza" }
  }),
  mode: "page",
  openTemporaryPage: true,
  rationale: "克劳德 APi 的模型广场要求登录，扩展复用当前 Chrome 配置文件的登录态，token 过期后用 refresh_token 自动续期",
  preset,
  request: requestPolicy(() => KELAODE_MODEL_PLAZA_ENDPOINT, {
    credentials: "include",
    pageAuth
  })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
