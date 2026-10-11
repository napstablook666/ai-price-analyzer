import { DEFAULT_EXCHANGE_RATE } from "../shared/schema.js";
export const PUBLIC_PRICING_HOSTS = new Set(["nomissapi.com", "yorhamc.com", "token123.cfd", "liuguang.ai", "dddai.dev"]);
export const CHEAP_ROUTER_PRICING_ENDPOINT = "/api/v1/pricing/public?timezone=Asia%2FShanghai";
export const SIDRUNE_MODEL_PLAZA_ENDPOINT = "/api/v1/model-plaza/public";
export const TRUE_SOTA_MODEL_PRICING_ENDPOINT = "/api/v1/model-pricing";
export const NEXA_CHANNEL_CATALOG_ENDPOINT = "/api/v1/channels/catalog?available_only=true&timezone=Asia%2FShanghai";
export const AIAPI_MODEL_CATALOG_ENDPOINT = "/api/me/model-catalog";

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
  mode: "page",
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
  adapter: { kind: "aiapi-model-catalog", endpoint: AIAPI_MODEL_CATALOG_ENDPOINT, method: "GET", responseFormat: "auto" }
};

function addStationPreset(stations, preset, hostname) {
  if (!stations.length || stations.some(station => {
    try { return new URL(station.baseUrl).hostname.toLowerCase().replace(/^www\./, "") === hostname; }
    catch { return false; }
  })) return stations;
  const ids = new Set(stations.map(station => station.id));
  let id = preset.id;
  for (let suffix = 2; ids.has(id); suffix++) id = `${preset.id}-${suffix}`;
  return [...stations, { ...preset, id, auth: { ...preset.auth }, adapter: { ...preset.adapter } }];
}

export function addFastAiStationPreset(stations) {
  return addStationPreset(stations, fastAiPreset, "fastaitoken.com");
}
export function addNexaStationPreset(stations) {
  return addStationPreset(stations, nexaPreset, "nexavlinks.com");
}

export function addDddaiStationPreset(stations) {
  return addStationPreset(stations, dddaiPreset, "dddai.dev");
}

export function addLiuguangStationPreset(stations) {
  return addStationPreset(stations, liuguangPreset, "liuguang.ai");
}
export function addCunStationPreset(stations) {
  return addStationPreset(stations, cunPreset, "cun.ai");
}


export function addSidruneStationPreset(stations, exchangeRate = DEFAULT_EXCHANGE_RATE) {
  return addStationPreset(stations, { ...sidrunePreset, rechargeRmb: exchangeRate }, "sidrune.ai");
}

export function addTrueSotaStationPreset(stations) {
  return addStationPreset(stations, trueSotaPreset, "true-sota.com");
}
export function addCheapRouterStationPreset(stations) {
  return addStationPreset(stations, cheapRouterPreset, "cheaprouter.cc");
}

export function addAiApiStationPreset(stations) {
  return addStationPreset(stations, aiApiPreset, "cn.aiapi.bot");
}
