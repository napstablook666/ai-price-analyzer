// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { localStoragePageAuth, requestPolicy, sessionProbeAuth } from "../../core/provider-registry.js";

const preset = {
  id: "cun",
  name: "CUN.AI",
  baseUrl: "https://www.cun.ai/pricing",
  rechargeRateVerified: false,
  rechargeRateNote: "站点充值折算尚未核验，当前仅保留站点原始报价，不用于已验证人民币成本比价。",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { kind: "cun", endpoint: "/api/pricing", method: "GET", responseFormat: "auto" }
};

const pluginSource = {
  id: "cun",
  preserveRechargeRateVerification: true,
  host: "cun.ai",
  matches: ({ hostname, path }) => hostname === "cun.ai" && ["/", "/pricing"].includes(path),
  prepareMatches: ({ hostname }) => hostname === "cun.ai",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/pricing`,
    mode: "page",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "cun", endpoint: "/api/pricing", method: "GET", responseFormat: "auto" }
  }),
  mode: "page",
  openTemporaryPage: true,
  authType: "none",
  rationale: "CUN.AI 通过已登录页面读取价格 API",
  preset,
  request: requestPolicy(() => "/api/pricing", {
    credentials: "include",
    pageAuth: localStoragePageAuth("uid", "New-Api-User", "未找到 CUN.AI 登录凭据，请先在当前 Chrome 配置文件登录后重试"),
    // POST /api/user/auth/refresh 在这个部署上是 404（2026-11-25 实测，返回
    // "Invalid URL"），换不了 access token；/api/user/self 存在且要登录，
    // 而 New-API 强制校验 New-Api-User 头，所以 uid 得先从页面报进凭据仓再探。
    // 「待实测」：真实会话有效性要等 U9 在已登录的配置文件里跑一次。
    renewal: sessionProbeAuth({
      probePath: "/api/user/self",
      probeHeaders: { "New-Api-User": "{{identity}}" },
      missingMessage: "未找到 CUN.AI 登录凭据，请先在当前 Chrome 配置文件登录后重试",
      failureMessage: "CUN.AI 登录态已失效，请在当前 Chrome 配置文件重新登录后重试"
    })
  })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
