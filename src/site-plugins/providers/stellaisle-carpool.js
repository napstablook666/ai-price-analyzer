// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import {
  requestPolicy,
  sessionProbeAuth,
  STELLAISLE_CARPOOL_ENDPOINT,
  STELLAISLE_PRICING_ENDPOINT
} from "../../core/provider-registry.js";

// 拼车中心的价格不是模型单价，而是「座位价 + 每周额度」。
// 座位折扣 = 座位价（元） / (每周额度美元 × 剩余天数 / 7)，站点额度按 1 元 = 1 美元计价，
// 所以这个折扣可以直接乘到 /api/pricing 的模型价上，等于「这车把站点价格打到几折」。
const preset = {
  id: "stellaisle-carpool",
  name: "飓星API 拼车",
  category: "paid",
  baseUrl: "https://token.stellaisle.com/carpool-market",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "拼车座位按「座位价 ÷ 期间额度」折算，站点额度 1 元 = 1 美元。座位价已含卖家折扣，押金不计入单价。",
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "折算后的额度价，1 元充值换 1 美元额度",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: {
    kind: "stellaisle-carpool",
    endpoint: STELLAISLE_CARPOOL_ENDPOINT,
    method: "GET",
    responseFormat: "stellaisle-carpool"
  }
};

// 拼车市场要登录：New API 用 HttpOnly cookie 认人，另外强制校验 New-Api-User 头，
// 这个头就是页面 localStorage 里的 uid，只能在页面上下文里取。
const pageAuth = {
  source: "localStorage",
  storageKey: "uid",
  header: "New-Api-User",
  missingMessage: "未找到飓星API 登录用户 ID，请先在当前 Chrome 配置文件登录后重试"
};

const pluginSource = {
  id: "stellaisle-carpool",
  host: "token.stellaisle.com",
  preserveRechargeRateVerification: true,
  preservePriceCurrency: true,
  matches: ({ hostname, path }) => hostname === "token.stellaisle.com" && path === "/carpool-market",
  prepareMatches: ({ hostname, path }) => hostname === "token.stellaisle.com" && path === "/carpool-market",
  prepare: (stationInput, { url }) => {
    const prepared = {
      ...stationInput,
      baseUrl: `${url.origin}/carpool-market`,
      category: "paid",
      rechargeRateVerified: true,
      mode: "page",
      auth: { type: "none" },
      adapter: {
        ...(stationInput.adapter || {}),
        kind: "stellaisle-carpool",
        endpoint: STELLAISLE_CARPOOL_ENDPOINT,
        method: "GET",
        responseFormat: "stellaisle-carpool"
      }
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
  // 拼车中心和主站同域（token.stellaisle.com），浏览器里往往已经开着主站的页面。
  // 复用那个 tab 就能读 localStorage 里的 uid，省一次开页；没有可用的才临时开一个。
  reuseAmbiguousOriginTab: true,
  openTemporaryPage: true,
  responseFormat: "stellaisle-carpool",
  authType: "cookie",
  rationale: "拼车市场要登录态，座位清单和站内定价一起读，按座位折扣折算模型价",
  preset,
  request: requestPolicy(() => STELLAISLE_CARPOOL_ENDPOINT, {
    credentials: "include",
    // 页面自己会抓 /api/pricing，抓回来的是公开定价，不是拼车报文，别让它顶掉主请求。
    skipCapture: true,
    pageAuth,
    // POST /api/user/auth/refresh 在这个部署上是 404（2026-11-25 实测，返回
    // "Invalid URL"），换不了 access token；/api/user/self 存在且要登录，
    // 而 New-API 强制校验 New-Api-User 头，所以 uid 得先从页面报进凭据仓再探。
    // 「待实测」：真实会话有效性要等 U9 在已登录的配置文件里跑一次。
    renewal: sessionProbeAuth({
      probePath: "/api/user/self",
      probeHeaders: { "New-Api-User": "{{identity}}" },
      missingMessage: "未找到飓星API 登录用户 ID，请先在当前 Chrome 配置文件登录后重试",
      failureMessage: "飓星API 登录态已失效，请在当前 Chrome 配置文件重新登录后重试"
    }),
    // 座位只有模型名，单价还在公开定价接口里。
    aux: [{ key: "pricing", endpoint: STELLAISLE_PRICING_ENDPOINT }]
  })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
