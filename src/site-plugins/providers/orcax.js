// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测，匿名直连 /api/pricing，不需要登录）：
//   title / og:title 是「Orca X 小虎鲸｜GPT API 与多模型接入平台」，system_name = OrcaX，register_enabled = true，
//   turnstile_check = true（只在注册/前端拦，接口匿名可读）。14 个模型，只有 1 个分组 Gold，倍率 0.6。
//   model_ratio 基准与 allrouter 一致（1 = $2/百万）：gpt-6-astra ratio 5 → $10、gpt-6.2-astra 4 → $8、gpt-6-sol 1 → $2。
//   2 个出图模型（gpt-image-2.5-sunburst / flare）把张价写进表达式：
//   tier("standard", p*5 + cr*1.25 + img*8 + img_cr*2 + c*30)，同时带 image-generation 端点，走表达式的 image 变量。
//   12 条带 cache_ratio，cache_creation 系字段全无。
//   OP（linux.do 3069487）：1024 程序员节给 Linux DO 新用户送 $10.24 体验额度。
// 报文形状归到 allrouter 基座，站点差异只有基座选择、ratioBase 与充值口径。
const PRICE_MAP = { base: "allrouter" };

const HOSTS = ["orcax.net"];
const PATHS = ["/", "/pricing", "/console", "/console/topup", "/topup"];

const preset = {
  id: "orcax",
  name: "Orca X 小虎鲸",
  baseUrl: "https://orcax.net/",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点 /api/status：price = 1、quota_per_unit = 500000、quota_display_type = CUSTOM、custom_currency_symbol = 🔱、custom_currency_exchange_rate = 1、usd_exchange_rate = 1，即 ¥1 = 1 美元额度（站内显示成 1 个 🔱）。没有 bulk_topup_discounts、没有 pay_methods；充值端点匿名全部非 200。只读配置没付款，rechargeRateVerified 为 false。",
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "报价 = model_ratio × ratioBase(2) × Gold 分组倍率 0.6，2 个出图模型按表达式里的张价；1 = $2/百万的基准与 allrouter 相同。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "orcax",
  host: "orcax.net",
  preset,
  matches: ({ hostname, path }) => HOSTS.includes(hostname) && PATHS.includes(path),
  prepareMatches: ({ hostname }) => HOSTS.includes(hostname),
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
  }),
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "Orca X 小虎鲸 的 /api/pricing 匿名可读，14 个模型 14 条价目与分组倍率都不需要登录",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
