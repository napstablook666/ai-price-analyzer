import { BOC_EXCHANGE_URL, DEFAULT_EXCHANGE_RATE, OPENROUTER_URL } from "../shared/schema.js";

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
    const shortId = id.includes("/") ? id.split("/").slice(1).join("/") : id;
    const aliases = [id, shortId, model.name, model.canonical_slug].filter(Boolean).map(String).map(value => value.toLowerCase());
    const modalities = model.architecture?.output_modalities;
    return [{
      name: id || model.name,
      display_name: model.name || id,
      aliases: [...new Set(aliases)],
      provider: id.split("/")[0] || "OpenRouter",
      input: input ?? 0,
      output: output ?? 0,
      cacheRead: pricePerMillion(pricing.input_cache_read),
      cacheWrite: pricePerMillion(pricing.input_cache_write),
      request,
      imageOutput,
      imagePrice,
      isImageModel: Array.isArray(modalities) && modalities.includes("image")
    }];
  });
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
  const result = { models: cache.models || [], exchangeRate: Number(cache.exchangeRate) || DEFAULT_EXCHANGE_RATE, fetchedAt: cache.fetchedAt || 0, warnings: [] };
  const [modelsResult, rateResult] = await Promise.allSettled([
    fetchImpl(OPENROUTER_URL, { signal }).then(response => {
      if (!response.ok) throw new Error(`OpenRouter ${response.status}`);
      return response.json();
    }).then(parseOpenRouterData),
    fetchImpl(`${BOC_EXCHANGE_URL}?_=${now}`, { signal }).then(response => {
      if (!response.ok) throw new Error(`BOC ${response.status}`);
      return response.text();
    }).then(parseOfficialExchangeRate)
  ]);
  if (modelsResult.status === "fulfilled" && modelsResult.value.length) result.models = modelsResult.value;
  else result.warnings.push(modelsResult.reason?.message || "OpenRouter 数据为空");
  if (rateResult.status === "fulfilled") result.exchangeRate = rateResult.value;
  else result.warnings.push(rateResult.reason?.message || "汇率不可用");
  if (result.models.length || rateResult.status === "fulfilled") result.fetchedAt = now;
  return result;
}

export { pricePerMillion, pricePerRequest };
