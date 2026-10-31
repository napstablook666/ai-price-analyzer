import { DEFAULT_MATCHING_RULES, STATION_CATEGORIES, SYSTEM_BASE_PRICE_PER_1M } from "../shared/schema.js";
import { buildModelMatchIndex, matchModelWithOverrides } from "./matching.js";
import { STANDARD_PRICE_FIELDS } from "./price-fields.js";


export function currencyToRmb(currency, rechargeRate = 1) {
  const code = String(currency ?? "").trim().toUpperCase();
  if (!code || ["UNKNOWN", "UNSPECIFIED", "NONE"].includes(code)) return null;
  if (["CNY", "RMB", "¥", "￥"].includes(code)) return 1;
  if (!["USD", "CREDITS", "POINTS"].includes(code)) return null;
  const rate = Number(rechargeRate);
  return Number.isFinite(rate) ? rate : 1;
}

function buildProxyPrices(item = {}, groupRatio = 1, factor = 1, basePrice = SYSTEM_BASE_PRICE_PER_1M) {
  const explicit = value => value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) * factor : null);
  const billing = item.billing || {};
  const cacheWrite1h = explicit(item.cache_write_1h_price) ?? explicit(billing.cacheWrite1h);
  const fallbackInput = Number.isFinite(Number(item.model_ratio)) && Number(item.model_ratio) > 0 ? Number(item.model_ratio) * (Number(groupRatio) || 1) * basePrice * factor : null;
  const fallbackOutput = fallbackInput === null ? null : fallbackInput * (Number(item.completion_ratio) || 1);
  const imageInput = explicit(item.image_input_price) ?? explicit(billing.imageInput);
  return {
    input: explicit(item.input_price) ?? fallbackInput,
    output: explicit(item.output_price) ?? fallbackOutput,
    cacheRead: explicit(item.cache_read_price) ?? explicit(billing.cacheRead),
    cacheWrite: explicit(item.cache_write_price) ?? explicit(billing.cacheWrite),
    ...(cacheWrite1h === null ? {} : { cacheWrite1h }),
    request: explicit(item.request_price) ?? explicit(billing.request),
    ...(imageInput === null ? {} : { imageInput }),
    imageOutput: explicit(item.image_output_price) ?? explicit(billing.imageOutput),
    imagePrice: explicit(item.image_price) ?? explicit(billing.imagePrice)
  };
}

function hasNumericPrice(prices = {}) {
  return STANDARD_PRICE_FIELDS.some(field => Number.isFinite(prices[field]));
}

export function getProxyPriceQuote(item = {}, groupRatio = 1, rechargeRate = 1, basePrice = SYSTEM_BASE_PRICE_PER_1M, priceCurrencyVerified = true, rechargeRateVerified = true) {
  const effectiveRechargeRate = rechargeRateVerified === true ? rechargeRate : 1;
  const factor = currencyToRmb(item.price_currency, effectiveRechargeRate);
  const unavailableReasons = [];
  if (factor === null || priceCurrencyVerified === false) unavailableReasons.push("currency_unverified");
  const sourceCurrency = String(item.price_currency ?? "").trim().toUpperCase() || "UNKNOWN";
  const quotedPrices = buildProxyPrices(item, groupRatio, 1, basePrice);
  if (!hasNumericPrice(quotedPrices)) unavailableReasons.push("price_missing");
  return {
    quotedPrices,
    costPrices: unavailableReasons.length ? null : buildProxyPrices(item, groupRatio, factor, basePrice),
    sourceCurrency,
    quotedInSourceCurrency: unavailableReasons.length > 0,
    pricingUnavailable: unavailableReasons.length > 0,
    pricingUnavailableReasons: unavailableReasons
  };
}

export function getProxyPrices(item = {}, groupRatio = 1, rechargeRate = 1, basePrice = SYSTEM_BASE_PRICE_PER_1M, priceCurrencyVerified = true, rechargeRateVerified = true) {
  const quote = getProxyPriceQuote(item, groupRatio, rechargeRate, basePrice, priceCurrencyVerified, rechargeRateVerified);
  return quote.costPrices || { ...Object.fromEntries(STANDARD_PRICE_FIELDS.map(field => [field, null])), pricingUnavailable: true, pricingUnavailableReasons: quote.pricingUnavailableReasons };
}

