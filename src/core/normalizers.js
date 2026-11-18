import { SYSTEM_BASE_PRICE_PER_1M } from "../shared/schema.js";
import { mediaSpecsOf, mediaTypeForPricing } from "./media.js";
import { applyPriceMap } from "./price-map.js";
import { tokenfluxPriceMap } from "./price-maps/tokenflux.js";
import { stellaislePriceMap } from "./price-maps/stellaisle.js";
import { stellaisleCarpoolPriceMap } from "./price-maps/stellaisle-carpool.js";
import { cheapRouterPriceMap } from "./price-maps/cheaprouter.js";
import { trueSotaPriceMap } from "./price-maps/true-sota.js";
import { sidrunePriceMap } from "./price-maps/sidrune.js";
import { relayRouterPriceMap } from "./price-maps/relayrouter.js";
import { newcodexPriceMap } from "./price-maps/newcodex.js";
import { ALLROUTER_IMAGE_MODELS, ALLROUTER_MODELS, allrouterPriceMap } from "./price-maps/allrouter.js";
import { PRICE_FIELD_DEFINITIONS, rawPriceValue } from "./price-fields.js";
import { assertResponseFormatHandlers, getResponseFormatDefinition, getResponseFormatHandler, registerResponseFormatHandler } from "./response-formats.js";
import { AIAPI_EFFECTIVE_PRICE_FIELDS } from "./aiapi-contract.js";
export const NORMALIZATION_VERSION = 26;

const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
const number = (value, fallback = 1) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const finitePrice = value => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};
const linuxDoFinitePrice = value => {
  if (value === null || value === undefined || typeof value === "boolean" || (typeof value === "string" && value.trim() === "")) return null;
  if (typeof value === "object") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const normalizeCurrency = value => {
  const normalized = String(value ?? "").trim().toUpperCase();
  return normalized || "UNKNOWN";
};
const blankCurrency = value => value === null || value === undefined || String(value).trim() === "";
const genericFallbackCurrency = options => options.priceCurrency === "CREDITS" && options.priceCurrencyVerified === true ? "CREDITS" : "UNKNOWN";
const rowPriceCurrency = (item, options) => {
  const rawCurrency = blankCurrency(item?.price_currency) ? item?.currency : item?.price_currency;
  return blankCurrency(rawCurrency) ? genericFallbackCurrency(options) : normalizeCurrency(rawCurrency);
};

const hasAiApiEffectivePrices = models => Array.isArray(models) && models.some(model => {
  const effective = model?.effective;
  return effective && typeof effective === "object" && AIAPI_EFFECTIVE_PRICE_FIELDS.some(key => own(effective, key));
});
const perMillion = value => {
  const parsed = finitePrice(value);
  return parsed === null ? null : parsed * 1_000_000;
};



const BILLING_UNIT_ALIASES = Object.freeze({
  token: "token",
  tokens: "token",
  "per_token": "token",
  "per_1m_tokens": "token",
  request: "request",
  per_request: "request",
  call: "request",
  image: "image",
  image_generation: "image",
  per_image: "image",
  second: "second",
  seconds: "second",
  per_second: "second",
  minute: "minute",
  minutes: "minute",
  per_minute: "minute",
  character: "character",
  characters: "character",
  per_character: "character"
});

function billingUnitOf(item, prices) {
  const explicit = item?.billing_unit ?? item?.billingUnit ?? item?.request_unit ?? item?.unit;
  const explicitUnit = BILLING_UNIT_ALIASES[String(explicit ?? "").trim().toLowerCase()];
  if (explicitUnit) return explicitUnit;
  const mediaType = String(item?.media_type || item?.mediaType || "").trim().toLowerCase();
  if (mediaType === "image" || mediaType === "video" || mediaType === "audio") return "image";
  if (Number(prices.request_price) > 0) return "request";
  if (Number(prices.image_price) > 0) return "image";
  if (["input_price", "output_price", "cache_read_price", "cache_write_price", "cache_write_1h_price"].some(field => Number.isFinite(prices[field]))) return "token";
  return "unknown";
}

function billingBasisOf(unit) {
  return {
    token: "per_1m_tokens",
    request: "per_request",
    image: "per_image",
    second: "per_second",
    minute: "per_minute",
    character: "per_character"
  }[unit] || "unknown";
}

function normalizeBillingConditions(value) {
  const source = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : value ? [{ expression: value }] : [];
  return source.map(entry => {
    const raw = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : { expression: entry };
    const expression = String(raw.expression ?? raw.condition ?? raw.time_condition ?? "").trim();
    const timezone = String(raw.timezone ?? raw.time_zone ?? "").trim();
    const start = String(raw.start ?? raw.start_time ?? "").trim();
    const end = String(raw.end ?? raw.end_time ?? "").trim();
    const multiplierValue = raw.multiplier ?? raw.discount ?? raw.factor;
    const fallbackValue = raw.fallback_multiplier ?? raw.fallbackMultiplier;
    const multiplier = multiplierValue === undefined || multiplierValue === null || multiplierValue === "" ? null : finitePrice(multiplierValue);
    const fallbackMultiplier = fallbackValue === undefined || fallbackValue === null || fallbackValue === "" ? null : finitePrice(fallbackValue);
    if (!expression && !timezone && !start && !end && multiplier === null && fallbackMultiplier === null) return null;
    const type = ["time", "time-window", "usage", "context"].includes(raw.type || raw.kind) ? (raw.type || raw.kind) : "time";
    return {
      type,
      ...(expression ? { expression } : {}),
      ...(timezone ? { timezone } : {}),
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
      ...(multiplier === null ? {} : { multiplier }),
      ...(fallbackMultiplier === null ? {} : { fallback_multiplier: fallbackMultiplier })
    };
  }).filter(Boolean);
}

function billingConditionsOf(item) {
  const explicit = item?.billing_conditions ?? item?.billingConditions ?? item?.time_conditions ?? item?.timeConditions;
  const conditions = normalizeBillingConditions(explicit);
  const legacyCondition = String(item?.tier_time_condition || "").trim();
  const legacyDiscount = finitePrice(item?.tier_time_discount);
  if (legacyCondition && legacyDiscount !== null && !conditions.some(condition => condition.expression === legacyCondition && condition.multiplier === legacyDiscount)) {
    conditions.push({ type: "time", expression: legacyCondition, multiplier: legacyDiscount, fallback_multiplier: 1 });
  }
  const peakEnabled = item?.peak_rate_enabled === true;
  const peakStart = String(item?.peak_start || "").trim();
  const peakEnd = String(item?.peak_end || "").trim();
  const peakMultiplier = finitePrice(item?.peak_rate_multiplier);
  if (peakEnabled && peakStart && peakEnd && peakMultiplier !== null) {
    conditions.push({
      type: "time-window",
      ...(item?.timezone ? { timezone: String(item.timezone).trim() } : {}),
      start: peakStart,
      end: peakEnd,
      multiplier: peakMultiplier,
      fallback_multiplier: 1
    });
  }
  return conditions;
}

export function cleanPricingRows(rows, options = {}) {
  return (Array.isArray(rows) ? rows : []).map(item => {
    const rawModelRatio = item.model_ratio ?? item.ratio ?? item.input_ratio;
    const priceValues = Object.fromEntries(PRICE_FIELD_DEFINITIONS.map(field => [field.normalized, finitePrice(rawPriceValue(item, field))]));
    const inputPrice = priceValues.input_price;
    const outputPrice = priceValues.output_price;
    const cacheReadPrice = priceValues.cache_read_price;
    const cacheWritePrice = priceValues.cache_write_price;
    const cacheWrite1hPrice = priceValues.cache_write_1h_price;
    const requestPrice = priceValues.request_price;
    const imageInputPrice = priceValues.image_input_price;
    const imageOutputPrice = priceValues.image_output_price;
    const imagePrice = priceValues.image_price;
    const billingUnit = billingUnitOf(item, priceValues);
    const billingConditions = billingConditionsOf(item);
    const minTokens = finitePrice(item.min_tokens);
    const maxTokens = finitePrice(item.max_tokens);
    const hasModelRatio = rawModelRatio !== undefined && rawModelRatio !== null && rawModelRatio !== "" && finitePrice(rawModelRatio) !== null;
    const hasPrice = PRICE_FIELD_DEFINITIONS.some(field => priceValues[field.normalized] !== null);
    const mediaType = mediaTypeForPricing({ ...item, image_price: imagePrice });
    const mediaSpecs = mediaSpecsOf(item);
    return {
      model_name: item.model_name || item.model || item.id || item.name || "",
      model_display_name: item.model_display_name || item.display_name || item.name || item.model || item.id || "",
      model_ratio: finitePrice(rawModelRatio, 0),
      completion_ratio: finitePrice(item.completion_ratio ?? item.output_ratio, 1),
      group_ratio: finitePrice(item.group_ratio ?? item.groupRatio, 1),
      ...priceValues,
      price_currency: rowPriceCurrency(item, options),
      enable_groups: item.enable_groups || item.groups || [],
      proxy_group_name: item.proxy_group_name || item.group_name || "",
      tier_name: item.tier_name || item.tier || "",
      billing_unit: billingUnit,
      billing_basis: billingBasisOf(billingUnit),
      ...(item.request_unit ? { request_unit: String(item.request_unit).trim().toLowerCase() } : {}),
      ...(minTokens === null ? {} : { min_tokens: minTokens }),
      ...(maxTokens === null ? {} : { max_tokens: maxTokens }),
      ...(billingConditions.length ? { billing_conditions: billingConditions } : {}),
      // 出图/视频的规格档（1K / 2K / 4K）单独一列，不混进按长度分档的 tier_name。
      ...(item.size_tier ? { size_tier: String(item.size_tier).trim() } : {}),
      evidence: item.evidence || "provider_payload",
      ...(mediaType ? { media_type: mediaType } : {}),
      ...(mediaSpecs ? { media_specs: mediaSpecs } : {}),
      hasPricing: hasModelRatio || hasPrice
    };
  }).filter(item => item.model_name).map(({ hasPricing, ...item }) => ({ ...item, catalogOnly: !hasPricing }));
}
export class ParsingStrategy {
  canParse() { return false; }
  parse() { return { data: [], group_ratio: {} }; }
}

const TIER_CALL_PATTERN = /tier\s*\(/gi;
// len <= N / p <= N 这类长度条件决定档位区间，hour(...) 之类的时间条件不算。
const TIER_BOUNDARY_PATTERN = /(?:^|[^a-z0-9_])(?:len|length|tokens?|input_tokens?|p)\s*(<=|<|>=|>)\s*(\d+(?:\.\d+)?)\s*$/i;
const TIER_TIME_RULE_PATTERN = /\*\s*\(\s*(.*?)\?\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*\)/i;

function balancedSpan(source, start) {
  let depth = 1;
  let quote = "";
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")" && --depth === 0) return { body: source.slice(start, index), end: index };
  }
  return null;
}

