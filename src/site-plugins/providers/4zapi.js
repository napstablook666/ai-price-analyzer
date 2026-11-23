// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 4Z API 取证（2026-11-23，匿名直连 /api/pricing，不需要登录）：
//   4zapi.com 与 openlux.ai 是同一套部署：/api/status 的 price=1、usd_exchange_rate=6.68752、
//   custom_currency_exchange_rate=1 逐字段相同，bulk_topup_discounts 的 14 档折扣也一模一样，
//   报文里还带 rr_hydration_noise_filter 这类 RelayRouter 系字段，所以基座直接取 relayrouter。
//   报文形状：cache_creation_ratio / cache_creation_1h_ratio 拆成 5 分钟与 1 小时两档，
//   长上下文分档在 step_ratios 里（44 个模型带，字段 step_size / prompt_step_ratio / completion_step_ratio），
//   这两处 relayrouter 基座都覆盖。
//   本批唯一没有 billing_expr 的大站：323 个模型里 114 个按次/按张，其余全走 model_ratio 规则。
//   model_ratio 基准 1 单位 = 2 美元/百万（claude-opus-5-5 = 2 → $4/M、claude-sonnet-5 = 1 → $2/M）。
//   它自己给 qwen / glm / kimi 系列打了更低的倍率（glm-5 = 0.5，同族别家是 2），这是站内定价，照实采。
//   另有 /api/pricing_new 多带 group_model_ratio 与 voice_clone_fee，当前用不上 /api/pricing 就够。
//   备用域名 efwef.xyz 实测只回 index.html（914 字节的 SPA 兜底），没有接口，不挂进来。
// 报文形状归到 relayrouter 基座，站点差异只有基座选择与充值口径。
const PRICE_MAP = { base: "relayrouter" };

const HOSTS = ["4zapi.com","www.4zapi.com"];
const PATHS = ["/","/pricing","/console/topup"];

const preset = {
  id: "4zapi",
  name: "4Z API",
  baseUrl: "https://4zapi.com/pricing",
  rechargeAuto: false,
  rechargeRmb: 6.68752,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "站点 /api/status：currency_type = USD、payment_currency_symbol = $、price = 1、original_price = 1、custom_currency_exchange_rate = 1（1 美元额度就是 1 美元），usd_exchange_rate = 6.68752 是站内把美元额度折成人民币展示用的值。bulk_topup_discounts 14 档：$10 面值 0.99 折、$10 万面值 0.925 折，min_topup = 1。收银台是美元实付，人民币过钱包汇率，真实账单未取。",
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "报文与页面都是美元额度；报价 = 官方价 × 分组倍率（0.04–1.1，41 档）。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "4zapi",
  host: "4zapi.com",
  preset,
  matches: ({ hostname, path }) => HOSTS.includes(hostname) && PATHS.includes(path),
  prepareMatches: ({ hostname }) => HOSTS.includes(hostname),
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/pricing`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
  }),
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "4Z API 的 /api/pricing 匿名可读，323 个模型 80 个分组，充值口径按站点自报字段核过",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