export function workloadCost(prices = {}, usage = {}) {
  const perMillion = (price, tokens) => (Number.isFinite(price) ? price : 0) * ((Number(tokens) || 0) / 1_000_000);
  return perMillion(prices.input, usage.input) +
    perMillion(prices.cacheRead ?? prices.input, usage.cacheRead) +
    perMillion(prices.cacheWrite ?? prices.input, usage.cacheWrite) +
    perMillion(prices.cacheWrite1h, usage.cacheWrite1h) +
    perMillion(prices.output, usage.output) +
    (Number(usage.requests) || 0) * (Number.isFinite(prices.request) ? prices.request : 0) +
    perMillion(prices.imageInput, usage.imageInputTokens) +
    perMillion(prices.imageOutput, usage.imageOutputTokens ?? usage.imageTokens) +
    (Number(usage.images) || 0) * (Number.isFinite(prices.imagePrice) ? prices.imagePrice : 0);
}

function referencePrices(model, exchangeRate = 1) {
  if (!model) return null;
  const factor = Number(exchangeRate) || 1;
  return {
    input: (Number(model.input) || 0) * factor,
    output: (Number(model.output) || 0) * factor,
    cacheRead: Number.isFinite(model.cacheRead) ? model.cacheRead * factor : null,
    cacheWrite: Number.isFinite(model.cacheWrite) ? model.cacheWrite * factor : null,
    ...(Number.isFinite(model.cacheWrite1h) ? { cacheWrite1h: model.cacheWrite1h * factor } : {}),
    request: Number.isFinite(model.request) ? model.request * factor : null,
    imageInput: Number.isFinite(model.imageInput) ? model.imageInput * factor : null,
    imageOutput: Number.isFinite(model.imageOutput) ? model.imageOutput * factor : null,
    imagePrice: Number.isFinite(model.imagePrice) ? model.imagePrice * factor : null
  };
}

export function getTierShares(items, peakShare = 7 / 24) {
  if (items.length <= 1) return [1];
  const peak = Math.min(1, Math.max(0, Number(peakShare) || 0));
  const shares = items.map(item => {
    const name = String(item.tier_name || "").toLowerCase();
    if (/peak|高峰|busy|high/.test(name) && !/off|低峰|非高峰|low/.test(name)) return peak;
    if (/off|低峰|非高峰|low/.test(name)) return 1 - peak;
    return null;
  });
  const known = shares.reduce((sum, share) => sum + (share ?? 0), 0);
  const unknownCount = shares.filter(share => share === null).length;
  if (unknownCount) {
    if (known >= 1) return shares.map(share => share === null ? 0 : share / known);
    const fallback = (1 - known) / unknownCount;
    return shares.map(share => share ?? fallback);
  }
  if (known > 0) return shares.map(share => share / known);
  return shares.map(() => 1 / shares.length);
}

function offerGroups(item, normalized) {
  const values = Array.isArray(item.enable_groups) && item.enable_groups.length
    ? item.enable_groups
    : [item.proxy_group_name || "Default"];
  return [...new Set(values.map(value => item.proxy_group_name || value))];
}

function addWeighted(target, source, share) {
  for (const field of STANDARD_PRICE_FIELDS) {
    const value = source[field];
    if (!Number.isFinite(value)) continue;
    target[field] = (target[field] ?? 0) + value * share;
  }
}

function tierKey(item, group) {
  return `${item.model_name}\u0000${group}`;
}

function normalizeStationCategory(station) {
  return STATION_CATEGORIES.includes(station.category) ? station.category : "paid";
}

