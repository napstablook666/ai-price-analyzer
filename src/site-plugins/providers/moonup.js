// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { requestPolicy } from "../../core/provider-registry.js";

// 2026-11-23 匿名实测：
//   GET /api/v1/marketplace/models 返回 200：7 个分组、51 个模型（去重后 44 个），价格公开。
//   分组倍率已经乘进 payload 的单价：gpt-6-sol 在 0.25 组输入 0.5/M、在 0.099 组 0.198/M，
//   同一个 base 价 2 对上（0.5 / 0.25 = 0.198 / 0.099 = 2），和文档「广场价已含倍率」一致。
//   所以这里先除以分组倍率还原 base，再由引擎按 ratioField 乘回去，出的就是最终扣费价。
//   /api/v1/payment/plans 与 /api/v1/groups/rates 匿名一律 401，充值比例拿不到，按未验证记录，不猜。
const MODELS_ENDPOINT = "/api/v1/marketplace/models";

// 出图模型按张计，payload 直接给 1K / 2K / 4K 三档价；同价的三档交给引擎并回一行。
const IMAGE_TIER_FIELDS = [
  { name: "1K", field: "image_price_1k" },
  { name: "2K", field: "image_price_2k" },
  { name: "4K", field: "image_price_4k" }
];

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

// payload 的单价是「每 token 美元」，引擎按「每 1M token」算；分组倍率已含在单价里，先除掉。
function perMillionBase(value, ratio) {
  const number = finiteOrNull(value);
  return number === null ? null : number * 1e6 / ratio;
}

function basePrice(value, ratio) {
  const number = finiteOrNull(value);
  return number === null ? null : number / ratio;
}

function intervalLabel(minTokens, maxTokens, index, count) {
  const min = finiteOrNull(minTokens);
  const max = finiteOrNull(maxTokens);
  const compact = value => value >= 1e6 ? `${Number((value / 1e6).toFixed(2))}M`
    : value >= 1e3 ? `${Number((value / 1e3).toFixed(1))}K` : String(value);
  if (min !== null && min > 0 && max !== null && max > 0) return `${compact(min)}–${compact(max)}`;
  if (max !== null && max > 0) return `≤${compact(max)}`;
  if (min !== null && min > 0) return `≥${compact(min)}`;
  return count > 1 ? `档 ${index + 1}` : "";
}

// token 区间：12 个模型按上下文长度分两档，其余模型把价格直接放在 pricing 上，这里统一摊成区间数组，
// 免得两套规则各写一遍。乱码或负数的价格读成 null，交给引擎记「输入价算不出来」，不补 0。
function tokenIntervalsOf(pricing, ratio) {
  const intervals = Array.isArray(pricing.context_intervals) && pricing.context_intervals.length
    ? pricing.context_intervals
    : [pricing];
  return intervals.map((interval, index) => {
    const min = finiteOrNull(interval?.min_tokens);
    const max = finiteOrNull(interval?.max_tokens);
    return {
      input: perMillionBase(interval?.input_price_per_token, ratio),
      output: perMillionBase(interval?.output_price_per_token, ratio),
      cacheRead: perMillionBase(interval?.cache_read_price_per_token, ratio),
      cacheWrite: perMillionBase(interval?.cache_write_price_per_token, ratio),
      label: intervalLabel(min, max, index, intervals.length),
      ...(min !== null && min > 0 ? { min_tokens: min } : {}),
      ...(max !== null && max > 0 ? { max_tokens: max } : {})
    };
  }).filter(cell => cell.input !== null || cell.output !== null);
}

// Fast 通道与标准价不是固定倍率关系（实测同一模型不同上下文档分别 1.0x / 1.33x / 2x），
// 所以单独摊一组区间，按「分组 · Fast」报价，不去拿标准价乘系数。
function fastIntervalsOf(pricing, ratio) {
  const intervals = Array.isArray(pricing?.context_intervals) && pricing.context_intervals.length
    ? pricing.context_intervals
    : [pricing];
  return intervals.map((interval, index) => {
    const min = finiteOrNull(interval?.min_tokens);
    const max = finiteOrNull(interval?.max_tokens);
    const label = intervalLabel(min, max, index, intervals.length);
    return {
      input: perMillionBase(interval?.fast_input_price_per_token, ratio),
      output: perMillionBase(interval?.fast_output_price_per_token, ratio),
      cacheRead: perMillionBase(interval?.fast_cache_read_price_per_token, ratio),
      cacheWrite: perMillionBase(interval?.fast_cache_write_price_per_token, ratio),
      label: label ? `Fast ${label}` : "Fast",
      ...(min !== null && min > 0 ? { min_tokens: min } : {}),
      ...(max !== null && max > 0 ? { max_tokens: max } : {})
    };
  }).filter(cell => cell.input !== null || cell.output !== null);
}

function imageSizesOf(pricing, ratio) {
  return IMAGE_TIER_FIELDS
    .map(({ name, field }) => ({ name, price: basePrice(pricing[field], ratio) }))
    .filter(size => size.price !== null && size.price > 0);
}

