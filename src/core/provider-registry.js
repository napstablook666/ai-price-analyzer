import { PRICE_FIELD_DEFINITIONS } from "./price-fields.js";
import { AIAPI_PRICE_KEYS } from "./aiapi-contract.js";
import { SITE_PLUGIN_ORDER } from "../shared/plugin-order.js";

const MODEL_PLAZA_RAW_PRICE_KEYS = [
  "per_request_price", "rate_multiplier", "user_rate_multiplier", "image_rate_multiplier", "video_rate_multiplier"
];
export { AIAPI_EFFECTIVE_PRICE_FIELDS, AIAPI_GROUP_PRICE_FIELDS, AIAPI_PRICE_KEYS } from "./aiapi-contract.js";
export const PUBLIC_PRICING_HOSTS = new Set(["nomissapi.com", "yorhamc.com", "token123.cfd", "liuguang.ai", "dddai.dev"]);
export const CHEAP_ROUTER_PRICING_ENDPOINT = "/api/v1/pricing/public?timezone=Asia%2FShanghai";
export const SIDRUNE_MODEL_PLAZA_ENDPOINT = "/api/v1/model-plaza/public";
export const NODEAI_MODEL_PLAZA_ENDPOINT = "/api/v1/model-plaza";
export const KILLAI_PRICING_ENDPOINT = "/api/pricing";
export const TOKENFLUX_PRICING_ENDPOINT = "/api/pricing";
export const CENTOS_PRICING_ENDPOINT = "/api/pricing";
export const MAOLAO_PRICING_ENDPOINT = "/api/pricing";
export const WINDHUB_PRICING_ENDPOINT = "/api/pricing";
export const SEVENAI_MODEL_PLAZA_ENDPOINT = "/api/v1/model-plaza?timezone=Asia%2FShanghai";
export const FUCK_EVERYONE_MODEL_PLAZA_ENDPOINT = "/api/v1/model-plaza";
export const TRUE_SOTA_MODEL_PRICING_ENDPOINT = "/api/v1/model-pricing";
export const NEXA_CHANNEL_CATALOG_ENDPOINT = "/api/v1/channels/catalog?available_only=true&timezone=Asia%2FShanghai";
export const AIAPI_MODEL_CATALOG_ENDPOINT = "/api/me/model-catalog";
export const ALL_IN_ONE_MODELS_ENDPOINT = "/api/tenant/models";
export const AIAPI_MODEL_CATALOG_FORMAT = "aiapi-model-catalog";
export const HEPINGAN_CHANNELS_ENDPOINT = "/api/v1/channels/available";

export const RAW_PRICE_KEYS = new Set([
  "model_ratio", "ratio", "input_ratio", "completion_ratio", "group_ratio",
  ...MODEL_PLAZA_RAW_PRICE_KEYS,
  ...PRICE_FIELD_DEFINITIONS.flatMap(field => field.aliases)
].map(key => key.toLowerCase()));
export const ALL_IN_ONE_PRICE_KEYS = new Set([...RAW_PRICE_KEYS, "cache_read", "cache_creation_price", "cache_creation_1h_price"]);

export function normalizeHostname(value) {
  return String(value || "").toLowerCase().replace(/^www\./, "");
}

export function normalizePath(value) {
  const path = String(value || "/").replace(/\/$/, "");
  return path || "/";
}