export function confidenceScore(row) {
  let score = Number(row.matchConfidence ?? 0.6) * 100;
  if (row.cacheReadEstimated) score -= 10;
  if (row.cacheWriteEstimated) score -= 5;
  if (!row.officialName || !row.provider) score -= 15;
  if (row.stale) score -= 15;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function classifyOffer(offer) {
  if (offer.pricingUnavailable) return "pending";
  if (offer.monthlyCost === 0 && offer.officialMonthlyCost > 0) return "excellent";
  if (offer.officialMonthlyCost === 0 && offer.monthlyCost > 0) return "bad";
  if (offer.diffPercent < -40) return "excellent";
  if (offer.diffPercent < -2) return "good";
  if (offer.diffPercent > 50) return "bad";
  return "fair";
}

export function addRecommendationScores(comparisons, profile = "price") {
  const weights = { balanced: [0.8, 0.2], price: [0.9, 0.1], reliability: [0.7, 0.3] }[profile] || [0.9, 0.1];
  for (const comparison of comparisons) {
    const candidates = comparison.offers.filter(offer => !offer.pricingUnavailable && !offer.incomplete && Number.isFinite(offer.monthlyCost));
    const eligible = candidates.filter(offer => comparison.comparisonGroup === "public" || (offer.matchRuleId === "exact" && Number(offer.officialMonthlyCost) > 0));
    const minCost = candidates.length ? Math.min(...candidates.map(offer => offer.monthlyCost)) : null;
    const maxCost = candidates.length ? Math.max(...candidates.map(offer => offer.monthlyCost)) : null;
    for (const offer of comparison.offers) {
      const costScore = minCost === null || !Number.isFinite(offer.monthlyCost) ? 0 : maxCost === minCost ? 100 : Math.max(0, Math.min(100, Math.round((maxCost - offer.monthlyCost) / (maxCost - minCost) * 100)));
      const confidence = offer.confidenceScore;
      const score = Math.round(costScore * weights[0] + confidence * weights[1]);
      offer.recommendationScore = score;
      offer.recommendationEligible = eligible.includes(offer);
      offer.costScore = costScore;
      offer.confidenceScoreNormalized = confidence;
      offer.category = classifyOffer(offer);
    }
    const best = eligible.reduce((current, offer) => !current || offer.recommendationScore > current.recommendationScore ? offer : current, null);
    for (const offer of comparison.offers) {
      offer.recommended = offer === best;
      offer.recommendationLabel = !offer.recommendationEligible ? "需核验" : offer.recommended ? "推荐" : offer.recommendationScore >= 75 ? "推荐" : offer.recommendationScore >= 55 ? "可选" : "谨慎";
    }
  }
  return comparisons;
}

export function buildComparisonRows({ stations = [], snapshots = [], references = {}, usage = {}, rules = DEFAULT_MATCHING_RULES, modelMatchOverrides = [], showUnmatched = true, recommendationProfile = "price" } = {}) {
  const stationMap = new Map(stations.map(station => [station.id, station]));
  const referenceList = Array.isArray(references.models) ? references.models : [];
  const latestByStation = new Map();
  const matchingIndex = buildModelMatchIndex(referenceList, modelMatchOverrides);
  for (const snapshot of snapshots) {
    const previous = latestByStation.get(snapshot.stationId);
    if (!previous || snapshot.collectedAt > previous.collectedAt) latestByStation.set(snapshot.stationId, snapshot);
  }
  const grouped = new Map();
  for (const snapshot of latestByStation.values()) {
    const station = stationMap.get(snapshot.stationId);
    if (!station || !snapshot.normalized?.data) continue;
    const stationCategory = normalizeStationCategory(station);
    const comparisonGroup = stationCategory === "public" ? "public" : "standard";
    const tierSharesByGroup = new Map();
    const tierItemsByGroup = new Map();
    const rawUnpricedModelKeys = snapshot.unpricedModels || snapshot.normalized?.unpricedModels;
    const unpricedModelKeys = Array.isArray(rawUnpricedModelKeys) ? rawUnpricedModelKeys.map(value => String(value)) : [];
    snapshot.normalized.data.forEach(item => {
      if (item.catalogOnly) return;
      if (!item.tier_name) return;
      for (const group of offerGroups(item, snapshot.normalized)) {
        const key = tierKey(item, group);
        if (!tierItemsByGroup.has(key)) tierItemsByGroup.set(key, []);
        tierItemsByGroup.get(key).push(item);
      }
    });
    for (const [key, items] of tierItemsByGroup) tierSharesByGroup.set(key, new Map(items.map((item, index) => [item, getTierShares(items, usage.peakShare)[index]])));

    snapshot.normalized.data.forEach((item, itemIndex) => {
      if (item.catalogOnly) return;
      const matches = matchModelWithOverrides(item.model_name, referenceList, { stationId: station.id, rules, index: matchingIndex });
      if (!matches.length && !showUnmatched) return;
      const matchResults = matches.length ? matches : [{ match: null, rule: "未匹配", ruleId: "unmatched", confidence: 0 }];
      for (const group of offerGroups(item, snapshot.normalized)) {
        const rawGroupRatio = item.group_ratio ?? snapshot.normalized.group_ratio?.[group] ?? snapshot.normalized.group_ratio?.[item.enable_groups?.[0]];
        const groupRatio = Number.isFinite(Number(rawGroupRatio)) ? Number(rawGroupRatio) : 1;
        const hasUnpricedPriceGap = unpricedModelKeys.some(value => value.startsWith(`${group}:${item.model_name}:`));
        const priceCurrencyVerified = station.priceCurrencyVerified ?? snapshot.priceCurrencyVerified;
        const rechargeRateVerified = station.rechargeRateVerified ?? snapshot.rechargeRateVerified ?? false;
        const priceQuote = getProxyPriceQuote(item, groupRatio, stationCategory === "public" ? 1 : station.rechargeRate, station.basePricePerMillion, priceCurrencyVerified, stationCategory === "public" ? true : rechargeRateVerified);
        const quotedPrices = priceQuote.quotedPrices;
        const baseCostPrices = priceQuote.costPrices;
        const share = item.tier_name ? (tierSharesByGroup.get(tierKey(item, group))?.get(item) ?? 0) : 1;
        for (const result of matchResults) {
          let costPrices = baseCostPrices;
          const official = result.match;
          const canonicalModel = official?.name || item.model_name;
          const rowKey = [station.id, item.model_name, official?.name || "", official?.provider || "", group, item.tier_name ? "tier" : `item:${itemIndex}`].join("\u0000");
          const row = grouped.get(rowKey) || {
            canonicalModel,
            displayName: official?.display_name || official?.name || item.model_display_name || item.model_name,
            provider: official?.provider || "未匹配",
            official,
            offers: [],
            proxyPrices: {},
            costPrices: {},
            officialQuotedPrices: {},
            officialPrices: {},
            officialCurrency: "CREDITS",
            sourceCurrency: null,
            quotedInSourceCurrency: false,
            tierNames: new Set(),
            cacheReadEstimated: false,
            pricingUnavailable: false,
            pricingUnavailableReasons: new Set(),
            cacheWriteEstimated: false,
            monthlyCost: 0,
            officialMonthlyCost: 0,
            stationId: station.id,
            stationName: station.name,
            stationCategory,
            comparisonGroup,
            modelName: item.model_name,
            displayNameOverride: item.model_display_name || item.model_name,
            groupName: group,
            groupRatio,
            matchRule: result.rule,
            matchRuleId: result.ruleId,
            matchConfidence: result.confidence,
            matchCandidateCount: matches.length,
            evidence: item.evidence || "estimated",
            incomplete: Boolean(snapshot.incomplete || snapshot.status === "partial" || snapshot.normalized?.incomplete),
            unsupportedBillingModes: snapshot.unsupportedBillingModes || snapshot.normalized?.unsupportedBillingModes || [],
            invalidPricingValues: snapshot.invalidPricingValues || snapshot.normalized?.invalidPricingValues || [],
            unpricedModels: snapshot.unpricedModels || snapshot.normalized?.unpricedModels || [],
            stale: Boolean(snapshot.stale || (snapshot.status !== "success" && snapshot.status !== "partial")),
            collectedAt: snapshot.collectedAt,
            sourceFormat: snapshot.source || snapshot.normalized.sourceFormat || "unknown"
          };
          for (const reason of priceQuote.pricingUnavailableReasons) row.pricingUnavailableReasons.add(reason);
          if (!row.sourceCurrency) row.sourceCurrency = priceQuote.sourceCurrency;
          else if (row.sourceCurrency !== priceQuote.sourceCurrency) row.sourceCurrency = "MIXED";
          row.quotedInSourceCurrency ||= priceQuote.quotedInSourceCurrency;
          if ((Number(usage.cacheWrite1h) || 0) > 0 && !Number.isFinite(costPrices?.cacheWrite1h)) {
            row.pricingUnavailableReasons.add("cache_write_1h_missing");
            costPrices = null;
          }
          if (hasUnpricedPriceGap) {
            row.pricingUnavailableReasons.add("unpriced_model_price_missing");
            costPrices = null;
          }
          if (priceQuote.pricingUnavailable || !costPrices) row.pricingUnavailable = true;
          addWeighted(row.proxyPrices, quotedPrices, share);
          if (costPrices) addWeighted(row.costPrices, costPrices, share);
          const officialQuotedPrices = stationCategory === "public" ? null : referencePrices(official, 1);
          const officialPrices = stationCategory === "public" ? null : referencePrices(official, references.openRouterRechargeRate || references.exchangeRate || 1);
          if (officialQuotedPrices) addWeighted(row.officialQuotedPrices, officialQuotedPrices, share);
          if (officialPrices) addWeighted(row.officialPrices, officialPrices, share);
          if (quotedPrices.cacheRead === null) row.cacheReadEstimated = true;
          if (quotedPrices.cacheWrite === null) row.cacheWriteEstimated = true;
          if (costPrices) row.monthlyCost += workloadCost(costPrices, usage) * share;
          row.officialMonthlyCost += officialPrices ? workloadCost(officialPrices, usage) * share : 0;
          if (item.tier_name) row.tierNames.add(`${item.tier_name} ${Math.round(share * 100)}%`);
          grouped.set(rowKey, row);
        }
      }
    });
  }

  const comparisons = new Map();
  for (const row of grouped.values()) {
    const quotedUnit = hasNumericPrice(row.proxyPrices) ? row.proxyPrices : null;
    const costUnit = hasNumericPrice(row.costPrices) ? row.costPrices : null;
    const officialQuotedUnit = Object.keys(row.officialQuotedPrices).length ? row.officialQuotedPrices : null;
    const officialUnit = Object.keys(row.officialPrices).length ? row.officialPrices : null;
    const offer = {
      stationId: row.stationId,
      stationName: row.stationName,
      stationCategory: row.stationCategory,
      modelName: row.modelName,
      displayName: row.displayNameOverride,
      provider: row.provider,
      officialName: row.official?.name || "",
      matchRule: row.matchRule,
      matchRuleId: row.matchRuleId,
      matchConfidence: row.matchConfidence,
      matchCandidateCount: row.matchCandidateCount,
      groupName: row.groupName,
      groupRatio: row.groupRatio,
      tierName: [...row.tierNames].join(" / ") || "标准",
      quotedPrices: quotedUnit,
      prices: quotedUnit,
      costPrices: row.pricingUnavailable ? null : costUnit,
      sourceCurrency: row.sourceCurrency || "UNKNOWN",
      quotedInSourceCurrency: row.quotedInSourceCurrency,
      officialPrices: officialUnit,
      officialQuotedPrices: officialQuotedUnit,
      officialCurrency: row.officialCurrency,
      monthlyCost: row.pricingUnavailable ? null : row.monthlyCost,
      costCurrency: row.stationCategory === "public" ? row.sourceCurrency : null,
      officialMonthlyCost: row.stationCategory === "public" ? null : row.official ? row.officialMonthlyCost : null,
      diffPercent: row.stationCategory !== "public" && !row.pricingUnavailable && Number.isFinite(row.monthlyCost) && row.official && row.officialMonthlyCost > 0 ? ((row.monthlyCost - row.officialMonthlyCost) / row.officialMonthlyCost) * 100 : null,
      evidence: row.evidence,
      pricingUnavailable: row.pricingUnavailable,
      pricingUnavailableReasons: [...row.pricingUnavailableReasons].sort(),
      incomplete: row.incomplete,
      unsupportedBillingModes: row.unsupportedBillingModes,
      invalidPricingValues: row.invalidPricingValues,
      unpricedModels: row.unpricedModels,
      cacheReadEstimated: row.cacheReadEstimated,
      cacheWriteEstimated: row.cacheWriteEstimated,
      stale: row.stale,
      collectedAt: row.collectedAt,
      sourceFormat: row.sourceFormat
    };
    offer.confidenceScore = confidenceScore(offer);
    const comparisonKey = `${row.canonicalModel}\u0000${row.comparisonGroup}`;
    if (!comparisons.has(comparisonKey)) comparisons.set(comparisonKey, {
      canonicalModel: row.canonicalModel,
      comparisonGroup: row.comparisonGroup,
      displayName: row.displayName,
      provider: row.provider,
      official: row.official,
      offers: []
    });
    comparisons.get(comparisonKey).offers.push(offer);
  }
  const result = [...comparisons.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  addRecommendationScores(result, recommendationProfile);
  return result;
}

export function flattenComparisonRows(comparisons) {
  return comparisons.flatMap(comparison => comparison.offers.map(offer => ({ ...offer, canonicalModel: comparison.canonicalModel })));
}

export function summarizeComparisons(comparisons) {
  const offers = flattenComparisonRows(comparisons);
  const best = offers.filter(offer => Number.isFinite(offer.monthlyCost)).sort((a, b) => a.monthlyCost - b.monthlyCost)[0];
  return {
    modelCount: new Set(comparisons.map(comparison => comparison.canonicalModel)).size,
    offerCount: offers.length,
    stationCount: new Set(offers.map(offer => offer.stationId)).size,
    staleCount: offers.filter(offer => offer.stale).length,
    bestSaving: best?.diffPercent < 0 ? Math.abs(best.diffPercent) : 0
  };
}
