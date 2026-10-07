import { NORMALIZATION_VERSION, normalizeCapturedData } from "./normalizers.js";
import { AIAPI_MODEL_CATALOG_ENDPOINT, CHEAP_ROUTER_PRICING_ENDPOINT, NEXA_CHANNEL_CATALOG_ENDPOINT, PUBLIC_PRICING_HOSTS, SIDRUNE_MODEL_PLAZA_ENDPOINT } from "./station-presets.js";
import { normalizeStation } from "../shared/schema.js";

function number(value, fallback = null) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function nonNegative(value, fallback = null) {
  const result = number(value, fallback);
  return result !== null && result >= 0 ? result : fallback;
}

const RAW_PRICE_KEYS = new Set([
  "model_ratio", "ratio", "input_ratio", "completion_ratio", "group_ratio",
  "input_price", "inputPrice", "input", "prompt_price", "output_price", "outputPrice", "output", "completion_price",
  "cache_read_price", "cacheReadPrice", "cache_read", "cache_write_price", "cacheWritePrice", "cache_write",
  "request_price", "requestPrice", "request", "image_price", "imagePrice", "per_image_price",
  "image_output_price", "imageOutputPrice", "image_token_price"
].map(key => key.toLowerCase()));

function hasInvalidPricingValue(value, depth = 0) {
  if (!value || depth > 6 || typeof value !== "object") return false;
  return Object.entries(value).some(([key, current]) => {
    const normalizedKey = key.toLowerCase();
    if (RAW_PRICE_KEYS.has(normalizedKey) && current !== null && typeof current !== "object" && current !== "" && (!Number.isFinite(Number(current)) || Number(current) < 0)) return true;
    return current && typeof current === "object" && hasInvalidPricingValue(current, depth + 1);
  });
}

const JIJI_HOST = "jiji.cc";
const JIJI_MODEL_PAGE = "/extension/models";
const JIJI_MODEL_API = "/extension/api/trpc/extension.modelMarket";
const JIJI_INPUT = JSON.stringify({ 0: { json: {} } });

const CHEAP_ROUTER_HOST = "cheaprouter.cc";
const CHEAP_ROUTER_PATH = "/models";

function jijiRequestConfig(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { return null; }
  if (url.hostname.toLowerCase().replace(/^www\./, "") !== JIJI_HOST || !["/", JIJI_MODEL_PAGE, JIJI_MODEL_API].includes(url.pathname)) return null;
  const token = url.searchParams.get("token") || "";
  const endpoint = new URL(JIJI_MODEL_API, url.origin);
  endpoint.searchParams.set("batch", "1");
  endpoint.searchParams.set("input", JIJI_INPUT);
  return { baseUrl: `${url.origin}${url.pathname}`, endpoint: endpoint.toString(), token };
}