function splitArguments(body) {
  const parts = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (const char of body) {
    if (quote) {
      current += char;
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === "(" || char === "[") depth += 1;
    else if (char === ")" || char === "]") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

// 三元链 A ? X : B ? Y : Z 里每个分支的生效条件就是它前面那个 `?` 左侧的表达式，
// 各分支条件天然互斥（B 成立即 A 不成立），所以不必把 A 的否定拼进去。
function conditionBefore(expression, questionAt) {
  let depth = 0;
  let quote = "";
  let index = questionAt - 1;
  for (; index >= 0; index -= 1) {
    const char = expression[index];
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === ")") {
      depth += 1;
      continue;
    }
    if (char === "(") {
      if (!depth) break;
      depth -= 1;
      continue;
    }
    if (depth) continue;
    if (char === "?" || char === ":" || char === ",") break;
  }
  return expression.slice(index + 1, questionAt).trim();
}

function ternaryBranches(expression) {
  const branches = [];
  const open = [];
  let depth = 0;
  let quote = "";
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[") {
      depth += 1;
      continue;
    }
    if (char === ")" || char === "]") {
      depth -= 1;
      continue;
    }
    if (char === "?") {
      open.push(index);
      continue;
    }
    if (char !== ":" || !open.length) continue;
    const questionAt = open.pop();
    branches.push({ condition: conditionBefore(expression, questionAt), start: questionAt + 1, end: index });
  }
  for (const questionAt of open) {
    branches.push({ condition: conditionBefore(expression, questionAt), start: questionAt + 1, end: expression.length });
  }
  return branches;
}

function boundaryOf(condition) {
  const match = String(condition || "").match(TIER_BOUNDARY_PATTERN);
  if (!match) return {};
  const value = Number(match[2]);
  if (!Number.isFinite(value)) return {};
  const operator = match[1];
  // 保留开闭区间：`len > N` 的档从 N+1 开始，`len <= N` 的档到 N 结束、下一档从 N+1 开始。
  if (operator.startsWith("<")) return { maxTokens: value, maxInclusive: operator === "<=" };
  return { minTokens: operator === ">=" ? value : value + 1 };
}

