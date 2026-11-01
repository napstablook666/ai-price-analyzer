import { DEFAULT_EXCHANGE_RATE } from "../shared/schema.js";
import { PRICE_FIELD_DEFINITIONS } from "./price-fields.js";
import { AIAPI_PRICE_KEYS } from "./aiapi-contract.js";

const MODEL_PLAZA_RAW_PRICE_KEYS = [
  "per_request_price", "rate_multiplier", "user_rate_multiplier", "image_rate_multiplier", "video_rate_multiplier"
];
export { AIAPI_EFFECTIVE_PRICE_FIELDS, AIAPI_GROUP_PRICE_FIELDS, AIAPI_PRICE_KEYS } from "./aiapi-contract.js";
export const PUBLIC_PRICING_HOSTS = new Set(["nomissapi.com", "yorhamc.com", "token123.cfd", "liuguang.ai", "dddai.dev"]);
export const CHEAP_ROUTER_PRICING_ENDPOINT = "/api/v1/pricing/public?timezone=Asia%2FShanghai";
export const SIDRUNE_MODEL_PLAZA_ENDPOINT = "/api/v1/model-plaza/public";
export const NODEAI_MODEL_PLAZA_ENDPOINT = "/api/v1/model-plaza";
export const KILLAI_MODEL_PLAZA_ENDPOINT = "/api/v1/model-plaza?timezone=Asia%2FShanghai";
export const TOKENFLUX_PRICING_ENDPOINT = "/api/pricing";
export const CENTOS_PRICING_ENDPOINT = "/api/pricing";
export const SEVENAI_MODEL_PLAZA_ENDPOINT = "/api/v1/model-plaza?timezone=Asia%2FShanghai";
export const FUCK_EVERYONE_MODEL_PLAZA_ENDPOINT = "/api/v1/model-plaza";
export const TRUE_SOTA_MODEL_PRICING_ENDPOINT = "/api/v1/model-pricing";
export const NEXA_CHANNEL_CATALOG_ENDPOINT = "/api/v1/channels/catalog?available_only=true&timezone=Asia%2FShanghai";
export const AIAPI_MODEL_CATALOG_ENDPOINT = "/api/me/model-catalog";
export const ALL_IN_ONE_MODELS_ENDPOINT = "/api/tenant/models";
const AIAPI_MODEL_CATALOG_FORMAT = "aiapi-model-catalog";
export const HEPINGAN_CHANNELS_ENDPOINT = "/api/v1/channels/available";

export const RAW_PRICE_KEYS = new Set([
  "model_ratio", "ratio", "input_ratio", "completion_ratio", "group_ratio",
  ...MODEL_PLAZA_RAW_PRICE_KEYS,
  ...PRICE_FIELD_DEFINITIONS.flatMap(field => field.aliases)
].map(key => key.toLowerCase()));
const ALL_IN_ONE_PRICE_KEYS = new Set([...RAW_PRICE_KEYS, "cache_read", "cache_creation_price", "cache_creation_1h_price"]);

const JIJI_HOST = "jiji.cc";
const JIJI_MODEL_PAGE = "/custom/13235f4cd3f1e94e";
const JIJI_LEGACY_MODEL_PAGE = "/extension/models";
const JIJI_MODEL_API = "/extension/api/trpc/extension.modelMarket";
const JIJI_INPUT = JSON.stringify({ 0: { json: {} } });