// 把「分组 → 模型 → 上下文区间」摊平成引擎认识的条目，一行一个分组的价。
// 同一个模型在不同分组里价格不同（gpt-6-sol、deepseek-v4-pro 都跨两组），
// 按模型合并会把其中一组的价丢掉，必须按分组各出一行。
function decodeMarketplace(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const groups = Array.isArray(payload.data) ? payload.data : [];
  const items = [];
  for (const group of groups) {
    if (!group || typeof group !== "object") continue;
    const groupName = String(group.name ?? "").trim();
    if (!groupName) continue;
    const ratio = finiteOrNull(group.rate_multiplier);
    const divisor = ratio !== null && ratio > 0 ? ratio : 1;
    for (const model of Array.isArray(group.models) ? group.models : []) {
      if (!model || typeof model !== "object") continue;
      const modelName = String(model.id ?? "").trim();
      if (!modelName) continue;
      const pricing = model.pricing && typeof model.pricing === "object" ? model.pricing : {};
      const mode = String(pricing.pricing_mode ?? "unknown");
      const item = {
        model_name: modelName,
        model_display_name: String(model.display_name ?? "").trim() || modelName,
        enable_groups: [groupName],
        row_ratio: divisor,
        pricing_mode: mode,
        price_status: String(pricing.price_status ?? "")
      };
      if (mode === "image") {
        const sizes = imageSizesOf(pricing, divisor);
        if (sizes.length) {
          item.image_sizes = sizes;
          item.image_base = sizes[0].price;
        }
      } else {
        // Fast 通道价并进同一分组的档位里（label 以 Fast 开头），不额外造分组
        item.intervals = [
          ...tokenIntervalsOf(pricing, divisor),
          ...fastIntervalsOf(pricing, divisor)
        ];
      }
      items.push(item);
    }
  }
  return { ...payload, data: items };
}

const PRICE_MAP = {
  schemaVersion: "price-map/1",
  source: "moonup",
  rootPath: "/data",
  nameField: "model_name",
  labelField: "model_display_name",
  // 模型广场直接标美元：window.__APP_CONFIG__.balance_unit_name = USD，文档也写「余额单位 USD」。
  currency: "USD",
  // 每行自带分组倍率：payload 的价已经乘过倍率，摊平时除掉了，这里按行乘回来。
  groups: { listPath: "enable_groups", ratioField: "row_ratio" },
  rules: [
    {
      when: { path: "price_status", equals: "unpriced" },
      kind: "unsupported",
      sourcePath: "pricing_mode",
      reason: "站点标记为未定价（unpriced），模型广场没有报价"
    },
    {
      when: { path: "pricing_mode", equals: "image" },
      kind: "request",
      price: "image_base",
      unit: "image",
      mediaType: "image",
      sizeTiers: { path: "image_sizes", nameField: "name", priceField: "price" },
      tierName: "按张"
    },
    {
      kind: "token",
      tiers: {
        path: "intervals",
        nameField: "label",
        minField: "min_tokens",
        maxField: "max_tokens",
        input: "input",
        output: "output",
        cacheRead: "cacheRead",
        cacheWrite: "cacheWrite"
      },
      tierName: "标准"
    }
  ]
};

const RECHARGE_NOTE = "模型广场与价格匿名可读，但 /api/v1/payment/plans 与 /api/v1/groups/rates 匿名一律 401；充值档位、折扣和分组费率没有登录态报文，充值比例未验证，不参与已验证推荐。";

const preset = {
  id: "moonup",
  name: "MoonUp",
  baseUrl: "https://moonup.dev/",
  rechargeAuto: false,
  rechargeRateVerified: false,
  rechargeRateNote: RECHARGE_NOTE,
  priceCurrency: "USD",
  priceCurrencyVerified: true,
  priceCurrencyNote: "模型广场单价是美元/token，已含分组倍率（0.099–1.9）；Fast 通道的价单独从 fast_* 字段取，与标准价倍率不固定，单独成「分组 · Fast」报价；峰时倍率不改基础价，未折算。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: {
    kind: "declarative",
    endpoint: MODELS_ENDPOINT,
    method: "GET",
    responseFormat: "price-map",
    priceMap: PRICE_MAP
  }
};

const pluginSource = {
  id: "moonup",
  host: "moonup.dev",
  preservePriceCurrency: true,
  preserveRechargeRateVerification: true,
  preset,
  matches: ({ hostname }) => hostname === "moonup.dev",
  prepareMatches: ({ hostname }) => hostname === "moonup.dev",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: url.origin,
    mode: "direct",
    auth: { type: "none" },
    priceCurrency: "USD",
    priceCurrencyVerified: true,
    priceCurrencyNote: stationInput.priceCurrencyNote || preset.priceCurrencyNote,
    rechargeAuto: false,
    rechargeRateVerified: stationInput.rechargeRateVerified ?? false,
    rechargeRateNote: stationInput.rechargeRateNote || RECHARGE_NOTE,
    adapter: {
      ...(stationInput.adapter || {}),
      kind: "declarative",
      endpoint: MODELS_ENDPOINT,
      method: "GET",
      responseFormat: "price-map",
      priceMap: PRICE_MAP
    }
  }),
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "MoonUp 的模型广场 /api/v1/marketplace/models 匿名可读，7 分组 51 模型的价格与倍率直连采集；充值方案匿名 401，比例未验证",
  request: requestPolicy(() => MODELS_ENDPOINT, { credentials: "omit", decodeResponse: decodeMarketplace })
};

const MODEL_ALIASES = [
  {
    "alias": "gemini-3.8-flash-tiered",
    "canonicalId": "gemini-3-8-flash"
  }
];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
