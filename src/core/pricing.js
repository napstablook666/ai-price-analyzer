import { STATION_CATEGORIES, SYSTEM_BASE_PRICE_PER_1M } from "../shared/schema.js";
import { buildModelMatchIndex, matchModelWithOverrides } from "./matching.js";
import { STANDARD_PRICE_FIELDS } from "./price-fields.js";
import { canonicalKey, stripDecoration, stripVendorPrefix } from "./canonical.js";
import { mediaTypeForPricing } from "./media.js";
import { effectiveRecharge } from "./recharge.js";
import { rechargePaymentRate, representativeRechargePayment } from "../shared/recharge-payments.js";


export function currencyToRmb(currency, rechargeRate = 1) {
  const code = String(currency ?? "").trim().toUpperCase();
  if (!code || ["UNKNOWN", "UNSPECIFIED", "NONE"].includes(code)) return null;
  if (["CNY", "RMB", "¥", "￥"].includes(code)) return 1;
  if (!["USD", "CREDITS", "POINTS"].includes(code)) return null;
  const rate = Number(rechargeRate);
  return Number.isFinite(rate) ? rate : 1;
}

export const MIX_KEYS = ["cacheRead", "input", "cacheWrite", "cacheWrite1h", "output"];

// 混合单价统一口径：requests 不计入 token 总量，按次成本只在月成本里体现。
export function tokenTotalOf(usage = {}) {
  return (Number(usage.input) || 0) + (Number(usage.cacheRead) || 0) + (Number(usage.cacheWrite) || 0) +
    (Number(usage.cacheWrite1h) || 0) + (Number(usage.output) || 0);
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
  for (const key of MIX_KEYS) mix[key] = (Number(usage[key]) || 0) / total;
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
// 只用来判定「这条不是文本」：比价入口判到 image 直接丢，报价行上只剩 token 和 request 两种。
// 有「元/张」就算生图道。生图模型常常同时报文本 prompt 的 token 价，只看有没有 token 价会把它判成文本。
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
    (Number(usage.requests) || 0) * (Number.isFinite(prices.request) ? prices.request : 0);
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

function offerGroups(item, normalized) {
  const values = Array.isArray(item.enable_groups) && item.enable_groups.length
    ? item.enable_groups
    : [item.proxy_group_name || "Default"];
  return [...new Set(values.map(value => item.proxy_group_name || value))];
}

function addPrices(target, source) {
  for (const field of STANDARD_PRICE_FIELDS) {
    const value = source[field];
    if (value === null && !Object.hasOwn(target, field)) {
      target[field] = null;
      continue;
    }
    if (!Number.isFinite(value)) continue;
    target[field] = (target[field] ?? 0) + value;
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
    let recommended = eligible.reduce((current, offer) => !current || offer.monthlyCost < current.monthlyCost ? offer : current, null);
    for (const offer of comparison.offers) {
      // 「按次」行的成本口径是摊出来的，不给档位。
      const mode = offer.billingMode ?? "token";
      offer.category = comparison.comparisonGroup === "public" ? "" : mode === "request" ? "" : classifyOffer(offer);
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
    const rawUnpricedModelKeys = snapshot.unpricedModels || snapshot.normalized?.unpricedModels;
    const unpricedModelKeys = Array.isArray(rawUnpricedModelKeys) ? rawUnpricedModelKeys.map(value => String(value)) : [];

    snapshot.normalized.data.forEach((item, itemIndex) => {
      if (item.catalogOnly) return;
      // 按用量分档（上下文长度区间）只留命中当前单次请求长度的那一档：同一模型在表里只出一行，
      // 单价与月成本都按这一档算。长度取站点画像的 tokensPerRequest，没配就用估算用量的均值。
      // 时段档、按秒档不在这里过滤，它们各自成行（见下面 rowTierKey）。
      if (item.min_tokens != null || item.max_tokens != null) {
        const length = tokensPerRequest;
        const lower = item.min_tokens == null ? 0 : Number(item.min_tokens);
        const upper = item.max_tokens == null ? Infinity : Number(item.max_tokens);
        // 没有用量数据时保留最低档，保证每个模型仍有代表价，不会整行消失。
        const missed = length > 0 ? length < lower || length >= upper : lower > 0;
        if (missed) return;
      }
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
        // 同一条报价的多个官方候选合并成一行：中转侧的数值只累加一次，官方侧按候选分桶。
        const resultsByCanonical = new Map();
        for (const result of matchResults) {
          const key = result.canonical?.name || result.match?.name || item.model_name;
          if (!resultsByCanonical.has(key)) resultsByCanonical.set(key, []);
          resultsByCanonical.get(key).push(result);
        }
        for (const [canonicalModel, results] of resultsByCanonical) {
          const primaryResult = results[0];
          const billingMode = billingModeOf(baseCostPrices ?? quotedPrices);
          // 只比文本模型：生图、视频（以及插件标出的其他媒体类型）整条不识别，不进比价表。
          // media_type / 计费单位判不出来时，再按「有元/张就是生图」兜一层。
          if (billingMode === "image" || mediaTypeForPricing(item, { targetField: billingMode })) continue;
          let costPrices = baseCostPrices;
          // 时段档各自独立成行，每个档一行，不做加权合并。
          // 上下文长度分档不在这里分行：入口处已按单次请求长度选中一档，同一模型只出一行。
          const rowTierKey = item.tier_name ? `tier:${item.tier_name}` : `item:${itemIndex}`;
          const rowKey = [station.id, item.model_name, canonicalModel, group, rowTierKey].join("\u0000");
          const row = grouped.get(rowKey) || {
            canonicalModel,
            displayName: primaryResult.match?.display_name || primaryResult.match?.name || item.model_display_name || item.model_name,
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
            requestUnit: item.request_unit || "",
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
          addPrices(row.proxyPrices, quotedPrices);
          if (!isPublic && costPrices) addPrices(row.costPrices, costPrices);
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
              addPrices(candidate.quotedPrices, officialQuotedPrices);
            }
            if (officialPrices) {
              candidate.prices ||= {};
              addPrices(candidate.prices, officialPrices);
              candidate.monthlyCost += workloadCost(officialPrices, usage);
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
          if (!isPublic && costPrices) row.monthlyCost += workloadCost(costPrices, usage);
          if (item.tier_name) row.tierNames.add(item.tier_name);
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
    // 渠道实付优先：有收银台证据就按「实付人民币 / 面值额度」折，覆盖档位推算。
    // 没有证据才走「面值 × 落档折扣 × rechargeFactor」。两者都不成立时退回原价。
    const paidPayment = row.stationCategory === "public" || row.pricingUnavailable
      ? null
      : representativeRechargePayment(rowStation?.rechargePayments, faceMonthlyCost);
    const paidRate = rechargePaymentRate(paidPayment);
    let monthlyCostPaid;
    let monthlyCostPaidSource;
    if (row.stationCategory === "public" || row.pricingUnavailable) {
      monthlyCostPaid = null;
      monthlyCostPaidSource = null;
    } else if (paidRate !== null) {
      monthlyCostPaid = faceMonthlyCost * paidRate;
      monthlyCostPaidSource = "counter";
    } else if (rechargePlan) {
      monthlyCostPaid = rechargePlan.payRmb * rechargeFactor;
      monthlyCostPaidSource = "derived";
    } else {
      monthlyCostPaid = row.monthlyCost;
      monthlyCostPaidSource = "derived";
    }
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
      billingMode: row.billingMode,
      requestUnit: row.requestUnit,
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
      monthlyCostPaidSource,
      rechargePlan,
      ...(paidPayment ? { rechargePayment: paidPayment } : {}),
      costCurrency: row.stationCategory === "public" ? row.sourceCurrency : null,
      officialMonthlyCost: row.stationCategory === "public" || !primary ? null : primary.monthlyCost,
      diffPercent: row.stationCategory !== "public" && !row.pricingUnavailable && primary && Number.isFinite(row.monthlyCost) && primary.monthlyCost > 0 ? ((row.monthlyCost - primary.monthlyCost) / primary.monthlyCost) * 100 : null,
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
      estimatedFields: [...row.estimatedFields, ...(row.billingMode === "request" ? ["requestBilled"] : [])].sort(),
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
