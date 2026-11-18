import { STATION_CATEGORIES, SYSTEM_BASE_PRICE_PER_1M } from "../shared/schema.js";
import { buildModelMatchIndex, matchModelWithOverrides } from "./matching.js";
import { STANDARD_PRICE_FIELDS } from "./price-fields.js";
import { canonicalKey, stripDecoration, stripVendorPrefix } from "./canonical.js";
import { compareImageQuote, imageCategoryOf, imageTierLabel, imageTierOf, mediaUnitLabel, mediaUnitRank, pickImageQuote, toPerImage } from "./image-billing.js";
import { mediaModeMatches, mediaSpecsOf, mediaTypeForPricing } from "./media.js";
import { effectiveRecharge } from "./recharge.js";


export function currencyToRmb(currency, rechargeRate = 1) {
  const code = String(currency ?? "").trim().toUpperCase();
  if (!code || ["UNKNOWN", "UNSPECIFIED", "NONE"].includes(code)) return null;
  if (["CNY", "RMB", "¥", "￥"].includes(code)) return 1;
  if (!["USD", "CREDITS", "POINTS"].includes(code)) return null;
  const rate = Number(rechargeRate);
  return Number.isFinite(rate) ? rate : 1;
}

export const MIX_KEYS = ["cacheRead", "input", "cacheWrite", "cacheWrite1h", "output", "image"];

// 混合单价统一口径：requests / images 不计入 token 总量，按次、按张成本只在月成本里体现。
export function tokenTotalOf(usage = {}) {
  return (Number(usage.input) || 0) + (Number(usage.cacheRead) || 0) + (Number(usage.cacheWrite) || 0) +
    (Number(usage.cacheWrite1h) || 0) + (Number(usage.output) || 0) +
    (Number(usage.imageInputTokens) || 0) + (Number(usage.imageOutputTokens ?? usage.imageTokens) || 0);
}

export function blendedUnitPrice(cost, usage = {}) {
  const total = tokenTotalOf(usage);
  if (!Number.isFinite(cost) || total <= 0) return null;
  return cost / total * 1_000_000;
}

export function blendedMixOf(usage = {}) {
  const total = tokenTotalOf(usage);
  if (total <= 0) return null;
  const mix = {};
  for (const key of MIX_KEYS) {
    const raw = key === "image"
      ? (Number(usage.imageInputTokens) || 0) + (Number(usage.imageOutputTokens ?? usage.imageTokens) || 0)
      : (Number(usage[key]) || 0);
    mix[key] = raw / total;
  }
  return mix;
}

