// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测，匿名直连 /api/pricing，不需要登录）：
//   system_name = Orbitix AI，register_enabled = true，无 Turnstile；主站在子域 newapi.orbitix.site，
//   orbitix.site 根域的 /api/pricing 是 404（只有 SPA 兜底页），所以只挂子域。
//   11 个模型、4 个分组：CodeX-特惠 0.08、CodeX-不降智 0.2、国模 0.2、生图 1（usable_group 里写明「特惠分组 不保证稳定性与智商」）。
//   11 个模型全部带 billing_expr，含分时分档：weekday("Asia/Shanghai") 1–5 且 (9–12 点 或 14–16 点 / 14–18 点)
//   命中时走 peak 双倍档，其余时间走 off_peak（两个窗口宽度不统一，一个是 14–16 一个是 14–18）；另有 len <= 272000 的 0_272k / 272k_plus 档。
//   2 个出图模型（gpt-image-2.5-sunburst-1K / flare-1K）走 tier("base", fixed(0.009))，即 $0.009/张，带 image-generation 端点。
//   没有 cache_ratio（0 条），缓存读取价跟着表达式里的 cr 变量走。
//   OP（linux.do 3098990）：0.2X CodeX-不降智、0.2X 国模、生图按张，注册回帖送 $2。
// 报文形状归到 allrouter 基座，站点差异只有基座选择、ratioBase 与充值口径。
const PRICE_MAP = { base: "allrouter" };

const HOSTS = ["newapi.orbitix.site"];
const PATHS = ["/", "/pricing", "/console", "/console/topup", "/topup"];

const preset = {
  id: "orbitix",
  name: "Orbitix AI",
  baseUrl: "https://newapi.orbitix.site/",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点 /api/status：price = 1、quota_per_unit = 500000、quota_display_type = CNY、usd_exchange_rate = 1，即 ¥1 = 1 美元额度。没有 bulk_topup_discounts、没有 pay_methods；充值端点匿名全部非 200。只读配置没付款，rechargeRateVerified 为 false。",
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "报价 = billing_expr 求值 × 分组倍率（0.08–1）；分时表达式按抓取时刻求值，工作日 9–12 / 14–16(18) 点抓到的是 peak 双倍价、其余时刻是 off_peak 价，出图模型是 $0.009/张。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "orbitix",
  host: "newapi.orbitix.site",
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
  rationale: "Orbitix AI 的 /api/pricing 匿名可读，11 个模型 19 条价目与分组倍率都不需要登录",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
