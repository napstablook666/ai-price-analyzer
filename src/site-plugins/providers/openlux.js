// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 口径调研（2026-11-20，匿名可读，不需要登录）：
//   报文 /api/pricing：322 个模型，quota_type 0（按 token）211 个、1（按次）111 个，
//     model_ratio 的基准是 2 美元/M（quota_per_unit = 500000，price = 1，与 New API 默认一致）。
//   页面 /pricing：claude-opus-5-5 显示 0.353，最低分组 0.08824 × 2 × 2 = 0.35296 对得上；
//     gpt-image-2-c 显示 0.00882 / request，报文最低分组 0.0088236 对得上。页面不带货币符号。
//   站点自述：/relay 与 /wholesale 写着「1 美元 = 1 美元额度，用多少扣多少，最低充值 $1」，
//     /api/status 里 currency_type = USD、price = 1、original_price = 1、
//     custom_currency_exchange_rate = 1（1 美元额度就是 1 美元），
//     usd_exchange_rate = 6.68752（人民币付款按这个汇率折算），
//     bulk_topup_discounts 14 档（10 面值 9.9 折，10 万面值 0.925），min_topup = 1。
//   所以实付人民币 / 1 美元额度 = 6.68752。没有真实到账单，后续有账单以账单为准。
// 报文形状与 RelayRouter 一致，映射直接复用基座；分组倍率 0.03677 ~ 1.1，95 个分组。
const PRICE_MAP = { base: "relayrouter" };

const preset = {
  id: "openlux",
  name: "OpenLux",
  baseUrl: "https://www.openlux.ai/pricing",
  // 1 美元额度 = 6.68752 元（站点 /api/status 的 usd_exchange_rate），面值折扣见档位表。
  rechargeRmb: 6.68752,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  // /api/status 的 price 在这里是「1 美元面值卖 1 美元」（payment_currency_symbol 是 $），
  // 自动采集会把它当成「1 美元额度 = 1 元」写进折算，价格直接低 6.7 倍，所以锁手填值。
  rechargeAuto: false,
  rechargeRateNote: "站点自述「1 美元 = 1 美元额度，最低充值 $1」，price=1 是美元口径（支付币种 $），所以关掉自动采集，按站点 usd_exchange_rate 6.68752 折算人民币，未用真实账单核对。面值 10 起每档 9.9~9.25 折，已并入档位表。",
  // bulk_topup_discounts 原样搬过来：面值（美元额度）→ 折扣。
  rechargeTiers: [
    { amount: 10, discount: 0.99 },
    { amount: 50, discount: 0.985 },
    { amount: 100, discount: 0.98 },
    { amount: 200, discount: 0.975 },
    { amount: 300, discount: 0.97 },
    { amount: 500, discount: 0.965 },
    { amount: 1000, discount: 0.96 },
    { amount: 2000, discount: 0.955 },
    { amount: 5000, discount: 0.95 },
    { amount: 10000, discount: 0.945 },
    { amount: 30000, discount: 0.94 },
    { amount: 50000, discount: 0.935 },
    { amount: 80000, discount: 0.93 },
    { amount: 100000, discount: 0.925 }
  ],
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "报文与页面都是美元额度，页面显示不带货币符号",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "openlux",
  host: "openlux.ai",
  preset,
  matches: ({ hostname, path }) => ["www.openlux.ai", "openlux.ai"].includes(hostname) &&
    ["/", "/pricing", "/console/topup", "/console/models"].includes(path),
  prepareMatches: ({ hostname }) => ["www.openlux.ai", "openlux.ai"].includes(hostname),
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
  rationale: "OpenLux 的 /api/pricing 匿名可读，按 token 与按次两种计费都覆盖，分组倍率与充值档位已按站点自述核过",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