export function parseBillingTiers(expression) {
  if (typeof expression !== "string" || !expression.includes("tier")) return [];
  const branches = ternaryBranches(expression);
  const tiers = [];
  TIER_CALL_PATTERN.lastIndex = 0;
  let match;
  while ((match = TIER_CALL_PATTERN.exec(expression))) {
    const callStart = match.index;
    const span = balancedSpan(expression, TIER_CALL_PATTERN.lastIndex);
    if (!span) continue;
    TIER_CALL_PATTERN.lastIndex = span.end + 1;
    const [rawName, rawBody = ""] = splitArguments(span.body);
    const name = String(rawName || "").replace(/["']/g, "").trim();
    const body = rawBody.trim();
    const branch = branches
      .filter(item => item.start <= callStart && callStart < item.end)
      .sort((first, second) => (first.end - first.start) - (second.end - second.start))[0];
    const boundary = boundaryOf(branch?.condition);
    const minTokens = boundary.minTokens ?? null;
    const maxTokens = boundary.maxTokens ?? null;
    const maxInclusive = boundary.maxInclusive ?? true;
    // fixed(x) 是站点写的固定单价：* image_count 时按张，否则按次。
    const fixed = body.match(/^fixed\s*\(\s*(\d+(?:\.\d+)?|\.\d+)\s*\)$/i);
    if (fixed) {
      const perImage = /^\s*\*\s*image_count\b/i.test(expression.slice(span.end + 1));
      const price = Number(fixed[1]);
      tiers.push({
        name,
        input: 0,
        output: 0,
        ratio: 0,
        completion: 1,
        billing: { cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 },
        unit: perImage ? "image" : "request",
        fixed: price,
        ...(perImage ? {} : { request: price }),
        minTokens,
        maxTokens,
        maxInclusive
      });
      continue;
    }
    const coefficients = {};
    for (const term of body.match(/[+-]?[^+-]+/g) || []) {
      const parts = term.trim().match(/^([+-]?)\s*(?:(\d+(?:\.\d+)?|\.\d+)\s*\*\s*)?([a-z0-9]+)(?:\s*\*\s*(\d+(?:\.\d+)?|\.\d+))?$/i);
      if (!parts) continue;
      const sign = parts[1] === "-" ? -1 : 1;
      const coefficient = Number(parts[2] || parts[4] || 1) * sign;
      coefficients[parts[3].toLowerCase()] = (coefficients[parts[3].toLowerCase()] || 0) + coefficient;
    }
    const input = Number(coefficients.p || 0);
    const output = Number(coefficients.c || 0);
    if (input <= 0 && output <= 0) continue;
    tiers.push({
      name,
      input,
      output,
      ratio: input / SYSTEM_BASE_PRICE_PER_1M,
      completion: input > 0 ? output / input : 1,
      billing: {
        cacheRead: Number(coefficients.cr || 0),
        cacheWrite: Number(coefficients.cc || 0),
        cacheWrite1h: Number(coefficients.cc1h || 0)
      },
      unit: "token",
      fixed: null,
      minTokens,
      maxTokens,
      maxInclusive
    });
  }
  const timeDiscount = expression.match(TIER_TIME_RULE_PATTERN);
  if (timeDiscount) {
    const timeCondition = timeDiscount[1].trim();
    const multiplier = Number(timeDiscount[2]);
    const fallbackMultiplier = Number(timeDiscount[3]);
    for (const tier of tiers) {
      tier.timeDiscount = multiplier;
      tier.timeCondition = timeCondition;
      tier.billingConditions = [{
        type: "time",
        expression: timeCondition,
        multiplier,
        fallback_multiplier: fallbackMultiplier
      }];
    }
  }
  // 只有出现长度条件时才补区间下界，否则普通单档模型不该凭空多出 min_tokens。
  if (tiers.some(tier => tier.minTokens !== null || tier.maxTokens !== null)) {
    tiers.forEach((tier, index) => {
      if (tier.minTokens !== null) return;
      if (index === 0) {
        tier.minTokens = 0;
        return;
      }
      const previous = tiers[index - 1];
      // 上一档上界是闭区间（<=）时，本档从它 +1 开始；开区间（<）时本档就从该值开始。
      tier.minTokens = previous.maxTokens === null ? null : previous.maxInclusive === false ? previous.maxTokens : previous.maxTokens + 1;
    });
  }
  return tiers;
}

export class PqhPricingStrategy extends ParsingStrategy {
  canParse(raw) {
    const items = Array.isArray(raw?.data) ? raw.data : [];
    const envelope = Boolean(raw && (raw.pricing_version || raw.usable_group || raw.vendors));
    const tiered = items.some(item => item && (item.billing_mode === "tiered_expr" || typeof item.billing_expr === "string"));
    return Boolean(items.length && raw?.group_ratio && typeof raw.group_ratio === "object" &&
      (envelope || tiered) && items.some(item => item && typeof item.model_name === "string" &&
        (Array.isArray(item.enable_groups) || typeof item.enable_groups === "string") &&
        (own(item, "model_ratio") || typeof item.billing_expr === "string")));
  }

  parse(raw, options = {}) {
    const configuredBase = Number(options.basePricePerMillion);
    const base = Number.isFinite(configuredBase) && configuredBase >= 0 ? configuredBase : SYSTEM_BASE_PRICE_PER_1M;
    const hasModelCatalog = Array.isArray(raw.available_models) && Array.isArray(raw.priced_model_details);
    let items = raw.data;
    if (hasModelCatalog) {
      const normalizeName = value => String(value || "").trim().toLowerCase();
      const available = new Set(raw.available_models.map(normalizeName));
      const merged = new Map();
      for (const item of raw.data) {
        const name = normalizeName(item?.model_name);
        if (name) merged.set(name, item);
      }
      for (const item of raw.priced_model_details) {
        const name = normalizeName(item?.model_name);
        if (!name) continue;
        const current = merged.get(name);
        merged.set(name, current ? { ...current, ...item, enable_groups: current.enable_groups } : item);
      }
      items = [...merged.values()].filter(item => available.has(normalizeName(item.model_name)));
    }
    const groupRatios = Object.fromEntries(Object.entries(raw.group_ratio).map(([key, value]) => [key, number(value)]));
    const catalogRatios = !hasModelCatalog && raw.catalog_group_ratio && typeof raw.catalog_group_ratio === "object"
      ? Object.fromEntries(Object.entries(raw.catalog_group_ratio).map(([key, value]) => [key, number(value)]))
      : null;
    const catalogPricing = Boolean(catalogRatios && Object.keys(catalogRatios).length);
    const displayGroups = catalogPricing ? Object.keys(catalogRatios) : null;
    const usableGroups = !hasModelCatalog && raw.usable_group && typeof raw.usable_group === "object" ? Object.keys(raw.usable_group) : [];
    const activeGroups = usableGroups.filter(group => own(groupRatios, group));
    const list = [];
    const mediaGroups = new Set(Object.values(raw.media_groups || {}).filter(Boolean).map(String));

    for (const item of items) {
      if (!item || typeof item.model_name !== "string") continue;
      const itemGroups = Array.isArray(item.enable_groups) ? item.enable_groups : [item.enable_groups].filter(Boolean);
      if (!hasModelCatalog && !itemGroups.length) continue;
      if (itemGroups.some(group => mediaGroups.has(group))) continue;
      const requestBilled = hasModelCatalog && Number(item.quota_type) === 1;
      const tiers = requestBilled ? [] : parseBillingTiers(item.billing_expr).filter(tier => tier.unit === "token");
      const variants = tiers.length ? tiers : [{
        name: "标准",
        input: requestBilled ? NaN : Number(item.model_ratio) * base,
        output: requestBilled ? NaN : Number(item.model_ratio) * base * Number(item.completion_ratio || 1),
        ratio: item.model_ratio,
        completion: item.completion_ratio,
        request: Number(item.quota_type) === 1 && Number.isFinite(Number(item.model_price)) ? Number(item.model_price) : null,
        billing: {
          cacheRead: requestBilled || finitePrice(item.cache_ratio) === null ? null : Number(item.model_ratio) * base * Number(item.cache_ratio),
          cacheWrite: requestBilled || finitePrice(item.create_cache_ratio) === null ? null : Number(item.model_ratio) * base * Number(item.create_cache_ratio)
        }
      }];
      const targetGroups = hasModelCatalog ? [null] : catalogPricing
        ? displayGroups
        : (activeGroups.length ? itemGroups.filter(group => activeGroups.includes(group)) : itemGroups);
      const discounts = item.active_discount_rates || {};
      const displayDiscounts = item.active_discount_display || {};

      for (const group of targetGroups) {
        const groupRatio = hasModelCatalog ? 1 : number((catalogPricing ? catalogRatios : groupRatios)[group]);
        const discountValue = catalogPricing && own(discounts, group) && displayDiscounts[group] !== false ? Number(discounts[group]) : null;
        const discountFactor = Number.isFinite(discountValue) ? discountValue / 100 : 1;
        for (const tier of variants) {
          const billing = tier.billing || {};
          const inputPrice = Number.isFinite(tier.input) ? tier.input * groupRatio * discountFactor : null;
          const outputPrice = Number.isFinite(tier.output) ? tier.output * groupRatio * discountFactor : null;
          list.push({
            model_name: item.model_name,
            model_display_name: item.model_name,
            model_ratio: inputPrice === null ? number(tier.ratio, number(item.model_ratio)) * groupRatio * discountFactor : inputPrice / base,
            completion_ratio: inputPrice > 0 && outputPrice !== null ? outputPrice / inputPrice : number(tier.completion, number(item.completion_ratio)),
            input_price: inputPrice,
            output_price: outputPrice,
            cache_read_price: finitePrice(billing.cacheRead) === null ? null : billing.cacheRead * groupRatio * discountFactor,
            cache_write_price: finitePrice(billing.cacheWrite) === null ? null : billing.cacheWrite * groupRatio * discountFactor,
            cache_write_1h_price: finitePrice(billing.cacheWrite1h) === null ? null : billing.cacheWrite1h * groupRatio * discountFactor,
            request_price: finitePrice(tier.request) === null ? null : tier.request * groupRatio * discountFactor,
            price_currency: "USD",
            enable_groups: hasModelCatalog ? itemGroups : [group],
            proxy_group_name: hasModelCatalog ? "" : group,
            tier_name: tier.name,
            group_ratio: groupRatio * discountFactor,
            evidence: "exact"
          });
        }
      }
    }
    return { data: list, group_ratio: hasModelCatalog ? {} : catalogPricing ? Object.fromEntries(displayGroups.map(group => [group, 1])) : groupRatios, sourceFormat: Array.isArray(raw.auto_groups) ? "new-api-pricing" : "pqh" };
  }
}


export class TokenFluxPricingStrategy extends ParsingStrategy {
  // 同形状的站点只是换一份字段映射，子类覆盖这个 getter 就行。
  get priceMap() { return tokenfluxPriceMap; }
  canParse(raw, options = {}) {
    return options.responseFormat === "tokenflux" && raw?.success === true &&
      Array.isArray(raw?.data) && raw?.group_ratio && typeof raw.group_ratio === "object";
  }

  parse(raw) {
    // 字段映射全在 price-maps/tokenflux.js 里，这里只负责调用和把失败报上去。
    const { rows, unresolved } = applyPriceMap(this.priceMap, raw, { parseTiers: parseBillingTiers });
    const groupRatio = Object.fromEntries(Object.entries(raw.group_ratio)
      .map(([group, value]) => [group, finitePrice(value)])
      .filter(([, value]) => value !== null));
    return {
      data: rows,
      group_ratio: groupRatio,
      sourceFormat: "tokenflux",
      ...(unresolved.length
        ? {
            incomplete: true,
            unsupportedBillingModes: [...new Set(unresolved.map(entry => entry.reason))].sort(),
            unpricedModels: unresolved.map(entry => entry.model)
          }
        : {})
    };
  }
}

// 同一份 tokenflux 形状，倍率类的 model_ratio 按 1 = $2 折算，理由见 price-maps/newcodex.js。
export class NewCodexPricingStrategy extends TokenFluxPricingStrategy {
  get priceMap() { return newcodexPriceMap; }

  canParse(raw, options = {}) {
    return options.responseFormat === "newcodex" && raw?.success === true && Array.isArray(raw?.data) && raw?.group_ratio && typeof raw.group_ratio === "object";
  }

  parse(raw) {
    return { ...super.parse(raw), sourceFormat: "newcodex" };
  }
}

// AllRouter 的 /api/ratio_config 是 New API 的列式报文：data 里没有行数组，
// 而是 model_ratio / completion_ratio / cache_ratio / create_cache_ratio / model_price /
// billing_expr / billing_mode 七张「模型名 → 值」的表。这里按模型名拼成行，再交给价格映射。
// 拼之前先过在售白名单：ratio 表里那 486 条大多是 New API 出厂默认表，站点根本不卖。
export const ALLROUTER_COLUMNS = [
  "model_ratio", "completion_ratio", "cache_ratio", "create_cache_ratio", "model_price", "billing_expr", "billing_mode"
];
const ALLROUTER_MODEL_SET = new Set(ALLROUTER_MODELS);

export function pivotAllRouterColumns(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const columns = ALLROUTER_COLUMNS.filter(key => data[key] && typeof data[key] === "object");
  if (!columns.length) return [];
  const names = new Set();
  for (const key of columns) for (const name of Object.keys(data[key])) names.add(name);
  return [...names].filter(name => ALLROUTER_MODEL_SET.has(name)).map(name => {
    const row = { model_name: name };
    for (const key of columns) if (own(data[key], name)) row[key] = data[key][name];
    // 站点不报端点类型，出图模型靠这张表补，见 price-maps/allrouter.js。
    if (ALLROUTER_IMAGE_MODELS.has(name)) row.supported_endpoint_types = ["image-generation"];
    return row;
  });
}

// 拼出来的行和 tokenflux 同构，规则整份复用；倍率类乘 2 的理由见 price-maps/allrouter.js。
export class AllRouterPricingStrategy extends TokenFluxPricingStrategy {
  get priceMap() { return allrouterPriceMap; }

  canParse(raw, options = {}) {
    return options.responseFormat === "allrouter" && raw?.success === true &&
      raw?.data && typeof raw.data === "object" && !Array.isArray(raw.data) &&
      Boolean(raw.data.model_ratio) && typeof raw.data.model_ratio === "object";
  }

  parse(raw) {
    // 站点没有公开的分组倍率表，group_ratio 给空对象，让它走价格映射里的 unlisted 基准价。
    const normalized = super.parse({ ...raw, data: pivotAllRouterColumns(raw.data), group_ratio: {} });
    return { ...normalized, sourceFormat: "allrouter" };
  }
}

export class WindHubPricingStrategy extends TokenFluxPricingStrategy {
  canParse(raw, options = {}) {
    return options.responseFormat === "windhub" && raw?.success === true && Array.isArray(raw?.data) && raw?.group_ratio && typeof raw.group_ratio === "object";
  }

  parse(raw) {
    const normalized = super.parse(raw);
    const vendors = new Map((Array.isArray(raw.vendors) ? raw.vendors : []).map(vendor => [String(vendor?.id), String(vendor?.name || vendor?.id || "").trim()]));
    const sourceByModel = new Map((raw.data || []).map(item => [String(item?.model_name || ""), item]));
    return {
      ...normalized,
      sourceFormat: "windhub",
      ...(normalized.data.length ? {} : { error: "WindHub 公开定价数据为空或格式无效" }),
      auto_groups: Array.isArray(raw.auto_groups) ? [...raw.auto_groups] : [],
      usable_group: raw.usable_group && typeof raw.usable_group === "object" ? { ...raw.usable_group } : {},
      vendors: Array.isArray(raw.vendors) ? raw.vendors.map(vendor => ({ ...vendor })) : [],
      supported_endpoint: raw.supported_endpoint && typeof raw.supported_endpoint === "object" ? { ...raw.supported_endpoint } : {},
      pricing_version: raw.pricing_version || "",
      data: normalized.data.map(row => {
        const source = sourceByModel.get(row.model_name) || {};
        return {
          ...row,
          vendor_id: source.vendor_id ?? null,
          vendor: vendors.get(String(source.vendor_id)) || String(source.owner_by || "").trim(),
          cache_ratio: source.cache_ratio ?? null,
          price_currency: "CREDITS",
          supported_endpoint_types: Array.isArray(source.supported_endpoint_types) ? [...source.supported_endpoint_types] : [],
          pricing_version: source.pricing_version || raw.pricing_version || ""
        };
      })
    };
  }
}

// Star API 的报文和 WindHub 同构，分组根本不公开模型 ↔ 分组的对应，只出基准价（见 price-maps/stellaisle.js）。
export class StellaislePricingStrategy extends WindHubPricingStrategy {
  get priceMap() { return stellaislePriceMap; }

  canParse(raw, options = {}) {
    return options.responseFormat === "stellaisle" && raw?.success === true &&
      Array.isArray(raw?.data) && raw?.group_ratio && typeof raw.group_ratio === "object";
  }

  parse(raw) {
    const normalized = super.parse(raw);
    return {
      ...normalized,
      sourceFormat: "stellaisle",
      // 父类那句报错写着 WindHub，换到这家就自相矛盾了。
      ...(normalized.data.length ? {} : { error: "Star API 公开定价数据为空或格式无效" })
    };
  }
}

// 拼车中心（/api/carpool-market）单独一套报文：一份座位清单，模型字段只有名字。
// 价格要靠站点自己的 /api/pricing 当辅助报文（requestPolicy 的 aux），
// 座位折扣当分组倍率用，一辆车一个分组。
function carpoolSeatFactor(listing) {
  const price = Number(listing?.seat_price_minor) / 100;
  const weeklyUsd = Number(listing?.seat_quota_usd);
  const days = Number(listing?.remaining_days);
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(weeklyUsd) || weeklyUsd <= 0) return null;
  if (!Number.isFinite(days) || days <= 0) return null;
  // 期间额度 = 每周额度 × 剩余周数；额度按 1 元 = 1 美元额度计价。
  const factor = price / (weeklyUsd * days / 7);
  return Number.isFinite(factor) && factor > 0 ? factor : null;
}

export class StellaisleCarpoolPricingStrategy extends ParsingStrategy {
  canParse(raw, options = {}) {
    return options.responseFormat === "stellaisle-carpool" && raw?.success === true &&
      Array.isArray(raw?.data?.data);
  }

  parse(raw) {
    const listings = (raw.data.data || []).filter(listing => listing && typeof listing === "object");
    const pricing = raw.__aux?.pricing;
    if (!pricing || !Array.isArray(pricing.data)) {
      return { data: [], group_ratio: {}, sourceFormat: "stellaisle-carpool", error: "拼车缺少站点定价报文，无法折算单价" };
    }

    // 一辆车一个分组名；同名车靠 id 区分，否则倍率表会互相覆盖。
    const groups = new Map();
    const taken = new Set();
    const unresolved = [];
    for (const listing of listings) {
      const factor = carpoolSeatFactor(listing);
      const models = (Array.isArray(listing.models) ? listing.models : []).map(model => String(model || "").trim()).filter(Boolean);
      const base = `拼车 · ${String(listing.name || "").trim() || `#${listing.id}`}`;
      if (factor === null || !models.length) {
        unresolved.push({ model: base, reason: factor === null ? "座位价或额度缺失，算不出折算" : "这条拼车没有模型清单" });
        continue;
      }
      let group = base;
      if (taken.has(group)) group = `${base} #${listing.id}`;
      taken.add(group);
      groups.set(group, { factor, models });
    }
    if (!groups.size) {
      return { data: [], group_ratio: {}, sourceFormat: "stellaisle-carpool", error: "拼车市场当前没有可折算的座位" };
    }

    const groupRatio = Object.fromEntries([...groups].map(([group, entry]) => [group, entry.factor]));
    const groupsByModel = new Map();
    for (const [group, entry] of groups) {
      for (const model of entry.models) {
        if (!groupsByModel.has(model)) groupsByModel.set(model, []);
        groupsByModel.get(model).push(group);
      }
    }

    const items = pricing.data
      .filter(item => groupsByModel.has(String(item?.model_name || "").trim()))
      .map(item => ({
        ...item,
        // 拼车分组的清单由座位决定，不跟站点渠道的 enable_groups 混在一起。
        enable_groups: groupsByModel.get(String(item.model_name).trim())
      }));
    if (!items.length) {
      return { data: [], group_ratio: {}, sourceFormat: "stellaisle-carpool", error: "拼车座位上的模型在定价表里都找不到" };
    }

    const vendors = new Map((Array.isArray(pricing.vendors) ? pricing.vendors : [])
      .map(vendor => [String(vendor?.id), String(vendor?.name || vendor?.id || "").trim()]));
    const { rows, unresolved: pricingUnresolved } = applyPriceMap(
      stellaisleCarpoolPriceMap,
      { success: true, data: items, group_ratio: groupRatio },
      { parseTiers: parseBillingTiers }
    );
    const sourceByModel = new Map(items.map(item => [String(item.model_name), item]));
    const data = rows.map(row => {
      const source = sourceByModel.get(row.model_name) || {};
      return {
        ...row,
        // 额度计价，1 元充值换 1 美元额度（站点 price=1 / quota_per_unit=500000）。
        price_currency: "CREDITS",
        vendor_id: source.vendor_id ?? null,
        vendor: vendors.get(String(source.vendor_id)) || String(source.owner_by || "").trim()
      };
    });
    const failed = [...unresolved, ...pricingUnresolved];
    return {
      data,
      group_ratio: groupRatio,
      sourceFormat: "stellaisle-carpool",
      ...(failed.length
        ? {
            incomplete: true,
            unsupportedBillingModes: [...new Set(failed.map(entry => entry.reason))].sort(),
            unpricedModels: failed.map(entry => entry.model)
          }
        : {}),
      ...(data.length ? {} : { error: "拼车座位折算不出价格" })
    };
  }
}
// RelayRouter 的报文和 TokenFlux 同构，只是字段名换了一套（见 price-maps/relayrouter.js）。
export class RelayRouterPricingStrategy extends TokenFluxPricingStrategy {
  get priceMap() { return relayRouterPriceMap; }

  canParse(raw, options = {}) {
    return options.responseFormat === "relayrouter" && raw?.success === true &&
      Array.isArray(raw?.data) && raw?.group_ratio && typeof raw.group_ratio === "object";
  }

  parse(raw) {
    return { ...super.parse(raw), sourceFormat: "relayrouter" };
  }
}
function unwrapTrpcPayload(raw) {
  const item = Array.isArray(raw) && raw.length ? raw[0] : raw;
  return item?.result?.data?.json || item?.result?.data || raw;
}

function jijiPrice(model, group, fields, multiplier) {
  const names = Array.isArray(fields) ? fields : [fields];
  const directField = names.find(field => group?.[field] !== undefined);
  const modelField = names.find(field => model?.[field] !== undefined);
  const direct = directField ? group[directField] : undefined;
  const value = directField ? direct : modelField ? model[modelField] : undefined;
  const parsed = finitePrice(value);
  return parsed === null ? null : directField ? parsed : parsed * multiplier;
}

function fastAiChannels(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.data?.data)) return raw.data.data;
  return [];
}

