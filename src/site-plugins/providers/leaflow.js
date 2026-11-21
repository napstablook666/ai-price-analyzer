// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { cookiePageAuth, requestPolicy } from "../../core/provider-registry.js";
import { finitePrice } from "../../core/price-map.js";

const HOST = "01a1fe61-12f8-7a6f-9b6f-8e6ffadd40aa.leaflow.net";
const MODEL_PAGE = "/products/canopy/models";
const MODELS_ENDPOINT = "/api/products/canopy/api/v1/models";
const PRICES_ENDPOINT = "/api/billing/api/v1/prices?currency=USD&product_id=canopy&page_size=200";
const TOKEN_FIELDS = { input: "input", output: "output", cache_read: "cacheRead", cache_write: "cacheWrite" };
const SPEC_KEYS = new Set(["size", "quality", "resolution"]);
const PRICE_MAP = {
  schemaVersion: "price-map/1", source: "leaflow-billing", rootPath: "/data", nameField: "name", currency: "USD", ratioBase: 1,
  groups: { unlisted: "平台价" },
  rules: [
    { when: { path: "unavailable", equals: true }, kind: "unsupported", reason: "模型不可用或当前项目未获授权" },
    { when: { path: "audio", equals: true }, kind: "unsupported", reason: "音频 token 或字符计费尚不支持，不能按文本 token 折算", sourcePath: "meters" },
    { when: { path: "mediaType", equals: "image" }, kind: "request", unit: "image", mediaType: "image", sizeTiers: { path: "sizes", nameField: "name", priceField: "price" } },
    { when: { path: "mediaType", equals: "video" }, kind: "request", unit: "second", mediaType: "video", mediaSpecsPath: "specs", sizeTiers: { path: "sizes", nameField: "name", priceField: "price" } },
    { when: { path: "token", equals: true }, kind: "token", ...Object.fromEntries(Object.values(TOKEN_FIELDS).map(field => [field, field])) },
    { kind: "unsupported", reason: "未支持的计量器或规格维度", sourcePath: "meters" }
  ]
};

function listOf(payload, label) {
  if (!Array.isArray(payload?.items) || !payload.items.length) throw new Error(`Leaflow ${label}缺失，请确认项目权限和登录态`);
  if (Number(payload.pagination?.total_count) > payload.items.length) throw new Error(`Leaflow ${label}分页未取全`);
  return payload.items;
}

const decimalOf = value => typeof value === "number" || (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value)) ? finitePrice(value) : null;
function amountOf(rate, scale) {
  const amount = decimalOf(rate.unit_amount);
  const quantity = decimalOf(rate.unit_quantity);
  if (amount === null || quantity === null || quantity <= 0 || rate.currency !== "USD" ||
      rate.billing_scheme !== "per_unit" || rate.usage_type !== "metered" || rate.interval !== "none" || rate.tiers_mode !== "none") {
    throw new Error("Leaflow 价格、币种或计费单位发生变化，停止折算");
  }
  const value = amount * scale / quantity;
  if (!Number.isFinite(value)) throw new Error("Leaflow 换算价格超出范围");
  return value;
}

function ratesFor(plan, meter) {
  const dimensions = meter.dimensions || {};
  if (!dimensions.model || !Array.isArray(meter.dimension_keys)) throw new Error("Leaflow 计量器维度缺失");
  return plan.rates.filter(rate => rate.meter?.lookup_key === meter.meter_lookup_key && rate.unit === meter.unit &&
    Object.keys(rate.dimensions || {}).every(key => meter.dimension_keys.includes(key)) &&
    meter.dimension_keys.every(key => rate.dimensions?.[key] != null) &&
    Object.entries(dimensions).every(([key, value]) => SPEC_KEYS.has(key) || rate.dimensions?.[key] === value));
}

