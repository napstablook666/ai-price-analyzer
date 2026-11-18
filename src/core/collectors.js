import { NORMALIZATION_VERSION, normalizePricingPayload } from "./normalizers.js";
import { PAGE_RUNTIME_CAPTURE_TYPE, PAGE_RUNTIME_FETCH_TYPE } from "./bridge-protocol.js";
import { getResponseFormatDefinition } from "./response-formats.js";
import { NORMALIZED_PRICE_FIELDS } from "./price-fields.js";
import { buildStationRequest } from "./request-strategy.js";
import { RECHARGE_STATUS_ENDPOINT, parseRechargeStatus } from "./recharge.js";

function hasInvalidPricingValue(value, priceKeys, depth = 0) {
  if (!value || depth > 6 || typeof value !== "object") return false;
  return Object.entries(value).some(([key, current]) => {
    const normalizedKey = key.toLowerCase();
    if (priceKeys.has(normalizedKey) && current !== null && typeof current !== "object" && current !== "" && (!Number.isFinite(Number(current)) || Number(current) < 0)) return true;
    return current && typeof current === "object" && hasInvalidPricingValue(current, priceKeys, depth + 1);
  });
}






// 站点偶尔一次握手失败就抛 TypeError: Failed to fetch，重试一次多半就好了，
// 不该让这一站直接记成失败。
const TRANSIENT_NETWORK_PATTERN = /Failed to fetch|NetworkError|net::ERR_|ERR_CONNECTION|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_INTERNET_DISCONNECTED|采集页面加载失败|采集页面加载超时/i;

export const COLLECT_RETRIES = 3;
export const COLLECT_RETRY_DELAY_MS = 600;

export function isTransientNetworkError(error) {
  const message = String(error?.message || error || "");
  return TRANSIENT_NETWORK_PATTERN.test(message);
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
    status: normalized.error ? "error" : normalized.incomplete ? "partial" : normalized.data.some(row => !row.catalogOnly) ? "success" : normalized.data.length ? "catalog" : "empty",
    source: normalized.sourceFormat,
    normalized,
    ...(normalized.error ? { error: normalized.error } : {}),
    ...(typeof station.priceCurrencyVerified === "boolean" ? { priceCurrencyVerified: station.priceCurrencyVerified } : {}),
    ...(typeof station.rechargeRateVerified === "boolean" ? { rechargeRateVerified: station.rechargeRateVerified } : {}),
    rawMeta: {
      url,
      status,
      ...(normalized.unsupportedBillingModes ? { unsupportedBillingModes: normalized.unsupportedBillingModes } : {}),
      ...(normalized.invalidPricingValues ? { invalidPricingValues: normalized.invalidPricingValues } : {}),
      ...(normalized.unpricedModels ? { unpricedModels: normalized.unpricedModels } : {}),
      ...(normalized.unsupportedPriceItems ? { unsupportedPriceItems: normalized.unsupportedPriceItems } : {}),
      ...(normalized.unpricedChannels ? { unpricedChannels: normalized.unpricedChannels } : {}),
      ...(normalized.filteredChannels ? { filteredChannels: normalized.filteredChannels } : {}),
      ...(normalized.unknownChannelStates ? { unknownChannelStates: normalized.unknownChannelStates } : {}),
      ...(normalized.failedModels ? { failedModels: normalized.failedModels } : {}),
      ...(normalized.failedModelCount ? { failedModelCount: normalized.failedModelCount } : {}),
      ...(normalized.failedModelReasons ? { failedModelReasons: normalized.failedModelReasons } : {})
    }
  };
}

export async function collectStation(station, { retries = COLLECT_RETRIES, retryDelayMs = COLLECT_RETRY_DELAY_MS, probeRecharge = true, ...options } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await withRecharge(station, await collectStationOnce(station, options), { ...options, probeRecharge });
    } catch (error) {
      if (!isTransientNetworkError(error)) throw error;
      // 重试用完还是失败：浏览器原话（Failed to fetch）对用户没信息量，换成能看懂的。
      if (attempt >= retries) {
        throw /^(Failed to fetch|NetworkError)/i.test(String(error?.message || ""))
          ? new Error(`${station.name || "站点"} 网络请求失败：站点或代理暂时不可达，请稍后重试`)
          : error;
      }
      await new Promise(resolve => setTimeout(resolve, retryDelayMs * attempt));
    }
  }
}