export function prepareStationInput(stationInput = {}) {
  let url;
  try { url = new URL(String(stationInput.baseUrl || "")); } catch { return stationInput; }
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (hostname === "sidrune.ai" && url.pathname.replace(/\/$/, "") === "/model-plaza") {
    return {
      ...stationInput,
      baseUrl: `${url.origin}/model-plaza`,
      mode: "direct",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), kind: "sidrune-model-plaza", endpoint: SIDRUNE_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "auto" }
    };
  }
  if (hostname === "soleapi.com" || PUBLIC_PRICING_HOSTS.has(hostname)) {
    const isSoleApi = hostname === "soleapi.com";
    return {
      ...stationInput,
      baseUrl: url.origin,
      auth: { type: "none" },
      mode: "direct",
      adapter: {
        ...(stationInput.adapter || {}),
        kind: "public-pricing",
        endpoint: isSoleApi ? "/api/public/models" : "/api/pricing",
        method: "GET",
        responseFormat: "auto"
      }
    };
  }
  if (hostname === "nexavlinks.com") {
    return {
      ...stationInput,
      baseUrl: `${url.origin}/modelsmarket`,
      mode: "page",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), endpoint: NEXA_CHANNEL_CATALOG_ENDPOINT, method: "GET", responseFormat: "auto" }
    };
  }
  if (hostname === "fastaitoken.com") {
    const path = url.pathname === "/" ? "/available-channels" : url.pathname;
    return {
      ...stationInput,
      baseUrl: `https://www.fastaitoken.com${path}`,
      mode: "page",
      adapter: {
        ...(stationInput.adapter || {}),
        endpoint: "/api/v1/channels/available",
        method: "GET",
        responseFormat: "auto"
      }
    };
  }

  if (hostname === CHEAP_ROUTER_HOST && url.pathname.replace(/\/$/, "") === CHEAP_ROUTER_PATH) {
    return {
      ...stationInput,
      baseUrl: `${url.origin}${CHEAP_ROUTER_PATH}`,
      mode: "page",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), kind: "cheaprouter", endpoint: CHEAP_ROUTER_PRICING_ENDPOINT, method: "GET", responseFormat: "auto" }
    };
  }
  if (hostname === "cn.aiapi.bot" && ["/dashboard/model-prices", "/dashboard/model-prices/"].includes(url.pathname)) {
    return {
      ...stationInput,
      baseUrl: `${url.origin}/dashboard/model-prices`,
      mode: "page",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), kind: "aiapi-model-catalog", endpoint: AIAPI_MODEL_CATALOG_ENDPOINT, method: "GET", responseFormat: "auto" }
    };
  }
  const config = jijiRequestConfig(stationInput.baseUrl);
  if (!config) return stationInput;
  const inputAuth = stationInput.auth || {};
  const token = String(inputAuth.token || config.token || "").trim();
  return {
    ...stationInput,
    baseUrl: config.baseUrl,
    mode: "direct",
    auth: token ? { ...inputAuth, type: "bearer", token } : inputAuth,
    adapter: { ...(stationInput.adapter || {}), kind: "jiji", endpoint: config.endpoint, method: "GET", responseFormat: "auto" }
  };
}
function cleanRows(rows) {
  return (Array.isArray(rows) ? rows : []).map(item => {
    const rawModelRatio = item.model_ratio ?? item.ratio ?? item.input_ratio;
    const inputPrice = nonNegative(item.input_price ?? item.inputPrice ?? item.input ?? item.prompt_price);
    const outputPrice = nonNegative(item.output_price ?? item.outputPrice ?? item.output ?? item.completion_price);
    const cacheReadPrice = nonNegative(item.cache_read_price ?? item.cacheReadPrice ?? item.cache_read);
    const cacheWritePrice = nonNegative(item.cache_write_price ?? item.cacheWritePrice ?? item.cache_write);
    const requestPrice = nonNegative(item.request_price ?? item.requestPrice ?? item.request);
    const imageOutputPrice = nonNegative(item.image_output_price ?? item.imageOutputPrice ?? item.image_token_price);
    const imagePrice = nonNegative(item.image_price ?? item.imagePrice ?? item.per_image_price);
    const hasModelRatio = rawModelRatio !== undefined && rawModelRatio !== null && rawModelRatio !== "" && nonNegative(rawModelRatio) !== null;
    const hasPrice = [inputPrice, outputPrice, cacheReadPrice, cacheWritePrice, requestPrice, imageOutputPrice, imagePrice].some(value => value !== null);
    return {
      model_name: item.model_name || item.model || item.id || item.name || "",
      model_display_name: item.model_display_name || item.display_name || item.name || item.model || item.id || "",
      model_ratio: nonNegative(rawModelRatio, 0),
      completion_ratio: nonNegative(item.completion_ratio ?? item.output_ratio, 1),
      group_ratio: nonNegative(item.group_ratio ?? item.groupRatio, 1),
      input_price: inputPrice,
      output_price: outputPrice,
      cache_read_price: cacheReadPrice,
      cache_write_price: cacheWritePrice,
      request_price: requestPrice,
      price_currency: item.price_currency || item.currency || "USD",
      image_output_price: imageOutputPrice,
      image_price: imagePrice,
      enable_groups: item.enable_groups || item.groups || [],
      proxy_group_name: item.proxy_group_name || item.group_name || "",
      tier_name: item.tier_name || item.tier || "",
      evidence: item.evidence || "provider_payload",
      hasPricing: hasModelRatio || hasPrice
    };
  }).filter(item => item.model_name).map(({ hasPricing, ...item }) => ({ ...item, catalogOnly: !hasPricing }));
}

export function parseSoraPricing(payload, options = {}) {
  const parsed = normalizeCapturedData(payload, options);
  if (parsed.data?.length) return { ...parsed, sourceFormat: parsed.sourceFormat || "sora" };
  const rows = payload?.data || payload?.models || payload?.pricing || payload;
  const groupRatio = payload?.group_ratio || payload?.groupRatio || {};
  return { sourceFormat: "sora", data: cleanRows(rows), group_ratio: groupRatio };
}

