// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

// VelaMost 是 New API 分支：/api/pricing 匿名可读，报文形状与 tokenflux 一致。
// model_ratio 是「官方价 ÷ 2 美元/百万」（ratio 1 = $2/M），分组倍率在报文顶层 group_ratio，
// 引擎按 enable_groups 取最小倍率得到页面「起」价。三处实测对得上：
//   claude-sonnet-5  ratio 1.5   × 2 × 0.9(Claude- lite) = $2.7 入 / $13.5 出
//   gpt-5.4-mini     ratio 37.5  × 2 × 3(official-lite)  = $225 入 / $1350 出
// 所以 priceMap 只用 { base: "tokenflux" }，不写 ratioBase、不覆盖 currency。
const PRICE_MAP = { base: "tokenflux" };

const RECHARGE_NOTE =
  "匿名 /api/status 只返回 price=1、quota_per_unit=500000、quota_display_type=USD、custom_currency_exchange_rate=1、usd_exchange_rate=1；" +
  "/api/group/ 需要登录，匿名拿不到充值档位与到账比例，未编造任何档位。";

const preset = {
  id: "velamost",
  name: "VelaMost",
  baseUrl: "https://velamost.com/pricing",
  rechargeAuto: false,
  rechargeRateVerified: false,
  rechargeRateNote: RECHARGE_NOTE,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote:
    "模型报价沿用 New API 的 model_ratio × 2（ratio 1 = $2/百万）× 分组倍率口径；/api/pricing 顶层 group_ratio 自带，按 enable_groups 取最小倍率，与页面「起」价一致。",
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
  id: "velamost",
  host: "velamost.com",
  preservePriceCurrency: true,
  preserveRechargeRateVerification: true,
  matches: ({ hostname, path }) => hostname === "velamost.com" && path === "/pricing",
  prepareMatches: ({ hostname }) => hostname === "velamost.com",
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
  rationale: "VelaMost 的 /api/pricing 匿名可读，公开价格接口直连采集；分组倍率随报文返回，充值档位与到账比例需登录未验证",
  preset,
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
