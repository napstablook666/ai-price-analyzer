// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

const PRICE_MAP = { base: "tokenflux" };
const RECHARGE_NOTE =
  "匿名 /api/status 只返回 price=1、quota_per_unit=500000、quota_display_type=CNY、custom_currency_exchange_rate=1、usd_exchange_rate=1；" +
  "没有登录后的到账金额、充值方案或第三方支付账单，因此不能把这些字段当成已验证的 1:1 充值比例。";

const preset = {
  id: "juziai",
  name: "橘子API",
  baseUrl: "https://api.juziai.cc/pricing",
  rechargeAuto: false,
  rechargeRateVerified: false,
  rechargeRateNote: RECHARGE_NOTE,
  rechargePlansVerified: false,
  rechargePaymentsVerified: false,
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
  rationale: "橘子API 的 /api/pricing 与 /api/status 匿名可读，公开价格接口直连采集；充值口径未验证",
  preset,
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
