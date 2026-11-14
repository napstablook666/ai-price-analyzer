// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { HEPINGAN_CHANNELS_ENDPOINT, localStoragePageAuth, requestPolicy } from "../../core/provider-registry.js";

const preset = {
  id: "hepingan",
  name: "hepingan.top",
  baseUrl: "https://api.hepingan.top/available-channels",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { endpoint: HEPINGAN_CHANNELS_ENDPOINT, method: "GET", responseFormat: "auto" }
};

const pluginSource = {
  id: "hepingan",
  host: "api.hepingan.top",
  matches: ({ hostname, path }) => hostname === "api.hepingan.top" && path === "/available-channels",
  prepareMatches: ({ hostname }) => hostname === "api.hepingan.top",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/available-channels`,
    mode: "page",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), endpoint: HEPINGAN_CHANNELS_ENDPOINT, method: "GET", responseFormat: "auto" }
  }),
  mode: "page",
  openTemporaryPage: true,
  rationale: "Hepingan 复用当前 Chrome 配置文件的持久登录态，首次使用需先登录一次",
  preset,
  request: requestPolicy(() => HEPINGAN_CHANNELS_ENDPOINT, {
    credentials: "include",
    pageAuth: localStoragePageAuth("auth_token", "Authorization", "未找到 Hepingan 登录凭据，请先在当前 Chrome 配置文件登录后重试", "Bearer", [401])
  })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
