// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT as PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-24 实测，匿名直连 /api/pricing，不需要登录）：
//   system_name = New AI，注册关闭（register_enabled = false，只能邀请或自带号），无 Cloudflare Turnstile。
//   报文是 New API 同源形状但没有 billing_expr 与 pricing_version，多一个顶层 time_discount；每行只有 model_ratio、completion_ratio、
//   enable_groups、supported_endpoint_types，17 个模型全按 token 计价，没有按次、没有按张、没有 cache_ratio。
//   quota_per_unit = 1000000（别家是 500000），所以 model_ratio 1 只值 1 美元/百万而不是 2，插件里用 ratioBase: 1 表达。
//   交叉验证：同批 7 家站点的 gpt-6.1-terra 都是 $1/百万、gpt-6.1-sol 都是 $2/百万、deepseek-v4.1-flash 都是 $0.3/百万，
//   本站在 ratioBase 1 下与之一致（用 2 会整体翻倍），所以 1 是实测口径不是猜的。
//   顶层另有 time_discount：glm-5-turbo / glm-5.2 / glm-5.3 / glm-5.3-flashx / glm-5.4 标着限时特惠 0.9 折。
//   映射引擎只读表达式里的分时字段，不读这个顶层表，因此表里这 5 个模型是折前价。
//   OP（linux.do 2927211）：国模智谱 / kimi 官套中转，随用随充，可申请 500 万 token 试用。
// 报文形状归到 allrouter 基座，站点差异只有基座选择、ratioBase 与充值口径。
const PRICE_MAP = { base: "allrouter", ratioBase: 1 };

const HOSTS = ["ai.deadlion.cn"];
const PATHS = ["/", "/pricing", "/console", "/console/topup", "/topup"];

const preset = {
  id: "deadlion",
  name: "New AI",
  baseUrl: "https://ai.deadlion.cn/",
  rechargeRmb: 7.3,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点 /api/status：price = 7.3、usd_exchange_rate = 7.3、quota_per_unit = 1000000、quota_display_type = TOKENS、display_in_currency = false、custom_currency_symbol = 积分，即 ¥7.3 = 1 美元额度（等于把汇率原样当价，没有折扣）。没有 bulk_topup_discounts、没有 pay_methods；/api/user/topup/info 等 6 个充值端点匿名全部非 200，档位与赠送读不到。只读配置没付款，rechargeRateVerified 为 false。",
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "报价由 /api/pricing 的 model_ratio × 分组倍率 × ratioBase(1) 折算成美元每百万 token；本站两个分组 default / vip 倍率都是 1；没有 billing_expr，也没有按次与图片端点。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "deadlion",
  host: "ai.deadlion.cn",
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
  rationale: "New AI 的 /api/pricing 匿名可读，17 个模型 26 条价目与分组倍率都不需要登录",
  request: requestPolicy(() => PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