function fastAiEffectivePrice(interval, pricing, field) {
  const value = interval[field];
  if (value !== null && value !== undefined) return finitePrice(value);
  const base = finitePrice(pricing[field]);
  return base === null ? null : base * number(interval[`${field.replace(/_price$/, "")}_multiplier`]);
}

function fastAiTierName(interval) {
  if (!interval || interval.tier_label) return interval?.tier_label || "标准";
  const label = value => value >= 1_000_000 ? `${Math.round(value / 10_000) / 100}M` : value >= 1_000 ? `${Math.round(value / 10) / 100}K` : String(value);
  const min = number(interval.min_tokens, 0);
  return interval.max_tokens == null ? `>${label(min)}` : min === 0 ? `<=${label(number(interval.max_tokens))}` : `${label(min)}-${label(number(interval.max_tokens))}`;
}

function fastAiCacheWrite1h(interval, pricing) {
  const value = interval.cache_write_1h_price ?? interval.cache_write_price;
  if (value !== null && value !== undefined) return finitePrice(value);
  const base = finitePrice(pricing.cache_write_1h_price ?? pricing.cache_write_price);
  return base === null ? null : base * number(interval.cache_write_multiplier);
}

export class FastAiChannelsStrategy extends ParsingStrategy {
  canParse(raw) { return fastAiChannels(raw).some(channel => Array.isArray(channel?.platforms)); }

  parse(raw) {
    const data = [];
    const groupRatio = {};
    for (const channel of fastAiChannels(raw)) {
      for (const section of channel.platforms || []) {
        const groups = Array.isArray(section.groups) && section.groups.length ? section.groups : [{ name: section.platform || channel.name, rate_multiplier: 1 }];
        for (const model of section.supported_models || []) {
          const modelName = String(model?.model_id || model?.name || "").trim();
          if (!modelName) continue;
          for (const group of groups) {
            const pricing = model.group_pricing?.[String(group.id)] || model.pricing;
            if (!pricing) continue;
            const intervals = Array.isArray(pricing.intervals) ? [...pricing.intervals].sort((a, b) => number(a.min_tokens, 0) - number(b.min_tokens, 0)) : [];
            const defaultInterval = intervals.find(interval => number(interval.min_tokens, 0) < 1 && (interval.max_tokens == null || number(interval.max_tokens) >= 1));
            const tiers = group.long_context_pricing_enabled === false
              ? [defaultInterval || pricing]
              : intervals.length ? intervals : [pricing];
            const rate = number(group.rate_multiplier);
            const imageRate = group.image_rate_independent ? Math.max(0, number(group.image_rate_multiplier)) : rate;
            const scale = (value, multiplier = rate) => value === null ? null : value * multiplier;
            const groupName = String(group.name || section.platform || channel.name || "Default").trim();
            groupRatio[groupName] = 1;
            for (const tier of tiers) {
              const input = scale(perMillion(fastAiEffectivePrice(tier, pricing, "input_price")));
              const output = scale(perMillion(fastAiEffectivePrice(tier, pricing, "output_price")));
              const cacheRead = scale(perMillion(fastAiEffectivePrice(tier, pricing, "cache_read_price")));
              const cacheWrite = scale(perMillion(fastAiEffectivePrice(tier, pricing, "cache_write_price")));
              const cacheWrite1h = scale(perMillion(fastAiCacheWrite1h(tier, pricing)));
              const request = scale(finitePrice(tier.per_request_price ?? pricing.per_request_price), model.pricing?.billing_mode === "image" ? imageRate : rate);
              const imageOutput = scale(perMillion(fastAiEffectivePrice(tier, pricing, "image_output_price")));
              const imagePrice = scale(finitePrice(tier.per_image_price ?? tier.image_price ?? pricing.per_image_price ?? pricing.image_price), imageRate);
              if ([input, output, cacheRead, cacheWrite, cacheWrite1h, request, imageOutput, imagePrice].every(value => value === null)) continue;
              const mediaType = mediaTypeForPricing({ ...model, ...pricing, image_price: imagePrice });
              const mediaSpecs = mediaSpecsOf(model) || mediaSpecsOf(pricing);
              data.push({
                model_name: modelName,
                model_display_name: String(model.name || model.display_name || modelName),
                model_ratio: input === null ? 0 : input / SYSTEM_BASE_PRICE_PER_1M,
                completion_ratio: input > 0 && output !== null ? output / input : 1,
                input_price: input,
                output_price: output,
                cache_read_price: cacheRead,
                cache_write_price: cacheWrite,
                cache_write_1h_price: cacheWrite1h,
                request_price: request,
                image_output_price: imageOutput,
                image_price: imagePrice,
                price_currency: tier.price_currency || tier.currency || pricing.price_currency || pricing.currency || model.price_currency || model.currency || "USD",
                enable_groups: [groupName],
                proxy_group_name: groupName,
                group_ratio: 1,
                tier_name: intervals.length && group.long_context_pricing_enabled !== false ? fastAiTierName(tier) : "标准",
                ...(mediaType ? { media_type: mediaType } : {}),
                ...(mediaSpecs ? { media_specs: mediaSpecs } : {}),
                evidence: "exact"
              });
            }
          }
        }
      }
    }
    if (!data.length) throw new Error("FastAIToken 可用渠道价格数据为空");
    return { data, group_ratio: groupRatio, sourceFormat: "fastaitoken" };
  }
}
function soleApiCharge(charges, keys, multiplier, usage) {
  for (const key of keys) {
    const charge = charges?.[key];
    const price = finitePrice(charge?.price);
    if (price === null) continue;
    const unit = String(charge.unit || "").toLowerCase();
    const scale = usage === "tokens" && unit === "per_m_tokens" ? 1
      : usage === "request" && unit === "per_request" ? 1
        : usage === "request" && unit === "per_k_calls" ? 0.001
          : usage === "image" && unit === "per_image" ? 1
            : null;
    if (scale !== null) return price * scale * multiplier;
  }
  return null;
}