export function parsePqhPricing(payload, options = {}) {
  const parsed = normalizeCapturedData(payload, options);
  if (parsed.data?.length) return { ...parsed, sourceFormat: parsed.sourceFormat || "pqh" };
  const rows = payload?.data || payload?.models || payload?.pricing || payload;
  const groupRatio = payload?.group_ratio || payload?.groupRatio || {};
  return { sourceFormat: "pqh", data: cleanRows(rows), group_ratio: groupRatio };
}

export function parseGenericPricing(payload) {
  if (Array.isArray(payload)) return { sourceFormat: "array", data: cleanRows(payload), group_ratio: {} };
  if (Array.isArray(payload?.data)) return { sourceFormat: "data", data: cleanRows(payload.data), group_ratio: payload.group_ratio || {} };
  if (Array.isArray(payload?.models)) return { sourceFormat: "models", data: cleanRows(payload.models), group_ratio: payload.group_ratio || {} };
  return { sourceFormat: "unknown", data: [], group_ratio: {} };
}

export function normalizePricingPayload(payload, format = "auto", options = {}) {
  if (format === "sora") return parseSoraPricing(payload, options);
  if (format === "pqh") return parsePqhPricing(payload, options);
  const normalized = normalizeCapturedData(payload, options);
  return normalized.data?.length ? normalized : parseGenericPricing(payload);
}

const DEFAULT_ENDPOINT = "/api/ai/pricing";

function endpointCandidates(station) {
  const configured = String(station.adapter?.endpoint || DEFAULT_ENDPOINT).trim();
  let basePath = "/";
  try { basePath = new URL(station.baseUrl).pathname || "/"; } catch { /* normalizeStation validates this */ }
  const inferred = basePath.replace(/\/$/, "") || "/";
  const isAutomatic = configured === DEFAULT_ENDPOINT || configured === inferred;
  if (!isAutomatic || station.adapter?.kind === "jiji") return [configured];
  const candidates = [];
  const add = endpoint => { if (endpoint && !candidates.includes(endpoint)) candidates.push(endpoint); };
  const looksLikeApiPath = /^\/(?:api|v\d+|openai|anthropic|extension)(?:\/|$)/i.test(inferred);
  if (inferred !== "/") add(looksLikeApiPath ? inferred : `/api${inferred}`);
  add(configured);
  if (inferred !== "/" && !looksLikeApiPath) add(inferred);
  if (inferred === "/") for (const endpoint of ["/api/pricing", "/api/models", "/api/user/models", "/v1/models"]) add(endpoint);
  return candidates;
}

