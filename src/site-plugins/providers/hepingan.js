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

// 站点的 auth_token 24 小时过期，过期后前端拿 localStorage 里的 refresh_token 调
// /api/v1/auth/refresh 换一对新的（refresh_token 每次都会轮换）。这里照同一套续期，
// 第一次登录过后扩展自己就能续上，不用再让用户回站点重新登录。
const pageAuth = localStoragePageAuth("auth_token", "Authorization", "未找到 Hepingan 登录凭据，请先在当前 Chrome 配置文件登录后重试", "Bearer", [401], {
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
  rationale: "Hepingan 复用当前 Chrome 配置文件的登录态，token 过期后用 refresh_token 自动续期，首次使用需登录一次",
  preset,
  request: requestPolicy(() => HEPINGAN_CHANNELS_ENDPOINT, {
    credentials: "include",
    pageAuth
  })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
