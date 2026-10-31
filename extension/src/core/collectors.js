import { NORMALIZATION_VERSION, normalizePricingPayload } from "./normalizers.js";
import { PAGE_RUNTIME_CAPTURE_TYPE, PAGE_RUNTIME_FETCH_TYPE } from "./bridge-protocol.js";
import { getResponseFormatDefinition } from "./response-formats.js";
import { NORMALIZED_PRICE_FIELDS } from "./price-fields.js";
import { buildStationRequest } from "./request-strategy.js";

function hasInvalidPricingValue(value, priceKeys, depth = 0) {
  if (!value || depth > 6 || typeof value !== "object") return false;
  return Object.entries(value).some(([key, current]) => {
    const normalizedKey = key.toLowerCase();
    if (priceKeys.has(normalizedKey) && current !== null && typeof current !== "object" && current !== "" && (!Number.isFinite(Number(current)) || Number(current) < 0)) return true;
    return current && typeof current === "object" && hasInvalidPricingValue(current, priceKeys, depth + 1);
  });
}






const PAGE_SESSION_FAILURE = "页面会话已失效，请在当前 Chrome 配置文件重新登录后重试";

function isPageSessionFailure(strategy, response) {
  const statuses = strategy?.pageAuth?.sessionFailureStatuses;
  return Array.isArray(statuses) && statuses.includes(Number(response?.status));
}

function requestError(station, strategy, response) {
  if (isPageSessionFailure(strategy, response)) return strategy.pageAuth.sessionFailureMessage || PAGE_SESSION_FAILURE;
  return `${station.name} 请求失败（${response?.status || "无响应"}）`;
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
    status: normalized.incomplete ? "partial" : normalized.data.some(row => !row.catalogOnly) ? "success" : normalized.data.length ? "catalog" : "empty",
    source: normalized.sourceFormat,
    normalized,
    ...(typeof station.priceCurrencyVerified === "boolean" ? { priceCurrencyVerified: station.priceCurrencyVerified } : {}),
    ...(typeof station.rechargeRateVerified === "boolean" ? { rechargeRateVerified: station.rechargeRateVerified } : {}),
    rawMeta: {
      url,
      status,
      ...(normalized.unsupportedBillingModes ? { unsupportedBillingModes: normalized.unsupportedBillingModes } : {}),
      ...(normalized.invalidPricingValues ? { invalidPricingValues: normalized.invalidPricingValues } : {}),
      ...(normalized.unpricedModels ? { unpricedModels: normalized.unpricedModels } : {})
    }
  };
}

export async function collectStation(station, { fetchImpl = fetch, pageFetch, collection } = {}) {
  if (!collection) throw new Error("collectStation requires a prepared collection");
  const { endpoints, priceKeys, request: requestStrategy } = collection;
  const rawJson = String(station.adapter?.rawJson || "").trim();
  if (rawJson) {
    let payload;
    try {
      payload = JSON.parse(rawJson);
    } catch {
      throw new Error(`${station.name} 手动价格 JSON 无效`);
    }
    if (hasInvalidPricingValue(payload, priceKeys)) throw new Error("价格数据校验失败");
    const normalized = normalizePricingPayload(payload, station.adapter?.responseFormat || "auto", { basePricePerMillion: station.basePricePerMillion, priceCurrency: station.priceCurrency, priceCurrencyVerified: station.priceCurrencyVerified, modelListCurrency: "CREDITS" });
    return buildSnapshot(station, normalized, "manual://station-config", 200);
  }
  let firstEmptySnapshot = null;
  let lastError = null;

  if (station.mode === "page" && pageFetch?.supportsCapture && requestStrategy.skipCapture !== true) {
    try {
      const response = await pageFetch({ capture: true });
      if (isPageSessionFailure(requestStrategy, response)) throw new Error(requestError(station, requestStrategy, response));
      const payload = typeof response?.json === "function" ? await readResponse(response) : response?.body;
      if (payload && typeof payload === "object" && hasInvalidPricingValue(payload, priceKeys)) throw new Error("页面响应未通过价格数据校验");
      const normalized = payload && typeof payload !== "string"
        ? normalizePricingPayload(payload, station.adapter?.responseFormat || "auto", { basePricePerMillion: station.basePricePerMillion, priceCurrency: station.priceCurrency, priceCurrencyVerified: station.priceCurrencyVerified, modelListCurrency: "CREDITS" })
        : { sourceFormat: "page-capture", data: [] };
      const priceFields = NORMALIZED_PRICE_FIELDS;
      if (normalized.data.some(row => priceFields.some(field => row[field] !== null && row[field] !== undefined && (!Number.isFinite(Number(row[field])) || Number(row[field]) < 0)))) throw new Error("页面响应未通过价格数据校验");
      if (response?.ok && normalized.data.length) return buildSnapshot(station, normalized, station.baseUrl, response.status || 200);
    } catch (error) {
      lastError = error;
    }
  }
  for (const endpoint of endpoints) {
    const url = new URL(endpoint, station.baseUrl).toString();
    const request = buildStationRequest(station, url, requestStrategy);
    try {
      const response = station.mode === "page" && pageFetch
        ? await pageFetch(request.pageRequest)
        : await fetchImpl(url, { method: request.method, headers: request.headers, body: request.body, credentials: request.credentials });
      if (!response || response.ok === false || (response.status && response.status >= 400)) {
        throw new Error(requestError(station, requestStrategy, response));
      }
      const options = { basePricePerMillion: station.basePricePerMillion, priceCurrency: station.priceCurrency, priceCurrencyVerified: station.priceCurrencyVerified, modelListCurrency: "CREDITS" };
      const payload = typeof response.json === "function" ? await readResponse(response) : response.body;
      if (payload && typeof payload === "object" && hasInvalidPricingValue(payload, priceKeys)) throw new Error("价格数据校验失败");
      const normalized = typeof payload === "string"
        ? { sourceFormat: "text", data: [], group_ratio: {}, error: "响应不是 JSON" }
        : normalizePricingPayload(payload, station.adapter?.responseFormat || "auto", options);
      if (station.mode === "page" && pageFetch) {
        const priceFields = NORMALIZED_PRICE_FIELDS;
        if (!normalized.data.length) throw new Error("页面响应未生成可用价格数据");
        if (normalized.data.some(row => priceFields.some(field => row[field] !== null && row[field] !== undefined && (!Number.isFinite(Number(row[field])) || Number(row[field]) < 0)))) throw new Error("页面响应未通过价格数据校验");
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
    sendMessage({ type: request?.capture ? PAGE_RUNTIME_CAPTURE_TYPE : PAGE_RUNTIME_FETCH_TYPE, request }, response => {
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