function headersFor(station) {
  const auth = station.auth || {};
  const headers = { Accept: "application/json" };
  if (station.adapter?.kind === "jiji") headers["x-trpc-source"] = "browser-client";
  if (auth.type === "bearer" && auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (auth.type === "api-key" && auth.token) headers["X-API-Key"] = auth.token;
  if (auth.type === "basic" && auth.username) headers.Authorization = `Basic ${btoa(`${auth.username}:${auth.password || ""}`)}`;
  return headers;
}

async function readResponse(response) {
  if (response && Object.prototype.hasOwnProperty.call(response, "body") && typeof response.json !== "function") return response.body;
  const contentType = response.headers?.get?.("content-type") || "";
  return contentType.includes("json") ? response.json() : response.text();
}
function buildSnapshot(station, normalized, url, status = 200) {
  return {
    id: `${station.id}:${Date.now()}`,
    normalizationVersion: NORMALIZATION_VERSION,
    stationId: station.id,
    stationName: station.name,
    collectedAt: Date.now(),
    status: normalized.data.some(row => !row.catalogOnly) ? "success" : normalized.data.length ? "catalog" : "empty",
    source: normalized.sourceFormat,
    normalized,
    rawMeta: { url, status }
  };
}

export async function collectStation(stationInput, { fetchImpl = fetch, pageFetch } = {}) {
  const station = normalizeStation(prepareStationInput(stationInput));
  const endpoints = endpointCandidates(station);
  const rawJson = String(station.adapter?.rawJson || "").trim();
  if (rawJson) {
    let payload;
    try {
      payload = JSON.parse(rawJson);
    } catch {
      throw new Error(`${station.name} 手动价格 JSON 无效`);
    }
    if (hasInvalidPricingValue(payload)) throw new Error("价格数据校验失败");
    const normalized = normalizePricingPayload(payload, station.adapter?.responseFormat || "auto", { basePricePerMillion: station.basePricePerMillion });
    return buildSnapshot(station, normalized, "manual://station-config", 200);
  }
  let firstEmptySnapshot = null;
  let lastError = null;

  if (station.mode === "page" && pageFetch?.supportsCapture) {
    try {
      const response = await pageFetch({ capture: true });
      const payload = typeof response?.json === "function" ? await readResponse(response) : response?.body;
      if (payload && typeof payload === "object" && hasInvalidPricingValue(payload)) throw new Error("页面响应未通过价格数据校验");
      const normalized = payload && typeof payload !== "string"
        ? normalizePricingPayload(payload, station.adapter?.responseFormat || "auto", { basePricePerMillion: station.basePricePerMillion })
        : { sourceFormat: "page-capture", data: [] };
      const priceFields = ["input_price", "output_price", "cache_read_price", "cache_write_price", "request_price", "image_price", "image_output_price"];
      if (normalized.data.some(row => priceFields.some(field => row[field] !== null && row[field] !== undefined && (!Number.isFinite(Number(row[field])) || Number(row[field]) < 0)))) throw new Error("页面响应未通过价格数据校验");
      if (response?.ok && normalized.data.length) return buildSnapshot(station, normalized, station.baseUrl, response.status || 200);
    } catch (error) {
      lastError = error;
    }
  }
  for (const endpoint of endpoints) {
    const url = new URL(endpoint, station.baseUrl).toString();
    const headers = headersFor(station);
    const method = String(station.adapter?.method || "GET").toUpperCase() === "POST" ? "POST" : "GET";
    const body = method === "POST" ? station.adapter?.body || undefined : undefined;
    if (body) headers["Content-Type"] ||= "application/json";
    const request = { url, method, headers, body };
    // The page-world bridge can be observed by the site; use its session instead of leaking extension credentials.
    const pageHeaders = { Accept: headers.Accept };
    for (const name of ["x-trpc-source"]) if (headers[name]) pageHeaders[name] = headers[name];
    if (body) pageHeaders["Content-Type"] = headers["Content-Type"];
    const pageRequest = { ...request, headers: pageHeaders };

    try {
      const response = station.mode === "page" && pageFetch
        ? await pageFetch(pageRequest)
        : await fetchImpl(url, { method: request.method, headers: request.headers, body: request.body, credentials: ["public-pricing", "jiji", "sidrune-model-plaza"].includes(station.adapter?.kind) ? "omit" : "include" });
      if (!response || response.ok === false || (response.status && response.status >= 400)) {
        throw new Error(`${station.name} 请求失败（${response?.status || "无响应"}）`);
      }
      const options = { basePricePerMillion: station.basePricePerMillion };
      const payload = typeof response.json === "function" ? await readResponse(response) : response.body;
      if (payload && typeof payload === "object" && hasInvalidPricingValue(payload)) throw new Error("价格数据校验失败");
      const normalized = typeof payload === "string"
        ? { sourceFormat: "text", data: [], group_ratio: {}, error: "响应不是 JSON" }
        : normalizePricingPayload(payload, station.adapter?.responseFormat || "auto", options);
      if (station.mode === "page" && pageFetch) {
        const priceFields = ["input_price", "output_price", "cache_read_price", "cache_write_price", "request_price", "image_price", "image_output_price"];
        if (!normalized.data.length || normalized.data.some(row => priceFields.some(field => row[field] !== null && row[field] !== undefined && (!Number.isFinite(Number(row[field])) || Number(row[field]) < 0)))) throw new Error("页面响应未通过价格数据校验");
      }
      const snapshot = buildSnapshot(station, normalized, url, response.status || 200);
      if (normalized.data.length || endpoints.length === 1) return snapshot;
      if (!firstEmptySnapshot) firstEmptySnapshot = snapshot;
    } catch (error) {
      lastError = error;
    }
  }

  if (firstEmptySnapshot) return firstEmptySnapshot;
  throw lastError || new Error(`${station.name} 请求失败`);
}

export function createPageFetch(sendMessage) {
  const fetchPage = request => new Promise((resolve, reject) => {
    sendMessage({ type: request?.capture ? "PAGE_CAPTURE" : "PAGE_FETCH", request }, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) return reject(new Error(response?.error || "页面请求失败"));
      const pageResponse = response.response;
      if (!pageResponse || typeof pageResponse !== "object" || typeof pageResponse.ok !== "boolean" || !Number.isInteger(pageResponse.status) || pageResponse.status < 100 || pageResponse.status > 599 || !Object.prototype.hasOwnProperty.call(pageResponse, "body")) return reject(new Error("页面响应格式不受信任"));
      resolve(pageResponse);
    });
  });
  fetchPage.supportsCapture = true;
  return fetchPage;
}
