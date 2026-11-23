// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { DEFAULT_PRICING_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";
import { tokenfluxPriceMap } from "../../core/price-maps/tokenflux.js";

// 2026-11-23 取证：eapi.site 是 New API 衍生面板（habitat-panel-facade），匿名 GET /api/pricing 返回 41 个模型。
//
// 单位判定（见 out/ratio/eapi.site.json）：
//   input_price_micros / output_price_micros 是 micro-USD per 1M tokens（折后美元单价 × 1e6）。
//   换算链：source_input_usd_per_1m × applied_multiplier × 1e6 = input_price_micros，
//   applied_multiplier = 1 - discount_pct/100（discount_pct 是折扣百分比，如 90 表示省 90%）。
//   model_ratio = input_price_micros / 2e6，即已含折扣的官方价 ÷ 2，
//   匹配 tokenflux token 规则默认 ratioBase=2（SYSTEM_BASE_PRICE_PER_1M），
//   所以 model_ratio × 2 = 折后美元/百万，与页面展示价（micros ÷ 1e6 × usd_exchange_rate=7 得 ¥）一致。
//
// 计费形态：
//   per_token（33 个）—— billing_mode=per_token，billing_expr 全为空串，走 tokenflux token 规则。
//   fixed（8 个）—— billing_mode=fixed，model_price 是美元/张，走自写 request 规则。
//   eapi 的 fixed 模型 supported_endpoint_types 写的是 /v1/images/generations，
//   tokenflux 图片规则要求 contains "image-generation"，不命中，所以自写 fixed 规则拦截在前。
//
// 缓存价：cache_*_price_micros 字段全部等于 input_price_micros，与 cache_ratio 矛盾，是坏字段，不读。
//   缓存价按 cache_ratio / create_cache_ratio 从 model_ratio 推算（tokenflux token 规则已覆盖）。
//   9 个模型无 create_cache_ratio，cacheWrite 表达式收口为 null，渲染 "-"，不报占位价。
//
// 时段价：deepseek-v4.1-flash 带 time_band（闲时/忙时两档），报文头部的 input_price_micros
// 已是当前生效档的折后价（闲时 $0.09/百万 ↔ 页面 ¥0.63，忙时翻倍）。
// 比价表报当前价；到忙时段站点自己把头部价格翻倍，无需本地处理。

const RECHARGE_NOTE = "公开 /api/pricing 与 /api/status 匿名可读；站点文档自述人民币/美元两种充值、以美元等额换算，支付页显示参考汇率（/docs/eapi-codex-claude#recharge），但档位金额、折扣、最低充值只在登录后的 /api/user/topup/info，匿名 401/403。status 的 usd_exchange_rate=7、price=7 是展示换算系数，不构成充值比例证据。rechargeRateVerified=false，缺登录态的 amount_options、discount、min_topup 三证。";

const PRICE_MAP = {
  base: "tokenflux",
  source: "eapi",
  // eapi 是 New API 衍生面板，41 个模型全部没有 enable_groups，顶层也没有 group_ratio，
  // 只有站内基准价。不写 unlisted 时 groupSelection 返回空数组，模型会静默不出行，
  // 所以展开 base 的分组声明再补 unlisted，让每条模型落到单条基准分组。
  groups: { ...tokenfluxPriceMap.groups, unlisted: "站内基准价" },
  rules: [
    // fixed 计费：按张计价的生图模型。billing_mode=fixed 是 eapi 自有字段，
    // model_price 已是折后美元/张，与 image_resolution_pricing.default（micro-USD）÷ 1e6 一致。
    {
      when: { path: "billing_mode", equals: "fixed" },
      kind: "request",
      price: "model_price",
      unit: "image",
      mediaType: "image"
    },
    ...tokenfluxPriceMap.rules
  ]
};

const preset = {
  id: "eapi",
  name: "E-API",
  baseUrl: "https://eapi.site/pricing",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "报文 input_price_micros 是 micro-USD per 1M，页面 ¥ 展示价 = micros ÷ 1e6 × usd_exchange_rate(7)；币种为美元额度，与 tokenflux 族一致。",
  rechargeAuto: false,
  rechargeRateVerified: false,
  rechargeRateNote: RECHARGE_NOTE,
  adapter: { kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "eapi",
  host: "eapi.site",
  preservePriceCurrency: true,
  preserveRechargeRateVerification: true,
  preset,
  matches: ({ hostname, path }) => hostname === "eapi.site" && path === "/pricing",
  prepareMatches: ({ hostname }) => hostname === "eapi.site",
  prepare: (stationInput, { url }) => {
    return {
      ...stationInput,
      baseUrl: `${url.origin}/pricing`,
      mode: "direct",
      auth: { type: "none" },
      priceCurrency: "USD",
      priceCurrencyVerified: true,
      priceCurrencyNote: stationInput.priceCurrencyNote || preset.priceCurrencyNote,
      rechargeAuto: false,
      rechargeRateVerified: stationInput.rechargeRateVerified ?? false,
      rechargeRateNote: stationInput.rechargeRateNote || RECHARGE_NOTE,
      adapter: { ...(stationInput.adapter || {}), kind: "declarative", endpoint: DEFAULT_PRICING_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
    };
  },
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "公开报价匿名可读；41 个模型（per_token 33 + fixed 8）按折后价映射；充值档位未取到登录态报文，rechargeRateVerified=false",
  request: requestPolicy(() => DEFAULT_PRICING_ENDPOINT, { credentials: "omit" })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