const fastAiPreset = {
  id: "fastaitoken",
  name: "fastaitoken.com",
  baseUrl: "https://www.fastaitoken.com/available-channels",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { endpoint: "/api/v1/channels/available", method: "GET", responseFormat: "auto" }
};
const dddaiPreset = {
  id: "dddai",
  name: "dddai.dev",
  baseUrl: "https://dddai.dev/pricing",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "public-pricing", endpoint: "/api/pricing", method: "GET", responseFormat: "auto" }
};
const liuguangPreset = {
  id: "liuguang",
  name: "liuguang.ai",
  baseUrl: "https://www.liuguang.ai/pricing",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "public-pricing", endpoint: "/api/models", method: "GET", responseFormat: "auto" }
};
const cunPreset = {
  id: "cun",
  name: "CUN.AI",
  baseUrl: "https://www.cun.ai/pricing",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { kind: "cun", endpoint: "/api/pricing", method: "GET", responseFormat: "auto" }
};
const cheapRouterPreset = {
  id: "cheaprouter",
  name: "cheaprouter.cc",
  baseUrl: "https://cheaprouter.cc/models",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "cheaprouter", endpoint: CHEAP_ROUTER_PRICING_ENDPOINT, method: "GET", responseFormat: "auto" }
};
const sidrunePreset = {
  id: "sidrune",
  name: "sidrune.ai",
  baseUrl: "https://sidrune.ai/model-plaza",
  enabled: true,
  mode: "direct",
  rechargeRmb: DEFAULT_EXCHANGE_RATE,
  rechargeCurrency: "USD",
  rechargeCredits: 1,
  auth: { type: "none" },
  adapter: { kind: "sidrune-model-plaza", endpoint: SIDRUNE_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "auto" }
};
const nodeAiPreset = {
  id: "nodeai",
  name: "NodeAI",
  baseUrl: "https://nodeai.cc/model-plaza",
  rechargeRmb: 1,
  rechargeCurrency: "CNY",
  rechargeCredits: 1,
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "nodeai-model-plaza", endpoint: NODEAI_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "nodeai-model-plaza" }
};
const killAiPreset = {
  id: "killai",
  name: "KillAI",
  baseUrl: "https://api.killai.cc/model-plaza?embedded=1",
  rechargeRmb: 1,
  rechargeCurrency: "CNY",
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "KillAI 充值折算尚未核验，当前不参与已验证比价推荐。",
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { kind: "killai-model-plaza", endpoint: KILLAI_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "killai-model-plaza" }
};
const sevenAiPreset = {
  id: "sevenai",
  name: "SevenAI",
  baseUrl: "https://sevenai.moe/model-plaza?embedded=1",
  rechargeRateVerified: false,
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "sevenai-model-plaza", endpoint: SEVENAI_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "sevenai-model-plaza" }
};
const tokenFluxPreset = {
  id: "tokenflux",
  name: "TokenFlux",
  baseUrl: "https://tokenflux.cloud/pricing",
  rechargeRateVerified: false,
  rechargeRateNote: "TokenFlux 未公开充值折算，当前不参与已验证比价推荐。",
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "tokenflux", endpoint: TOKENFLUX_PRICING_ENDPOINT, method: "GET", responseFormat: "tokenflux" }
};
const centosPreset = {
  id: "centos",
  name: "ai.centos.hk",
  baseUrl: "https://ai.centos.hk/pricing",
  rechargeRateVerified: false,
  rechargeRateNote: "ai.centos.hk 充值折算尚未核验，当前不参与已验证比价推荐。",
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "tokenflux", endpoint: CENTOS_PRICING_ENDPOINT, method: "GET", responseFormat: "tokenflux" }
};
const fuckEveryonePreset = {
  id: "fuck-everyone",
  name: "fuck-everyone.com",
  baseUrl: "https://fuck-everyone.com/model-plaza?embedded=1",
  rechargeRmb: 1,
  rechargeCurrency: "CNY",
  rechargeCredits: 1,
  rechargeRateVerified: false,
  rechargeRateNote: "站点未公开币种与充值折算，当前按 CNY 1:1 估算。",
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  priceCurrencyNote: "",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "fuck-everyone-model-plaza", endpoint: FUCK_EVERYONE_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "fuck-everyone-model-plaza" }
};
const trueSotaPreset = {
  id: "true-sota",
  name: "TrueSOTA",
  baseUrl: "https://true-sota.com/model-pricing",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "true-sota-model-pricing", endpoint: TRUE_SOTA_MODEL_PRICING_ENDPOINT, method: "GET", responseFormat: "auto" }
};
const nexaPreset = {
  id: "nexavlinks",
  name: "NexaVlinks",
  baseUrl: "https://www.nexavlinks.com/modelsmarket",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { endpoint: NEXA_CHANNEL_CATALOG_ENDPOINT, method: "GET", responseFormat: "auto" }
};
const aiApiPreset = {
  id: "aiapi",
  name: "AIAPI",
  baseUrl: "https://cn.aiapi.bot/dashboard/model-prices",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { kind: "aiapi-model-catalog", endpoint: AIAPI_MODEL_CATALOG_ENDPOINT, method: "GET", responseFormat: AIAPI_MODEL_CATALOG_FORMAT }
};

