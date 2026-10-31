import { DEFAULT_EXCHANGE_RATE } from "../shared/schema.js";
import { PROVIDER_REGISTRY, providerById, stationContext } from "./provider-registry.js";


function addStationPreset(stations, preset, hostname) {
  if (!stations.length || stations.some(station => {
    return stationContext(station).hostname === hostname;
  })) return stations;
  const ids = new Set(stations.map(station => station.id));
  let id = preset.id;
  for (let suffix = 2; ids.has(id); suffix++) id = `${preset.id}-${suffix}`;
  return [...stations, { ...preset, id, auth: { ...preset.auth }, adapter: { ...preset.adapter } }];
}

function addRegisteredStationPreset(stations, providerId, options = {}) {
  const provider = providerById(providerId);
  const preset = typeof provider?.preset === "function" ? provider.preset(options) : provider?.preset;
  return provider?.host && preset ? addStationPreset(stations, preset, provider.host) : stations;
}

export function addRegisteredStationPresets(stations, options = {}) {
  return PROVIDER_REGISTRY.reduce((current, provider) => {
    const preset = typeof provider.preset === "function" ? provider.preset(options) : provider.preset;
    return provider.host && preset ? addStationPreset(current, preset, provider.host) : current;
  }, stations);
}

export function addFastAiStationPreset(stations) {
  return addRegisteredStationPreset(stations, "fastaitoken");
}
export function addNexaStationPreset(stations) {
  return addRegisteredStationPreset(stations, "nexavlinks");
}
export function addDddaiStationPreset(stations) {
  return addRegisteredStationPreset(stations, "dddai");
}
export function addLiuguangStationPreset(stations) {
  return addRegisteredStationPreset(stations, "liuguang");
}
export function addCunStationPreset(stations) {
  return addRegisteredStationPreset(stations, "cun");
}
export function addSidruneStationPreset(stations, exchangeRate = DEFAULT_EXCHANGE_RATE) {
  return addRegisteredStationPreset(stations, "sidrune", { exchangeRate });
}
export function addNodeAiStationPreset(stations) {
  return addRegisteredStationPreset(stations, "nodeai");
}

export function addFuckEveryoneStationPreset(stations) {
  return addRegisteredStationPreset(stations, "fuck-everyone");
}
export function addTokenFluxStationPreset(stations) {
  return addRegisteredStationPreset(stations, "tokenflux");
}
export function addTrueSotaStationPreset(stations) {
  return addRegisteredStationPreset(stations, "true-sota");
}
export function addCheapRouterStationPreset(stations) {
  return addRegisteredStationPreset(stations, "cheaprouter");
}
export function addAiApiStationPreset(stations) {
  return addRegisteredStationPreset(stations, "aiapi");
}
export function addAllInOneStationPreset(stations) {
  return addRegisteredStationPreset(stations, "all-in-one");
}
export function addHepinganStationPreset(stations) {
  return addRegisteredStationPreset(stations, "hepingan");
}

export {
  HEPINGAN_CHANNELS_ENDPOINT,
  AIAPI_MODEL_CATALOG_ENDPOINT,
  ALL_IN_ONE_MODELS_ENDPOINT,
  AIAPI_PRICE_KEYS,
  CHEAP_ROUTER_PRICING_ENDPOINT,
  NEXA_CHANNEL_CATALOG_ENDPOINT,
  PROVIDER_REGISTRY,
  PUBLIC_PRICING_HOSTS,
  RAW_PRICE_KEYS,
  SIDRUNE_MODEL_PLAZA_ENDPOINT,
  NODEAI_MODEL_PLAZA_ENDPOINT,
  FUCK_EVERYONE_MODEL_PLAZA_ENDPOINT,
  TRUE_SOTA_MODEL_PRICING_ENDPOINT,
  TOKENFLUX_PRICING_ENDPOINT
} from "./provider-registry.js";
