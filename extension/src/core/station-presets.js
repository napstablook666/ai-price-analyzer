import { stationContext } from "./provider-registry.js";


function addStationPreset(stations, preset, hostname) {
  if (stations.some(station => stationContext(station).hostname === hostname)) return stations;
  const ids = new Set(stations.map(station => station.id));
  let id = preset.id;
  for (let suffix = 2; ids.has(id); suffix++) id = `${preset.id}-${suffix}`;
  return [...stations, { ...preset, id, auth: { ...preset.auth }, adapter: { ...preset.adapter } }];
}

export function addProviderStationPresets(stations, providers, options = {}) {
  return providers.reduce((current, provider) => {
    const preset = typeof provider?.preset === "function" ? provider.preset(options) : provider?.preset;
    return provider?.host && preset ? addStationPreset(current, { ...preset, pluginId: provider.id }, provider.host) : current;
  }, stations);
}