const allInOnePreset = {
  id: "all-in-one",
  name: "all-in-one.icu",
  baseUrl: "https://all-in-one.icu/#/tenant/models",
  rechargeRateVerified: false,
  priceCurrency: "CREDITS",
  priceCurrencyVerified: true,
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { kind: "all-in-one-models", endpoint: ALL_IN_ONE_MODELS_ENDPOINT, method: "GET", responseFormat: "all-in-one-models", pageUrl: "https://all-in-one.icu/#/tenant/models" }
};
const hepinganPreset = {
  id: "hepingan",
  name: "hepingan.top",
  baseUrl: "https://api.hepingan.top/available-channels",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { endpoint: HEPINGAN_CHANNELS_ENDPOINT, method: "GET", responseFormat: "auto" }
};
function normalizeHostname(value) {
  return String(value || "").toLowerCase().replace(/^www\./, "");
}

function normalizePath(value) {
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

function exactPath(...paths) {
  const allowed = new Set(paths.map(normalizePath));
  return ({ path }) => allowed.has(path);
}

const isJijiModelPath = exactPath("/", JIJI_MODEL_PAGE, JIJI_LEGACY_MODEL_PAGE, JIJI_MODEL_API);

function publicPricingEndpoint(hostname) {
  if (hostname === "soleapi.com") return "/api/public/models";
  return hostname === "liuguang.ai" ? "/api/models" : "/api/pricing";
}

const PAGE_SESSION_FAILURE_STATUSES = [401];
const PAGE_SESSION_FAILURE_MESSAGE = "页面会话已失效，请在当前 Chrome 配置文件重新登录后重试";

function localStoragePageAuth(storageKey, header, missingMessage, scheme = "", sessionFailureStatuses = PAGE_SESSION_FAILURE_STATUSES, refresh = null) {
  return {
    source: "localStorage",
    storageKey,
    header,
    ...(scheme ? { scheme } : {}),
    missingMessage,
    sessionFailureStatuses,
    sessionFailureMessage: PAGE_SESSION_FAILURE_MESSAGE,
    ...(refresh ? { refresh } : {}),
  };

}
const killAiPageAuth = localStoragePageAuth("auth_token", "Authorization", "未找到 KillAI 登录凭据，请先在当前 Chrome 配置文件登录后重试", "Bearer", PAGE_SESSION_FAILURE_STATUSES, {
  endpoint: "/api/v1/auth/refresh",
  credentials: "same-origin",
  includeAccessToken: true,
  refreshTokenStorageKey: "refresh_token",
  responsePath: "data",
  accessTokenKey: "access_token",
  refreshTokenKey: "refresh_token",
  expiresInKey: "expires_in",
  expiresAtStorageKey: "token_expires_at",
});

function cookiePageAuth(sessionFailureStatuses = [401]) {
  return {
    source: "cookie",
    sessionFailureStatuses,
    sessionFailureMessage: PAGE_SESSION_FAILURE_MESSAGE
  };
}

function requestPolicy(endpoint, options = {}) {
  return {
    endpoint,
    endpointCandidates: options.endpointCandidates || "provider",
    headers: options.headers || {},
    pageHeaders: options.pageHeaders || [],
    credentials: options.credentials || "omit",
    priceKeys: options.priceKeys || RAW_PRICE_KEYS,
    query: options.query || null,
    pageAuth: options.pageAuth || null,
    skipCapture: options.skipCapture === true
  };
}

function preparePublicPricing(stationInput, { url, hostname }) {
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

function jijiRequestConfig(value) {
  const url = value instanceof URL ? value : stationUrl({ baseUrl: value });
  if (!url || normalizeHostname(url.hostname) !== JIJI_HOST || !isJijiModelPath({ path: normalizePath(url.pathname) })) return null;
  const token = url.searchParams.get("token") || "";
  const endpoint = new URL(JIJI_MODEL_API, url.origin);
  endpoint.searchParams.set("batch", "1");
  endpoint.searchParams.set("input", JIJI_INPUT);
  return { baseUrl: `${url.origin}${JIJI_MODEL_PAGE}`, endpoint: endpoint.toString(), token };
}

function prepareJiji(stationInput, { url }) {
  const config = jijiRequestConfig(url);
  if (!config) return stationInput;
  const inputAuth = stationInput.auth || {};
  const token = String(inputAuth.token || config.token || "").trim();
  return {
    ...stationInput,
    baseUrl: config.baseUrl,
    mode: "page",
    auth: token ? { ...inputAuth, type: "bearer", token } : inputAuth,
    adapter: { ...(stationInput.adapter || {}), kind: "jiji", endpoint: config.endpoint, method: "GET", responseFormat: "auto" }
  };
}

const publicPricingProvider = (id, hostname, preset = null, rationale = "通过公开价格 API 直连采集") => ({
  id,
  host: hostname,
  matches: ({ hostname: current }) => current === hostname,
  prepare: preparePublicPricing,
  mode: "direct",
  authType: "none",
  rationale,
  preset,
  request: requestPolicy(({ hostname: current }) => publicPricingEndpoint(current), { credentials: "omit" })
});

export const PROVIDER_REGISTRY = [
  {
    id: "sevenai",
    preserveRechargeRateVerification: true,
    host: "sevenai.moe",
    matches: ({ hostname, path }) => hostname === "sevenai.moe" && path === "/model-plaza",
    prepare: (stationInput, { url }) => ({
      ...stationInput,
      baseUrl: `${url.origin}/model-plaza?embedded=1`,
      rechargeRateVerified: stationInput.rechargeRateVerified === true,
      mode: "direct",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), kind: "sevenai-model-plaza", endpoint: SEVENAI_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "sevenai-model-plaza" }
    }),
    mode: "direct",
    responseFormat: "sevenai-model-plaza",
    authType: "none",
    rationale: "SevenAI 通过公开模型广场 API 直连采集",
    preset: sevenAiPreset,
    request: requestPolicy(() => SEVENAI_MODEL_PLAZA_ENDPOINT, { credentials: "omit" })
  },
  {
    id: "tokenflux",
    host: "tokenflux.cloud",
    matches: ({ hostname, path }) => hostname === "tokenflux.cloud" && ["/", "/pricing"].includes(path),
    prepareMatches: ({ hostname }) => hostname === "tokenflux.cloud",
    prepare: (stationInput, { url }) => ({
      ...stationInput,
      baseUrl: `${url.origin}/pricing`,
      mode: "direct",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), kind: "tokenflux", endpoint: TOKENFLUX_PRICING_ENDPOINT, method: "GET", responseFormat: "tokenflux" }
    }),
    mode: "direct",
    responseFormat: "tokenflux",
    authType: "none",
    rationale: "TokenFlux 通过公开定价 API 直连采集",
    preset: tokenFluxPreset,
    request: requestPolicy(() => TOKENFLUX_PRICING_ENDPOINT, { credentials: "omit" })
  },
  {
    id: "centos",
    host: "ai.centos.hk",
    preserveRechargeRateVerification: true,
    matches: ({ hostname, path, url }) => hostname === "ai.centos.hk" && url?.hostname === "ai.centos.hk" && path === "/pricing",
    prepare: (stationInput, { url }) => ({
      ...stationInput,
      baseUrl: `${url.origin}/pricing`,
      rechargeRateVerified: stationInput.rechargeRateVerified === true,
      mode: "direct",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), kind: "tokenflux", endpoint: CENTOS_PRICING_ENDPOINT, method: "GET", responseFormat: "tokenflux" }
    }),
    mode: "direct",
    responseFormat: "tokenflux",
    authType: "none",
    rationale: "ai.centos.hk 通过公开定价 API 直连采集",
    preset: centosPreset,
    request: requestPolicy(() => CENTOS_PRICING_ENDPOINT, { credentials: "omit" })
  },
  {
    id: "true-sota",
    host: "true-sota.com",
    matches: ({ hostname, path }) => hostname === "true-sota.com" && path === "/model-pricing",
    prepare: (stationInput, { url }) => ({
      ...stationInput,
      baseUrl: `${url.origin}/model-pricing`,
      mode: "direct",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), kind: "true-sota-model-pricing", endpoint: TRUE_SOTA_MODEL_PRICING_ENDPOINT, method: "GET", responseFormat: "auto" }
    }),
    mode: "direct",
    authType: "none",
    rationale: "TrueSOTA 通过公开模型价格 API 采集",
    preset: trueSotaPreset,
    request: requestPolicy(() => TRUE_SOTA_MODEL_PRICING_ENDPOINT, { credentials: "omit" })
  },
  {
    id: "sidrune",
    host: "sidrune.ai",
    matches: ({ hostname, path }) => hostname === "sidrune.ai" && path === "/model-plaza",
    prepare: (stationInput, { url }) => ({
      ...stationInput,
      baseUrl: `${url.origin}/model-plaza`,
      mode: "direct",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), kind: "sidrune-model-plaza", endpoint: SIDRUNE_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "auto" }
    }),
    mode: "direct",
    authType: "none",
    rationale: "Sidrune 通过公开模型广场 API 采集",
    preset: options => ({ ...sidrunePreset, rechargeRmb: options.exchangeRate ?? DEFAULT_EXCHANGE_RATE }),
    request: requestPolicy(() => SIDRUNE_MODEL_PLAZA_ENDPOINT, { credentials: "omit" })
  },
  {
    id: "nodeai",
    host: "nodeai.cc",
    matches: ({ hostname, path }) => hostname === "nodeai.cc" && path === "/model-plaza",
    prepare: (stationInput, { url }) => ({
      ...stationInput,
      baseUrl: nodeAiPreset.baseUrl,
      mode: "direct",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), kind: "nodeai-model-plaza", endpoint: NODEAI_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "nodeai-model-plaza" }
    }),
    mode: "direct",
    responseFormat: "nodeai-model-plaza",
    authType: "none",
    rationale: "NodeAI 通过公开模型广场 API 直连采集",
    preset: nodeAiPreset,
    request: requestPolicy(() => NODEAI_MODEL_PLAZA_ENDPOINT, { credentials: "omit" })
  },
  {
    id: "killai",
    host: "api.killai.cc",
    preserveRechargeRateVerification: true,
    matches: ({ hostname, path }) => hostname === "api.killai.cc" && path === "/model-plaza",
    prepare: (stationInput, { url }) => {
      const prepared = {
        ...stationInput,
        baseUrl: `${url.origin}/model-plaza?embedded=1`,
        mode: "page",
        auth: { type: "none" },
        adapter: { ...(stationInput.adapter || {}), kind: "killai-model-plaza", endpoint: KILLAI_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "killai-model-plaza" }
      };
      if (prepared.rechargeRmb == null) prepared.rechargeRmb = killAiPreset.rechargeRmb;
      if (!prepared.rechargeCurrency) prepared.rechargeCurrency = killAiPreset.rechargeCurrency;
      if (prepared.rechargeCredits == null) prepared.rechargeCredits = killAiPreset.rechargeCredits;
      if (typeof prepared.rechargeRateVerified !== "boolean") prepared.rechargeRateVerified = killAiPreset.rechargeRateVerified;
      if (prepared.rechargeRateNote == null) prepared.rechargeRateNote = killAiPreset.rechargeRateNote;
      if (!prepared.priceCurrency) prepared.priceCurrency = killAiPreset.priceCurrency;
      if (typeof prepared.priceCurrencyVerified !== "boolean") prepared.priceCurrencyVerified = killAiPreset.priceCurrencyVerified;
      if (prepared.priceCurrencyNote == null) prepared.priceCurrencyNote = killAiPreset.priceCurrencyNote;
      return prepared;
    },
    mode: "page",
    openTemporaryPage: true,
    responseFormat: "killai-model-plaza",
    authType: "none",
    rationale: "KillAI 通过已登录页面读取模型广场接口",
    preset: killAiPreset,
    request: requestPolicy(() => KILLAI_MODEL_PLAZA_ENDPOINT, { credentials: "include", pageAuth: killAiPageAuth })
  },
  {
    id: "fuck-everyone",
    preserveRechargeRateVerification: true,
    host: "fuck-everyone.com",
    matches: ({ hostname, path }) => hostname === "fuck-everyone.com" && path === "/model-plaza",
    prepare: (stationInput, { url }) => {
      const prepared = {
        ...stationInput,
        baseUrl: `${url.origin}/model-plaza?embedded=1`,
        mode: "direct",
        auth: { type: "none" },
        adapter: { ...(stationInput.adapter || {}), kind: "fuck-everyone-model-plaza", endpoint: FUCK_EVERYONE_MODEL_PLAZA_ENDPOINT, method: "GET", responseFormat: "fuck-everyone-model-plaza" }
      };
      if (prepared.rechargeRmb == null) prepared.rechargeRmb = fuckEveryonePreset.rechargeRmb;
      if (!prepared.rechargeCurrency) prepared.rechargeCurrency = fuckEveryonePreset.rechargeCurrency;
      if (prepared.rechargeCredits == null) prepared.rechargeCredits = fuckEveryonePreset.rechargeCredits;
      if (typeof prepared.rechargeRateVerified !== "boolean") prepared.rechargeRateVerified = fuckEveryonePreset.rechargeRateVerified;
      if (prepared.rechargeRateNote == null) prepared.rechargeRateNote = fuckEveryonePreset.rechargeRateNote;
      if (!prepared.priceCurrency || (prepared.priceCurrency === "UNKNOWN" && prepared.priceCurrencyVerified !== true)) prepared.priceCurrency = fuckEveryonePreset.priceCurrency;
      if (typeof prepared.priceCurrencyVerified !== "boolean") prepared.priceCurrencyVerified = fuckEveryonePreset.priceCurrencyVerified;
      if (prepared.priceCurrencyNote == null) prepared.priceCurrencyNote = fuckEveryonePreset.priceCurrencyNote;
      return prepared;
    },
    mode: "direct",
    responseFormat: "fuck-everyone-model-plaza",
    authType: "none",
    rationale: "fuck-everyone.com 通过公开模型广场 API 直连采集",
    preset: fuckEveryonePreset,
    request: requestPolicy(() => FUCK_EVERYONE_MODEL_PLAZA_ENDPOINT, { credentials: "omit" })
  },
  {
    id: "cun",
    host: "cun.ai",
    matches: ({ hostname, path }) => hostname === "cun.ai" && ["/", "/pricing"].includes(path),
    prepareMatches: ({ hostname }) => hostname === "cun.ai",
    prepare: (stationInput, { url }) => ({
      ...stationInput,
      baseUrl: `${url.origin}/pricing`,
      mode: "page",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), kind: "cun", endpoint: "/api/pricing", method: "GET", responseFormat: "auto" }
    }),
    mode: "page",
    openTemporaryPage: true,
    authType: "none",
    rationale: "CUN.AI 通过已登录页面读取价格 API",
    preset: cunPreset,
    request: requestPolicy(() => "/api/pricing", {
      credentials: "include",
      pageAuth: localStoragePageAuth("uid", "New-Api-User", "未找到 CUN.AI 登录凭据，请先在当前 Chrome 配置文件登录后重试")
    })
  },
  publicPricingProvider("soleapi", "soleapi.com", null, "SoleAPI 通过公开模型价格 API 采集"),
  publicPricingProvider("dddai", "dddai.dev", dddaiPreset),
  publicPricingProvider("liuguang", "liuguang.ai", liuguangPreset),
  {
    ...publicPricingProvider("public-pricing", "nomissapi.com"),
    matches: ({ hostname }) => PUBLIC_PRICING_HOSTS.has(hostname) && !["dddai.dev", "liuguang.ai"].includes(hostname)
  },
  {
    id: "hepingan",
    host: "api.hepingan.top",
    matches: ({ hostname, path }) => hostname === "api.hepingan.top" && path === "/available-channels",
    prepareMatches: ({ hostname }) => hostname === "api.hepingan.top",
    prepare: (stationInput, { url }) => ({
      ...stationInput,
      baseUrl: `${url.origin}/available-channels`,
      mode: "page",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), endpoint: HEPINGAN_CHANNELS_ENDPOINT, method: "GET", responseFormat: "auto" }
    }),
    mode: "page",
    openTemporaryPage: true,
    rationale: "Hepingan 复用当前 Chrome 配置文件的持久登录态，首次使用需先登录一次",
    preset: hepinganPreset,
    request: requestPolicy(() => HEPINGAN_CHANNELS_ENDPOINT, {
      credentials: "include",
      pageAuth: localStoragePageAuth("auth_token", "Authorization", "未找到 Hepingan 登录凭据，请先在当前 Chrome 配置文件登录后重试", "Bearer", [401])
    })
  },
  {
    id: "all-in-one",
    preserveRechargeRateVerification: true,
    host: "all-in-one.icu",
    matches: ({ hostname, path, hashPath }, station = {}) => hostname === "all-in-one.icu" && (hashPath === "/tenant/models" || (path === "/" && station.adapter?.kind === "all-in-one-models")),
    prepareMatches: ({ hostname, path, hashPath }, station = {}) => hostname === "all-in-one.icu" && (hashPath === "/tenant/models" || (path === "/" && station.adapter?.kind === "all-in-one-models")),
    prepare: (stationInput, { url }) => {
      const prepared = {
        ...stationInput,
        baseUrl: `${url.origin}/#/tenant/models`,
        mode: "page",
        auth: { type: "none" },
        adapter: { ...(stationInput.adapter || {}), kind: "all-in-one-models", endpoint: ALL_IN_ONE_MODELS_ENDPOINT, method: "GET", responseFormat: "all-in-one-models", pageUrl: `${url.origin}/#/tenant/models` }
      };
      if (typeof prepared.rechargeRateVerified !== "boolean") prepared.rechargeRateVerified = allInOnePreset.rechargeRateVerified;
      if (!prepared.priceCurrency) prepared.priceCurrency = allInOnePreset.priceCurrency;
      if (typeof prepared.priceCurrencyVerified !== "boolean") prepared.priceCurrencyVerified = allInOnePreset.priceCurrencyVerified;
      return prepared;
    },
    mode: "page",
    openTemporaryPage: true,
    responseFormat: "all-in-one-models",
    authType: "none",
    rationale: "all-in-one.icu 通过已登录页面读取租户模型价格",
    preset: allInOnePreset,
    request: requestPolicy(() => ALL_IN_ONE_MODELS_ENDPOINT, {
      priceKeys: ALL_IN_ONE_PRICE_KEYS,
      credentials: "include",
      pageAuth: localStoragePageAuth("tenant_access_token", "Authorization", "未找到 all-in-one.icu 登录凭据，请先在当前 Chrome 配置文件登录后重试", "Bearer", [401, 403]),
      skipCapture: true
    })
  },
  {
    id: "aiapi",
    host: "cn.aiapi.bot",
    matches: ({ hostname, path }) => hostname === "cn.aiapi.bot" && path === "/dashboard/model-prices",
    prepare: (stationInput, { url }) => ({
      ...stationInput,
      baseUrl: `${url.origin}/dashboard/model-prices`,
      mode: "page",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), kind: "aiapi-model-catalog", endpoint: AIAPI_MODEL_CATALOG_ENDPOINT, method: "GET", responseFormat: AIAPI_MODEL_CATALOG_FORMAT }
    }),
    mode: "page",
    responseFormat: AIAPI_MODEL_CATALOG_FORMAT,
    openTemporaryPage: true,
    authType: "none",
    rationale: "AIAPI 通过已登录页面读取模型价格",
    preset: aiApiPreset,
    request: requestPolicy(() => AIAPI_MODEL_CATALOG_ENDPOINT, {
      priceKeys: AIAPI_PRICE_KEYS,
      credentials: "include",
      pageAuth: cookiePageAuth()
    })
  },
  {
    id: "fastaitoken",
    host: "fastaitoken.com",
    matches: ({ hostname }) => hostname === "fastaitoken.com",
    prepare: (stationInput, { url }) => {
      const path = url.pathname === "/" ? "/available-channels" : url.pathname;
      return {
        ...stationInput,
        baseUrl: `https://www.fastaitoken.com${path}`,
        mode: "page",
        adapter: { ...(stationInput.adapter || {}), endpoint: "/api/v1/channels/available", method: "GET", responseFormat: "auto" }
      };
    },
    mode: "page",
    openTemporaryPage: true,
    rationale: "FastAIToken 通过已登录页面读取可用渠道",
    preset: fastAiPreset,
    request: requestPolicy(() => "/api/v1/channels/available", {
      headers: { "X-User-UI-Request": "1" },
      pageHeaders: ["X-User-UI-Request"],
      credentials: "include",
      pageAuth: localStoragePageAuth("auth_token", "Authorization", "未找到 FastAIToken 登录凭据，请先在当前 Chrome 配置文件登录后重试", "Bearer", [401])
    })
  },
  {
    id: "nexavlinks",
    host: "nexavlinks.com",
    matches: ({ hostname }) => hostname === "nexavlinks.com",
    prepare: (stationInput, { url }) => ({
      ...stationInput,
      baseUrl: `${url.origin}/modelsmarket`,
      mode: "page",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), endpoint: NEXA_CHANNEL_CATALOG_ENDPOINT, method: "GET", responseFormat: "auto" }
    }),
    mode: "page",
    openTemporaryPage: true,
    rationale: "NexaVlinks 通过已登录页面读取模型渠道",
    preset: nexaPreset,
    request: requestPolicy(() => NEXA_CHANNEL_CATALOG_ENDPOINT, { credentials: "include" })
  },
  {
    id: "cheaprouter",
    host: "cheaprouter.cc",
    matches: ({ hostname, path }) => hostname === "cheaprouter.cc" && path === "/models",
    prepare: (stationInput, { url }) => ({
      ...stationInput,
      baseUrl: `${url.origin}/models`,
      mode: "direct",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), kind: "cheaprouter", endpoint: CHEAP_ROUTER_PRICING_ENDPOINT, method: "GET", responseFormat: "auto" }
    }),
    mode: "direct",
    rationale: "CheapRouter 通过公开模型价格 API 直连采集",
    preset: cheapRouterPreset,
    request: requestPolicy(() => CHEAP_ROUTER_PRICING_ENDPOINT, { credentials: "omit" })
  },
  {
    id: "jiji",
    host: JIJI_HOST,
    matches: ({ hostname, path }) => hostname === JIJI_HOST && isJijiModelPath({ path }),
    prepareMatches: ({ hostname, path }) => hostname === JIJI_HOST && isJijiModelPath({ path }),
    prepare: prepareJiji,
    mode: "direct",
    openTemporaryPage: true,
    rationale: "通过吉吉模型市场 API 直连采集",
    request: requestPolicy(() => JIJI_MODEL_API, {
      endpointCandidates: "provider",
      query: { batch: "1", input: JIJI_INPUT },
      headers: { "x-trpc-source": "browser-client" },
      pageHeaders: ["x-trpc-source", "Authorization"],
      credentials: "omit",
      pageAuth: localStoragePageAuth("auth_token", "Authorization", "未找到 Jiji 登录凭据，请先在当前 Chrome 配置文件登录后重试", "Bearer", [401])
    })
  }
];

export function providerForStation(station = {}, { forPrepare = false } = {}) {
  const context = stationContext(station);
  if (!context.url) return null;
  return PROVIDER_REGISTRY.find(provider => (forPrepare ? provider.prepareMatches || provider.matches : provider.matches)(context, station)) || null;
}

export function providerById(id) {
  return PROVIDER_REGISTRY.find(provider => provider.id === id) || null;
}

export function prepareStationInput(stationInput = {}) {
  const provider = providerForStation(stationInput, { forPrepare: true });
  const prepared = provider?.prepare ? provider.prepare(stationInput, stationContext(stationInput)) : stationInput;
  return { ...prepared, priceCurrency: "CREDITS", priceCurrencyVerified: true, rechargeRateVerified: provider?.preserveRechargeRateVerification ? prepared.rechargeRateVerified !== false : true };
}