const LIUGUANG_METRICS = {
  input_tokens: ["input_price", 1_000_000],
  output_tokens: ["output_price", 1_000_000],
  cached_tokens: ["cache_read_price", 1_000_000],
  cache_write_5m_tokens: ["cache_write_price", 1_000_000],
  calls: ["request_price", 1],
  images: ["image_price", 1]
};

function liuguangPrice(book, metric) {
  const rules = Array.isArray(book?.rules) ? book.rules.filter(rule => rule?.metric === metric) : [];
  if (rules.length !== 1 || (rules[0].conditions?.length ?? 0) !== 0) return null;
  const amount = finitePrice(rules[0].amount);
  const per = finitePrice(rules[0].per);
  return amount === null || per === null || per === 0 ? null : amount * LIUGUANG_METRICS[metric][1] / per;
}

export class LiuguangModelsStrategy extends ParsingStrategy {
  canParse(raw) { return Array.isArray(raw?.models) && raw.models.some(model => Array.isArray(model?.priceBooks)); }

  parse(raw) {
    const data = [];
    for (const model of raw.models) {
      if (!model?.id || !Array.isArray(model.priceBooks) || (model.status && model.status !== "live") || model.callable === false) continue;
      if (!["chat", "image"].includes(model.modality)) continue;
      for (const priceBook of model.priceBooks) {
        const book = priceBook?.book;
        if (book?.basis !== "points" || String(book.currency).toLowerCase() !== "points" || !Array.isArray(book.rules)) continue;
        const prices = Object.fromEntries(Object.keys(LIUGUANG_METRICS).map(metric => [LIUGUANG_METRICS[metric][0], liuguangPrice(book, metric)]));
        const hasRule = metric => book.rules.some(rule => rule?.metric === metric);
        const input = prices.input_price;
        const output = prices.output_price;
        if (model.modality === "chat" && (input === null || output === null)) continue;
        if (model.modality === "image" && ["images", "calls"].some(metric => hasRule(metric) && prices[LIUGUANG_METRICS[metric][0]] === null)) continue;
        if (model.modality === "image" && prices.image_price === null && prices.request_price === null) continue;
        const group = String(priceBook.label || priceBook.channelId || "Default").trim();
        const mediaType = mediaTypeForPricing(model);
        const mediaSpecs = mediaSpecsOf(model);
        data.push({
          model_name: String(model.id),
          model_display_name: String(model.label || model.id),
          provider: String(model.vendor || ""),
          model_ratio: input === null ? 0 : input / SYSTEM_BASE_PRICE_PER_1M,
          completion_ratio: input > 0 && output !== null ? output / input : 0,
          ...prices,
          price_currency: "POINTS",
          enable_groups: [group],
          proxy_group_name: group,
          group_ratio: 1,
          ...(mediaType ? { media_type: mediaType } : {}),
          ...(mediaSpecs ? { media_specs: mediaSpecs } : {}),
          evidence: "exact"
        });
      }
    }
    return { data, group_ratio: {}, sourceFormat: "liuguang-models" };
  }
}

export class AiApiModelCatalogStrategy extends ParsingStrategy {
  canParse(raw, options = {}) {
    const catalog = raw?.data;
    const source = String(catalog?.source || "").toLowerCase();
    const provider = String(catalog?.provider || "").toLowerCase();
    const knownSource = source === "cnaiapi" || source === "aiapi";
    const knownProvider = provider === "aiapi" || provider === "cnaiapi";
    const otherIdentity = (source && !knownSource) || (provider && !knownProvider);
    const explicitFormat = options.responseFormat === "aiapi-model-catalog";
    const canUseAiApi = explicitFormat || (!otherIdentity && (knownSource || knownProvider));
    return Boolean(canUseAiApi && (
      Array.isArray(catalog?.groups) || hasAiApiEffectivePrices(catalog?.models)
    ));
  }

  parse(raw) {
    const data = [];
    const groupRatio = {};
    const grouped = Array.isArray(raw.data.groups) ? raw.data.groups : [];
    const groups = grouped.some(group => hasAiApiEffectivePrices(group?.models))
      ? grouped
      : hasAiApiEffectivePrices(raw.data.models)
        ? [{ name: String(raw.data.provider || raw.data.catalogVersion || "AIAPI"), billingMultiplier: 1, models: raw.data.models }]
        : grouped;
    for (const group of groups) {
      const groupName = String(group?.name || group?.code || group?.id || "").trim();
      if (!groupName) continue;
      const multiplier = finitePrice(group.billingMultiplier) ?? 1;
      groupRatio[groupName] = multiplier;
      for (const model of Array.isArray(group.models) ? group.models : []) {
        const modelName = String(model?.id || "").trim();
        if (!modelName || model.available === false) continue;
        const effective = model.effective || {};
        const input = finitePrice(effective.inputPer1M);
        const output = finitePrice(effective.outputPer1M);
        const cacheRead = finitePrice(effective.cacheReadPer1M);
        const cacheWrite = finitePrice(effective.cacheCreatePer1M);
        const cacheWrite1h = finitePrice(effective.cacheCreate1hPer1M);
        if ([input, output, cacheRead, cacheWrite, cacheWrite1h].every(value => value === null)) continue;
        data.push({
          model_name: modelName,
          model_display_name: String(model.displayName || modelName),
          model_ratio: input === null ? 0 : input / SYSTEM_BASE_PRICE_PER_1M,
          completion_ratio: input > 0 && output !== null ? output / input : 1,
          input_price: input,
          output_price: output,
          cache_read_price: cacheRead,
          cache_write_price: cacheWrite,
          cache_write_1h_price: cacheWrite1h,
          price_currency: "CNY",
          enable_groups: [groupName],
          proxy_group_name: groupName,
          group_ratio: multiplier,
          evidence: "exact"
        });
      }
    }
    if (!data.length) throw new Error("AIAPI 模型价格数据为空");
    return { data, group_ratio: groupRatio, sourceFormat: "aiapi-model-catalog" };
  }
}

export class SoleApiPublicModelsStrategy extends ParsingStrategy {
  canParse(raw) { return Array.isArray(raw?.data?.list); }

  parse(raw) {
    const data = [];
    const groupRatio = {};
    for (const model of raw.data.list) {
      const modelName = String(model?.canonicalName || "").trim();
      if (!modelName) continue;
      const channels = Array.isArray(model.channels) ? model.channels : [];
      for (const channel of channels) {
        const groupName = String(channel?.name || "").trim();
        const multiplier = finitePrice(channel?.multiplier);
        if (!groupName || multiplier === null) continue;
        const charges = model.charges || {};
        const input = soleApiCharge(charges, ["prompt"], multiplier, "tokens");
        const output = soleApiCharge(charges, ["completion"], multiplier, "tokens");
        const cacheRead = soleApiCharge(charges, ["cache_read"], multiplier, "tokens");
        const cacheWrite = soleApiCharge(charges, ["cache_write_5m"], multiplier, "tokens") ?? soleApiCharge(charges, ["cache_write"], multiplier, "tokens");
        const cacheWrite1h = soleApiCharge(charges, ["cache_write_1h"], multiplier, "tokens");
        const request = soleApiCharge(charges, ["request"], multiplier, "request");
        const imageOutput = soleApiCharge(charges, ["image_output"], multiplier, "tokens");
        const imagePrice = soleApiCharge(charges, ["image_output", "image_output_1024px", "image_output_512px"], multiplier, "image");
        if ([input, output, cacheRead, cacheWrite, cacheWrite1h, request, imageOutput, imagePrice].every(value => value === null)) continue;
        groupRatio[groupName] = 1;
        data.push({
          model_name: modelName,
          model_display_name: String(model.displayName || modelName),
          model_ratio: input === null ? 0 : input / SYSTEM_BASE_PRICE_PER_1M,
          completion_ratio: input > 0 && output !== null ? output / input : 1,
          input_price: input,
          output_price: output,
          cache_read_price: cacheRead,
          cache_write_price: cacheWrite,
          cache_write_1h_price: cacheWrite1h,
          request_price: request,
          image_output_price: imageOutput,
          image_price: imagePrice,
          price_currency: String(model.priceCurrency || "USD").toUpperCase(),
          enable_groups: [groupName],
          proxy_group_name: groupName,
          group_ratio: 1,
          evidence: "exact"
        });
      }
    }
    if (!data.length) throw new Error("SoleAPI 公开模型价格数据为空");
    return { data, group_ratio: groupRatio, sourceFormat: "soleapi-public-api" };
  }
}

export class CheapRouterPricingStrategy extends ParsingStrategy {
  canParse(raw) { return raw?.code === 0 && Array.isArray(raw?.data?.items); }

  parse(raw) {
    // 字段映射全在 price-maps/cheaprouter.js 里，这里只负责调用和把失败报上去。
    const { rows, unresolved } = applyPriceMap(cheapRouterPriceMap, raw);
    const groupRatio = {};
    for (const row of rows) groupRatio[row.proxy_group_name] = row.group_ratio;
    if (!rows.length) throw new Error("CheapRouter 公开模型价格数据为空");
    return {
      data: rows,
      group_ratio: groupRatio,
      sourceFormat: "cheaprouter-public-api",
      ...(unresolved.length
        ? {
            incomplete: true,
            unsupportedBillingModes: [...new Set(unresolved.map(entry => entry.reason))].sort(),
            unpricedModels: unresolved.map(entry => entry.model)
          }
        : {})
    };
  }
}

function jijiMarketRoot(raw) {
  const root = raw?.data && Array.isArray(raw.data.providers) ? raw.data : raw;
  return Array.isArray(root?.providers) ? root : null;
}

export class JijiModelMarketStrategy extends ParsingStrategy {
  canParse(raw) { return Boolean(jijiMarketRoot(raw)?.providers.some(provider => Array.isArray(provider?.models))); }

