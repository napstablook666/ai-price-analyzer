import { SYSTEM_BASE_PRICE_PER_1M } from "../shared/schema.js";
export const NORMALIZATION_VERSION = 4;

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
    const groupRatios = Object.fromEntries(Object.entries(raw.group_ratio).map(([key, value]) => [key, number(value)]));
    const catalogRatios = raw.catalog_group_ratio && typeof raw.catalog_group_ratio === "object"
      ? Object.fromEntries(Object.entries(raw.catalog_group_ratio).map(([key, value]) => [key, number(value)]))
      : null;
    const catalogPricing = Boolean(catalogRatios && Object.keys(catalogRatios).length);
    const displayGroups = catalogPricing ? Object.keys(catalogRatios) : null;
    const usableGroups = raw.usable_group && typeof raw.usable_group === "object" ? Object.keys(raw.usable_group) : [];
    const activeGroups = usableGroups.filter(group => own(groupRatios, group));
    const list = [];

    for (const item of raw.data) {
      if (!item || typeof item.model_name !== "string") continue;
      const itemGroups = Array.isArray(item.enable_groups) ? item.enable_groups : [item.enable_groups].filter(Boolean);
      if (!itemGroups.length) continue;
      const tiers = parseBillingTiers(item.billing_expr);
      const variants = tiers.length ? tiers : [{
        name: "标准",
        input: Number(item.model_ratio) * base,
        output: Number(item.model_ratio) * base * Number(item.completion_ratio || 1),
        ratio: item.model_ratio,
        completion: item.completion_ratio,
        request: Number(item.quota_type) === 1 && Number.isFinite(Number(item.model_price)) ? Number(item.model_price) : null,
        billing: {
          cacheRead: finitePrice(item.cache_ratio) === null ? null : Number(item.model_ratio) * base * Number(item.cache_ratio),
          cacheWrite: finitePrice(item.create_cache_ratio) === null ? null : Number(item.model_ratio) * base * Number(item.create_cache_ratio)
        }
      }];
      const targetGroups = catalogPricing
        ? displayGroups
        : (activeGroups.length ? itemGroups.filter(group => activeGroups.includes(group)) : itemGroups);
      const discounts = item.active_discount_rates || {};
      const displayDiscounts = item.active_discount_display || {};

      for (const group of targetGroups) {
        const groupRatio = number((catalogPricing ? catalogRatios : groupRatios)[group]);
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
            enable_groups: [group],
            proxy_group_name: group,
            tier_name: tier.name,
            group_ratio: groupRatio * discountFactor,
            evidence: "exact"
          });
        }
      }
    }
    return { data: list, group_ratio: catalogPricing ? Object.fromEntries(displayGroups.map(group => [group, 1])) : groupRatios, sourceFormat: "pqh" };
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
