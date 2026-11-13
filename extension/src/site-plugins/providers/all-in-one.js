import { ALL_IN_ONE_MODELS_ENDPOINT, ALL_IN_ONE_PRICE_KEYS, localStoragePageAuth, requestPolicy } from "../../core/provider-registry.js";

const preset = {
  id: "all-in-one",
  name: "all-in-one.icu",
  baseUrl: "https://all-in-one.icu/#/tenant/models",
  rechargeRateVerified: false,
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { kind: "all-in-one-models", endpoint: ALL_IN_ONE_MODELS_ENDPOINT, method: "GET", responseFormat: "all-in-one-models", pageUrl: "https://all-in-one.icu/#/tenant/models" }
};

const pageAuth = localStoragePageAuth("tenant_auth", "Authorization", "未找到 all-in-one.icu 登录凭据，请先在当前 Chrome 配置文件登录后重试", "Bearer", [401, 403], null, ["state.token", "token", "state.accessToken", "accessToken"]);

export const sitePlugin = {
  id: "all-in-one",
  preserveRechargeRateVerification: true,
  host: "all-in-one.icu",
  matches: ({ hostname, path, hashPath }, station = {}) => hostname === "all-in-one.icu" && (hashPath === "/tenant/models" || (path === "/" && station.adapter?.kind === "all-in-one-models")),
  prepareMatches: ({ hostname, path, hashPath }, station = {}) => hostname === "all-in-one.icu" && (hashPath === "/tenant/models" || (path === "/" && station.adapter?.kind === "all-in-one-models")),
  prepare: (stationInput, { url }) => {
    const prepared = {
      ...stationInput,
      baseUrl: `${url.origin}/#/tenant/models`,
      mode: "page",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), kind: "all-in-one-models", endpoint: ALL_IN_ONE_MODELS_ENDPOINT, method: "GET", responseFormat: "all-in-one-models", pageUrl: `${url.origin}/#/tenant/models` }
    };
    if (typeof prepared.rechargeRateVerified !== "boolean") prepared.rechargeRateVerified = preset.rechargeRateVerified;
    if (!prepared.priceCurrency) prepared.priceCurrency = preset.priceCurrency;
    if (typeof prepared.priceCurrencyVerified !== "boolean") prepared.priceCurrencyVerified = preset.priceCurrencyVerified;
    return prepared;
  },
  mode: "page",
  openTemporaryPage: true,
  responseFormat: "all-in-one-models",
  authType: "none",
  rationale: "all-in-one.icu 通过已登录页面读取租户模型价格",
  preset,
  request: requestPolicy(() => ALL_IN_ONE_MODELS_ENDPOINT, {
    priceKeys: ALL_IN_ONE_PRICE_KEYS,
    credentials: "include",
    pageAuth,
    skipCapture: true
  })
};