  parse(raw) {
    const root = jijiMarketRoot(raw) || { providers: [] };
    const data = [];
    const groupRatio = {};
    for (const provider of root.providers) {
      const providerName = String(provider?.name || provider?.code || provider?.id || "Jiji").trim();
      for (const model of Array.isArray(provider?.models) ? provider.models : []) {
        const modelName = String(model?.model_id || model?.id || model?.display_name || "").trim();
        if (!modelName) continue;
        const groups = Array.isArray(model.group_prices) && model.group_prices.length ? model.group_prices : [{ name: providerName, multiplier: 1 }];
        for (const group of groups) {
          const multiplier = number(group?.multiplier ?? group?.rate_multiplier, 1);
          const groupName = String(group?.name || group?.group_name || group?.code || providerName).trim();
          const input = jijiPrice(model, group, "input_price", multiplier);
          const output = jijiPrice(model, group, "output_price", multiplier);
          const request = jijiPrice(model, group, ["per_request_price", "request_price"], multiplier);
          const cacheRead = jijiPrice(model, group, "cache_read_price", multiplier);
          const cacheWrite = jijiPrice(model, group, "cache_write_price", multiplier);
          const cacheWrite1h = jijiPrice(model, group, "cache_write_1h_price", multiplier);
          if (input === null && output === null && request === null) continue;
          groupRatio[groupName] = multiplier;
          data.push({
            model_name: modelName,
            model_display_name: String(model.display_name || modelName),
            model_ratio: input === null ? 0 : input / SYSTEM_BASE_PRICE_PER_1M,
            completion_ratio: input > 0 && output !== null ? output / input : 1,
            input_price: input,
            output_price: output,
            cache_read_price: cacheRead,
            cache_write_price: cacheWrite,
            cache_write_1h_price: cacheWrite1h,
            request_price: request,
            price_currency: String(group?.price_currency || model.price_currency || "USD"),
            enable_groups: [groupName],
            proxy_group_name: groupName,
            group_ratio: multiplier,
            evidence: "exact"
          });
        }
      }
    }
    if (!data.length) throw new Error("Jiji 模型价格数据为空");
    return { data, group_ratio: groupRatio, sourceFormat: "jiji" };
  }
}


export class SidruneModelPlazaStrategy extends ParsingStrategy {
  canParse(raw) {
    return raw?.code === 0 && Array.isArray(raw?.data?.groups) && Array.isArray(raw?.data?.pricing);
  }

  parse(raw) {
    // 字段映射全在 price-maps/sidrune.js 里，这里只负责调用和把失败报上去。
    const { rows, unresolved } = applyPriceMap(sidrunePriceMap, raw);
    const groupRatio = {};
    for (const row of rows) groupRatio[row.proxy_group_name] = row.group_ratio;
    if (!rows.length) throw new Error("Sidrune 模型广场价格数据为空");
    return {
      data: rows,
      group_ratio: groupRatio,
      sourceFormat: "sidrune-model-plaza",
      ...(unresolved.length
        ? {
            incomplete: true,
            unsupportedBillingModes: [...new Set(unresolved.map(entry => entry.reason))].sort(),
            unpricedModels: unresolved.map(entry => entry.model)
          }
        : {})
    };
  }
}


export class TrueSotaModelPricingStrategy extends ParsingStrategy {
  canParse(raw) {
    return raw?.code === 0 && Array.isArray(raw?.data?.groups) && Array.isArray(raw?.data?.models) &&
      raw.data.models.some(model => model && model.group_id !== undefined && Object.prototype.hasOwnProperty.call(model, "input_price"));
  }

  parse(raw) {
    // 字段映射全在 price-maps/true-sota.js 里，这里只负责调用和把失败报上去。
    const { rows, unresolved } = applyPriceMap(trueSotaPriceMap, raw);
    const groupRatio = {};
    for (const row of rows) groupRatio[row.proxy_group_name] = row.group_ratio;
    if (!rows.length) throw new Error("TrueSOTA 模型价格数据为空");
    return {
      data: rows,
      group_ratio: groupRatio,
      sourceFormat: "true-sota-model-pricing",
      ...(unresolved.length
        ? {
            incomplete: true,
            unsupportedBillingModes: [...new Set(unresolved.map(entry => entry.reason))].sort(),
            unpricedModels: unresolved.map(entry => entry.model)
          }
        : {})
    };
  }
}

const MODEL_PLAZA_PROFILES = Object.freeze({
  sevenai: {
    sourceFormat: "sevenai-model-plaza",
    label: "SevenAI",
    currency: null,
    intervalMode: "all",
    groupMultiplier: group => {
      const value = group?.rate_multiplier;
      return typeof value === "string" && !value.trim() ? null : finitePrice(value);
    },
    nonTokenBilling: Object.freeze({})
  },
  nodeai: {
    sourceFormat: "nodeai-model-plaza",
    label: "NodeAI",
    currency: "CNY",
    intervalMode: "first",
    groupMultiplier: group => finitePrice(group?.user_rate_multiplier ?? group?.rate_multiplier) ?? 1,
    nonTokenMultiplier: (group, _billingMode, groupMultiplier) => group?.image_rate_independent && finitePrice(group?.image_rate_multiplier) !== null
      ? finitePrice(group.image_rate_multiplier)
      : groupMultiplier,
    nonTokenBilling: Object.freeze({ image: "image", per_request: "request" }),
    nonTokenBillingFallback: billingMode => billingMode.includes("image") ? "image" : "request",
  },
  killai: {
    sourceFormat: "killai-model-plaza",
    label: "KillAI",
    currency: null,
    preserveImageTokenPrices: true,
    intervalMode: "all",
    groupMultiplier: group => finitePrice(group?.rate_multiplier) ?? 1,
    nonTokenMultiplier: (_group, _billingMode, groupMultiplier) => groupMultiplier,
    nonTokenBilling: Object.freeze({ image: "image", per_request: "request" })
  },
  "fuck-everyone": {
    sourceFormat: "fuck-everyone-model-plaza",
    label: "fuck-everyone.com",
    currency: null,
    preserveImageTokenPrices: true,
    intervalMode: "all",
    rejectInvalidGroupMultiplier: true,
    groupMultiplier: group => {
      const value = group?.user_rate_multiplier ?? group?.rate_multiplier;
      return value === null || value === undefined || value === "" ? 1 : finitePrice(value);
    },
    nonTokenMultiplier: (group, billingMode, groupMultiplier) => {
      const independentField = billingMode === "image" ? "image_rate_independent" : billingMode === "per_request" ? "video_rate_independent" : "";
      const multiplierField = billingMode === "image" ? "image_rate_multiplier" : billingMode === "per_request" ? "video_rate_multiplier" : "";
      if (independentField && group?.[independentField] === true) return finitePrice(group?.[multiplierField]);
      return groupMultiplier;
    },
    nonTokenBilling: Object.freeze({ image: "image", per_request: "request" })
  }
});

export class ModelPlazaStrategy extends ParsingStrategy {
  constructor(profileName) {
    super();
    this.profile = MODEL_PLAZA_PROFILES[profileName];
    if (!this.profile) throw new Error(`未知模型广场 profile：${profileName}`);
  }

  canParse(raw, options = {}) {
    return options.responseFormat === this.profile.sourceFormat && raw?.code === 0 &&
      Array.isArray(raw?.data?.groups) && raw.data.groups.some(group => Array.isArray(group?.models));
  }

  parse(raw, options = {}) {
    const { profile } = this;
    const priceCurrency = profile.currency || (options.priceCurrency === "CNY" || options.priceCurrency === "USD" ? options.priceCurrency : "UNKNOWN");
    const data = [];
    const groupRatio = {};
    const unsupportedBillingModes = new Set();
    const invalidPricingValues = new Set();
    const unpricedModels = new Set();
    let modelCount = 0;
    const invalidNumericValue = (object, fields) => fields.some(field => Object.hasOwn(object || {}, field) && object[field] !== null && object[field] !== undefined && object[field] !== "" && finitePrice(object[field]) === null);
    const perMillion = value => {
      const parsed = finitePrice(value);
      return parsed === null ? null : parsed * 1_000_000;
    };
    const scale = (value, multiplier) => value === null ? null : value * multiplier;

    for (const group of raw.data.groups) {
      const groupName = String(group?.name || group?.id || "").trim();
      if (!groupName) continue;
      const invalidGroupMultiplier = invalidNumericValue(group, ["rate_multiplier", "user_rate_multiplier"]);
      if (invalidNumericValue(group, ["rate_multiplier", "user_rate_multiplier", "image_rate_multiplier", "video_rate_multiplier"])) invalidPricingValues.add(`${groupName}:multiplier`);
      const multiplier = profile.groupMultiplier(group);
      if (multiplier === null || (profile.rejectInvalidGroupMultiplier && invalidGroupMultiplier)) {
        invalidPricingValues.add(`${groupName}:multiplier`);
        for (const model of Array.isArray(group.models) ? group.models : []) {
          const modelName = String(model?.name || model?.id || "").trim();
          if (!modelName) continue;
          modelCount += 1;
          unpricedModels.add(`${groupName}:${modelName}:default`);
        }
        continue;
      }
      groupRatio[groupName] = multiplier;

      for (const model of Array.isArray(group.models) ? group.models : []) {
        const modelName = String(model?.name || model?.id || "").trim();
        const pricing = model?.pricing;
        if (!modelName) continue;
        modelCount += 1;
        const unpricedKey = `${groupName}:${modelName}`;
        if (!pricing || typeof pricing !== "object") {
          unpricedModels.add(`${unpricedKey}:default`);
          continue;
        }
        const billingMode = String(pricing.billing_mode || "token").toLowerCase();
        if (invalidNumericValue(pricing, ["per_request_price", "request_price"])) {
          invalidPricingValues.add(modelName);
          continue;
        }

        if (billingMode !== "token") {
          const targetField = profile.nonTokenBilling[billingMode] || profile.nonTokenBillingFallback?.(billingMode);
          if (!targetField) {
            unsupportedBillingModes.add(billingMode);
            continue;
          }
          const mediaType = mediaTypeForPricing({ ...model, ...pricing, ...group }, { targetField });
          const mediaSpecs = mediaSpecsOf(model) || mediaSpecsOf(pricing) || mediaSpecsOf(group);
          const multiplierForPrice = profile.nonTokenMultiplier(group, billingMode, multiplier);
          const billingConditions = billingConditionsOf({ ...group, ...model, ...pricing });
          if (multiplierForPrice === null) {
            invalidPricingValues.add(`${modelName}:multiplier`);
            continue;
          }
          const perRequest = finitePrice(pricing.per_request_price ?? pricing.request_price);
          const imageInput = profile.preserveImageTokenPrices
            ? scale(perMillion(pricing.image_input_price), multiplierForPrice)
            : null;
          const imageOutput = profile.preserveImageTokenPrices
            ? scale(perMillion(pricing.image_output_price), multiplierForPrice)
            : null;
          const imageBilled = targetField === "image";
          const fallbackPerImage = imageBilled && !profile.preserveImageTokenPrices
            ? finitePrice(pricing.image_output_price)
            : null;
          const perCall = perRequest ?? fallbackPerImage;
          if (perCall === null && imageInput === null && imageOutput === null) {
            unpricedModels.add(`${unpricedKey}:default`);
            continue;
          }
          unpricedModels.delete(`${unpricedKey}:default`);
          const price = perCall === null ? null : perCall * multiplierForPrice;
          data.push({
            model_name: modelName,
            model_display_name: String(model?.display_name || model?.label || modelName),
            model_ratio: 0,
            completion_ratio: 1,
            input_price: null,
            output_price: null,
            cache_read_price: null,
            cache_write_price: null,
            request_price: targetField === "request" ? price : null,
            image_price: targetField === "image" ? price : null,
            image_input_price: imageInput,
            image_output_price: imageOutput,
            price_currency: priceCurrency,
            enable_groups: [groupName],
            proxy_group_name: groupName,
            group_ratio: multiplier,
            ...(mediaType ? { media_type: mediaType } : {}),
            ...(mediaSpecs ? { media_specs: mediaSpecs } : {}),
            ...(billingConditions.length ? { billing_conditions: billingConditions } : {}),
            evidence: "exact"
          });
          continue;
        }

        const hasExplicitIntervals = Array.isArray(pricing.intervals) && pricing.intervals.length && profile.intervalMode === "all";
        const intervals = hasExplicitIntervals
          ? pricing.intervals
          : [Array.isArray(pricing.intervals) && pricing.intervals.length ? pricing.intervals[0] : null];
        for (const [intervalIndex, interval] of intervals.entries()) {
          const tierLabel = String(interval?.tier_label || interval?.tier_name || interval?.tier || "").trim();
          const diagnosticTier = hasExplicitIntervals
            ? `${tierLabel || "interval"}:${intervalIndex}`
            : "default";
          const unpricedTierKey = `${unpricedKey}:${diagnosticTier}`;
          const price = field => scale(perMillion((interval || pricing)[field]), multiplier);
          const input = price("input_price");
          const output = price("output_price");
          const cacheRead = price("cache_read_price");
          const cacheWrite = price("cache_write_price");
          const billingConditions = billingConditionsOf({ ...group, ...model, ...pricing, ...(interval || {}) });
          const cacheWrite1h = price("cache_write_1h_price");
          if ([input, output, cacheRead, cacheWrite, cacheWrite1h].every(value => value === null)) {
            unpricedModels.add(unpricedTierKey);
            continue;
          }
          unpricedModels.delete(unpricedTierKey);
          data.push({
            model_name: modelName,
            model_display_name: String(model?.display_name || model?.label || modelName),
            model_ratio: input === null ? 0 : input / SYSTEM_BASE_PRICE_PER_1M,
            completion_ratio: input > 0 && output !== null ? output / input : 1,
            input_price: input,
            output_price: output,
            cache_read_price: cacheRead,
            cache_write_price: cacheWrite,
            cache_write_1h_price: cacheWrite1h,
            request_price: null,
            price_currency: priceCurrency,
            enable_groups: [groupName],
            proxy_group_name: groupName,
            group_ratio: multiplier,
            ...(tierLabel ? { tier_name: tierLabel } : {}),
            ...(billingConditions.length ? { billing_conditions: billingConditions } : {}),
            evidence: "exact"
          });
        }
      }
    }
    if (!modelCount) throw new Error(`${profile.label} 模型广场价格数据为空`);
    return {
      data,
      group_ratio: groupRatio,
      sourceFormat: profile.sourceFormat,
      ...(unsupportedBillingModes.size || invalidPricingValues.size || unpricedModels.size ? { incomplete: true } : {}),
      ...(unsupportedBillingModes.size ? { unsupportedBillingModes: [...unsupportedBillingModes].sort() } : {}),
      ...(invalidPricingValues.size ? { invalidPricingValues: [...invalidPricingValues].sort() } : {}),
      ...(unpricedModels.size ? { unpricedModels: [...unpricedModels].sort() } : {})
    };
  }
}

