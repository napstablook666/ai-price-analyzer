import { KILLAI_PRICING_ENDPOINT, localStoragePageAuth, requestPolicy } from "@app/core/provider-registry.js";

const preset = {
  id: "killai",
  name: "KillAI",
  baseUrl: "https://api.killai.cc/pricing",
  rechargeRmb: 1,
  rechargeCurrency: "CNY",
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "KillAI 充值折算尚未核验，当前不参与已验证比价推荐。",
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { kind: "killai-pricing", endpoint: KILLAI_PRICING_ENDPOINT, method: "GET", responseFormat: "pqh" }
};

const pageAuth = localStoragePageAuth("auth_token", "Authorization", "未找到 KillAI 登录凭据，请先在当前 Chrome 配置文件登录后重试", "Bearer", [401], {
  endpoint: "/api/user/auth/refresh",
  credentials: "same-origin",
  cookieOnly: true,
  responsePath: "data",
  accessTokenKey: "access_token",
  refreshTokenKey: "refresh_token",
  expiresInKey: "expires_in",
  expiresAtStorageKey: "token_expires_at"
});

export const sitePlugin = {
  id: "killai",
  host: "api.killai.cc",
  preserveRechargeRateVerification: true,
  preservePriceCurrency: true,
  matches: ({ hostname, path }) => hostname === "api.killai.cc" && (path === "/pricing" || path === "/model-plaza"),
  prepare: (stationInput, { url }) => {
    const prepared = {
      ...stationInput,
      baseUrl: `${url.origin}/pricing`,
      mode: "page",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), kind: "killai-pricing", endpoint: KILLAI_PRICING_ENDPOINT, method: "GET", responseFormat: "pqh" }
    };
    if (prepared.rechargeRmb == null) prepared.rechargeRmb = preset.rechargeRmb;
    if (prepared.rechargeCredits == null) prepared.rechargeCredits = preset.rechargeCredits;
    if (typeof prepared.rechargeRateVerified !== "boolean") prepared.rechargeRateVerified = preset.rechargeRateVerified;
    if (prepared.rechargeRateNote == null) prepared.rechargeRateNote = preset.rechargeRateNote;
    if (!prepared.priceCurrency || prepared.priceCurrency === "UNKNOWN") prepared.priceCurrency = preset.priceCurrency;
    if (typeof prepared.priceCurrencyVerified !== "boolean") prepared.priceCurrencyVerified = preset.priceCurrencyVerified;
    if (prepared.priceCurrencyNote == null) prepared.priceCurrencyNote = preset.priceCurrencyNote;
    return prepared;
  },
  mode: "page",
  openTemporaryPage: true,
  responseFormat: "pqh",
  authType: "none",
  rationale: "KillAI 通过已登录页面读取 New API 价格接口",
  preset,
  request: requestPolicy(() => KILLAI_PRICING_ENDPOINT, { credentials: "include", pageAuth })
};
