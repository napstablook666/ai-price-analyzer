// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测，匿名直连 /api/pricing，不需要登录）：
//   system_name = TonkicAPI中转，register_enabled = true，turnstile_check = true（只拦注册）。
//   只卖 7 个模型（gpt-6-astra / gpt-6-sol / gpt-6.1-sol / gpt-5.6-luna / gpt-6-luna / gpt-5.6-sol / gpt-5.6-terra），
//   但 7 个全部带 billing_expr，len <= 272000 长短上下文分档，7 个分组把同一模型摊成 48 行：
//   0.05羊毛 0.05、0.1 0.1、claude 0.1、grok 0.1、0.15不降智 0.15、0.2 0.2（Luna 专属）、bps-local 1（本地桥接实验组）。
//   usable_group 里还声明了 auto 自动分组（按 0.05 → 0.1 → 0.15 失败回退），它不在 group_ratio 里，落不进价表。
//   3 条带 cache_ratio，cache_creation 系全无；无按次、无图片端点。
//   OP（linux.do 2765557）：自建小站，注册送 1 刀、回帖送 1 刀，目前只有 0.05 与 0.1 两档，最低充值 1 元；
//   国外地址 us.tonkicapi.xyz 本次实测 502，不挂进 hosts。
// 报文形状归到 allrouter 基座，站点差异只有基座选择、ratioBase 与充值口径。
const PRICE_MAP = { base: "allrouter" };

const HOSTS = ["tonkicapi.xyz","www.tonkicapi.xyz"];
const PATHS = ["/", "/pricing", "/console", "/console/topup", "/topup"];

const preset = {
  id: "tonkic",
  name: "TonkicAPI",
  baseUrl: "https://tonkicapi.xyz/",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点 /api/status：price = 1、quota_per_unit = 500000、quota_display_type = USD、usd_exchange_rate = 6.78，按 New API 口径是 ¥1 = 1 美元额度（usd_exchange_rate 只用于显示）。OP 写「最低充值 1 元，随充随用」。没有 bulk_topup_discounts、没有 pay_methods；充值端点匿名全部非 200。只读配置没付款，rechargeRateVerified 为 false。",
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "报价 = billing_expr 求值 × 分组倍率（0.05–1），表达式口径是美元/百万；7 个模型全部带表达式，没有回落 model_ratio 的行。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "tonkic",
  host: "tonkicapi.xyz",
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
  rationale: "TonkicAPI 的 /api/pricing 匿名可读，7 个模型 48 条价目与分组倍率都不需要登录",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
