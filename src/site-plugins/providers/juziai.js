// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

const PRICE_MAP = { base: "tokenflux" };
const RECHARGE_NOTE =
  "匿名 /api/status 只返回 price=1、quota_per_unit=500000、quota_display_type=CNY、custom_currency_exchange_rate=1、usd_exchange_rate=1；" +
  "钱包页已展示 11 档充值折扣，订单 108c9947 的支付宝收银台显示 1 额度应付 ¥0.75；" +
  "订单未付款，未验证到账金额、余额变化或 CREDITS 与 CNY 的最终充值比例，因此不把待支付报价当成到账证明。";

const RECHARGE_TIERS = [
  { amount: 1, discount: 0.75 },
  { amount: 5, discount: 0.73 },
  { amount: 10, discount: 0.72 },
  { amount: 30, discount: 0.70 },
  { amount: 50, discount: 0.69 },
  { amount: 100, discount: 0.68 },
  { amount: 200, discount: 0.67 },
  { amount: 300, discount: 0.66 },
  { amount: 500, discount: 0.65 },
  { amount: 1000, discount: 0.62 },
  { amount: 2000, discount: 0.60 }
];

const RECHARGE_PLANS = RECHARGE_TIERS.map(({ amount, discount }) => ({
  kind: "topup",
  amount,
  credits: amount,
  discount,
  currency: "CREDITS",
  availability: "self_service",
  verified: true,
  note: amount === 1
    ? "订单 108c9947 的支付宝待支付收银台报价：1 额度应付 ¥0.75；订单未付款，未证明到账。"
    : "钱包快捷充值档位；discount 是收银台应付金额与额度面值之比。"
}));



const preset = {
  id: "juziai",
  name: "橘子API",
  baseUrl: "https://api.juziai.cc/pricing",
  rechargeAuto: false,
  rechargeRateVerified: false,
  rechargeRateNote: RECHARGE_NOTE,
  rechargeTiers: RECHARGE_TIERS,
  rechargePlansVerified: true,
  rechargePlans: RECHARGE_PLANS,
  rechargePayments: [{
    channel: "alipay",
    faceAmount: 1,
    payAmount: 0.75,
    currency: "CNY",
    status: "pending",
    paidRmb: null,
    at: "2026-11-22",
    note: "订单 108c9947 的待支付收银台报价；页面显示 TUC1、¥0.75。订单未付款，未证明到账。"
  }],
  rechargePaymentsVerified: true,
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote:
    "模型报价沿用 New API 的 model_ratio × 官方价 / 2 口径；站点 status 显示 CNY 展示单位，但没有证据证明额度与人民币的到账比例。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: {
    kind: "declarative",
    endpoint: DEFAULT_PRICING_ENDPOINT,
    method: "GET",
    responseFormat: "price-map",
    priceMap: PRICE_MAP
  }
};

const pluginSource = {
  id: "juziai",
  host: "api.juziai.cc",
  preserveRechargeRateVerification: true,
  matches: ({ hostname, path }) => hostname === "api.juziai.cc" && ["/", "/pricing"].includes(path),
  prepareMatches: ({ hostname }) => hostname === "api.juziai.cc",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/pricing`,
    mode: "direct",
    auth: { type: "none" },
    adapter: {
      ...(stationInput.adapter || {}),
      kind: "declarative",
      endpoint: DEFAULT_PRICING_ENDPOINT,
      method: "GET",
      responseFormat: "price-map",
      priceMap: PRICE_MAP
    }
  }),
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "橘子API 的 /api/pricing 与 /api/status 匿名可读，公开价格接口直连采集；充值档位与待支付金额已核验，到账比例未闭环",
  preset,
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