function allInOneModels(raw) {
  if (raw?.code !== 0) return [];
  for (const candidate of [raw?.data?.list, raw?.data?.data?.list, raw?.data, raw?.list]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function isAllInOneEnvelope(raw) {
  return raw?.code === 0 && [raw?.data?.list, raw?.data?.data?.list, raw?.data, raw?.list].some(Array.isArray);
}

export class AllInOneModelsStrategy extends ParsingStrategy {
  canParse(raw, options = {}) {
    return options.responseFormat === "all-in-one-models" && isAllInOneEnvelope(raw);
  }

  parse(raw) {
    const data = [];
    const models = allInOneModels(raw);
    const unsupportedBillingModes = new Set();
    const invalidPricingValues = new Set();
    const unpricedModels = new Set();
    const modelCount = models.length;
    const parsePrice = value => finitePrice(value);
    const invalid = (object, fields) => fields.some(field => own(object, field) && object[field] !== null && object[field] !== undefined && object[field] !== "" && finitePrice(object[field]) === null);
    const modelName = model => String(model?.model_id || model?.model_name || model?.id || "").trim();
    const displayName = model => String(model?.display_name || model?.model_name_display || model?.name || modelName(model)).trim();
    // 站点只给 min_tokens/max_tokens 时用区间做档位名，避免同模型多档在表里同名。
    const tokenRangeLabel = (min, max) => {
      const unit = value => value >= 1000000 ? `${Number((value / 1000000).toFixed(2))}M` : value >= 1000 ? `${Number((value / 1000).toFixed(2))}K` : String(value);
      if (min === null && max === null) return "";
      return min === null ? `0-${unit(max)}` : max === null ? `${unit(min)} 以上` : `${unit(min)}-${unit(max)}`;
    };
    const rowsFor = (model, tier, tierIndex, tiered) => {
      const key = `${modelName(model)}:${tiered ? `tier:${tierIndex}` : "default"}`;
      if (tiered && (!tier || typeof tier !== "object" || Array.isArray(tier))) {
        invalidPricingValues.add(`${key}:tier`);
        return;
      }
      const source = tiered ? tier : model;
      const fields = ["input_price", "output_price", "cache_read_price", "cache_read", "cache_creation_price", "cache_write_price", "cache_write", "cache_creation_1h_price", "cache_write_1h_price"];
      const minTokens = tiered && own(source, "min_tokens") ? finitePrice(source.min_tokens) : null;
      const maxTokens = tiered && own(source, "max_tokens") && source.max_tokens !== null ? finitePrice(source.max_tokens) : null;
      const invalidBounds = tiered && ((own(source, "min_tokens") && minTokens === null) || (own(source, "max_tokens") && source.max_tokens !== null && maxTokens === null) || (minTokens !== null && maxTokens !== null && maxTokens < minTokens));
      if (invalid(source, fields) || invalidBounds) {
        invalidPricingValues.add(invalidBounds ? `${key}:bounds` : key);
        return;
      }
      const input = parsePrice(source.input_price);
      const output = parsePrice(source.output_price);
      const cacheRead = parsePrice(source.cache_read_price ?? source.cache_read);
      const cacheWrite = parsePrice(source.cache_creation_price ?? source.cache_write_price ?? source.cache_write);
      const cacheWrite1h = parsePrice(source.cache_creation_1h_price ?? source.cache_write_1h_price);
      if ([input, output, cacheRead, cacheWrite, cacheWrite1h].every(value => value === null)) {
        unpricedModels.add(key);
        return;
      }
      unpricedModels.delete(key);
      const row = {
        model_name: modelName(model),
        model_display_name: displayName(model),
        model_ratio: input === null ? 0 : input / SYSTEM_BASE_PRICE_PER_1M,
        completion_ratio: input > 0 && output !== null ? output / input : 1,
        input_price: input,
        output_price: output,
        cache_read_price: cacheRead,
        cache_write_price: cacheWrite,
        cache_write_1h_price: cacheWrite1h,
        request_price: null,
        price_currency: "CNY",
        enable_groups: [],
        proxy_group_name: "",
        group_ratio: 1,
        evidence: "exact"
      };
      if (tiered) {
        if (Object.hasOwn(source, "min_tokens")) row.min_tokens = source.min_tokens;
        if (Object.hasOwn(source, "max_tokens")) row.max_tokens = source.max_tokens;
        const tierName = String(source.tier_label || source.tier_name || source.name || "").trim() || tokenRangeLabel(minTokens, maxTokens);
        if (tierName) row.tier_name = tierName;
      }
      data.push(row);
    };

    for (const model of models) {
      const name = modelName(model);
      if (!name) continue;
      const billingMode = String(model.billing_mode || "token").trim().toLowerCase();
      if (billingMode === "per_request") {
        // 图像类模型按次计价：列表里的 per_request_price 就是每次请求价。
        const request = parsePrice(model.per_request_price);
        if (request === null) {
          unpricedModels.add(`${name}:request`);
          continue;
        }
        data.push({
          model_name: name,
          model_display_name: displayName(model),
          model_ratio: 0,
          completion_ratio: 1,
          input_price: null,
          output_price: null,
          cache_read_price: null,
          cache_write_price: null,
          cache_write_1h_price: null,
          request_price: request,
          price_currency: "CNY",
          enable_groups: [],
          proxy_group_name: "",
          group_ratio: 1,
          media_type: "image",
          ...(mediaSpecsOf(model) ? { media_specs: mediaSpecsOf(model) } : {}),
          evidence: "exact"
        });
        continue;
      }
      if (billingMode === "special") {
        // 视频类模型只给 per_second_prices，key 是分辨率档，值是每秒单价。
        const perSecond = model.per_second_prices && typeof model.per_second_prices === "object" && !Array.isArray(model.per_second_prices)
          ? model.per_second_prices
          : null;
        if (perSecond) {
          const specs = mediaSpecsOf(model);
          let emitted = false;
          for (const [label, value] of Object.entries(perSecond)) {
            const price = parsePrice(value);
            if (price === null || price <= 0) continue;
            emitted = true;
            data.push({
              model_name: name,
              model_display_name: displayName(model),
              model_ratio: 0,
              completion_ratio: 1,
              input_price: null,
              output_price: null,
              cache_read_price: null,
              cache_write_price: null,
              cache_write_1h_price: null,
              request_price: price,
              price_currency: "CNY",
              enable_groups: [],
              proxy_group_name: "",
              group_ratio: 1,
              tier_name: String(label).trim(),
              media_type: "video",
              request_unit: "second",
              ...(specs ? { media_specs: specs } : {}),
              evidence: "exact"
            });
          }
          if (emitted) continue;
        }
        unsupportedBillingModes.add(billingMode);
        continue;
      }
      if (!["token", "tiered"].includes(billingMode)) {
        unsupportedBillingModes.add(billingMode || "unknown");
        continue;
      }
      const tiers = billingMode === "tiered" ? model.pricing_tiers : null;
      if (billingMode === "tiered" && (!Array.isArray(tiers) || !tiers.length)) {
        unpricedModels.add(`${name}:default`);
        continue;
      }
      if (billingMode === "tiered") {
        tiers.forEach((tier, index) => rowsFor(model, tier, index, true));
      } else {
        rowsFor(model, null, 0, false);
      }
    }
    if (!modelCount) throw new Error("all-in-one.icu 模型价格数据为空");
    return {
      data,
      group_ratio: {},
      sourceFormat: "all-in-one-models",
      ...(unsupportedBillingModes.size || invalidPricingValues.size || unpricedModels.size ? { incomplete: true } : {}),
      ...(unsupportedBillingModes.size ? { unsupportedBillingModes: [...unsupportedBillingModes].sort() } : {}),
      ...(invalidPricingValues.size ? { invalidPricingValues: [...invalidPricingValues].sort() } : {}),
      ...(unpricedModels.size ? { unpricedModels: [...unpricedModels].sort() } : {})
    };
  }
}


export class JijiModelPlazaStrategy extends ParsingStrategy {
  canParse(raw) {
    return raw?.code === 0 && Array.isArray(raw?.data?.groups) && !Array.isArray(raw?.data?.providers) && !raw.data.groups.some(group =>
      ["user_rate_multiplier", "image_rate_independent", "image_rate_multiplier"].some(key => Object.hasOwn(group || {}, key)) ||
      group?.models?.some(model => ["billing_mode", "intervals", "official_pricing", "image_output_price"].some(key => Object.hasOwn(model?.pricing || {}, key)))
    );
  }


  parse(raw) {
    const data = [];
    const groupRatio = {};
    for (const group of raw.data.groups) {
      const groupName = String(group?.name || "").trim();
      if (!groupName) continue;
      const rateMultiplier = number(group?.rate_multiplier);
      groupRatio[groupName] = rateMultiplier;
      for (const model of Array.isArray(group.models) ? group.models : []) {
        const pricing = model?.pricing || {};
        const applyRate = value => {
          const parsed = finitePrice(value);
          return parsed === null ? null : parsed * rateMultiplier;
        };
        const input = applyRate(pricing.input_price);
        const output = applyRate(pricing.output_price);
        const request = applyRate(pricing.per_request_price);
        if (!model?.name || (input === null && request === null)) continue;
        const mediaType = mediaTypeForPricing({ ...model, ...pricing, request_price: request });
        const mediaSpecs = mediaSpecsOf(model) || mediaSpecsOf(pricing);
        data.push({
          model_name: String(model.name),
          model_display_name: String(model.name),
          model_ratio: input === null ? 0 : input / SYSTEM_BASE_PRICE_PER_1M,
          completion_ratio: input > 0 && output !== null ? output / input : 1,
          input_price: input,
          output_price: output,
          cache_read_price: applyRate(pricing.cache_read_price),
          cache_write_price: applyRate(pricing.cache_write_price),
          request_price: request,
          price_currency: "CNY",
          enable_groups: [groupName],
          proxy_group_name: groupName,
          group_ratio: rateMultiplier,
          ...(mediaType ? { media_type: mediaType } : {}),
          ...(mediaSpecs ? { media_specs: mediaSpecs } : {}),
          evidence: "exact"
        });
      }
    }
    if (!data.length) throw new Error("吉吉模型价格数据为空");
    return { data, group_ratio: groupRatio, sourceFormat: "jiji" };
  }
}

export class SoraPricingStrategy extends ParsingStrategy {
  canParse(_raw, options = {}) {
    return options.responseFormat === "sora";
  }

  parse(raw) {
    const rows = raw?.data || raw?.models || raw?.pricing || raw;
    const groupRatio = raw?.group_ratio || raw?.groupRatio || {};
    return { sourceFormat: "sora", data: cleanPricingRows(rows), group_ratio: groupRatio };
  }
}

export class StandardNewApiStrategy extends ParsingStrategy {
  canParse(raw) { return Boolean(raw?.data?.ModelRatio && raw?.data?.GroupRatio); }
  parse(raw) {
    const list = [];
    const groups = raw.data.GroupRatio || {};
    const completions = raw.data.CompletionRatio || {};
    for (const [modelName, ratio] of Object.entries(raw.data.ModelRatio || {})) {
      list.push({ model_name: modelName, model_display_name: modelName, model_ratio: number(ratio), completion_ratio: number(completions[modelName]), enable_groups: Object.keys(groups), evidence: "exact" });
    }
    return { data: list, group_ratio: groups, sourceFormat: "standard-new-api" };
  }
}

export class LegacyStrategy extends ParsingStrategy {
  canParse(raw) { return Boolean(raw?.data?.model_group); }
  parse(raw) {
    const list = [];
    const groups = raw.data.model_group || {};
    const completions = raw.data.model_completion_ratio || {};
    const models = {};
    for (const [groupName, group] of Object.entries(groups)) {
      for (const [modelName, price] of Object.entries(group.ModelPrice || {})) {
        models[modelName] ||= { ratio: price.price, groups: [] };
        models[modelName].groups.push(groupName);
      }
    }
    for (const [modelName, value] of Object.entries(models)) {
      list.push({ model_name: modelName, model_display_name: modelName, model_ratio: number(value.ratio), completion_ratio: number(completions[modelName]), enable_groups: value.groups, evidence: "exact" });
    }
    return { data: list, group_ratio: Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, number(value.GroupRatio)])), sourceFormat: "legacy" };
  }
}

