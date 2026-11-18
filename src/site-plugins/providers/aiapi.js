// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { AIAPI_MODEL_CATALOG_ENDPOINT, AIAPI_MODEL_CATALOG_FORMAT, AIAPI_PRICE_KEYS, cookiePageAuth, requestPolicy } from "../../core/provider-registry.js";

const preset = {
  id: "aiapi",
  preserveRechargeRateVerification: true,
  name: "AIAPI",
  baseUrl: "https://cn.aiapi.bot/dashboard/model-prices",
  rechargeRateVerified: false,
  rechargeRateNote: "站点充值折算尚未核验，当前仅保留站点原始报价，不用于已验证人民币成本比价。",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { kind: "aiapi-model-catalog", endpoint: AIAPI_MODEL_CATALOG_ENDPOINT, method: "GET", responseFormat: AIAPI_MODEL_CATALOG_FORMAT }
};

const pluginSource = {
  id: "aiapi",
  host: "cn.aiapi.bot",
  matches: ({ hostname, path }) => hostname === "cn.aiapi.bot" && path === "/dashboard/model-prices",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/dashboard/model-prices`,
    mode: "page",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "aiapi-model-catalog", endpoint: AIAPI_MODEL_CATALOG_ENDPOINT, method: "GET", responseFormat: AIAPI_MODEL_CATALOG_FORMAT }
  }),
  mode: "page",
  responseFormat: AIAPI_MODEL_CATALOG_FORMAT,
  openTemporaryPage: true,
  authType: "none",
  rationale: "AIAPI 通过已登录页面读取模型价格",
  preset,
  request: requestPolicy(() => AIAPI_MODEL_CATALOG_ENDPOINT, {
    priceKeys: AIAPI_PRICE_KEYS,
    credentials: "include",
    pageAuth: cookiePageAuth()
  })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