// 归一阶段的公共参数。原来同一行 options 在三个分支里复制了三遍，
// 加一个键就要改三处；priceMap 也从站点 adapter 一起带下去。
function normalizationOptionsFor(station) {
  return {
    basePricePerMillion: station.basePricePerMillion,
    priceCurrency: station.priceCurrency,
    priceCurrencyVerified: station.priceCurrencyVerified,
    modelListCurrency: station.priceCurrency,
    priceMap: station.adapter?.priceMap || null
  };
}
async function collectStationOnce(station, { fetchImpl = fetch, pageFetch, collection } = {}) {
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
    const normalized = normalizePricingPayload(payload, station.adapter?.responseFormat || "auto", normalizationOptionsFor(station));
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
        ? normalizePricingPayload(payload, station.adapter?.responseFormat || "auto", normalizationOptionsFor(station))
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
      const options = normalizationOptionsFor(station);
      const payload = typeof response.json === "function" ? await readResponse(response) : response.body;
      if (payload && typeof payload === "object" && hasInvalidPricingValue(payload, priceKeys)) throw new Error("价格数据校验失败");
      // 主价格之外还要取的报文（拼车市场就是这种：座位在 /api/carpool-market，
      // 单价在 /api/pricing），拿不到不算采集失败。
      const enriched = typeof payload === "string" ? payload
        : await attachAuxiliary(station, payload, requestStrategy, { fetchImpl, pageFetch });
      const normalized = typeof enriched === "string"
        ? { sourceFormat: "text", data: [], group_ratio: {}, error: "响应不是 JSON" }
        : normalizePricingPayload(enriched, station.adapter?.responseFormat || "auto", options);
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

// 站点可能把价格和分组拆在两个接口里：飓星API 的拼车中心就是一个例子，
// 座位清单在 /api/carpool-market，模型单价还在 /api/pricing。
// 分组广场更绕一层：先拿分组表，每个分组的报价在 /api/group-plaza/groups/{id}。
// 辅助报文挂在 __aux 上交给响应格式处理器；拿不到就跳过，不拖垮主采集。
function pickPath(source, path) {
  const keys = String(path || "").split(".").map(key => key.trim()).filter(Boolean);
  let current = source;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

async function fetchAuxBody(station, endpoint, strategy, spec, { fetchImpl, pageFetch }) {
  const url = new URL(endpoint, station.baseUrl).toString();
  const request = buildStationRequest(station, url, { ...strategy, ...spec });
  const response = station.mode === "page" && pageFetch
    ? await pageFetch(request.pageRequest)
    : await fetchImpl(url, { method: request.method, headers: request.headers, body: request.body, credentials: request.credentials });
  if (!response || response.ok === false || (response.status && response.status >= 400)) return null;
  const body = typeof response.json === "function" ? await readResponse(response) : response.body;
  return body && typeof body === "object" && !Array.isArray(body) ? body : null;
}

// 逐条拉取时一次放几个出去：分组广场三十来个分组，串行会拖到一分钟以外。
const AUX_DETAIL_CONCURRENCY = 6;

async function mapWithConcurrency(entries, limit, worker) {
  const results = new Array(entries.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, entries.length) }, async () => {
    while (cursor < entries.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(entries[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function attachAuxiliary(station, payload, strategy, { fetchImpl, pageFetch }) {
  const specs = Array.isArray(strategy?.aux) ? strategy.aux : [];
  if (!specs.length || !payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const auxiliary = {};
  for (const spec of specs) {
    const key = String(spec?.key || "").trim();
    const endpoint = String(spec?.endpoint || "").trim();
    if (!key || !endpoint) continue;
    try {
      // forEach 指向主报文里的一张清单：清单里一个 id 一次请求，结果按原顺序收成数组。
      if (!spec.forEach) {
        const body = await fetchAuxBody(station, endpoint, strategy, spec, { fetchImpl, pageFetch });
        if (body) auxiliary[key] = body;
        continue;
      }
      // 清单可以来自主报文，也可以来自前一个辅助报文（分组表就是先拉列表再逐组取价）。
      const list = pickPath(auxiliary, spec.forEach) ?? pickPath(payload, spec.forEach);
      if (!Array.isArray(list)) continue;
      const idField = String(spec.idField || "id");
      const where = spec.where && typeof spec.where === "object" ? spec.where : null;
      const targets = list
        .filter(row => row && typeof row === "object")
        .filter(row => !where || Object.entries(where).every(([field, expected]) => String(row[field] ?? "") === String(expected)))
        .map(row => String(row[idField] ?? "").trim())
        .filter(Boolean);
      if (!targets.length) continue;
      const bodies = await mapWithConcurrency(targets, AUX_DETAIL_CONCURRENCY, id =>
        fetchAuxBody(station, endpoint.replace("{id}", encodeURIComponent(id)), strategy, spec, { fetchImpl, pageFetch })
      );
      const collected = bodies.filter(Boolean);
      if (collected.length) auxiliary[key] = collected;
    } catch {
      // 辅助接口失败就当作没有：主价格还在。
    }
  }
  return Object.keys(auxiliary).length ? { ...payload, __aux: auxiliary } : payload;
}

// 充值比例是站点级事实，站点自己公布在 /api/status 上。抓一次挂到快照顶部，
// 主价格照常；拿不到就当这次没有自动倍率，比价回落到手填值。
async function withRecharge(station, snapshot, { probeRecharge = true, fetchImpl = fetch, pageFetch } = {}) {
  if (!snapshot || probeRecharge === false || station?.rechargeAuto === false) return snapshot;
  const recharge = await probeRechargeRate(station, { fetchImpl, pageFetch });
  return recharge ? { ...snapshot, recharge } : snapshot;
}

export async function probeRechargeRate(station, { fetchImpl = fetch, pageFetch } = {}) {
  try {
    const url = new URL(RECHARGE_STATUS_ENDPOINT, station.baseUrl).toString();
    // 固定 GET、不带密钥：这一步只读公开的站点参数，不要把目标接口的鉴权和请求体带进来。
    const request = { url, method: "GET", headers: { accept: "application/json" }, body: undefined, credentials: "omit", pageAuth: null };
    const response = station.mode === "page" && pageFetch
      ? await pageFetch(request)
      : await fetchImpl(url, { method: "GET", headers: request.headers, credentials: "omit" });
    if (!response || response.ok === false || (response.status && response.status >= 400)) return null;
    const body = typeof response.json === "function" ? await readResponse(response) : response.body;
    const parsed = parseRechargeStatus(body);
    return parsed ? { ...parsed, source: "auto", collectedAt: Date.now() } : null;
  } catch {
    // 老站没有这个接口，或者返回的是 HTML 首页：没有就没有，不写失败。
    return null;
  }
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
