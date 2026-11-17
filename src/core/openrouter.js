import { BOC_EXCHANGE_URL, DEFAULT_EXCHANGE_RATE, OPENROUTER_IMAGES_URL, OPENROUTER_URL } from "../shared/schema.js";
import { IMAGE_UNITS } from "./image-billing.js";

function pricePerMillion(value) {
  if (value === null || value === undefined || value === "") return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price * 1_000_000 : null;
}

function pricePerRequest(value) {
  if (value === null || value === undefined || value === "") return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

function aliasesOf(id, name, canonicalSlug) {
  const shortId = id.includes("/") ? id.split("/").slice(1).join("/") : id;
  return [...new Set([id, shortId, name, canonicalSlug].filter(Boolean).map(String).map(value => value.toLowerCase()))];
}

export function parseOpenRouterData(json) {
  if (!json || !Array.isArray(json.data)) return [];
  return json.data.flatMap(model => {
    const pricing = model.pricing || {};
    const input = pricePerMillion(pricing.prompt);
    const output = pricePerMillion(pricing.completion);
    const imageOutput = pricePerMillion(pricing.image_output ?? pricing.image_token);
    const imagePrice = pricePerRequest(pricing.image);
    const request = pricePerRequest(pricing.request);
    if (input === null && output === null && imageOutput === null && imagePrice === null && request === null) return [];
    const id = String(model.id || "").trim();
    const modalities = model.architecture?.output_modalities;
    return [{
      id: id || model.name,
      name: id || model.name,
      display_name: model.name || id,
      aliases: aliasesOf(id, model.name, model.canonical_slug),
      provider: id.split("/")[0] || "OpenRouter",
      input: input ?? 0,
      output: output ?? 0,
      cacheRead: pricePerMillion(pricing.input_cache_read),
      cacheWrite: pricePerMillion(pricing.input_cache_write),
      request,
      imageOutput,
      imagePrice,
      isImageModel: Array.isArray(modalities) && modalities.includes("image"),
      price_currency: "USD"
    }];
  });
}

// 生图专用模型列表：58 个模型只出现在 /images/models，/models 里没有。
// 这些条目的价格在 endpoint 上，模型本身只提供身份信息。
export function parseImageModels(json) {
  if (!json || !Array.isArray(json.data)) return [];
  return json.data.flatMap(model => {
    const id = String(model.id || "").trim();
    if (!id) return [];
    return [{
      id,
      name: id,
      display_name: model.name || id,
      aliases: aliasesOf(id, model.name, model.canonical_slug),
      provider: id.split("/")[0] || "OpenRouter",
      input: 0,
      output: 0,
      cacheRead: null,
      cacheWrite: null,
      request: null,
      imageOutput: null,
      imagePrice: null,
      isImageModel: true,
      imageOnly: true,
      price_currency: "USD"
    }];
  });
}

// 只认 output_image。输入侧的 input_text / input_image 不参与出图比价。
export function parseImageEndpoints(json) {
  const modelId = String(json?.id || "").trim();
  const rows = [];
  for (const endpoint of Array.isArray(json?.endpoints) ? json.endpoints : []) {
    const provider = String(endpoint?.provider_name || endpoint?.provider_slug || "").trim();
    for (const entry of Array.isArray(endpoint?.pricing) ? endpoint.pricing : []) {
      if (entry?.billable !== "output_image") continue;
      const unit = String(entry.unit || "").trim().toLowerCase();
      const costUsd = Number(entry.cost_usd);
      if (!IMAGE_UNITS.includes(unit) || !Number.isFinite(costUsd) || costUsd <= 0) continue;
      // token 口径换算成「每 1M token」，和站点的 image_output_price 对齐；
      // 其余口径的 cost_usd 本身就是每 1 张 / 每 1 MP / 每 1 次。
      const valueUsd = unit === "token" ? costUsd * 1_000_000 : costUsd;
      rows.push({ modelId, provider, unit, valueUsd, variant: String(entry.variant || "").trim().toLowerCase() });
    }
  }
  return rows;
}

// 主档 = 无 variant 或 1k；同档多个 provider 取最低价。
// 只有 768 / 2k / 4k 这类档位的模型，退而取全表最低价当主档。
const PRIMARY_VARIANTS = ["", "1k"];

export function aggregateImageQuotes(rows = []) {
  const byModel = new Map();
  for (const row of rows) {
    if (!row.modelId) continue;
    if (!byModel.has(row.modelId)) byModel.set(row.modelId, new Map());
    const variants = byModel.get(row.modelId);
    const current = variants.get(row.variant);
    if (!current || row.valueUsd < current.valueUsd) variants.set(row.variant, row);
  }
  const quotes = {};
  for (const [modelId, variants] of byModel) {
    const cheapest = [...variants.values()].sort((left, right) => left.valueUsd - right.valueUsd)[0];
    const primaryKey = PRIMARY_VARIANTS.find(key => variants.has(key)) ?? cheapest.variant;
    const primary = variants.get(primaryKey);
    const tiers = {};
    for (const [key, row] of variants) {
      if (key === primaryKey) continue;
      tiers[key] = { unit: row.unit, value: row.valueUsd, provider: row.provider };
    }
    quotes[modelId] = { unit: primary.unit, value: primary.valueUsd, provider: primary.provider, variant: primaryKey, tiers };
  }
  return quotes;
}

// 68 个 endpoint 请求不能每次刷新都发，按 24h TTL 复用上一次的结果。
const IMAGE_QUOTE_TTL = 24 * 60 * 60 * 1000;
const IMAGE_FETCH_CONCURRENCY = 6;

async function runWithConcurrency(items, limit, worker) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  }));
}

