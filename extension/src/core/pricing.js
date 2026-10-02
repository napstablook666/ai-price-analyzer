import { DEFAULT_MATCHING_RULES, SYSTEM_BASE_PRICE_PER_1M } from "../shared/schema.js";
import { buildModelMatchIndex, matchModelWithOverrides } from "./matching.js";

const PRICE_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "request", "imageOutput", "imagePrice"];

export function currencyToRmb(currency, rechargeRate = 1) {
  const code = String(currency || "USD").toUpperCase();
  if (["CNY", "RMB", "¥", "￥"].includes(code)) return 1;
  const rate = Number(rechargeRate);
  return Number.isFinite(rate) ? rate : 1;
}

export function getProxyPrices(item = {}, groupRatio = 1, rechargeRate = 1, basePrice = SYSTEM_BASE_PRICE_PER_1M) {
  const factor = currencyToRmb(item.price_currency, rechargeRate);
  const explicit = value => value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) * factor : null);
  const billing = item.billing || {};
  const fallbackInput = (Number(item.model_ratio) || 0) * (Number(groupRatio) || 1) * basePrice * factor;
  const fallbackOutput = fallbackInput * (Number(item.completion_ratio) || 1);
  return {
    input: explicit(item.input_price) ?? fallbackInput,
    output: explicit(item.output_price) ?? fallbackOutput,
    cacheRead: explicit(item.cache_read_price) ?? explicit(billing.cacheRead),
    cacheWrite: explicit(item.cache_write_price) ?? explicit(billing.cacheWrite),
    request: explicit(item.request_price) ?? explicit(billing.request),
    imageOutput: explicit(item.image_output_price) ?? explicit(billing.imageOutput),
    imagePrice: explicit(item.image_price) ?? explicit(billing.imagePrice)
  };
}

export function workloadCost(prices = {}, usage = {}) {
  const perMillion = (price, tokens) => (Number.isFinite(price) ? price : 0) * ((Number(tokens) || 0) / 1_000_000);
  return perMillion(prices.input, usage.input) +
    perMillion(prices.cacheRead ?? prices.input, usage.cacheRead) +
    perMillion(prices.cacheWrite ?? prices.input, usage.cacheWrite) +
    perMillion(prices.output, usage.output) +
    (Number(usage.requests) || 0) * (Number.isFinite(prices.request) ? prices.request : 0) +
    perMillion(prices.imageOutput, usage.imageTokens) +
    (Number(usage.images) || 0) * (Number.isFinite(prices.imagePrice) ? prices.imagePrice : 0);
}

