// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { requestPolicy } from "../../core/provider-registry.js";

// Right Code 取证（2026-11-23，匿名直连 + 登录态）：定价在 /models/public，91KB，
//   `upstreams[]` 十三个渠道，每个下面 `models[]`，合计 111 个模型。
// 价格字段有两套：`input_price` 是上游挂牌价，`effective_price_config` 才是折后到手价
//   （`effective_upstream_rate` × `effective_model_rate` 已经乘进去），一律取后者。
// 三种计费：token 77、tiered 15、request 19。
//   tiered 的分档也在 effective_price_config.tiers 里，`max_context_length` 是分档上限。
//   站点公告：主站 rightapi.io，模型 API 走 https://api.site，抓价仍用主站。
// 充值：实测下单 Ø5.00 → 余额 $5.00，订单 ORD-399c9aa8a2cc45cfb2b2，1:1。
const MODELS_ENDPOINT = "/models/public";

const PRICE_MAP = {
  schemaVersion: "price-map/1",
  source: "rightcode",
  rootPath: "/upstreams",
  // 价格在 upstreams[].models[] 里，桶名（渠道名）才是分组名。
  expand: { itemsPath: "models", parentKey: "$parent" },
  nameField: "name",
  currency: "USD",
  groups: { listPath: "$parent.name" },
  rules: [
    {
      when: { path: "request_price", gt: 0 },
      kind: "request",
      // 111 个模型里有 9 个的 effective_price_config 是空对象，取值一律走链：折后价优先，没有就回落挂牌价。
      price: ["effective_price_config.request_price", "request_price"],
      unit: "request",
      mediaType: "image",
      tierName: "按次"
    },
    {
      when: { path: "billing_mode", equals: "tiered" },
      kind: "token",
      tiers: {
        path: "effective_price_config.tiers",
        upperField: "max_context_length",
        input: "input_price",
        output: "output_price",
        cacheRead: "cache_read_input_price",
        cacheWrite: "cache_creation_input_price"
      }
    },
    {
      when: { path: "input_price", gt: 0 },
      kind: "token",
      input: ["effective_price_config.input_price", "input_price"],
      output: ["effective_price_config.output_price", "output_price"],
      cacheRead: ["effective_price_config.cache_read_input_price", "cache_read_input_price"],
      cacheWrite: ["effective_price_config.cache_creation_input_price", "cache_creation_input_price"]
    }
  ]
};

const preset = {
  id: "rightcode",
  name: "Right Code",
  baseUrl: "https://rightapi.io/pricing",
  rechargeAuto: true,
  rechargeRmb: 1,
  rechargeCredits: 1,
  rechargeRateVerified: true,
  rechargeRateNote: "下单实测：充值余额 $5.00 对应应付金额 CNY 5.00，订单 ORD-399c9aa8a2cc45cfb2b2，1:1，无附加费。最低充值 $1。6% 手续费只挂在「需要国内发票」上，不选不收。",
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "报价字段是美元每百万 token，取 effective_price_config（上游折后价）。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: MODELS_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "rightcode",
  host: "rightapi.io",
  preset,
  matches: ({ hostname, path }) => hostname === "rightapi.io" && (path === "/pricing" || path.startsWith("/console")),
  prepareMatches: ({ hostname }) => hostname === "rightapi.io",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/pricing`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "declarative", endpoint: MODELS_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
  }),
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "Right Code 的 /models/public 匿名可读，111 个模型按 13 个渠道分桶，取折后价；充值 1:1 已下单实测",
  request: requestPolicy(() => MODELS_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
