import { OPENROUTER_URL } from "../shared/schema.js";
import { fetchExchangeRate } from "./exchange-rate.js";
import { withReferenceDeadline } from "./reference-request.js";

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
      price_currency: "USD"
    };
    rows.push(row);
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return foldFloatingAliases(rows, byId, floating);
}

const REFERENCE_TIMEOUTS = { models: 12_000, exchangeRate: 8_000 };

// 旧缓存里可能躺着 ~vendor/x-latest 的浮动别名条目（id 或 provider 带波浪号）。它们从来不是独立模型，读出来先丢掉。
export function dropFloatingModels(models) {
  if (!Array.isArray(models)) return [];
  return models.filter(model => !String(model?.id || "").startsWith("~") && !String(model?.provider || "").startsWith("~"));
}


export function referencesNeedRefresh(cache = {}, now = Date.now()) {
  if (cache.attemptedAt && now - cache.attemptedAt < 60 * 60 * 1000) return false;
  const legacy = dropFloatingModels(cache.models).length !== (Array.isArray(cache.models) ? cache.models.length : 0);
  return legacy || !cache.fetchedAt || now - cache.fetchedAt >= 24 * 60 * 60 * 1000
    || !cache.exchangeRateFetchedAt || now - cache.exchangeRateFetchedAt >= 24 * 60 * 60 * 1000;
}
export async function fetchReferences({ fetchImpl = fetch, signal, now = Date.now(), cache = {}, timeouts = {} } = {}) {
  const result = {
    models: cache.models || [],
    exchangeRate: cache.exchangeRate || null,
    exchangeRateSource: cache.exchangeRateSource || "",
    exchangeRateDate: cache.exchangeRateDate || "",
    exchangeRateFetchedAt: cache.exchangeRateFetchedAt || 0,
    attemptedAt: now,
    fetchedAt: cache.fetchedAt || 0,
    warnings: []
  };
  const [modelsResult, rateResult] = await Promise.allSettled([
    withReferenceDeadline("OpenRouter 模型价", timeouts.models ?? REFERENCE_TIMEOUTS.models, signal, async requestSignal => {
      const response = await fetchImpl(OPENROUTER_URL, { signal: requestSignal });
      if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
      return parseOpenRouterData(await response.json());
    }),
    withReferenceDeadline("汇率", timeouts.exchangeRate ?? REFERENCE_TIMEOUTS.exchangeRate, signal,
      requestSignal => fetchExchangeRate({ fetchImpl, signal: requestSignal, now }))
  ]);
  if (modelsResult.status === "fulfilled" && modelsResult.value.length) result.models = modelsResult.value;
  else result.warnings.push(modelsResult.reason?.message || "OpenRouter 数据为空");
  if (rateResult.status === "fulfilled") Object.assign(result, rateResult.value);
  else result.warnings.push(`汇率更新失败，${result.exchangeRate ? "沿用上次成功值" : "暂无可用缓存"}：${rateResult.reason?.message || "汇率不可用"}`);
  // 出手前统一清一遍：缓存里的旧浮动别名不该漏进 references.models，否则供应商栏又会冒出 ~vendor 分组。
  result.models = dropFloatingModels(result.models);
  if (modelsResult.status === "fulfilled" && modelsResult.value.length) result.fetchedAt = now;
  return result;
}

export { pricePerMillion, pricePerRequest };
