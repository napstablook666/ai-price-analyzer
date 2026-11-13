import { providerById, providerForStation, registerSiteProvider, resetProviderRegistry, retainSiteProviders } from "../core/provider-registry.js";
import { SITE_PLUGIN_CATALOG, sitePluginById, sitePluginForStation } from "./catalog.js";

export async function loadSitePlugin(id) {
  const registered = providerById(id);
  if (registered) return registered;
  const descriptor = sitePluginById(id);
  if (!descriptor) throw new Error(`未知站点插件：${id}`);
  const module = descriptor.load();
  if (module.sitePlugin?.id !== id) throw new Error(`站点插件身份不匹配：${id}`);
  return registerSiteProvider(module.sitePlugin);
}

export async function loadSitePlugins(ids) {
  return Promise.all([...new Set(ids)].map(loadSitePlugin));
}

export async function loadSitePluginForStation(station) {
  const descriptor = sitePluginForStation(station);
  return descriptor ? loadSitePlugin(descriptor.id) : null;
}

export async function syncSitePlugins(stations = []) {
  const ids = [...new Set(stations.map(sitePluginForStation).filter(Boolean).map(plugin => plugin.id))];
  await loadSitePlugins(ids);
  return ids.map(providerById).filter(Boolean);
}

export function pruneSitePlugins(stations = []) {
  const activeIds = new Set(stations.map(station => providerForStation(station)?.id).filter(Boolean));
  retainSiteProviders(activeIds);
}

export function loadedSitePluginIds() {
  return SITE_PLUGIN_CATALOG.filter(plugin => providerById(plugin.id)).map(plugin => plugin.id);
}

export async function loadAllSitePlugins() {
  return loadSitePlugins(SITE_PLUGIN_CATALOG.map(plugin => plugin.id));
}

export function resetSitePluginLoader() {
  resetProviderRegistry();
}