export function mixLabel(mix) {
  if (!mix) return "";
  const parts = ["cacheRead", "input", "output"].map(key => Math.round((mix[key] || 0) * 100));
  return parts.every(value => value === 0) ? "" : parts.join(":");
}
function buildProxyPrices(item = {}, groupRatio = 1, factor = 1, basePrice = SYSTEM_BASE_PRICE_PER_1M) {
  const explicit = value => value === null || value === undefined || value === "" ? null : (Number.isFinite(Number(value)) ? Number(value) * factor : null);
  const billing = item.billing || {};
  const cacheWrite1h = explicit(item.cache_write_1h_price) ?? explicit(billing.cacheWrite1h);
  const fallbackInput = Number.isFinite(Number(item.model_ratio)) && Number(item.model_ratio) > 0 ? Number(item.model_ratio) * (Number(groupRatio) || 1) * basePrice * factor : null;
  const input = explicit(item.input_price) ?? fallbackInput;
  const completionRatio = Number(item.completion_ratio);
  const fallbackOutput = input === null || !Number.isFinite(completionRatio) || completionRatio <= 0 ? null : input * completionRatio;
  const imageInput = explicit(item.image_input_price) ?? explicit(billing.imageInput);
  return {
    input,
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

// 任意一档报价都算有价：核心价（input/output）、缓存、按次、图像都各算一档。
function hasAnyPrice(prices = {}) {
  return STANDARD_PRICE_FIELDS.some(field => Number.isFinite(prices[field]));
}

// 有「元/张」才走生图道。这类报价没有 token 维度，摊进按 token 的混合单价
// 分母里没有「张」，只会算出 ¥0；而且生图模型常常同时报文本 prompt 的 token 价，
// 只看「有没有 token 价」会把它们判成文本模型。
// 只报「元/1M 图输出 token」的报价仍留在 token 道，用量里的「图像输出」能覆盖它。
export function billingModeOf(prices = {}) {
  if (Number(prices.request) > 0) return "request";
  if (Number(prices.imagePrice) > 0) return "image";
  return "token";
}

export function getProxyPriceQuote(item = {}, groupRatio = 1, rechargeRate = 1, basePrice = SYSTEM_BASE_PRICE_PER_1M, priceCurrencyVerified = true, rechargeRateVerified = true) {
  const effectiveRechargeRate = rechargeRateVerified === true ? rechargeRate : 1;
  const factor = currencyToRmb(item.price_currency, effectiveRechargeRate);
  const unavailableReasons = [];
  if (factor === null || priceCurrencyVerified === false) unavailableReasons.push("currency_unverified");
  const sourceCurrency = String(item.price_currency ?? "").trim().toUpperCase() || "UNKNOWN";
  const quotedPrices = buildProxyPrices(item, groupRatio, 1, basePrice);
  if (!hasAnyPrice(quotedPrices)) unavailableReasons.push("price_missing");
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

// 落档：橘子站 11 档折扣随额度单调加深，多档拼凑从不比单档便宜，所以取「第一个 >= 消耗的档」即可。
// 额度永久有效，多买的额度下月继续用，因此实付按实际消耗折，而不是按档位面值折。
export function resolveRechargeTier(tiers = [], spend = 0) {
  const amount = Number(spend);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const usable = (Array.isArray(tiers) ? tiers : []).filter(tier =>
    Number.isFinite(Number(tier?.amount)) && Number(tier.amount) > 0 &&
    Number.isFinite(Number(tier?.discount)) && Number(tier.discount) > 0 && Number(tier.discount) <= 1);
  if (!usable.length) return null;
  const sorted = usable.map(tier => ({ amount: Number(tier.amount), discount: Number(tier.discount) }))
    .sort((left, right) => left.amount - right.amount);
  const tier = sorted.find(entry => entry.amount >= amount) || sorted[sorted.length - 1];
  return { amount: tier.amount, discount: tier.discount, faceValue: amount, payRmb: amount * tier.discount };
}

// costPrices 里已经乘过的充值汇率。档位折扣要从面值算，所以先按它还原。
// CNY 站在 currencyToRmb 里固定返回 1，不受 rechargeRate 影响。
function rechargeFactorOf(station, currency, snapshot) {
  const code = String(currency ?? "").trim().toUpperCase();
  if (!["USD", "CREDITS", "POINTS"].includes(code)) return 1;
  // 倍率以站点自报的现价为准，手填值只在没有采集值时顶上。
  const recharge = effectiveRecharge(station, snapshot);
  if (!recharge.verified) return 1;
  return recharge.rate > 0 ? recharge.rate : 1;
}

// 按次价格折成元/百万 token：分母是站点画像里的单次 token，不是全局平均。
// 分母缺失时返回 null，调用方据此显示「—」而不是编一个数出来。
export function requestUnitPriceOf(requestRmb, tokensPerRequest) {
  const price = Number(requestRmb);
  const tokens = Number(tokensPerRequest);
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(tokens) || tokens <= 0) return null;
  return price * 1_000_000 / tokens;
}

// 官方出图价优先取 /images/models/{id}/endpoints 的 output_image，那里才有单位。
// 拉不到时退回落 /models 的 image_output（美元/图输出 token），标成估算来源。
// pricing.image 是「美元/输入图」，不是出图价，这里不用。
function officialImageQuoteOf(model, references = {}) {
  if (!model) return null;
  const factor = Number(references.openRouterRechargeRate) || Number(references.exchangeRate) || 1;
  const quote = (references.imageQuotes || {})[model.id];
  if (quote && Number.isFinite(quote.value) && quote.value > 0) {
    return { unit: quote.unit, value: quote.value * factor, provider: quote.provider, variant: quote.variant, source: "endpoints" };
  }
  if (Number.isFinite(model.imageOutput) && model.imageOutput > 0) {
    return { unit: "token", value: model.imageOutput * factor, provider: "", variant: "", source: "models" };
  }
  return null;
}

// 生图行的整块结果：站内口径、官方口径、折合元/张、价差、月成本。
// 折算不出来就留 null，展示层显示「—」，不编数。
function resolveImagePricing({ costPrices, quotedPrices, model, references, modelId, imageCount, skipOfficial, rowTier }) {
  const official = skipOfficial ? null : officialImageQuoteOf(model, references);
  const station = pickImageQuote(costPrices ?? {}, official?.unit || "");
  const stationQuoted = pickImageQuote(quotedPrices ?? {}, official?.unit || "");
  const stationPerImage = toPerImage(station, modelId);
  // 站内规格来自自己的档位列（size_tier / tier_name），官方来自 endpoints 的 variant。
  // 取不到就 unstated，不猜；两边档位不同就当不了同口径，展示层要分开摆。
  const stationTier = imageTierOf(rowTier);
  const officialTier = imageTierOf(official?.variant || "");
  return {
    station,
    stationQuoted,
    official,
    stationTier,
    officialTier,
    stationPerImage,
    officialPerImage: toPerImage(official, modelId),
    compare: compareImageQuote(station, official, modelId, stationTier, officialTier),
    monthlyCost: stationPerImage && imageCount > 0 ? stationPerImage.perImage * imageCount : null
  };
}

// 一行自己的计价单位。元/张 和 元/1M 图token 分属两榜，所以单位是分榜键不是展示细节。
// 视频的 request_price 是每秒价，request_unit 已经标了 second，别和按次混一起。
function mediaUnitOf(billingMode, requestUnit, imageQuote) {
  if (billingMode === "image") return imageQuote?.unit || null;
  if (billingMode === "request") return String(requestUnit || "").trim().toLowerCase() === "second" ? "second" : "request";
  return null;
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
    if (value === null && !Object.hasOwn(target, field)) {
      target[field] = null;
      continue;
    }
    if (!Number.isFinite(value)) continue;
    target[field] = (target[field] ?? 0) + value * share;
  }
}
// 主候选：规范模型下常有 -0731、:batch 这类兄弟条目，合并成一行后只让主候选负责算差价，
// 避免同一条报价被多个候选各算一次。排序键依次是「名字与中转写法等价」「没带装饰后缀」「月成本更低」。
export function pickPrimaryOfficial(candidates = [], modelName = "") {
  const targetKey = canonicalKey(modelName);
  const targetBare = stripVendorPrefix(String(modelName || "")).toLowerCase().trim();
  const rankOf = candidate => {
    const name = String(candidate?.name || "");
    const bare = stripVendorPrefix(name).toLowerCase().trim();
    if (bare === targetBare) return 0;
    if (targetKey && canonicalKey(name) === targetKey) return 1;
    return stripDecoration(bare) === bare ? 2 : 3;
  };
  const costOf = candidate => (Number.isFinite(candidate?.monthlyCost) ? candidate.monthlyCost : Number.POSITIVE_INFINITY);
  return [...candidates].sort((left, right) => {
    const byRank = rankOf(left) - rankOf(right);
    if (byRank) return byRank;
    const leftCost = costOf(left);
    const rightCost = costOf(right);
    if (leftCost !== rightCost) return leftCost < rightCost ? -1 : 1;
    return String(left?.name || "").localeCompare(String(right?.name || ""));
  })[0] || null;
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
  // 按次报价摊成 token 单价全靠「单次 token」这个假设，降一档可信度。
  if (row.billingMode === "request") score -= 10;
  if (!row.officialName || !row.provider) score -= 15;
  return Math.max(0, Math.min(100, Math.round(score)));
}

// 按次报价的折算单价与盈亏平衡点。
// 盈亏平衡点 = 单次价格 × 1M / 同组按量报价里最低的混合单价，
// 意思是「一次跑多少 token 以内，这个按次模型才比按量便宜」。
// 同组没有按量报价时留 null，不拿别组的最低单价凑。
function resolveRequestPricing(comparisons) {
  for (const comparison of comparisons) {
    const tokenUnitPrices = comparison.offers
      .filter(offer => offer.billingMode !== "request" && !offer.pricingUnavailable)
      .map(offer => Number(offer.blendedUnitPrice))
      .filter(price => Number.isFinite(price) && price > 0);
    const referenceUnitPrice = tokenUnitPrices.length ? Math.min(...tokenUnitPrices) : null;
    for (const offer of comparison.offers) {
      if (offer.billingMode !== "request") continue;
      const requestRmb = Number(offer.costPrices?.request ?? offer.prices?.request);
      offer.requestUnitPrice = requestUnitPriceOf(requestRmb, offer.tokensPerRequest);
      offer.breakEvenTokens = referenceUnitPrice && Number.isFinite(requestRmb) && requestRmb > 0
        ? requestRmb * 1_000_000 / referenceUnitPrice
        : null;
    }
  }
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

export function addRecommendationStatus(comparisons, { evidenceThreshold = 60 } = {}) {
  const threshold = Math.max(0, Math.min(100, Number(evidenceThreshold) || 0));
  for (const comparison of comparisons) {
    const eligible = comparison.comparisonGroup === "public" ? [] : comparison.offers.filter(offer =>
      !offer.pricingUnavailable && (offer.billingMode ?? "token") === "token" && offer.matchRuleId === "exact" &&
      Number(offer.officialMonthlyCost) > 0 && Number(offer.confidenceScore) >= threshold);
    const recommended = eligible.reduce((current, offer) => !current || offer.monthlyCost < current.monthlyCost ? offer : current, null);
    for (const offer of comparison.offers) {
      // 生图行按元/张的价差分档；「按次」行的成本口径是摊出来的，不给档位。
      const mode = offer.billingMode ?? "token";
      offer.category = comparison.comparisonGroup === "public" ? "" :
        mode === "image" ? (Number(offer.imagePerImage) > 0 ? imageCategoryOf(offer.imageCompare) : "") :
          mode === "request" ? "" : classifyOffer(offer);
      offer.recommendationEligible = eligible.includes(offer);
      offer.recommended = offer === recommended;
      offer.recommendationLabel = comparison.comparisonGroup === "public" ? "" :
        !offer.recommendationEligible ? "需核验" :
          offer.recommended ? "推荐" : "可选";
    }
  }
  return comparisons;
}

export function buildComparisonRows({ stations = [], snapshots = [], references = {}, usage = {}, modelMatchOverrides = [], modelAliases = {}, llmMatches = {}, showUnmatched = true, evidenceThreshold = 60 } = {}) {
  const stationMap = new Map(stations.map(station => [station.id, station]));
  const referenceList = Array.isArray(references.models) ? references.models : [];
  const latestByStation = new Map();
  const matchingIndex = buildModelMatchIndex(referenceList, modelMatchOverrides, { modelAliases, llmMatches });
  for (const snapshot of snapshots) {
    const previous = latestByStation.get(snapshot.stationId);
    if (!previous || snapshot.collectedAt > previous.collectedAt) latestByStation.set(snapshot.stationId, snapshot);
  }
  const grouped = new Map();
  for (const snapshot of latestByStation.values()) {
    const station = stationMap.get(snapshot.stationId);
    if (!station || !snapshot.normalized?.data) continue;
    const stationCategory = normalizeStationCategory(station);
    const isPublic = stationCategory === "public";
    const comparisonGroup = isPublic ? "public" : "standard";
    // 按次模型的折算分母。站点画像优先；没配就回落到「本次估算用量的单次 token」。
    const billingProfile = station.billingProfile || {};
    const requestCount = Number(usage.requests) || 0;
    const fallbackTokensPerRequest = requestCount > 0 ? tokenTotalOf(usage) / requestCount : 0;
    const profileTokens = Number(billingProfile.tokensPerRequest) || 0;
    const tokensPerRequest = profileTokens > 0 ? profileTokens : fallbackTokensPerRequest;
    const tokensPerRequestEstimated = billingProfile.source !== "measured";
    const tierSharesByGroup = new Map();
    const tierItemsByGroup = new Map();
    const rawUnpricedModelKeys = snapshot.unpricedModels || snapshot.normalized?.unpricedModels;
    const unpricedModelKeys = Array.isArray(rawUnpricedModelKeys) ? rawUnpricedModelKeys.map(value => String(value)) : [];
    snapshot.normalized.data.forEach(item => {
      if (item.catalogOnly) return;
      if (!item.tier_name) return;
      // 按秒计价的视频档不参与上下文分档的流量加权。
      if (item.request_unit === "second") return;
      for (const group of offerGroups(item, snapshot.normalized)) {
        const key = tierKey(item, group);
        if (!tierItemsByGroup.has(key)) tierItemsByGroup.set(key, []);
        tierItemsByGroup.get(key).push(item);
      }
    });
    for (const [key, items] of tierItemsByGroup) tierSharesByGroup.set(key, new Map(items.map((item, index) => [item, getTierShares(items, usage.peakShare)[index]])));

    snapshot.normalized.data.forEach((item, itemIndex) => {
      if (item.catalogOnly) return;
      const matches = matchModelWithOverrides(item.model_name, referenceList, { stationId: station.id, index: matchingIndex });
      if (!matches.length && stationCategory !== "public" && !showUnmatched) return;
      const matchResults = matches.length ? matches : [{ match: null, rule: "未匹配", ruleId: "unmatched", confidence: 0 }];
      for (const group of offerGroups(item, snapshot.normalized)) {
        const rawGroupRatio = item.group_ratio ?? snapshot.normalized.group_ratio?.[group] ?? snapshot.normalized.group_ratio?.[item.enable_groups?.[0]];
        const groupRatio = Number.isFinite(Number(rawGroupRatio)) ? Number(rawGroupRatio) : 1;
        const hasUnpricedPriceGap = unpricedModelKeys.some(value => value.startsWith(`${group}:${item.model_name}:`));
        const priceCurrencyVerified = station.priceCurrencyVerified ?? snapshot.priceCurrencyVerified;
        const recharge = effectiveRecharge(station, snapshot);
        const priceQuote = getProxyPriceQuote(item, groupRatio, stationCategory === "public" ? 1 : recharge.rate, station.basePricePerMillion, priceCurrencyVerified, stationCategory === "public" ? true : recharge.verified);
        const quotedPrices = priceQuote.quotedPrices;
        const baseCostPrices = priceQuote.costPrices;
        // 视频按秒的档位是并列选项，各占 100%，不参与分档加权。
        const share = item.request_unit === "second" ? 1 : item.tier_name ? (tierSharesByGroup.get(tierKey(item, group))?.get(item) ?? 0) : 1;
        // 同一条报价的多个官方候选合并成一行：中转侧的数值只累加一次，官方侧按候选分桶。
        const resultsByCanonical = new Map();
        for (const result of matchResults) {
          const key = result.canonical?.name || result.match?.name || item.model_name;
          if (!resultsByCanonical.has(key)) resultsByCanonical.set(key, []);
          resultsByCanonical.get(key).push(result);
        }
        for (const [canonicalModel, results] of resultsByCanonical) {
          const primaryResult = results[0];
          let costPrices = baseCostPrices;
          const billingMode = billingModeOf(baseCostPrices ?? quotedPrices);
          const mediaType = mediaTypeForPricing(item, { targetField: billingMode });
          const rowMediaKey = mediaType || (billingMode === "image" ? "image" : "text");
          // 按秒计价的视频档（分辨率）是各自独立的报价，不能像上下文分档那样加权合并。
          const rowTierKey = item.request_unit === "second" ? `second:${item.tier_name ?? ""}` : item.tier_name ? "tier" : `item:${itemIndex}`;
          const rowKey = [station.id, item.model_name, canonicalModel, group, rowMediaKey, rowTierKey].join("\u0000");
          const row = grouped.get(rowKey) || {
            canonicalModel,
            displayName: primaryResult.match?.display_name || primaryResult.match?.name || item.model_display_name || item.model_name,
            // 出图规格：映射文档写 size_tier，老站点写 tier_name，两个都认。
            sizeTier: item.size_tier || item.tier_name || null,
            provider: primaryResult.match?.provider || "未匹配",
            official: null,
            officialCandidates: new Map(),
            offers: [],
            proxyPrices: {},
            costPrices: {},
            officialCurrency: "CREDITS",
            sourceCurrency: null,
            quotedInSourceCurrency: false,
            tierNames: new Set(),
            cacheReadEstimated: false,
            pricingUnavailable: false,
            pricingUnavailableReasons: new Set(),
            cacheWriteEstimated: false,
            estimatedFields: new Set(),
            monthlyCost: 0,
            stationId: station.id,
            stationName: station.name,
            stationCategory,
            comparisonGroup,
            modelName: item.model_name,
            displayNameOverride: item.model_display_name || item.model_name,
            groupName: group,
            groupRatio,
            billingMode,
            mediaType: mediaType || (billingMode === "image" ? "image" : "text"),
            requestUnit: item.request_unit || "",
            mediaSpecs: mediaSpecsOf(item),
            tokensPerRequest,
            tokensPerRequestEstimated,
            matchRule: primaryResult.rule,
            matchRuleId: primaryResult.ruleId,
            matchConfidence: primaryResult.confidence,
            matchCandidateCount: results.length,
            evidence: item.evidence || "estimated",
            incomplete: Boolean(snapshot.incomplete || snapshot.status === "partial" || snapshot.normalized?.incomplete),
            unsupportedBillingModes: snapshot.unsupportedBillingModes || snapshot.normalized?.unsupportedBillingModes || [],
            degradedReasons: snapshot.degradedReasons || snapshot.rawMeta?.degradedReasons || snapshot.normalized?.degradedReasons || [],
            invalidPricingValues: snapshot.invalidPricingValues || snapshot.normalized?.invalidPricingValues || [],
            unpricedModels: snapshot.unpricedModels || snapshot.normalized?.unpricedModels || [],
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
          if (priceQuote.pricingUnavailable || (!isPublic && !costPrices)) row.pricingUnavailable = true;
          addWeighted(row.proxyPrices, quotedPrices, share);
          if (!isPublic && costPrices) addWeighted(row.costPrices, costPrices, share);
          for (const result of results) {
            const official = result.match;
            if (!official) continue;
            const candidateKey = `${official.provider || ""}\u0000${official.name || ""}`;
            let candidate = row.officialCandidates.get(candidateKey);
            if (!candidate) {
              candidate = {
                name: official.name || "",
                provider: official.provider || "未匹配",
                displayName: official.display_name || official.name || "",
                model: official,
                monthlyCost: 0,
                quotedPrices: null,
                prices: null
              };
              row.officialCandidates.set(candidateKey, candidate);
            }
            const officialQuotedPrices = stationCategory === "public" ? null : referencePrices(official, 1);
            const officialPrices = stationCategory === "public" ? null : referencePrices(official, references.openRouterRechargeRate || references.exchangeRate || 1);
            if (officialQuotedPrices) {
              candidate.quotedPrices ||= {};
              addWeighted(candidate.quotedPrices, officialQuotedPrices, share);
            }
            if (officialPrices) {
              candidate.prices ||= {};
              addWeighted(candidate.prices, officialPrices, share);
              candidate.monthlyCost += workloadCost(officialPrices, usage) * share;
            }
          }
          if (quotedPrices.cacheRead === null) {
            row.cacheReadEstimated = true;
            row.estimatedFields.add("cacheRead");
          }
          if (quotedPrices.cacheWrite === null) {
            row.cacheWriteEstimated = true;
            row.estimatedFields.add("cacheWrite");
          }
          if (!isPublic && costPrices) row.monthlyCost += workloadCost(costPrices, usage) * share;
          // 按秒的档位是并列的单条报价，不带「占多少流量」的百分比后缀。
          if (item.tier_name) row.tierNames.add(item.request_unit === "second" ? item.tier_name : `${item.tier_name} ${Math.round(share * 100)}%`);
          grouped.set(rowKey, row);
        }
      }
    });
  }

  const comparisons = new Map();
  for (const row of grouped.values()) {
    const quotedUnit = hasAnyPrice(row.proxyPrices) ? row.proxyPrices : null;
    const costUnit = hasAnyPrice(row.costPrices) ? row.costPrices : null;
    const candidateList = [...row.officialCandidates.values()];
    const primary = pickPrimaryOfficial(candidateList, row.modelName);
    if (primary) {
      row.official = primary.model;
      row.provider = primary.provider;
      if (primary.displayName) row.displayName = primary.displayName;
    }
    const officialQuotedUnit = primary?.quotedPrices || null;
    const officialUnit = primary?.prices || null;
    const orderedCandidates = primary
      ? [primary, ...candidateList.filter(candidate => candidate !== primary).sort((left, right) => left.monthlyCost - right.monthlyCost)]
      : candidateList;
    const officialCandidates = orderedCandidates.map(candidate => ({
      name: candidate.name,
      provider: candidate.provider,
      monthlyCost: Number.isFinite(candidate.monthlyCost) ? candidate.monthlyCost : null,
      diffPercent: row.stationCategory !== "public" && !row.pricingUnavailable && Number.isFinite(row.monthlyCost) && candidate.monthlyCost > 0
        ? ((row.monthlyCost - candidate.monthlyCost) / candidate.monthlyCost) * 100
        : null,
      officialBlendedUnitPrice: row.stationCategory === "public" || !Number.isFinite(candidate.monthlyCost)
        ? null
        : blendedUnitPrice(candidate.monthlyCost, usage)
    }));
    // 实付 = 月消耗面值 × 落档折扣。额度永久有效，所以按实际消耗折，不按档位面值折。
    // costPrices 对 USD/CREDITS 站已经乘过 rechargeRate，档位折扣必须作用在面值上，否则重复打折。
    const rowStation = stationMap.get(row.stationId);
    const rechargeFactor = rechargeFactorOf(rowStation, row.sourceCurrency, latestByStation.get(row.stationId));
    const faceMonthlyCost = rechargeFactor > 0 ? row.monthlyCost / rechargeFactor : row.monthlyCost;
    const rechargePlan = row.stationCategory === "public" || row.pricingUnavailable
      ? null
      : resolveRechargeTier(rowStation?.rechargeTiers, faceMonthlyCost);
    // payRmb 是面值币种里的钱，换回人民币要乘回 rechargeFactor（CNY 站为 1，不受影响）。
    const monthlyCostPaid = row.stationCategory === "public" || row.pricingUnavailable
      ? null
      : (rechargePlan ? rechargePlan.payRmb * rechargeFactor : row.monthlyCost);
    // 生图道的四种计费口径（张 / 图 token / 像素 / 次）统一折到元/张再比，折算不出来就留空。
    const imageCount = Number(usage.images) || 0;
    const imagePricing = row.billingMode === "image"
      ? resolveImagePricing({
        costPrices: row.stationCategory === "public" || row.pricingUnavailable ? null : costUnit,
        quotedPrices: quotedUnit,
        model: row.official,
        references,
        modelId: row.official?.id || row.modelName,
        imageCount,
        rowTier: row.sizeTier,
        skipOfficial: row.stationCategory === "public"
      })
      : null;
    const imageMonthlyCost = imagePricing?.monthlyCost ?? null;
    const imageRechargePlan = imageMonthlyCost === null || row.stationCategory === "public"
      ? null
      : resolveRechargeTier(rowStation?.rechargeTiers, rechargeFactor > 0 ? imageMonthlyCost / rechargeFactor : imageMonthlyCost);
    const imageMonthlyCostPaid = imageMonthlyCost === null ? null : (imageRechargePlan ? imageRechargePlan.payRmb * rechargeFactor : imageMonthlyCost);
    const offer = {
      stationId: row.stationId,
      stationName: row.stationName,
      stationCategory: row.stationCategory,
      modelName: row.modelName,
      displayName: row.displayNameOverride,
      provider: row.provider,
      officialName: row.official?.name || "",
      primaryOfficialName: row.official?.name || "",
      officialCandidateCount: orderedCandidates.length,
      officialCandidates,
      matchRule: row.matchRule,
      matchRuleId: row.matchRuleId,
      matchConfidence: row.matchConfidence,
      matchCandidateCount: orderedCandidates.length,
      groupName: row.groupName,
      groupRatio: row.groupRatio,
      // 生图行按原始计价单位 + 折合元/张展示，不折成 token 单价，也不参与按 token 的月成本排名。
      imageQuote: imagePricing?.station ?? null,
      imageQuoteQuoted: imagePricing?.stationQuoted ?? null,
      imageOfficialQuote: imagePricing?.official ?? null,
      imagePerImage: imagePricing?.stationPerImage?.perImage ?? null,
      imagePerImageAssumption: imagePricing?.stationPerImage?.assumption ?? "",
      imageOfficialPerImage: imagePricing?.officialPerImage?.perImage ?? null,
      imageOfficialPerImageAssumption: imagePricing?.officialPerImage?.assumption ?? "",
      imageCompare: imagePricing?.compare ?? null,
      imageCount,
      imageMonthlyCost,
      imageMonthlyCostPaid,
      imageRechargePlan,
      billingMode: row.billingMode,
      mediaType: row.mediaType,
      requestUnit: row.requestUnit,
      mediaSpecs: row.mediaSpecs,
      // 分榜键。同一行只属于一个榜，跨榜不给百分比。
      mediaUnit: mediaUnitOf(row.billingMode, row.requestUnit, imagePricing?.station),
      mediaUnitText: mediaUnitLabel(mediaUnitOf(row.billingMode, row.requestUnit, imagePricing?.station), ""),
      // 原始单位价，不再折算成元/张。折现值留在 imagePerImage，只当注释。
      mediaUnitPrice: row.billingMode === "image"
        ? (imagePricing?.station?.value ?? null)
        : row.billingMode === "request"
          ? (costUnit?.request ?? quotedUnit?.request ?? null)
          : null,
      // 规格档。站内一律 unstated，官方的来自 endpoints 的 variant。
      imageSizeTier: imagePricing?.stationTier?.size ?? null,
      imageQualityTier: imagePricing?.stationTier?.quality ?? null,
      imageTierText: imagePricing ? imageTierLabel(imagePricing.stationTier) : null,
      officialImageTierText: imagePricing?.officialTier ? imageTierLabel(imagePricing.officialTier) : null,
      imageTierMatches: imagePricing ? imageTierLabel(imagePricing.stationTier) === imageTierLabel(imagePricing.officialTier) : null,
      tokensPerRequest: row.tokensPerRequest,
      tokensPerRequestEstimated: row.tokensPerRequestEstimated,
      tierName: [...row.tierNames].join(" / ") || "标准",
      quotedPrices: quotedUnit,
      prices: quotedUnit,
      costPrices: row.stationCategory === "public" || row.pricingUnavailable ? null : costUnit,
      sourceCurrency: row.sourceCurrency || "UNKNOWN",
      quotedInSourceCurrency: row.quotedInSourceCurrency,
      officialPrices: officialUnit,
      officialQuotedPrices: officialQuotedUnit,
      officialCurrency: row.officialCurrency,
      monthlyCost: row.stationCategory === "public" || row.pricingUnavailable ? null : row.monthlyCost,
      monthlyCostPaid,
      rechargePlan,
      costCurrency: row.stationCategory === "public" ? row.sourceCurrency : null,
      officialMonthlyCost: row.stationCategory === "public" || !primary ? null : primary.monthlyCost,
      // 按张计价的价差要按元/张比，跟按 token 的月成本不是一回事，这里不填。
      diffPercent: row.stationCategory !== "public" && !row.pricingUnavailable && row.billingMode !== "image" && primary && Number.isFinite(row.monthlyCost) && primary.monthlyCost > 0 ? ((row.monthlyCost - primary.monthlyCost) / primary.monthlyCost) * 100 : null,
      // 按次成本摊进 token 分母会污染口径，折算单价改用 requestUnitPrice（见下方补算）。
      blendedUnitPrice: row.stationCategory === "public" || row.pricingUnavailable || row.billingMode !== "token" ? null : blendedUnitPrice(row.monthlyCost, usage),
      blendedMix: row.stationCategory === "public" || row.pricingUnavailable || row.billingMode !== "token" ? null : blendedMixOf(usage),
      officialBlendedUnitPrice: row.stationCategory === "public" || !primary ? null : blendedUnitPrice(primary.monthlyCost, usage),
      evidence: row.evidence,
      pricingUnavailable: row.pricingUnavailable,
      pricingUnavailableReasons: [...row.pricingUnavailableReasons].sort(),
      incomplete: row.incomplete,
      unsupportedBillingModes: row.unsupportedBillingModes,
      degradedReasons: row.degradedReasons || [],
      invalidPricingValues: row.invalidPricingValues,
      unpricedModels: row.unpricedModels,
      cacheReadEstimated: row.cacheReadEstimated,
      cacheWriteEstimated: row.cacheWriteEstimated,
      estimatedFields: [...row.estimatedFields, ...(row.billingMode === "request" ? ["requestBilled"] : []), ...(row.billingMode === "image" ? ["imageBilled"] : [])].sort(),
      requestUnitPrice: null,
      breakEvenTokens: null,
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
  resolveRequestPricing(result);
  addRecommendationStatus(result, { evidenceThreshold });
  return result;
}

export function filterComparisonsByMode(comparisons = [], mode = "paid") {
  const comparisonGroup = mode === "public" ? "public" : "standard";
  return comparisons.filter(comparison => comparison.comparisonGroup === comparisonGroup);
}


export function filterComparisonsByMediaMode(comparisons = [], mode = "text") {
  const currentMode = ["text", "image", "video"].includes(mode) ? mode : "text";
  return comparisons
    .map(comparison => ({
      ...comparison,
      offers: (comparison.offers || []).filter(offer => mediaModeMatches(offer, currentMode))
    }))
    .filter(comparison => comparison.offers.length);
}
export function flattenComparisonRows(comparisons) {
  return comparisons.flatMap(comparison => comparison.offers.map(offer => ({ ...offer, canonicalModel: comparison.canonicalModel })));
}
// 站点指数：本站混合单价 / 官方混合单价的逐模型中位数。样本少于 3 的站不输出。
export function buildStationIndexes(comparisons = []) {
  const ratiosByStation = new Map();
  for (const offer of flattenComparisonRows(comparisons)) {
    if (offer.stationCategory === "public" || offer.pricingUnavailable || offer.incomplete) continue;
    const ratio = Number(offer.blendedUnitPrice) / Number(offer.officialBlendedUnitPrice);
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    if (!ratiosByStation.has(offer.stationId)) ratiosByStation.set(offer.stationId, { stationName: offer.stationName, ratios: [] });
    ratiosByStation.get(offer.stationId).ratios.push(ratio);
  }
  const rows = [];
  for (const [stationId, entry] of ratiosByStation) {
    if (entry.ratios.length < 3) continue;
    const sorted = [...entry.ratios].sort((a, b) => a - b);
    const pick = fraction => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))))];
    rows.push({
      stationId,
      stationName: entry.stationName,
      median: pick(0.5),
      p25: pick(0.25),
      p75: pick(0.75),
      sampleSize: sorted.length
    });
  }
  return rows.sort((a, b) => a.median - b.median);
}

export function summarizeComparisons(comparisons) {
  const offers = flattenComparisonRows(comparisons);
  const best = offers.filter(offer => Number.isFinite(offer.monthlyCost)).sort((a, b) => a.monthlyCost - b.monthlyCost)[0];
  return {
    modelCount: new Set(comparisons.map(comparison => comparison.canonicalModel)).size,
    offerCount: offers.length,
    stationCount: new Set(offers.map(offer => offer.stationId)).size,
    bestSaving: comparisons.some(comparison => comparison.comparisonGroup === "public") ? 0 : best?.diffPercent < 0 ? Math.abs(best.diffPercent) : 0
  };
}
