import { normalizeLocalPlugins, normalizeRegistryState } from "../core/declarative-plugin.js";
import { SITE_PLUGIN_CATALOG, sitePluginCatalogForStations, sitePluginForStation } from "./catalog.js";

// 出货的扩展不带任何插件：只有仓库安装过的插件和开发模式下加载的本地插件才算激活。
// 采集代码仍然随扩展打包（MV3 不能下发代码），但没装就不参与匹配，也不出现在可选站点里。
export function installedPluginIds(settings = {}) {
  const registry = normalizeRegistryState(settings.pluginRegistry);
  const ids = new Set(Object.keys(registry.installed));
  if (settings.devMode === true) {
    for (const spec of normalizeLocalPlugins(settings.localPlugins).specs) ids.add(spec.id);
  }
  return ids;
}

// null 表示还没算过（单元测试直接调目录时不设），此时按「全都能用」处理，保持纯函数语义。
let activeIds = null;

export function setActivePluginIds(ids) {
  activeIds = ids == null ? null : new Set(ids instanceof Set ? ids : Array.isArray(ids) ? ids : []);
  return activeIds;
}

export function activePluginIds() {
  return activeIds || new Set(SITE_PLUGIN_CATALOG.map(plugin => plugin.id));
}

// 已存站点里可能有迁移前加的站点，它们的插件没走过安装流程也要能继续采集；
// 界面上「可选站点」仍然只列已装插件的站点，这条只在按站点回查插件时使用。
export function activeSitePluginForStation(station = {}) {
  return sitePluginForStation(station);
}

export function activeCatalogForStations(stations = [], options = {}) {
  return sitePluginCatalogForStations(stations, { ...options, installedIds: activePluginIds() });
}