function hashPath(value) {
  const hash = String(value || "").replace(/^#/, "").split("?", 1)[0];
  return normalizePath(hash || "/");
}

function stationUrl(station) {
  try { return new URL(String(station?.baseUrl || "")); } catch { return null; }
}

export function stationContext(station) {
  const url = stationUrl(station);
  return { url, hostname: normalizeHostname(url?.hostname), path: normalizePath(url?.pathname), hashPath: hashPath(url?.hash) };
}

const PAGE_SESSION_FAILURE_STATUSES = [401];
const PAGE_SESSION_FAILURE_MESSAGE = "页面会话已失效，请在当前 Chrome 配置文件重新登录后重试";

export function localStoragePageAuth(storageKey, header, missingMessage, scheme = "", sessionFailureStatuses = PAGE_SESSION_FAILURE_STATUSES, refresh = null, storagePaths = null) {
  return {
    source: "localStorage",
    storageKey,
    header,
    ...(scheme ? { scheme } : {}),
    ...(Array.isArray(storagePaths) && storagePaths.length ? { storagePaths } : {}),
    missingMessage,
    sessionFailureStatuses,
    sessionFailureMessage: PAGE_SESSION_FAILURE_MESSAGE,
    ...(refresh ? { refresh } : {})
  };
}

export function cookiePageAuth(sessionFailureStatuses = [401]) {
  return {
    source: "cookie",
    sessionFailureStatuses,
    sessionFailureMessage: PAGE_SESSION_FAILURE_MESSAGE
  };
}
// 站点把登录态只放在 HttpOnly cookie 里、且刷新接口校验 Origin 时用：
// service worker 借 declarativeNetRequest 改写 Origin 与 Cookie 换 access token，全程不开页面。
export function cookieRefreshAuth(options = {}) {
  return {
    cookieName: String(options.cookieName || ""),
    refreshPath: String(options.refreshPath || ""),
    accessTokenPath: options.accessTokenPath || "data.access_token",
    expiresAtPath: options.expiresAtPath || "",
    missingMessage: options.missingMessage || "未找到站点登录 cookie，请先在当前 Chrome 配置文件登录后重试",
    failureMessage: options.failureMessage || PAGE_SESSION_FAILURE_MESSAGE
  };
}

export function requestPolicy(endpoint, options = {}) {
  return {
    endpoint,
    endpointCandidates: options.endpointCandidates || "provider",
    headers: options.headers || {},
    pageHeaders: options.pageHeaders || [],
    credentials: options.credentials || "omit",
    priceKeys: options.priceKeys || RAW_PRICE_KEYS,
    query: options.query || null,
    pageAuth: options.pageAuth || null,
    cookieAuth: options.cookieAuth || null,
    preflight: options.preflight || null,
    skipCapture: options.skipCapture === true
  };
}

function publicPricingEndpoint(hostname) {
  if (hostname === "soleapi.com") return "/api/public/models";
  return hostname === "liuguang.ai" ? "/api/models" : "/api/pricing";
}

export function preparePublicPricing(stationInput, { url, hostname }) {
  return {
    ...stationInput,
    baseUrl: url.origin,
    auth: { type: "none" },
    mode: "direct",
    adapter: {
      ...(stationInput.adapter || {}),
      kind: "public-pricing",
      endpoint: publicPricingEndpoint(hostname),
      method: "GET",
      responseFormat: "auto"
    }
  };
}

export function publicPricingProvider(id, hostname, preset = null, rationale = "通过公开价格 API 直连采集") {
  return {
    id,
    host: hostname,
    matches: ({ hostname: current }) => current === hostname,
    prepare: preparePublicPricing,
    mode: "direct",
    authType: "none",
    rationale,
    preset,
    request: requestPolicy(({ hostname: current }) => publicPricingEndpoint(current), { credentials: "omit" })
  };
}

const PROVIDER_ORDER = SITE_PLUGIN_ORDER;
// Keep the exported binding stable: collectors and request strategies read it lazily.
export const PROVIDER_REGISTRY = [];

export function listSiteProviders() {
  return [...PROVIDER_REGISTRY];
}

export function registerSiteProvider(provider) {
  if (!provider?.id || typeof provider.matches !== "function") throw new Error("站点插件缺少有效的 id 或 matches");
  const index = PROVIDER_REGISTRY.findIndex(item => item.id === provider.id);
  if (index >= 0) PROVIDER_REGISTRY[index] = provider;
  else PROVIDER_REGISTRY.push(provider);
  PROVIDER_REGISTRY.sort((left, right) => {
    const leftOrder = PROVIDER_ORDER.indexOf(left.id);
    const rightOrder = PROVIDER_ORDER.indexOf(right.id);
    return (leftOrder < 0 ? PROVIDER_ORDER.length : leftOrder) - (rightOrder < 0 ? PROVIDER_ORDER.length : rightOrder);
  });
  return provider;
}

export function unregisterSiteProvider(id) {
  const index = PROVIDER_REGISTRY.findIndex(item => item.id === id);
  if (index >= 0) PROVIDER_REGISTRY.splice(index, 1);
}

export function retainSiteProviders(providerIds) {
  const retained = providerIds instanceof Set ? providerIds : new Set(providerIds);
  PROVIDER_REGISTRY.splice(0, PROVIDER_REGISTRY.length, ...PROVIDER_REGISTRY.filter(provider => retained.has(provider.id)));
}

export function resetProviderRegistry() {
  PROVIDER_REGISTRY.splice(0, PROVIDER_REGISTRY.length);
}

export function providerForStation(station = {}, { forPrepare = false } = {}) {
  const context = stationContext(station);
  if (!context.url) return null;
  return PROVIDER_REGISTRY.find(provider => (forPrepare ? provider.prepareMatches || provider.matches : provider.matches)(context, station)) || null;
}

// 插件自带的模型拼写适配：站点把 glm-5.3 写成别的样子时，由插件自己声明映射。
export function modelAliasesForStation(station = {}) {
  const provider = providerForStation(station);
  const aliases = provider?.modelAliases;
  return Array.isArray(aliases) ? aliases : [];
}

export function modelAliasesForStations(stations = []) {
  const result = {};
  for (const station of stations) {
    const aliases = modelAliasesForStation(station);
    if (aliases.length) result[station.id] = aliases;
  }
  return result;
}

export function providerById(id) {
  return PROVIDER_REGISTRY.find(provider => provider.id === id) || null;
}

export function prepareStationInput(stationInput = {}) {
  const provider = providerForStation(stationInput, { forPrepare: true });
  const prepared = provider?.prepare ? provider.prepare(stationInput, stationContext(stationInput)) : stationInput;
  const priceCurrency = provider?.preservePriceCurrency && prepared.priceCurrency ? prepared.priceCurrency : "CREDITS";
  return { ...prepared, priceCurrency, priceCurrencyVerified: true, rechargeRateVerified: provider?.preserveRechargeRateVerification ? prepared.rechargeRateVerified !== false : true };
}
