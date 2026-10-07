export const PUBLIC_PRICING_HOSTS = new Set(["nomissapi.com", "yorhamc.com", "token123.cfd"]);
export const CHEAP_ROUTER_PRICING_ENDPOINT = "/api/v1/pricing/public?timezone=Asia%2FShanghai";
export const AIAPI_MODEL_CATALOG_ENDPOINT = "/api/me/model-catalog";
export const NEXA_CHANNEL_CATALOG_ENDPOINT = "/api/v1/channels/catalog?available_only=true&timezone=Asia%2FShanghai";

const fastAiPreset = {
  id: "fastaitoken",
  name: "fastaitoken.com",
  baseUrl: "https://www.fastaitoken.com/available-channels",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { endpoint: "/api/v1/channels/available", method: "GET", responseFormat: "auto" }
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

export function addFastAiStationPreset(stations) {
  if (!stations.length || stations.some(station => {
    try { return new URL(station.baseUrl).hostname.toLowerCase().replace(/^www\./, "") === "fastaitoken.com"; }
    catch { return false; }
  })) return stations;
  const ids = new Set(stations.map(station => station.id));
  let id = fastAiPreset.id;
  for (let suffix = 2; ids.has(id); suffix++) id = `${fastAiPreset.id}-${suffix}`;
  return [...stations, { ...fastAiPreset, id, auth: { ...fastAiPreset.auth }, adapter: { ...fastAiPreset.adapter } }];
}

export function addNexaStationPreset(stations) {
  if (!stations.length || stations.some(station => {
    try { return new URL(station.baseUrl).hostname.toLowerCase().replace(/^www\./, "") === "nexavlinks.com"; }
    catch { return false; }
  })) return stations;
  const ids = new Set(stations.map(station => station.id));
  let id = nexaPreset.id;
  for (let suffix = 2; ids.has(id); suffix++) id = `${nexaPreset.id}-${suffix}`;
  return [...stations, { ...nexaPreset, id, auth: { ...nexaPreset.auth }, adapter: { ...nexaPreset.adapter } }];
}

const cheapRouterPreset = {
  id: "cheaprouter",
  name: "cheaprouter.cc",
  baseUrl: "https://cheaprouter.cc/models",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { kind: "cheaprouter", endpoint: CHEAP_ROUTER_PRICING_ENDPOINT, method: "GET", responseFormat: "auto" }
};

export function addCheapRouterStationPreset(stations) {
  if (!stations.length || stations.some(station => {
    try { return new URL(station.baseUrl).hostname.toLowerCase().replace(/^www\./, "") === "cheaprouter.cc"; }
    catch { return false; }
  })) return stations;
  const ids = new Set(stations.map(station => station.id));
  let id = cheapRouterPreset.id;
  for (let suffix = 2; ids.has(id); suffix++) id = `${cheapRouterPreset.id}-${suffix}`;
  return [...stations, { ...cheapRouterPreset, id, auth: { ...cheapRouterPreset.auth }, adapter: { ...cheapRouterPreset.adapter } }];
}

const aiApiPreset = {
  id: "aiapi",
  name: "AIAPI",
  baseUrl: "https://cn.aiapi.bot/dashboard/model-prices",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { kind: "aiapi-model-catalog", endpoint: AIAPI_MODEL_CATALOG_ENDPOINT, method: "GET", responseFormat: "auto" }
};

export function addAiApiStationPreset(stations) {
  if (!stations.length || stations.some(station => {
    try { return new URL(station.baseUrl).hostname.toLowerCase() === "cn.aiapi.bot"; }
    catch { return false; }
  })) return stations;
  const ids = new Set(stations.map(station => station.id));
  let id = aiApiPreset.id;
  for (let suffix = 2; ids.has(id); suffix++) id = `${aiApiPreset.id}-${suffix}`;
  return [...stations, { ...aiApiPreset, id, auth: { ...aiApiPreset.auth }, adapter: { ...aiApiPreset.adapter } }];
}
