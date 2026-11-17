// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { KILLAI_PRICING_ENDPOINT, cookieRefreshAuth, requestPolicy } from "../../core/provider-registry.js";

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
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "killai-pricing", endpoint: KILLAI_PRICING_ENDPOINT, method: "GET", responseFormat: "pqh" }
};

// 登录态只在 HttpOnly cookie 里，刷新接口还校验 Origin，交给 service worker 用 DNR 换 token。
const cookieAuth = cookieRefreshAuth({
  cookieName: "new_api_refresh",
  refreshPath: "/api/user/auth/refresh",
  accessTokenPath: "data.access_token",
  expiresAtPath: "data.access_expires_at",
  missingMessage: "未找到 KillAI 登录凭据，请先在当前 Chrome 配置文件登录后重试",
  failureMessage: "KillAI 登录态已失效，请在当前 Chrome 配置文件重新登录后重试"
});

const pluginSource = {
  id: "killai",
  host: "api.killai.cc",
  preserveRechargeRateVerification: true,
  preservePriceCurrency: true,
  matches: ({ hostname, path }) => hostname === "api.killai.cc" && (path === "/pricing" || path === "/model-plaza"),
  prepare: (stationInput, { url }) => {
    const prepared = {
      ...stationInput,
      baseUrl: `${url.origin}/pricing`,
      mode: "direct",
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
  mode: "direct",
  responseFormat: "pqh",
  authType: "none",
  rationale: "KillAI 用 cookie 登录态在后台换 token 后直连 New API 价格接口",
  preset,
  request: requestPolicy(() => KILLAI_PRICING_ENDPOINT, { cookieAuth })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
