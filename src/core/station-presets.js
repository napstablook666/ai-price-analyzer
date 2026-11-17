import { stationContext } from "./provider-registry.js";


function addStationPreset(stations, preset, hostname) {
  const presetPath = stationContext({ baseUrl: preset.baseUrl }).path;
  // 同一个插件只加一次；手填的站点没有 pluginId，按域名 + 路径认，别把同一个接口加两遍。
  // 一个域名下可以挂多个插件（模型广场和拼车市场就是这种），所以路径要一起看。
  const exists = stations.some(station => {
    if (station.pluginId) return station.pluginId === preset.pluginId;
    const context = stationContext(station);
    return context.hostname === hostname && context.path === presetPath;
  });
  if (exists) return stations;
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
