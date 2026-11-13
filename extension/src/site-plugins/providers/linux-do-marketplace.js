import { LINUX_DO_MARKETPLACE_URL, localStoragePageAuth, requestPolicy } from "../../core/provider-registry.js";

const preset = {
  id: "linux-do-marketplace",
  name: "Linux.do Marketplace",
  category: "public",
  baseUrl: LINUX_DO_MARKETPLACE_URL,
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "仅站点积分/额度 1:1 展示基准，不代表人民币成本。",
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "站点积分/额度；仅为 1:1 展示基准，不代表人民币成本",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { kind: "linux-do-marketplace", endpoint: "/admin/graphql", method: "POST", responseFormat: "linux-do-marketplace" }
};

export const sitePlugin = {
  id: "linux-do-marketplace",
  host: "hub.linux.do",
  preserveRechargeRateVerification: true,
  matches: ({ hostname, path }) => hostname === "hub.linux.do" && path === "/marketplace",
  prepareMatches: ({ hostname }) => hostname === "hub.linux.do",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/marketplace`,
    category: "public",
    rechargeRateVerified: false,
    mode: "page",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "linux-do-marketplace", endpoint: "/admin/graphql", method: "POST", responseFormat: "linux-do-marketplace" }
  }),
  mode: "page",
  responseFormat: "linux-do-marketplace",
  authType: "none",
  openTemporaryPage: true,
  rationale: "Linux.do Marketplace 通过已登录页面会话读取只读 GraphQL 价格",
  preset,
  request: requestPolicy(() => "/admin/graphql", {
    credentials: "same-origin",
    pageHeaders: ["Content-Type"],
    pageAuth: localStoragePageAuth("axonhub_access_token", "Authorization", "未找到 Linux.do 登录凭据，请先在当前 Chrome 配置文件登录后重试", "Bearer", [401, 403]),
    preflight: { endpoint: "/admin/system/price-version", method: "GET" },
    skipCapture: true
  })
};
