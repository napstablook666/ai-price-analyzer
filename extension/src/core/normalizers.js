import { SYSTEM_BASE_PRICE_PER_1M } from "../shared/schema.js";
export const NORMALIZATION_VERSION = 14;

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
const perMillion = value => {
  const parsed = finitePrice(value);
  return parsed === null ? null : parsed * 1_000_000;
};

export class ParsingStrategy {
  canParse() { return false; }
  parse() { return { data: [], group_ratio: {} }; }
}

export function parseBillingTiers(expression) {
  if (typeof expression !== "string" || !expression.includes("tier(")) return [];
  const tiers = [];
  const pattern = /tier\(\s*["']([^"']+)["']\s*,\s*([^)]*)\)/gi;
  let match;
  while ((match = pattern.exec(expression))) {
    const coefficients = {};
    const terms = match[2].match(/[+-]?[^+-]+/g) || [];
    for (const term of terms) {
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
      name: match[1],
      input,
      output,
      ratio: input / SYSTEM_BASE_PRICE_PER_1M,
      completion: input > 0 ? output / input : 1,
      billing: {
        cacheRead: Number(coefficients.cr || 0),
        cacheWrite: Number(coefficients.cc || 0),
        cacheWrite1h: Number(coefficients.cc1h || 0)
      }
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
      const tiers = requestBilled ? [] : parseBillingTiers(item.billing_expr);
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
          evidence: "exact"
        });
      }
    }
    return { data, group_ratio: {}, sourceFormat: "liuguang-models" };
  }
}

export class AiApiModelCatalogStrategy extends ParsingStrategy {
  canParse(raw) {
    return raw?.data?.source === "cnaiapi" && Array.isArray(raw.data.groups) && raw.data.groups.some(group => Array.isArray(group?.models));
  }

  parse(raw) {
    const data = [];
    const groupRatio = {};
    for (const group of raw.data.groups) {
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
    const data = [];
    const groupRatio = {};
    for (const item of raw.data.items) {
      const modelName = String(item?.model || item?.display_name || "").trim();
      const pricing = item?.effective_pricing_usd || item?.official_pricing || {};
      if (!modelName || !pricing || typeof pricing !== "object") continue;
      const input = finitePrice(pricing.input_per_mtok_usd);
      const output = finitePrice(pricing.output_per_mtok_usd);
      const cacheRead = finitePrice(pricing.cache_read_per_mtok_usd);
      const cacheWrite = finitePrice(pricing.cache_write_per_mtok_usd);
      const request = finitePrice(pricing.per_request_usd);
      const image = finitePrice(pricing.per_image_usd);
      if ([input, output, cacheRead, cacheWrite, request, image].every(value => value === null)) continue;
      const groupName = String(item?.group?.name || "cheaprouter.cc").trim();
      groupRatio[groupName] = 1;
      data.push({
        model_name: modelName,
        model_display_name: String(item?.display_name || modelName),
        model_ratio: input === null ? 0 : input / SYSTEM_BASE_PRICE_PER_1M,
        completion_ratio: input > 0 && output !== null ? output / input : 1,
        input_price: input,
        output_price: output,
        cache_read_price: cacheRead,
        cache_write_price: cacheWrite,
        request_price: request,
        image_price: image,
        price_currency: "USD",
        enable_groups: [groupName],
        proxy_group_name: groupName,
        group_ratio: 1,
        evidence: "exact"
      });
    }
    if (!data.length) throw new Error("CheapRouter 公开模型价格数据为空");
    return { data, group_ratio: groupRatio, sourceFormat: "cheaprouter-public-api" };
  }
}

export class JijiModelMarketStrategy extends ParsingStrategy {
  canParse(raw) { return Array.isArray(raw?.providers) && raw.providers.some(provider => Array.isArray(provider?.models)); }

