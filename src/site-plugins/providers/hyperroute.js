// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 浏览器实测，node 侧被 Cloudflare 挡在 403 Just a moment，浏览器上下文匿名 200）：
//   /api/pricing 56 个模型、11 个分组（claude-max / claude-max-ext / gpt-codex / gpt-codex2 / grok /
//   gpt-image2 / 国模专用组 / claude-超低特惠 …），报文里没有 group_ratio，只有一个 usable_group
//   布尔表，所以分组倍率按 1 算。quota_type 分布 51 个按 token、5 个按次（图片与固定价模型）。
//   /api/status：price = 1、quota_per_unit = 500000、display_in_currency = true、stripe_unit_price = 8。
//   也就是 1 元买 1 美元额度，Stripe 侧 8 元一单位；只读了配置没有真实付款，金额档位不列。
//   直连拿不到（Cloudflare 挑战），所以走 page 模式：开一次临时页，用页面上下文发请求。
const PRICE_MAP = { base: "allrouter" };

const preset = {
  id: "hyperroute",
  name: "Hyperroute",
  baseUrl: "https://hyperroute.cc/",
  rechargeRmb: 7.3,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点 /api/status：price = 1、usd_exchange_rate = 7.3、quota_display_type = CNY、display_in_currency = true、stripe_unit_price = 8、quota_per_unit = 500000。按 New API 口径 usd_exchange_rate 是「1 美元额度的人民币价」，也就是 7.3 元 = 1 美元额度，站内额度按人民币显示。只读了配置，没有真实付款，所以 rechargeRateVerified 为 false，也不列赠送档位。",
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "报价由 /api/pricing 的 model_ratio × 分组倍率折算成美元每百万 token（倍率 1 = $2/M），站点报文里没有 group_ratio，分组倍率按 1 计；按次计价的模型落在 quota_type = 1。",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const HOSTS = ["hyperroute.cc", "www.hyperroute.cc"];

const pluginSource = {
  id: "hyperroute",
  host: "hyperroute.cc",
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
  rationale: "Hyperroute 的 /api/pricing 公开可读，但 Cloudflare 只放行真实浏览器，所以借临时页的上下文取价",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "include" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
