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

// OpenRouter 的浮动别名条目（~vendor/x-latest）不是独立模型：alias_target.slug 指向它当前落地的正式模型。
// 供应商要取目标的厂商，不然界面会冒出 ~anthropic 这类分组。
function aliasTargetOf(model) {
  return String(model?.alias_target?.slug || "").trim();
}

// 浮动别名的目标是同一列表里的正式条目时，把它的拼写收集起来，统一并进目标行；返回 target -> 拼写集合。
function floatingSpellingsOf(data) {
  const present = new Set();
  for (const model of data) {
    const id = String(model?.id || "").trim();
    if (id && !aliasTargetOf(model)) present.add(id);
  }
  const spellings = new Map();
  for (const model of data) {
    const target = aliasTargetOf(model);
    if (!target || !present.has(target)) continue;
    const bucket = spellings.get(target) || new Set();
    for (const alias of aliasesOf(String(model?.id || "").trim(), model?.name, model?.canonical_slug)) bucket.add(alias);
    spellings.set(target, bucket);
  }
  return spellings;
}

// 正式条目身份原样用 id；目标不在列表里的浮动条目顶替目标的身份。
function identityOf(model) {
  const rawId = String(model?.id || "").trim();
  const target = aliasTargetOf(model);
  const id = target || rawId;
  const aliases = target && target !== rawId
    ? [...new Set([...aliasesOf(target, model?.name, model?.canonical_slug), ...aliasesOf(rawId, model?.name, model?.canonical_slug)])]
    : aliasesOf(id, model?.name, model?.canonical_slug);
  return { id, aliases };
}

function foldFloatingAliases(rows, byId, floating) {
  for (const [target, spellings] of floating) {
    const row = byId.get(target);
    if (row) row.aliases = [...new Set([...row.aliases, ...spellings])];
  }
  return rows;
}

export function parseOpenRouterData(json) {
  if (!json || !Array.isArray(json.data)) return [];
  const floating = floatingSpellingsOf(json.data);
  const rows = [];
  const byId = new Map();
  for (const model of json.data) {
    const target = aliasTargetOf(model);
    // 目标正式条目会自己出一行，价格不丢；浮动条目跳过，拼写最后统一并进去。
    if (target && floating.has(target)) continue;
    const { id, aliases } = identityOf(model);
    const pricing = model.pricing || {};
    const input = pricePerMillion(pricing.prompt);
    const output = pricePerMillion(pricing.completion);
    const imageOutput = pricePerMillion(pricing.image_output ?? pricing.image_token);
    const imagePrice = pricePerRequest(pricing.image);
    const request = pricePerRequest(pricing.request);
    if (input === null && output === null && imageOutput === null && imagePrice === null && request === null) continue;
    const modalities = model.architecture?.output_modalities;
    const row = {
      id: id || model.name,
      name: id || model.name,
      display_name: model.name || id,
      aliases,
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
    };
    rows.push(row);
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return foldFloatingAliases(rows, byId, floating);
}

// 生图专用模型列表：58 个模型只出现在 /images/models，/models 里没有。
// 这些条目的价格在 endpoint 上，模型本身只提供身份信息。
export function parseImageModels(json) {
  if (!json || !Array.isArray(json.data)) return [];
  const floating = floatingSpellingsOf(json.data);
  const rows = [];
  const byId = new Map();
  for (const model of json.data) {
    const target = aliasTargetOf(model);
    if (target && floating.has(target)) continue;
    const { id, aliases } = identityOf(model);
    if (!id) continue;
    const row = {
      id,
      name: id,
      display_name: model.name || id,
      aliases,
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
    };
    rows.push(row);
    if (!byId.has(id)) byId.set(id, row);
  }
  return foldFloatingAliases(rows, byId, floating);
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

const REFERENCE_TIMEOUTS = { models: 12_000, exchangeRate: 8_000, images: 20_000 };

async function withReferenceDeadline(label, timeoutMs, signal, work) {
  if (signal?.aborted) throw signal.reason;
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  let timer;
  let onAbort;
  const deadline = new Promise((resolve, reject) => {
    onAbort = () => reject(controller.signal.reason);
    if (controller.signal.aborted) onAbort();
    else controller.signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => controller.abort(new Error(`${label}请求超时（${timeoutMs}ms）`)), timeoutMs);
  });
  try {
    return await Promise.race([
      deadline,
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return work(controller.signal);
      })
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", onAbort);
  }
}
async function runWithConcurrency(items, limit, worker) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  }));
}