export class AdvancedNestedStrategy extends ParsingStrategy {
  canParse(raw) { return Boolean(Array.isArray(raw?.data?.model_info) && raw?.data?.group_info); }
  parse(raw) {
    const groups = raw.data.group_info || {};
    const groupRatios = Object.fromEntries(Object.entries(groups).map(([key, value]) => [key, number(value.GroupRatio)]));
    const list = [];
    for (const item of raw.data.model_info) {
      if (!item?.model_name) continue;
      const priceMap = item.price_info || {};
      const targetGroups = item.enable_groups?.length ? item.enable_groups : Object.keys(priceMap);
      for (const groupName of targetGroups) {
        const config = priceMap[groupName]?.default || priceMap[Object.keys(priceMap)[0]]?.default;
        if (!config) continue;
        list.push({
          model_name: item.model_name,
          model_display_name: item.model_name,
          model_ratio: number(config.model_ratio, 0),
          completion_ratio: number(config.model_completion_ratio),
          enable_groups: [groupName],
          proxy_group_name: groupName,
          group_ratio: groupRatios[groupName] ?? 1,
          evidence: "exact"
        });
      }
    }
    return { data: list, group_ratio: groupRatios, sourceFormat: "advanced-nested" };
  }
}

registerResponseFormatHandler("aiapi", () => new AiApiModelCatalogStrategy());
registerResponseFormatHandler("pqh", () => new PqhPricingStrategy());
registerResponseFormatHandler("tokenflux", () => new TokenFluxPricingStrategy());
registerResponseFormatHandler("windhub", () => new WindHubPricingStrategy());
registerResponseFormatHandler("newcodex", () => new NewCodexPricingStrategy());
registerResponseFormatHandler("allrouter", () => new AllRouterPricingStrategy());
registerResponseFormatHandler("stellaisle", () => new StellaislePricingStrategy());
registerResponseFormatHandler("stellaisle-carpool", () => new StellaisleCarpoolPricingStrategy());
registerResponseFormatHandler("relayrouter", () => new RelayRouterPricingStrategy());
registerResponseFormatHandler("sora", () => new SoraPricingStrategy());
registerResponseFormatHandler("model-plaza", definition => new ModelPlazaStrategy(definition.profile));
registerResponseFormatHandler("all-in-one-models", () => new AllInOneModelsStrategy());
assertResponseFormatHandlers();

function explicitStrategyFor(format) {
  const definition = getResponseFormatDefinition(format);
  const factory = definition && getResponseFormatHandler(definition.strategy);
  return factory ? factory(definition) : null;
}

export function normalizeProxyData(raw, options = {}) {
  const definition = getResponseFormatDefinition(options.responseFormat);
  if (definition?.explicit) {
    const strategy = explicitStrategyFor(options.responseFormat);
    if (!strategy || !strategy.canParse(raw, options)) {
      return { data: [], group_ratio: {}, sourceFormat: "unknown", error: `无法识别${definition.label}数据格式` };
    }
    try {
      return strategy.parse(raw, options);
    } catch (error) {
      return { data: [], group_ratio: {}, sourceFormat: "parse-error", error: error.message };
    }
  }

  const strategies = [
    new AiApiModelCatalogStrategy(),
    new SoleApiPublicModelsStrategy(),
    new CheapRouterPricingStrategy(),
    new LiuguangModelsStrategy(),
    new FastAiChannelsStrategy(),
    new SidruneModelPlazaStrategy(),
    new TrueSotaModelPricingStrategy(),
    new JijiModelPlazaStrategy(),
    new JijiModelMarketStrategy(),
    new PqhPricingStrategy(),
    new StandardNewApiStrategy(),
    new LegacyStrategy(),
    new AdvancedNestedStrategy()
  ];
  for (const strategy of strategies) {
    if (!strategy.canParse(raw, options)) continue;
    try {
      return strategy.parse(raw, options);
    } catch (error) {
      return { data: [], group_ratio: {}, sourceFormat: "parse-error", error: error.message };
    }
  }
  return { data: [], group_ratio: {}, sourceFormat: "unknown", error: "无法识别价格数据格式" };
}

export function normalizeCapturedData(raw, options = {}) {
  const payload = unwrapTrpcPayload(raw);
  if (payload?.normalized?.data) return payload.normalized;
  return normalizeProxyData(payload, options);
}

export function parseGenericPricing(payload, options = {}) {
  if (Array.isArray(payload)) return { sourceFormat: "array", data: cleanPricingRows(payload, options), group_ratio: {} };
  if (Array.isArray(payload?.data)) return { sourceFormat: "data", data: cleanPricingRows(payload.data, options), group_ratio: payload.group_ratio || {} };
  if (Array.isArray(payload?.models)) return { sourceFormat: "models", data: cleanPricingRows(payload.models, options), group_ratio: payload.group_ratio || {} };
  return { sourceFormat: "unknown", data: [], group_ratio: {} };
}

function applyModelListCurrency(normalized, options = {}) {
  const currency = options.modelListCurrency;
  if (!currency || !Array.isArray(normalized?.data)) return normalized;
  return {
    ...normalized,
    data: normalized.data.map(item => ({ ...item, price_currency: currency }))
  };
}

export function normalizePricingPayload(payload, format = "auto", options = {}) {
  const normalizationOptions = format === "auto" ? options : { ...options, responseFormat: format };
  const normalized = normalizeCapturedData(payload, normalizationOptions);
  const result = format === "auto" && !normalized.data?.length ? parseGenericPricing(payload, normalizationOptions) : normalized;
  return applyModelListCurrency(result, normalizationOptions);
}