  parse(raw) {
    const data = [];
    const groupRatio = {};
    for (const provider of raw.providers) {
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

const sidruneMultiplier = group => {
  if (group?.promo_active === true) {
    const promo = finitePrice(group.promo_rate_multiplier);
    if (promo !== null) return promo;
  }
  return finitePrice(group?.effective_rate_multiplier) ?? finitePrice(group?.rate_multiplier) ?? 1;
};

export class SidruneModelPlazaStrategy extends ParsingStrategy {
  canParse(raw) {
    return raw?.code === 0 && Array.isArray(raw?.data?.groups) && Array.isArray(raw?.data?.pricing);
  }

  parse(raw) {
    const data = [];
    const groupRatio = {};
    const groups = new Map((raw.data.groups || []).map(group => [String(group?.id), group]));
    const perMillion = value => {
      const parsed = finitePrice(value);
      return parsed === null ? null : parsed * 1_000_000;
    };

    for (const pricing of raw.data.pricing) {
      const groupTargets = (Array.isArray(pricing?.group_ids) ? pricing.group_ids : [])
        .map(id => groups.get(String(id)))
        .filter(Boolean);
      if (!pricing?.name || !groupTargets.length) continue;
      const intervals = Array.isArray(pricing.intervals) && pricing.intervals.length ? pricing.intervals : [null];

      for (const group of groupTargets) {
        const groupName = String(group.name || group.id || "Sidrune").trim();
        const multiplier = sidruneMultiplier(group);
        groupRatio[groupName] = multiplier;
        for (const interval of intervals) {
          const price = field => {
            const value = interval?.[field] ?? pricing[field];
            const parsed = perMillion(value);
            return parsed === null ? null : parsed * multiplier;
          };
          const requestValue = interval?.per_request_price ?? pricing.per_request_price;
          const request = finitePrice(requestValue);
          const input = price("input_price");
          const output = price("output_price");
          const cacheRead = price("cache_read_price");
          const cacheWrite = price("cache_write_price");
          const cacheWrite1h = price("cache_write_1h_price");
          const imageOutput = price("image_output_price");
          const imageInput = price("image_input_price");
          if ([input, output, cacheRead, cacheWrite, cacheWrite1h, imageOutput, imageInput, request].every(value => value === null)) continue;
          const tierName = intervals.length > 1 || interval?.tier_label ? String(interval?.tier_label || "标准") : "";
          data.push({
            model_name: String(pricing.name),
            model_display_name: String(pricing.name),
            model_ratio: input === null ? 0 : input / SYSTEM_BASE_PRICE_PER_1M,
            completion_ratio: input > 0 && output !== null ? output / input : 1,
            input_price: input,
            output_price: output,
            cache_read_price: cacheRead,
            cache_write_price: cacheWrite,
            cache_write_1h_price: cacheWrite1h,
            request_price: request === null ? null : request * multiplier,
            image_input_price: imageInput,
            image_output_price: imageOutput,
            price_currency: "USD",
            enable_groups: [groupName],
            proxy_group_name: groupName,
            group_ratio: multiplier,
            tier_name: tierName,
            evidence: "exact"
          });
        }
      }
    }
    if (!data.length) throw new Error("Sidrune 模型广场价格数据为空");
    return { data, group_ratio: groupRatio, sourceFormat: "sidrune-model-plaza" };
  }
}


export class TrueSotaModelPricingStrategy extends ParsingStrategy {
  canParse(raw) {
    return raw?.code === 0 && Array.isArray(raw?.data?.groups) && Array.isArray(raw?.data?.models) &&
      raw.data.models.some(model => model && model.group_id !== undefined && Object.prototype.hasOwnProperty.call(model, "input_price"));
  }

  parse(raw) {
    const groups = new Map(raw.data.groups.map(group => [String(group?.id), group]));
    const data = [];
    const groupRatio = {};
    const perMillion = value => {
      const parsed = finitePrice(value);
      return parsed === null ? null : parsed * 1_000_000;
    };

    for (const model of raw.data.models) {
      const group = groups.get(String(model?.group_id));
      const modelName = String(model?.name || "").trim();
      const groupName = String(group?.name || group?.id || "").trim();
      const multiplier = finitePrice(group?.rate_multiplier) ?? 1;
      if (!modelName || !groupName) continue;
      const input = perMillion(model.input_price);
      const output = perMillion(model.output_price);
      const cache = perMillion(model.cache_price);
      if ([input, output, cache].every(value => value === null)) continue;
      const scale = value => value === null ? null : value * multiplier;
      const effectiveInput = scale(input);
      const effectiveOutput = scale(output);
      groupRatio[groupName] = multiplier;
      data.push({
        model_name: modelName,
        model_display_name: modelName,
        model_ratio: effectiveInput === null ? 0 : effectiveInput / SYSTEM_BASE_PRICE_PER_1M,
        completion_ratio: effectiveInput > 0 && effectiveOutput !== null ? effectiveOutput / effectiveInput : 1,
        input_price: effectiveInput,
        output_price: effectiveOutput,
        cache_read_price: scale(cache),
        cache_write_price: null,
        price_currency: "USD",
        enable_groups: [groupName],
        proxy_group_name: groupName,
        group_ratio: multiplier,
        evidence: "exact"
      });
    }
    if (!data.length) throw new Error("TrueSOTA 模型价格数据为空");
    return { data, group_ratio: groupRatio, sourceFormat: "true-sota-model-pricing" };
  }
}

export class JijiModelPlazaStrategy extends ParsingStrategy {
  canParse(raw) { return raw?.code === 0 && Array.isArray(raw?.data?.groups); }

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
          evidence: "exact"
        });
      }
    }
    if (!data.length) throw new Error("吉吉模型价格数据为空");
    return { data, group_ratio: groupRatio, sourceFormat: "jiji" };
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

export function normalizeProxyData(raw, options = {}) {
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
    if (!strategy.canParse(raw)) continue;
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
