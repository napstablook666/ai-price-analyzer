// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { ALL_IN_ONE_MODELS_ENDPOINT, ALL_IN_ONE_PRICE_KEYS, localStoragePageAuth, requestPolicy } from "../../core/provider-registry.js";

const preset = {
  id: "all-in-one",
  name: "all-in-one.icu",
  baseUrl: "https://all-in-one.icu/#/tenant/models",
  rechargeRateVerified: false,
  priceCurrency: "CNY",
  priceCurrencyVerified: true,
  priceCurrencyNote: "站点按站点设置 billing_currency 报价，当前为 CNY 元/百万 tokens。",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { kind: "all-in-one-models", endpoint: ALL_IN_ONE_MODELS_ENDPOINT, method: "GET", responseFormat: "all-in-one-models", pageUrl: "https://all-in-one.icu/#/tenant/models" }
};

// 站点把 JWT 平铺存在 tenant_access_token（记住我关闭时落到 sessionStorage），
// 过期后用 tenant_refresh_token 调 /api/tenant/auth/refresh 续期。
const pageAuth = localStoragePageAuth("tenant_access_token", "Authorization", "未找到 all-in-one.icu 登录凭据，请先在当前 Chrome 配置文件登录后重试", "Bearer", [401, 403], {
  endpoint: "/api/tenant/auth/refresh",
  credentials: "same-origin",
  requestTokenKey: "refresh_token",
  responsePath: "data",
  accessTokenKey: "access_token",
  refreshTokenStorageKey: "tenant_refresh_token",
  refreshTokenKey: "refresh_token",
  statuses: [401, 403]
});

const pluginSource = {
  id: "all-in-one",
  preserveRechargeRateVerification: true,
  preservePriceCurrency: true,
  host: "all-in-one.icu",
  // 整域归本站：旧配置可能还指着 `#/console` 之类的历史路由，只按 host 认站点，
  // prepare 会把 baseUrl/模式/适配器一起刷成当前页面。
  matches: ({ hostname }) => hostname === "all-in-one.icu",
  prepareMatches: ({ hostname }) => hostname === "all-in-one.icu",
  prepare: (stationInput, { url }) => {
    const prepared = {
      ...stationInput,
      baseUrl: `${url.origin}/#/tenant/models`,
      mode: "page",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), kind: "all-in-one-models", endpoint: ALL_IN_ONE_MODELS_ENDPOINT, method: "GET", responseFormat: "all-in-one-models", pageUrl: `${url.origin}/#/tenant/models` }
    };
    if (typeof prepared.rechargeRateVerified !== "boolean") prepared.rechargeRateVerified = preset.rechargeRateVerified;
    if (!prepared.priceCurrency || prepared.priceCurrency === "UNKNOWN") prepared.priceCurrency = preset.priceCurrency;
    if (typeof prepared.priceCurrencyVerified !== "boolean") prepared.priceCurrencyVerified = preset.priceCurrencyVerified;
    if (prepared.priceCurrencyNote == null) prepared.priceCurrencyNote = preset.priceCurrencyNote;
    return prepared;
  },
  mode: "page",
  openTemporaryPage: true,
  reuseAmbiguousOriginTab: true,
  responseFormat: "all-in-one-models",
  authType: "none",
  rationale: "all-in-one.icu 用租户页面会话读取模型价格，报价单位是站点设置的结算币种",
  preset,
  request: requestPolicy(() => ALL_IN_ONE_MODELS_ENDPOINT, {
    priceKeys: ALL_IN_ONE_PRICE_KEYS,
    credentials: "include",
    pageAuth,
    skipCapture: true
  })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