export function referencePrices(model, exchangeRate = 1) {
  if (!model) return null;
  const factor = Number(exchangeRate) || 1;
  return {
    input: (Number(model.input) || 0) * factor,
    output: (Number(model.output) || 0) * factor,
    cacheRead: Number.isFinite(model.cacheRead) ? model.cacheRead * factor : null,
    cacheWrite: Number.isFinite(model.cacheWrite) ? model.cacheWrite * factor : null,
    request: Number.isFinite(model.request) ? model.request * factor : null,
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
  for (const field of PRICE_FIELDS) {
    const value = source[field];
    if (!Number.isFinite(value)) continue;
    target[field] = (target[field] ?? 0) + value * share;
  }
}

function tierKey(item, group) {
  return `${item.model_name}\u0000${group}`;
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
  if (offer.dailyCost === 0 && offer.officialDailyCost > 0) return "excellent";
  if (offer.officialDailyCost === 0 && offer.dailyCost > 0) return "bad";
  if (offer.diffPercent < -40) return "excellent";
  if (offer.diffPercent < -2) return "good";
  if (offer.diffPercent > 50) return "bad";
  return "fair";
}

export function addRecommendationScores(comparisons, profile = "price") {
  const weights = { balanced: [0.8, 0.2], price: [0.9, 0.1], reliability: [0.7, 0.3] }[profile] || [0.9, 0.1];
  for (const comparison of comparisons) {
    const candidates = comparison.offers.filter(offer => Number.isFinite(offer.dailyCost));
    const eligible = candidates.filter(offer => offer.matchRuleId === "exact" && Number(offer.officialDailyCost) > 0);
    const minCost = candidates.length ? Math.min(...candidates.map(offer => offer.dailyCost)) : null;
    const maxCost = candidates.length ? Math.max(...candidates.map(offer => offer.dailyCost)) : null;
    for (const offer of comparison.offers) {
      const costScore = minCost === null || !Number.isFinite(offer.dailyCost) ? 0 : maxCost === minCost ? 100 : Math.max(0, Math.min(100, Math.round((maxCost - offer.dailyCost) / (maxCost - minCost) * 100)));
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
    const tierSharesByGroup = new Map();
    const tierItemsByGroup = new Map();
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
        const proxyPrices = getProxyPrices(item, groupRatio, station.rechargeRate, station.basePricePerMillion);
        const share = item.tier_name ? (tierSharesByGroup.get(tierKey(item, group))?.get(item) ?? 0) : 1;
        for (const result of matchResults) {
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
            officialPrices: {},
            tierNames: new Set(),
            cacheReadEstimated: false,
            cacheWriteEstimated: false,
            dailyCost: 0,
            officialDailyCost: 0,
            stationId: station.id,
            stationName: station.name,
            modelName: item.model_name,
            displayNameOverride: item.model_display_name || item.model_name,
            groupName: group,
            groupRatio,
            matchRule: result.rule,
            matchRuleId: result.ruleId,
            matchConfidence: result.confidence,
            matchCandidateCount: matches.length,
            evidence: item.evidence || "estimated",
            stale: Boolean(snapshot.stale || snapshot.status !== "success"),
            collectedAt: snapshot.collectedAt,
            sourceFormat: snapshot.source || snapshot.normalized.sourceFormat || "unknown"
          };
          addWeighted(row.proxyPrices, proxyPrices, share);
          const officialPrices = referencePrices(official, references.exchangeRate || 1);
          if (officialPrices) addWeighted(row.officialPrices, officialPrices, share);
          if (proxyPrices.cacheRead === null) row.cacheReadEstimated = true;
          if (proxyPrices.cacheWrite === null) row.cacheWriteEstimated = true;
          row.dailyCost += workloadCost(proxyPrices, usage) * share;
          row.officialDailyCost += officialPrices ? workloadCost(officialPrices, usage) * share : 0;
          if (item.tier_name) row.tierNames.add(`${item.tier_name} ${Math.round(share * 100)}%`);
          grouped.set(rowKey, row);
        }
      }
    });
  }

  const comparisons = new Map();
  for (const row of grouped.values()) {
    const prices = { ...row.proxyPrices };
    const officialUnit = Object.keys(row.officialPrices).length ? row.officialPrices : null;
    const offer = {
      stationId: row.stationId,
      stationName: row.stationName,
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
      prices,
      officialPrices: officialUnit,
      dailyCost: row.dailyCost,
      officialDailyCost: row.official ? row.officialDailyCost : null,
      diffPercent: row.official && row.officialDailyCost > 0 ? ((row.dailyCost - row.officialDailyCost) / row.officialDailyCost) * 100 : null,
      evidence: row.evidence,
      cacheReadEstimated: row.cacheReadEstimated,
      cacheWriteEstimated: row.cacheWriteEstimated,
      stale: row.stale,
      collectedAt: row.collectedAt,
      sourceFormat: row.sourceFormat
    };
    offer.confidenceScore = confidenceScore(offer);
    if (!comparisons.has(row.canonicalModel)) comparisons.set(row.canonicalModel, {
      canonicalModel: row.canonicalModel,
      displayName: row.displayName,
      provider: row.provider,
      official: row.official,
      offers: []
    });
    comparisons.get(row.canonicalModel).offers.push(offer);
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
  const best = offers.filter(offer => Number.isFinite(offer.dailyCost)).sort((a, b) => a.dailyCost - b.dailyCost)[0];
  return {
    modelCount: comparisons.length,
    offerCount: offers.length,
    stationCount: new Set(offers.map(offer => offer.stationId)).size,
    staleCount: offers.filter(offer => offer.stale).length,
    bestSaving: best?.diffPercent < 0 ? Math.abs(best.diffPercent) : 0
  };
}
