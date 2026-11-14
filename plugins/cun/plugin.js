import { localStoragePageAuth, requestPolicy } from "@app/core/provider-registry.js";

const preset = {
  id: "cun",
  name: "CUN.AI",
  baseUrl: "https://www.cun.ai/pricing",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { kind: "cun", endpoint: "/api/pricing", method: "GET", responseFormat: "auto" }
};

export const sitePlugin = {
  id: "cun",
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
    pageAuth: localStoragePageAuth("uid", "New-Api-User", "未找到 CUN.AI 登录凭据，请先在当前 Chrome 配置文件登录后重试")
  })
};
