// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 浏览器实测，node 侧 403 Just a moment，浏览器上下文匿名 200）：
//   /api/pricing 36 个模型、13 个分组，带 group_ratio：
//     claude Max 1.5 / claude Max(企业) 1.6 / claude AWS 满血 1.2 / claude kiro正价 0.25 /
//     claude kiro正价（高缓）0.3 / claude kiro 99缓（不稳定）0.138 / codex 稳定 0.12 /
//     codex 高缓 0.18 / codex-plus 0.074 / codex-pro 0.25 / deepseek 0.12 / image 1。
//   quota_type 分布 30 个按 token、6 个按次；按次的全部是图片（公告：已增加生图 0.012 元/张）。
//   /api/status：price = 1、quota_per_unit = 500000、display_in_currency = true、stripe_unit_price = 8，
//   另有两条公告：生图 0.012/张、特价 CC Max 0.5 倍。只读了配置没有真实付款，金额档位不列。
//   Cloudflare 只放行真实浏览器，所以走 page 模式开临时页取价。
const PRICE_MAP = { base: "allrouter" };

const preset = {
  id: "jetapi",
  name: "JetAPI",
  baseUrl: "https://api.jetapi.icu/",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点 /api/status：price = 1、usd_exchange_rate = 1、quota_display_type = USD、quota_per_unit = 500000、display_in_currency = true、stripe_unit_price = 8。按 New API 口径 price 是「1 美元额度的人民币价」，即 1 元 = 1 美元额度；Stripe 侧 8 元一单位。只读了配置，没有真实付款，所以 rechargeRateVerified 为 false，也不列赠送档位。",
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "报价由 /api/pricing 的 model_ratio × 分组倍率折算成美元每百万 token（倍率 1 = $2/M），分组倍率最低 0.074（codex-plus）、最高 1.6（claude Max 企业）；按次计价的 6 个图片模型落在 quota_type = 1。",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const HOSTS = ["api.jetapi.icu", "jetapi.icu", "www.jetapi.icu"];

const pluginSource = {
  id: "jetapi",
  host: "api.jetapi.icu",
  preset,
  matches: ({ hostname, path }) => HOSTS.includes(hostname) && path === "/",
  prepareMatches: ({ hostname }) => HOSTS.includes(hostname),
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/`,
    mode: "page",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
  }),
  mode: "page",
  openTemporaryPage: true,
  responseFormat: "price-map",
  authType: "none",
  rationale: "JetAPI 的 /api/pricing 公开可读，Cloudflare 只放行浏览器上下文，所以借临时页取价",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "include" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