export async function fetchImageReferences({ fetchImpl = fetch, signal, now = Date.now(), cache = {}, timeoutMs = REFERENCE_TIMEOUTS.images } = {}) {
  const cachedQuotes = cache.imageQuotes && typeof cache.imageQuotes === "object" ? cache.imageQuotes : null;
  const cachedModels = Array.isArray(cache.imageModels) ? cache.imageModels : [];
  const fetchedAt = Number(cache.imageQuotesFetchedAt) || 0;
  if (cachedQuotes && cachedModels.length && now - fetchedAt < IMAGE_QUOTE_TTL) {
    return { imageQuotes: cachedQuotes, imageModels: cachedModels, imageQuotesFetchedAt: fetchedAt, warning: "" };
  }
  return withReferenceDeadline("OpenRouter 图价", timeoutMs, signal, async requestSignal => {
    const listResponse = await fetchImpl(OPENROUTER_IMAGES_URL, { signal: requestSignal });
    if (!listResponse.ok) throw new Error(`OpenRouter images ${listResponse.status}`);
    const imageModels = parseImageModels(await listResponse.json());
    const rows = [];
    const failedIds = [];
    await runWithConcurrency(imageModels.map(model => model.id), IMAGE_FETCH_CONCURRENCY, async id => {
      requestSignal.throwIfAborted();
      try {
        const response = await fetchImpl(`${OPENROUTER_IMAGES_URL}/${id}/endpoints`, { signal: requestSignal });
        if (!response.ok) throw new Error(`OpenRouter image endpoints ${response.status}`);
        rows.push(...parseImageEndpoints(await response.json()));
      } catch (error) {
        if (requestSignal.aborted) throw error;
        failedIds.push(id);
      }
    });
    const imageQuotes = aggregateImageQuotes(rows);
    for (const id of failedIds) {
      if (cachedQuotes?.[id]) imageQuotes[id] = cachedQuotes[id];
    }
    return {
      imageQuotes,
      imageModels,
      imageQuotesFetchedAt: failedIds.length ? fetchedAt : now,
      warning: failedIds.length ? `OpenRouter 图价 ${failedIds.length} 个模型不可用，沿用已有缓存` : ""
    };
  });
}

// 图价模型里 58 个不在 /models 中，补进去才能参与匹配。已有条目以 /models 为准。
function mergeImageModels(models, imageModels) {
  if (!imageModels.length) return models;
  const known = new Set(models.map(model => model.id));
  const missing = imageModels.filter(model => !known.has(model.id));
  return missing.length ? [...models, ...missing] : models;
}

// 旧缓存里可能躺着 ~vendor/x-latest 的浮动别名条目（id 或 provider 带波浪号）。它们从来不是独立模型，读出来先丢掉。
export function dropFloatingModels(models) {
  if (!Array.isArray(models)) return [];
  return models.filter(model => !String(model?.id || "").startsWith("~") && !String(model?.provider || "").startsWith("~"));
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

export async function fetchReferences({ fetchImpl = fetch, signal, now = Date.now(), cache = {}, timeouts = {} } = {}) {
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
    withReferenceDeadline("OpenRouter 模型价", timeouts.models ?? REFERENCE_TIMEOUTS.models, signal, async requestSignal => {
      const response = await fetchImpl(OPENROUTER_URL, { signal: requestSignal });
      if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
      return parseOpenRouterData(await response.json());
    }),
    withReferenceDeadline("汇率", timeouts.exchangeRate ?? REFERENCE_TIMEOUTS.exchangeRate, signal, async requestSignal => {
      const response = await fetchImpl(`${BOC_EXCHANGE_URL}?_=${now}`, { signal: requestSignal });
      if (!response.ok) throw new Error(`BOC ${response.status}`);
      return parseOfficialExchangeRate(await response.text());
    }),
    fetchImageReferences({ fetchImpl, signal, now, cache, timeoutMs: timeouts.images ?? REFERENCE_TIMEOUTS.images })
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
  // 出手前统一清一遍：缓存里的旧浮动别名不该漏进 references.models，否则供应商栏又会冒出 ~vendor 分组。
  result.models = dropFloatingModels(mergeImageModels(result.models, result.imageModels));
  if (result.models.length || rateResult.status === "fulfilled") result.fetchedAt = now;
  return result;
}

export { pricePerMillion, pricePerRequest };
