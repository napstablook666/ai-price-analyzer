// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测，匿名直连 /api/pricing，不需要登录）：
//   system_name 直接写着运维提示「MoyaAI deepseek模型需要调整api key的分组为特惠deepseek」，register_enabled = true。
//   只卖 5 个模型：deepseek-v4.1-flash-1017、deepseek-v4.1-flash、glm-5.3、glm-5.3-flash、kimi-k3，全部走 model_ratio，无 billing_expr。
//   模型条目的 enable_groups 列了 8 个名字（公司 / 管理员 / deepseek / deepseek-eco / deepseek外供 / 部署 / 开源模型 - 稳定 / 特惠deepseek），
//   但 group_ratio 只给了 3 档：开源模型 - 稳定 0.1、特惠deepseek 0.15、CCMAX 0.8。倍率表里没有的分组不落行，
//   所以 5 个模型只摊出 5 条：glm 系落 开源模型 - 稳定（0.1）、deepseek 系落 特惠deepseek（0.15）。
//   这条「模型标了分组但没有倍率」的差异是本站唯一要注意的地方：不是采集漏了，是站内没给这些分组定价。
//   5 条全带 cache_ratio，cache_creation 系全无；无按次、无图片端点。
//   OP（linux.do 2726416）：主推 0.05 倍 deepseek（特价分组）与 0.15 倍的 grok / 0.25 倍 gpt-sol。
// 报文形状归到 allrouter 基座，站点差异只有基座选择、ratioBase 与充值口径。
const PRICE_MAP = { base: "allrouter" };

const HOSTS = ["moyaspace.com"];
const PATHS = ["/", "/pricing", "/console", "/console/topup", "/topup"];

const preset = {
  id: "moya",
  name: "MoyaAI",
  baseUrl: "https://moyaspace.com/",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点 /api/status：price = 1、quota_per_unit = 500000、quota_display_type = CNY、usd_exchange_rate = 1，即 ¥1 = 1 美元额度。没有 bulk_topup_discounts、没有 pay_methods；充值端点匿名全部非 200。只读配置没付款，rechargeRateVerified 为 false。",
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "报价 = model_ratio × ratioBase(2) × 分组倍率，只有 group_ratio 里给了倍率的两个分组（0.1 / 0.15）会落行；CCMAX 0.8 这档当前没有模型挂。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "moya",
  host: "moyaspace.com",
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
  rationale: "MoyaAI 的 /api/pricing 匿名可读，5 个模型 5 条价目与分组倍率都不需要登录",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
