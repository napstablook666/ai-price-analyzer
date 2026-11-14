import { providerById, providerForStation, registerSiteProvider, resetProviderRegistry, retainSiteProviders, unregisterSiteProvider } from "../core/provider-registry.js";
import { providerFromSpec } from "../core/declarative-plugin.js";
import { SITE_PLUGIN_CATALOG, sitePluginById } from "./catalog.js";
import { activeSitePluginForStation } from "./activation.js";

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
  const descriptor = activeSitePluginForStation(station);
  return descriptor ? loadSitePlugin(descriptor.id) : null;
}

export async function syncSitePlugins(stations = []) {
  const ids = [...new Set(stations.map(activeSitePluginForStation).filter(Boolean).map(plugin => plugin.id))];
  await loadSitePlugins(ids);
  return ids.map(providerById).filter(Boolean);
}

// 仓库插件与本地插件是声明式规格，运行时拼成 provider 注册，内置插件同 id 时内置优先。
export function syncSpecSitePlugins(specs = []) {
  for (const spec of specs) {
    if (providerById(spec.id)) continue;
    registerSiteProvider(providerFromSpec(spec));
  }
  return loadedSitePluginIds();
}

export function unloadSpecSitePlugin(id) {
  unregisterSiteProvider(id);
}

export function pruneSitePlugins(stations = [], keepIds = []) {
  const activeIds = new Set([...keepIds, ...stations.map(station => providerForStation(station)?.id).filter(Boolean)]);
  retainSiteProviders(activeIds);
}

export function loadedSitePluginIds() {
  return SITE_PLUGIN_CATALOG.filter(plugin => providerById(plugin.id)).map(plugin => plugin.id);
}

export function resetSitePluginLoader() {
  resetProviderRegistry();
}