function modelRow(model, prices) {
  if (!model.id || !Array.isArray(model.billing?.meters) || !model.billing.meters.length) throw new Error("Leaflow 模型计费配置缺失");
  const meters = model.billing.meters;
  const row = { name: model.id, meters };
  if (model.status !== "available" || model.access_granted !== true) return { ...row, unavailable: true };
  if (meters.some(meter => meter.kind.startsWith("audio_"))) return { ...row, audio: true };
  const plans = prices.filter(price => price.active === true && price.product_id === "canopy" && price.plan_id === model.billing.plan_id && price.currency === "USD");
  if (plans.length !== 1 || !Array.isArray(plans[0].rates)) throw new Error(`Leaflow ${model.id} 的有效美元价格计划不唯一或缺失`);
  const plan = plans[0];
  if (meters.every(meter => meter.unit === "token" && (TOKEN_FIELDS[meter.kind] || meter.kind === "reasoning"))) {
    let reasoning = null;
    for (const meter of meters) {
      if (meter.dimension_keys.some(key => !["model", "token_kind"].includes(key))) return row;
      const rates = ratesFor(plan, meter);
      if (rates.length !== 1) throw new Error(`Leaflow ${model.id}/${meter.kind} 单价不唯一或缺失`);
      const price = amountOf(rates[0], 1_000_000);
      if (meter.kind === "reasoning") reasoning = price;
      else row[TOKEN_FIELDS[meter.kind]] = price;
    }
    if (row.input == null || row.output == null) return row;
    // 当前 reasoning 与 output 同价；独立推理价不能静默合并到输出列。
    if (reasoning !== null && reasoning !== row.output) return row;
    return { ...row, token: true };
  }
  if (meters.length !== 1 || !["images", "video_seconds"].includes(meters[0].kind)) return row;
  const meter = meters[0];
  if (meter.unit !== (meter.kind === "images" ? "image" : "second")) return row;
  if (meter.dimension_keys.some(key => !["model", ...SPEC_KEYS].includes(key))) return row;
  const rates = ratesFor(plan, meter);
  if (!rates.length) throw new Error(`Leaflow ${model.id} 媒体单价缺失`);
  const sizes = rates.map(rate => ({
    name: meter.dimension_keys.filter(key => key !== "model").map(key => `${key}=${rate.dimensions?.[key] || "?"}`).join(" · "),
    price: amountOf(rate, 1),
    specs: Object.fromEntries(meter.dimension_keys.filter(key => key !== "model").map(key => [key, { enum: [rate.dimensions[key]] }]))
  })).sort((left, right) => left.name.localeCompare(right.name));
  if (sizes.some(size => size.name.includes("?")) || new Set(sizes.map(size => size.name)).size !== sizes.length) {
    throw new Error(`Leaflow ${model.id} 媒体规格缺失或重复`);
  }
  if (meter.kind === "images") return { ...row, mediaType: "image", sizes };
  // 视频榜通过 media_specs 展示分辨率，每个费率必须携带自己的规格。
  return sizes.map(size => ({ ...row, mediaType: "video", sizes: [size], specs: size.specs }));
}

const decodePricing = payload => ({
  data: listOf(payload, "模型目录").flatMap(model => modelRow(model, listOf(payload.__aux?.prices, "计费价格"))),
  group_ratio: { "平台价": 1 }
});
const rechargeRateNote = "2026-11-21 登录核验：结算账户和充值表单均为 USD，最低 1 USD，Stripe 银行卡/支付宝。尚未创建订单或核验人民币实付汇率、手续费与赠额，不能认定 1 USD 额度 = 1 元。";
const preset = {
  id: "leaflow", name: "Leaflow Canopy", baseUrl: `https://${HOST}${MODEL_PAGE}`, enabled: true,
  mode: "page", auth: { type: "none" }, priceCurrency: "CREDITS", priceCurrencyVerified: true,
  priceCurrencyNote: "美元计费价按 unit_amount / unit_quantity 还原：文本按百万 token，图片按张，视频按秒；音频与未授权模型明确保留为未解析。",
  rechargeCurrency: "USD", rechargeRateVerified: false, rechargeRateNote, rechargeAuto: false,
  rechargePlans: [10, 50, 100, 500].map(amount => ({ kind: "topup", amount, credits: amount, currency: "USD", availability: "self_service", verified: true,
    note: "登录充值页快捷美元面值；不是人民币实付、赠额或阶梯折扣，第三方支付未核验。" })),
  rechargePlansVerified: true, rechargePayments: [], rechargePaymentsVerified: false,
  adapter: { kind: "declarative", endpoint: MODELS_ENDPOINT, method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

const pluginSource = {
  id: "leaflow", host: HOST, mode: "page", responseFormat: "price-map", authType: "none", openTemporaryPage: true,
  preserveRechargeRateVerification: true,
  matches: ({ hostname, path }) => hostname === HOST && path === MODEL_PAGE,
  prepare: (stationInput, { url }) => ({
    ...stationInput, baseUrl: `${url.origin}${MODEL_PAGE}`, mode: "page", auth: { type: "none" },
    priceCurrency: "CREDITS", priceCurrencyVerified: true,
    priceCurrencyNote: stationInput.priceCurrencyNote || preset.priceCurrencyNote,
    rechargeCurrency: stationInput.rechargeCurrency || "USD", rechargeAuto: false,
    rechargeRateVerified: stationInput.rechargeRateVerified === true,
    rechargeRateNote: stationInput.rechargeRateNote || rechargeRateNote,
    ...(stationInput.rechargePlans == null ? { rechargePlans: preset.rechargePlans, rechargePlansVerified: true } : {}),
    adapter: { ...(stationInput.adapter || {}), ...preset.adapter }
  }),
  preset,
  rationale: "复用项目页面 HttpOnly cookie；全量模型目录关联独立计费价格，拒绝用公开精选页或历史价格补缺。",
  request: requestPolicy(() => MODELS_ENDPOINT, {
    credentials: "include", pageAuth: cookiePageAuth(), skipCapture: true,
    aux: [{ key: "prices", endpoint: PRICES_ENDPOINT }], decodeResponse: decodePricing
  })
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
