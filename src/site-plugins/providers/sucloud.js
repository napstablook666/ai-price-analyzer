// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { RELAYROUTER_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// 站点画像（2026-11-25 实测）：
//   主机 sucloud.vip（www.sucloud.vip 的 TLS 直连会 reset，只用裸域）；
//   GET /api/pricing 匿名 200、888KB、321 条、83 个分组，无需登录。
//   报文形状与 relayrouter / openlux 同一套（data[] + group_ratio + enable_groups +
//   cache_creation_5m/1h_ratio + quota_type），319 个模型目录完全一致，所以直接吃
//   relayrouter 基座，不写自定义规则。
//   倍率刻度实测过：渲染 /pricing 页面看 claude-opus-5-5「Enter price $0.9176/M」，
//   等于 model_ratio 2 × 最低分组 Claude-Code-1 0.229411 × 2，即 1 倍率 = $2/百万
//   token，与基座默认 ratioBase 一致，无需覆盖。
//   计费形状：213 个按 token，95 个按次（Pay per view），12 个按时长，1 个按分辨率；
//   按次里有 2 条报价为 0（未确认免费），基座按「不参与比价」处理，符合口径。
// 充值口径：
//   /api/status 的 data 里 price = 1、original_price = 1、currency_type = USD、
//   custom_currency_exchange_rate = 1、display_in_currency = true、
//   payment_currency_symbol = $、min_topup = 1，即 1 元 = 1 美元额度；
//   usd_exchange_rate = 6.68752 只用于把人民币金额折成美元显示，不参与扣费。
//   bulk_topup_discounts 是面值折扣表（14 档，0.99 → 0.925），折扣表现为少付钱。
//   注意：站点 2025-10-12 的推广帖标题写「充值汇率：￥0.7 = $1」，与当前 price=1
//   不一致，按运行时配置取 1；两个读数都写进 note 了。
//   没有真实付款，rechargeRateVerified 保持 false。
const PRICE_MAP = { base: "relayrouter" };

const preset = {
  id: "sucloud",
  name: "SuCloud",
  baseUrl: "https://sucloud.vip/pricing",
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "运行时配置 /api/status：price = 1、original_price = 1、currency_type = USD、min_topup = 1，即 1 元 = 1 美元额度；usd_exchange_rate = 6.68752 只影响人民币金额的美元展示，不参与扣费。站点 2025-10-12 推广帖标题写「￥0.7 = $1」，与当前配置冲突，按运行时取值。未真实付款。",
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
  rechargePlans: [
    { kind: "topup", amount: 10, credits: 10, discount: 0.99, currency: "USD", availability: "self_service", verified: true, note: "bulk_topup_discounts：面值 10 打 99 折" },
    { kind: "topup", amount: 100, credits: 100, discount: 0.98, currency: "USD", availability: "self_service", verified: true, note: "98 折" },
    { kind: "topup", amount: 500, credits: 500, discount: 0.965, currency: "USD", availability: "self_service", verified: true, note: "96.5 折" },
    { kind: "topup", amount: 1000, credits: 1000, discount: 0.96, currency: "USD", availability: "self_service", verified: true, note: "96 折" },
    { kind: "topup", amount: 10000, credits: 10000, discount: 0.945, currency: "USD", availability: "self_service", verified: true, note: "94.5 折" },
    { kind: "topup", amount: 100000, credits: 100000, discount: 0.925, currency: "USD", availability: "self_service", verified: true, note: "全额最高档 92.5 折" }
  ],
  rechargePlansVerified: true,
  rechargePayments: [
    { channel: "alipay", faceAmount: null, payAmount: null, currency: "CNY", status: "unavailable", paidRmb: null, at: "2026-11-25", note: "站点开支付宝 / 微信 / Stripe / USDT（推广帖自述），充值页需登录；未发起真实订单，未证明到账。" }
  ],
  rechargePaymentsVerified: false,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "价目页按美元每百万 token 展示（实测 claude-opus-5-5 $0.9176/M、gpt-6.1-sol $0.0956/M）",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: RELAYROUTER_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "sucloud",
  host: "sucloud.vip",
  preset,
  matches: ({ hostname, path }) => ["sucloud.vip", "www.sucloud.vip"].includes(hostname) &&
    ["/", "/pricing", "/console/topup"].includes(path),
  prepareMatches: ({ hostname }) => ["sucloud.vip", "www.sucloud.vip"].includes(hostname),
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/pricing`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "declarative", endpoint: RELAYROUTER_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
  }),
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "SuCloud 公开 /api/pricing 直连采集，321 个模型 83 个分组，报文与 RelayRouter 同源",
  request: requestPolicy(() => RELAYROUTER_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