export async function fetchImageReferences({ fetchImpl = fetch, signal, now = Date.now(), cache = {} } = {}) {
  const cachedQuotes = cache.imageQuotes && typeof cache.imageQuotes === "object" ? cache.imageQuotes : null;
  const cachedModels = Array.isArray(cache.imageModels) ? cache.imageModels : [];
  const fetchedAt = Number(cache.imageQuotesFetchedAt) || 0;
  if (cachedQuotes && cachedModels.length && now - fetchedAt < IMAGE_QUOTE_TTL) {
    return { imageQuotes: cachedQuotes, imageModels: cachedModels, imageQuotesFetchedAt: fetchedAt, warning: "" };
  }
  const listResponse = await fetchImpl(OPENROUTER_IMAGES_URL, { signal });
  if (!listResponse.ok) throw new Error(`OpenRouter images ${listResponse.status}`);
  const imageModels = parseImageModels(await listResponse.json());
  const rows = [];
  let failed = 0;
  await runWithConcurrency(imageModels.map(model => model.id), IMAGE_FETCH_CONCURRENCY, async id => {
    const response = await fetchImpl(`${OPENROUTER_IMAGES_URL}/${id}/endpoints`, { signal });
    if (!response.ok) {
      failed += 1;
      return;
    }
    rows.push(...parseImageEndpoints(await response.json()));
  });
  return {
    imageQuotes: aggregateImageQuotes(rows),
    imageModels,
    imageQuotesFetchedAt: now,
    warning: failed ? `OpenRouter 图价 ${failed} 个模型不可用` : ""
  };
}

// 图价模型里 58 个不在 /models 中，补进去才能参与匹配。已有条目以 /models 为准。
function mergeImageModels(models, imageModels) {
  if (!imageModels.length) return models;
  const known = new Set(models.map(model => model.id));
  const missing = imageModels.filter(model => !known.has(model.id));
  return missing.length ? [...models, ...missing] : models;
}

function htmlText(value) {
  return String(value || "").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").trim();
}

export function parseOfficialExchangeRate(html) {
  if (typeof html !== "string") throw new Error("汇率响应不是文本");
  const rows = [...html.matchAll(/<tr[^>]*>[\s\S]*?<\/tr>/gi)].map(match => match[0]);
  const row = rows.find(candidate => /美元|USD/i.test(htmlText(candidate)));
  if (!row) throw new Error("中国银行美元汇率数据不可用");
  const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(match => htmlText(match[1]));
  const ratePerHundred = Number((cells[5] || cells.find(cell => /^\d[\d,]*\.?\d*$/.test(cell)) || "").replace(/,/g, ""));
  if (!Number.isFinite(ratePerHundred) || ratePerHundred <= 0) throw new Error("中国银行美元汇率数据不可用");
  return ratePerHundred / 100;
}

export async function fetchReferences({ fetchImpl = fetch, signal, now = Date.now(), cache = {} } = {}) {
  const result = {
    models: cache.models || [],
    exchangeRate: Number(cache.exchangeRate) || DEFAULT_EXCHANGE_RATE,
    fetchedAt: cache.fetchedAt || 0,
    imageQuotes: cache.imageQuotes || {},
    imageModels: cache.imageModels || [],
    imageQuotesFetchedAt: cache.imageQuotesFetchedAt || 0,
    warnings: []
  };
  const [modelsResult, rateResult, imageResult] = await Promise.allSettled([
    fetchImpl(OPENROUTER_URL, { signal }).then(response => {
      if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
      return response.json();
    }).then(parseOpenRouterData),
    fetchImpl(`${BOC_EXCHANGE_URL}?_=${now}`, { signal }).then(response => {
      if (!response.ok) throw new Error(`BOC ${response.status}`);
      return response.text();
    }).then(parseOfficialExchangeRate),
    fetchImageReferences({ fetchImpl, signal, now, cache })
  ]);
  if (modelsResult.status === "fulfilled" && modelsResult.value.length) result.models = modelsResult.value;
  else result.warnings.push(modelsResult.reason?.message || "OpenRouter 数据为空");
  if (rateResult.status === "fulfilled") result.exchangeRate = rateResult.value;
  else result.warnings.push(rateResult.reason?.message || "汇率不可用");
  if (imageResult.status === "fulfilled") {
    result.imageQuotes = imageResult.value.imageQuotes;
    result.imageModels = imageResult.value.imageModels;
    result.imageQuotesFetchedAt = imageResult.value.imageQuotesFetchedAt;
    if (imageResult.value.warning) result.warnings.push(imageResult.value.warning);
  } else {
    result.warnings.push(imageResult.reason?.message || "OpenRouter 图价不可用");
  }
  result.models = mergeImageModels(result.models, result.imageModels);
  if (result.models.length || rateResult.status === "fulfilled") result.fetchedAt = now;
  return result;
}

export { pricePerMillion, pricePerRequest };
