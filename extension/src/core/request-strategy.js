import { prepareStationInput, providerForStation, RAW_PRICE_KEYS, stationContext } from "./provider-registry.js";
import { normalizeStation } from "../shared/schema.js";

const DEFAULT_ENDPOINT = "/api/ai/pricing";
const DEFAULT_REQUEST = {
  endpointCandidates: "automatic",
  headers: {},
  pageHeaders: [],
  credentials: "omit",
  priceKeys: RAW_PRICE_KEYS,
  pageAuth: null
};

function requestStrategy(station) {
  return providerForStation(station)?.request || DEFAULT_REQUEST;
}


function providerEndpoint(station, strategy) {
  if (!strategy.endpoint) return null;
  const endpoint = typeof strategy.endpoint === "function" ? strategy.endpoint(stationContext(station)) : strategy.endpoint;
  return new URL(appendQuery(endpoint, strategy), station.baseUrl).toString();
}
function appendQuery(endpoint, strategy) {
  if (!strategy.query) return endpoint;
  const absolute = /^https?:\/\//i.test(endpoint);
  const url = new URL(endpoint, "https://provider.invalid");
  const query = typeof strategy.query === "function" ? strategy.query() : strategy.query;
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, String(value));
  return absolute ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
}

function endpointCandidates(station, strategy) {
  const configured = String(station.adapter?.endpoint || DEFAULT_ENDPOINT).trim();
  if (strategy.endpointCandidates === "provider") return [providerEndpoint(station, strategy)];
  if (strategy.endpointCandidates === "configured") return [appendQuery(configured, strategy)];
  let basePath = "/";
  try { basePath = new URL(station.baseUrl).pathname || "/"; } catch { /* normalizeStation validates this */ }
  const inferred = basePath.replace(/\/$/, "") || "/";
  const isAutomatic = configured === DEFAULT_ENDPOINT || configured === inferred;
  if (!isAutomatic) return [appendQuery(configured, strategy)];
  const candidates = [];
  const add = endpoint => {
    const resolved = appendQuery(endpoint, strategy);
    if (resolved && !candidates.includes(resolved)) candidates.push(resolved);
  };
  const looksLikeApiPath = /^(?:\/(?:api|v\d+|openai|anthropic|extension))(?:\/|$)/i.test(inferred);
  if (inferred !== "/") add(looksLikeApiPath ? inferred : `/api${inferred}`);
  add(configured);
  if (inferred !== "/" && !looksLikeApiPath) add(inferred);
  if (inferred === "/") for (const endpoint of ["/api/pricing", "/api/models", "/api/user/models", "/v1/models"]) add(endpoint);
  return candidates;
}

function headersFor(station, strategy) {
  const auth = station.auth || {};
  const headers = { Accept: "application/json", ...strategy.headers };
  if (auth.type === "bearer" && auth.token) headers.Authorization = `Bearer ${auth.token}`;
  if (auth.type === "api-key" && auth.token) headers["X-API-Key"] = auth.token;
  if (auth.type === "basic" && auth.username) headers.Authorization = `Basic ${btoa(`${auth.username}:${auth.password || ""}`)}`;
  return headers;
}

export function getStationRequestConfig(station) {
  const strategy = requestStrategy(station);
  return { request: strategy, endpoints: endpointCandidates(station, strategy), priceKeys: strategy.priceKeys || RAW_PRICE_KEYS };
}
export function resolveStationCollection(stationInput = {}) {
  const station = normalizeStation(prepareStationInput(stationInput));
  return { station, ...getStationRequestConfig(station) };
}


export function buildStationRequest(station, url, strategy) {
  if (!strategy) throw new Error("buildStationRequest requires a resolved request strategy");
  const headers = headersFor(station, strategy);
  const method = String(station.adapter?.method || "GET").toUpperCase() === "POST" ? "POST" : "GET";
  const body = method === "POST" ? station.adapter?.body || undefined : undefined;
  if (body) headers["Content-Type"] ||= "application/json";
  // Only strategy-approved headers cross into the page-world bridge.
  const pageHeaders = { Accept: headers.Accept };
  for (const name of strategy.pageHeaders) if (headers[name]) pageHeaders[name] = headers[name];
  if (body) pageHeaders["Content-Type"] = headers["Content-Type"];
  return {
    url,
    method,
    headers,
    body,
    credentials: strategy.credentials,
    pageRequest: { url, method, headers: pageHeaders, body, credentials: strategy.credentials, pageAuth: strategy.pageAuth }
  };
}
