import { cloneDefaultStation, convertRechargeAmount, currentSiteOrigin, DEFAULT_EXCHANGE_RATE, normalizeSettings, normalizeUrl, STATION_CATEGORY_LABELS, TOKENS_PER_MILLION, usagePresetId, usagePresetOptions, usagePresetUsage } from "./shared/schema.js";
import { DEFAULT_MAGPIE_SYNC_INTERVAL_MINUTES, MAGPIE_SYNC_INTERVAL_OPTIONS, magpieSyncLabel } from "./core/magpie-usage.js";
import { callService, escapeHtml, hydrateIcons, icon, onAssistProgress, onRefreshProgress, toast } from "./shared/ui.js";
import { siteLogoUrl } from "./shared/site-icon.js";
import { initCardCollapse } from "./shared/collapse.js";
import { initTopMenu } from "./shared/menu.js";
import { RESPONSE_FORMAT_DEFINITIONS, isSupportedResponseFormat } from "./core/response-formats.js";
import { getPartialDiagnostics } from "./core/partial-diagnostics.js";
import { paginateRows } from "./dashboard-index.js";
import { canSelfUpdate, fetchUpdateManifest } from "./core/self-update.js";
import { applyUpdate, isExtensionDirectory, restoreBackup } from "./core/self-update-apply.js";

const state = { stations: [], sitePlugins: [], settings: null, pluginWorkspace: null, stationSourceTabIds: new Map(), configStationId: null, pendingStation: null, previewRequestId: 0, registryFilter: "all", registrySelected: new Set(), registryAnchorId: "", expandedRegistryId: "", installedOrder: [], installedSelectable: new Set(), installedSelected: new Set(), installedAnchorId: "", registryOrder: [], expandedInstalledId: "", assistantFilter: "all", assistantPage: 0, assistantPageSize: 20, update: null };
const $ = selector => document.querySelector(selector);
const EMBEDDED = new URLSearchParams(location.search).get("embed") === "1";
if (EMBEDDED) document.body.classList.add("is-embedded");

function selected(value, expected) { return value === expected ? " selected" : ""; }
function checked(value) { return value ? " checked" : ""; }


const SETTINGS_VIEWS = ["installed", "registry", "costs", "assistant", "about"];
const PLUGIN_CATEGORY_LABELS = { paid: "付费", public: "公益", benchmark: "基准" };
const PLUGIN_MODE_LABELS = { direct: "直接接口", page: "页面模式" };

function activateSettingsView(requested, { focus = false, updateHash = true } = {}) {
  const view = SETTINGS_VIEWS.includes(requested) ? requested : SETTINGS_VIEWS[0];
  for (const name of SETTINGS_VIEWS) {
    const active = name === view;
    const tab = $(`[data-settings-target="${name}"]`);
    const panel = $(`#settings-view-${name}`);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    panel.hidden = !active;
    if (active && focus) tab.focus();
  }
  syncNavGroup(view);
  if (view === "about") refreshUpdateState().catch(() => {});
  if (updateHash && location.hash !== `#${view}`) history.replaceState(null, "", `${location.pathname}${location.search}#${view}`);
navPinnedKey = "";
  const firstAnchor = $(`#settings-view-${view}`)?.querySelector("[data-nav-anchor]");
  setNavActiveKey(firstAnchor ? firstAnchor.dataset.navAnchor : "");
  scheduleNavActive();
}

const NAV_ACTIVE_OFFSET = 16;
let navScrollFrame = 0;
const NAV_PIN_MS = 1400;
let navPinnedKey = "";
let navPinnedAt = 0;

function syncNavGroup(view) {
  for (const group of document.querySelectorAll(".settings-nav-group")) {
    const subnav = group.querySelector(":scope > .settings-subnav");
    if (!subnav) continue;
    const expanded = group.dataset.navGroup === view;
    subnav.hidden = !expanded;
    group.querySelector(":scope > button")?.setAttribute("aria-expanded", String(expanded));
  }
}

function navTarget(key) {
  if (!key) return null;
  return document.querySelector(`[data-nav-anchor="${key}"]`) || document.getElementById(key);
}

function navJumpItem(key) {
  return [...document.querySelectorAll("[data-nav-jump]")].find(button => button.dataset.navJump === key) || null;
}

function jumpToNavTarget(key) {
  const target = navTarget(key);
  const item = navJumpItem(key);
  if (!target || !item) return;
  const view = item.closest(".settings-nav-group")?.dataset.navGroup;
  if (view) activateSettingsView(view);
navPinnedKey = key;
  navPinnedAt = performance.now();
  setNavActiveKey(key);
  const collapsed = target.closest('[data-collapsible][data-collapsed="true"]');
  collapsed?.querySelector("[data-collapse-toggle]")?.click();
  requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    scheduleNavActive();
  });
}

function scheduleNavActive() {
  if (navScrollFrame) return;
  navScrollFrame = requestAnimationFrame(() => {
    navScrollFrame = 0;
    updateNavActive();
  });
}

function setNavActiveKey(key) {
  for (const item of document.querySelectorAll("[data-nav-jump]")) {
    if (key && item.dataset.navJump === key) item.setAttribute("aria-current", "true");
    else item.removeAttribute("aria-current");
  }
}

function updateNavActive() {
  const container = $(".settings-content");
  const panel = $(".settings-view:not([hidden])");
  if (!container || !panel) return;
  if (navPinnedKey && performance.now() - navPinnedAt < NAV_PIN_MS) {
    setNavActiveKey(navPinnedKey);
    return;
  }
navPinnedKey = "";
  // 内容不足一屏时没有滚动信息可用，保持点击设定的高亮。
  if (container.scrollHeight - container.clientHeight <= 2) return;
  const threshold = container.getBoundingClientRect().top + NAV_ACTIVE_OFFSET;
  const anchors = [...panel.querySelectorAll("[data-nav-anchor]")].filter(node => node.getClientRects().length);
  if (!anchors.length) {
    setNavActiveKey("");
    return;
  }
let activeKey = anchors[0].dataset.navAnchor;
  let bestDelta = Infinity;
  for (const node of anchors) {
    const delta = Math.abs(node.getBoundingClientRect().top - threshold);
    if (delta >= bestDelta) continue;
    bestDelta = delta;
    activeKey = node.dataset.navAnchor;
  }
  setNavActiveKey(activeKey);
}


const PLUGIN_SOURCE_LABELS = { bundled: "随扩展", registry: "仓库安装", local: "本地插件" };
const PLUGIN_SOURCE_ORDER = ["registry", "local"];
const PLUGIN_GROUP_TITLES = { registry: "仓库安装", local: "本地插件" };

function pluginSourceKey(plugin) {
  const source = String(plugin?.source || "registry");
  // 代码随扩展打包的插件，用户仍是按仓库安装来管理的，界面上归到「仓库安装」。
  if (source === "bundled") return "registry";
  return PLUGIN_SOURCE_LABELS[source] ? source : "registry";
}

function pluginSourceBadge(plugin) {
  const source = pluginSourceKey(plugin);
  return `<span class="plugin-source-badge is-${source}">${PLUGIN_SOURCE_LABELS[source]}</span>`;
}

function pluginInitial(plugin) {
  const text = String(plugin?.name || plugin?.id || plugin?.host || "?").trim();
  return escapeHtml(text.slice(0, 1).toUpperCase() || "?");
}

function pluginDetailGrid(rows) {
  const items = rows.filter(([, value]) => value && String(value).trim()).map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
  return items ? `<dl class="plugin-detail-grid">${items}</dl>` : "";
}

function pluginDetailBlocks({ description, rows, note = "" }) {
  return `<div class="plugin-entry-detail">
    <p class="plugin-detail-description">${escapeHtml(description || "没有填写介绍。")}</p>
    ${pluginDetailGrid(rows)}
    ${note ? `<p class="plugin-detail-note">${note}</p>` : ""}
  </div>`;
}

// 一行放完：图标、名称、徽标、域名、站点数、操作，介绍收进展开区。
function pluginRow(plugin, actions = "", { stations, selectable = false } = {}) {
  const checked = selectable && state.installedSelected.has(String(plugin.id));
  const source = pluginSourceKey(plugin);
  const count = Number(plugin.stationCount) || 0;
  const expanded = state.expandedInstalledId === String(plugin.id);
  const badges = [pluginSourceBadge(plugin), plugin.addable ? "" : `<span class="station-badge">按地址添加</span>`].join("");
  const meta = [plugin.version ? `v${escapeHtml(plugin.version)}` : "", count ? `${count} 个站点` : "未添加站点"].filter(Boolean).join(" · ");
  const hosts = (plugin.hosts?.length ? plugin.hosts : [plugin.host]).filter(Boolean);
  return `<section class="plugin-entry${expanded ? " is-expanded" : ""}">
    <div class="plugin-row" data-plugin-row="${escapeHtml(plugin.id)}">
      ${selectable ? `<input class="plugin-check" type="checkbox" data-installed-check="${escapeHtml(plugin.id)}"${checked ? " checked" : ""} aria-label="选择 ${escapeHtml(plugin.name || plugin.id)}">` : ""}
      <span class="plugin-row-icon is-${source}" aria-hidden="true">${siteLogoUrl(plugin.id) ? `<img class="plugin-row-logo" src="${siteLogoUrl(plugin.id)}" alt="" width="20" height="20" loading="lazy">` : pluginInitial(plugin)}</span>
      <button class="plugin-row-toggle" type="button" data-plugin-toggle="${escapeHtml(plugin.id)}" aria-expanded="${expanded}" title="${escapeHtml(plugin.description || plugin.name || plugin.id)}">
        <span class="plugin-row-main">
          <span class="plugin-row-line1"><span class="plugin-row-name">${escapeHtml(plugin.name || plugin.id)}</span>${badges}</span>
          <span class="plugin-row-line2"><span class="plugin-row-host">${escapeHtml(hosts.join(" / "))}</span><span class="plugin-row-meta">${meta}</span></span>
        </span>
      </button>
      <div class="plugin-row-actions">${actions}</div>
      ${icon("chevron-right", { className: "icon plugin-row-caret" })}
    </div>
    ${expanded ? pluginDetailBlocks({
      description: plugin.description,
      rows: [
        ["插件 id", plugin.id],
        ["添加方式", plugin.addable ? "装好即加入工作区" : "按站点地址添加"],
        ["采集方式", PLUGIN_MODE_LABELS[plugin.mode] || ""],
        ["认证", plugin.authLabel || ""],
        ["分类", PLUGIN_CATEGORY_LABELS[plugin.category] || plugin.category || ""],
        ["页面路径", (plugin.paths || []).join(" / ")],
        ["站点数", count ? `${count} 个` : "未添加站点"]
      ]
    }) : ""}
    ${stations === false ? "" : pluginStations(plugin, Array.isArray(stations) ? stations : null)}
  </section>`;
}

function pluginInstalledActions(plugin) {
  const parts = [];
  const count = Number(plugin.stationCount) || 0;
  if (plugin.addable && !plugin.added) parts.push(`<button class="button button-quiet button-small" data-plugin-add="${escapeHtml(plugin.id)}" type="button">添加站点</button>`);
  // addable:false 的插件装好不会自己长出站点（吉吉、SoleAPI 这类要在地址里带 token），给个入口直接把添加站点打开。
  if (plugin.addable === false && !count && plugin.host) parts.push(`<button class="button button-quiet button-small" data-plugin-address="${escapeHtml(plugin.id)}" data-plugin-host="${escapeHtml(plugin.host)}" type="button" title="按站点地址添加">按地址添加</button>`);
  if (plugin.removable !== false) parts.push(`<button class="icon-button danger-icon" data-plugin-uninstall="${escapeHtml(plugin.id)}" type="button" title="移除插件" aria-label="移除插件">${icon("trash-2", { className: "icon" })}</button>`);
  return parts.join("");
}
function pluginStations(plugin, stations = null) {
  const list = stations || state.stations.filter(station => station.pluginId === plugin.id);
  if (!list.length) return "";
  return `<div class="stations-list plugin-stations">${list.map(stationCard).join("")}</div>`;
}

// 已安装列表把内置、仓库安装、本地开发三类合在一起，按来源分组；同 id 时本地盖过仓库。
function installedPluginEntries() {
  const workspace = state.pluginWorkspace || {};
  const catalog = workspace.catalog || [];
  const counts = new Map(catalog.map(plugin => [plugin.id, plugin.stationCount || 0]));
  const extraCounts = new Map();
  for (const station of state.stations || []) {
    if (!station.pluginId || counts.has(station.pluginId)) continue;
    extraCounts.set(station.pluginId, (extraCounts.get(station.pluginId) || 0) + 1);
  }
  const merged = new Map(catalog.map(plugin => [plugin.id, { ...plugin, source: pluginSourceKey(plugin) }]));
  for (const plugin of workspace.repositoryPlugins || []) {
    if (merged.has(plugin.id)) continue;
    merged.set(plugin.id, { ...plugin, source: "registry" });
  }
  for (const plugin of workspace.localPlugins || []) merged.set(plugin.id, { ...plugin, source: "local" });
  return [...merged.values()].map(plugin => ({ ...plugin, stationCount: counts.get(plugin.id) ?? extraCounts.get(plugin.id) ?? 0 }));
}

function installedQuery() {
  return ($("#plugin-installed-search")?.value || "").trim().toLowerCase();
}

function pluginSearchText(plugin) {
  return [plugin.name, plugin.id, plugin.description, ...(plugin.hosts || []), plugin.host]
    .map(value => String(value || "")).join(" ").toLowerCase();
}

function stationSearchText(station) {
  return [station.name, stationHostName(station.baseUrl)].map(value => String(value || "")).join(" ").toLowerCase();
}

// 已安装列表搜索：插件自身命中就保留它全部站点，只有站点命中就只留命中那几个站点。
function matchedInstalledPlugins(plugins, orphans) {
  const query = installedQuery();
  if (!query) return { entries: plugins.map(plugin => ({ plugin, stations: null })), orphans };
  const stationsOfPlugin = new Map();
  for (const station of state.stations || []) {
    if (!station.pluginId) continue;
    if (!stationsOfPlugin.has(station.pluginId)) stationsOfPlugin.set(station.pluginId, []);
    stationsOfPlugin.get(station.pluginId).push(station);
  }
  const entries = [];
  for (const plugin of plugins) {
    if (pluginSearchText(plugin).includes(query)) {
      entries.push({ plugin, stations: null });
      continue;
    }
    const stations = (stationsOfPlugin.get(plugin.id) || []).filter(station => stationSearchText(station).includes(query));
    if (stations.length) entries.push({ plugin, stations });
  }
  return { entries, orphans: orphans.filter(station => stationSearchText(station).includes(query)) };
}

function renderPluginInstalled() {
  const list = $("#plugin-installed-list");
  if (!list) return;
  const plugins = installedPluginEntries();
  const knownIds = new Set(plugins.map(plugin => plugin.id));
  const allOrphans = state.stations.filter(station => !station.pluginId || !knownIds.has(station.pluginId));
  if (!plugins.length && !allOrphans.length) {
    state.installedOrder = [];
    state.installedSelectable = new Set();
    list.innerHTML = `<p class="plugin-empty">还没有可用插件。到「插件仓库」装一个，或点右上「添加站点」。</p>`;
    updateInstalledSelection();
    return;
  }
  const { entries, orphans } = matchedInstalledPlugins(plugins, allOrphans);
  // 可选集合按全量插件算，搜索过滤不该悄悄丢掉已经勾上的选择。
  state.installedSelectable = new Set(plugins.filter(plugin => plugin.removable !== false).map(plugin => String(plugin.id)));
  if (!entries.length && !orphans.length) {
    state.installedOrder = [];
    list.innerHTML = `<p class="plugin-empty">没有匹配「${escapeHtml(installedQuery())}」的插件或站点。</p>`;
    updateInstalledSelection();
    return;
  }
  const groups = new Map(PLUGIN_SOURCE_ORDER.map(key => [key, []]));
  for (const entry of entries) groups.get(pluginSourceKey(entry.plugin)).push(entry);
  // installedOrder 按渲染顺序记下可选条目，Shift 区间选择直接照这个顺序取。
  const ordered = PLUGIN_SOURCE_ORDER.filter(key => groups.get(key).length).flatMap(key => groups.get(key));
  state.installedOrder = ordered.map(entry => String(entry.plugin.id));
  list.innerHTML = PLUGIN_SOURCE_ORDER.filter(key => groups.get(key).length).map(key => `<section class="plugin-group">
    <div class="plugin-group-heading"><h4>${PLUGIN_GROUP_TITLES[key]}</h4><span>${groups.get(key).length}</span></div>
    ${groups.get(key).map(entry => pluginRow(entry.plugin, pluginInstalledActions(entry.plugin), { stations: entry.stations, selectable: entry.plugin.removable !== false })).join("")}
  </section>`).join("") + (orphans.length ? `<section class="plugin-group">
    <div class="plugin-group-heading"><h4>未关联插件</h4><span>${orphans.length}</span></div>
    ${orphans.map(stationCard).join("")}
  </section>` : "");
  hydrateIcons(list);
  updateInstalledSelection();
}

function formatPluginTime(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return "";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function registryEntryBadges(entry) {
  return [
    entry.kind === "checkin" ? `<span class="station-badge">签到插件</span>` : "",
    entry.needsCode && !entry.builtin ? `<span class="station-badge is-warning">需更新扩展</span>` : "",
    entry.installed ? `<span class="plugin-source-badge is-registry">已安装</span>` : "",
    entry.updateAvailable ? `<span class="station-badge is-warning">有更新</span>` : ""
  ].filter(Boolean).join("");
}

function registryEntryInstallable(entry) {
  // 代码随扩展打进去的条目（builtin）能直接装；仓库里全新的条目要等扩展带上采集代码。
  return !(entry.needsCode && !entry.builtin);
}

function registryEntrySelectable(entry) {
  return registryEntryInstallable(entry) && (!entry.installed || entry.updateAvailable);
}

function registryEntryActions(entry) {
  if (!registryEntryInstallable(entry)) return "";
  if (!entry.installed) return `<button class="button button-primary button-small" data-plugin-install="${escapeHtml(entry.id)}" type="button">安装</button>`;
  const parts = [];
  if (entry.updateAvailable) parts.push(`<button class="button button-quiet button-small" data-plugin-install="${escapeHtml(entry.id)}" type="button">更新</button>`);
  parts.push(`<button class="icon-button danger-icon" data-plugin-uninstall="${escapeHtml(entry.id)}" type="button" title="移除插件" aria-label="移除插件">${icon("trash-2", { className: "icon" })}</button>`);
  return parts.join("");
}

function registryRow(entry) {
  const selectable = registryEntrySelectable(entry);
  const expanded = state.expandedRegistryId === entry.id;
  return `<section class="plugin-entry${expanded ? " is-expanded" : ""}">
    <div class="plugin-row" data-registry-row="${escapeHtml(entry.id)}">
      <input class="plugin-check" type="checkbox" data-registry-check="${escapeHtml(entry.id)}"${state.registrySelected.has(entry.id) ? " checked" : ""}${selectable ? "" : " disabled"} aria-label="选择 ${escapeHtml(entry.name || entry.id)}">
      <span class="plugin-row-icon is-registry" aria-hidden="true">${pluginInitial(entry)}</span>
      <button class="plugin-row-toggle" type="button" data-registry-toggle="${escapeHtml(entry.id)}" aria-expanded="${expanded}" title="${escapeHtml(entry.description || entry.name || entry.id)}">
        <span class="plugin-row-main">
          <span class="plugin-row-line1"><span class="plugin-row-name">${escapeHtml(entry.name || entry.id)}</span>${registryEntryBadges(entry)}</span>
          <span class="plugin-row-line2"><span class="plugin-row-host">${escapeHtml((entry.hosts || []).join(" / "))}</span><span class="plugin-row-meta">v${escapeHtml(entry.version || "?")}${entry.installed ? " · 已安装" : ""}</span></span>
        </span>
      </button>
      <span class="plugin-row-actions">${registryEntryActions(entry)}</span>
      ${icon("chevron-right", { className: "icon plugin-row-caret" })}
    </div>
    ${expanded ? registryDetail(entry) : ""}
  </section>`;
}

function registryDetail(entry) {
  const details = entry.details || {};
  const note = entry.needsCode
    ? (entry.builtin
      ? "采集代码随扩展打包，当前扩展版本已内置，装上就能用。"
      : "这个插件的采集代码还没随扩展发布，暂时装不了；等扩展内置这个插件后再装。")
    : entry.kind === "checkin"
      ? "签到插件只带接口规格，装上后在顶栏菜单里出入签到卡片，不参与价格采集。"
      : "";
  if (entry.kind === "checkin") {
    const checkin = details.checkin || {};
    return pluginDetailBlocks({
      description: entry.description,
      rows: [
        ["插件 id", entry.id],
        ["版本", entry.installed ? `${entry.version}（已装 v${entry.installedVersion || entry.version}）` : entry.version],
        ["域名", (entry.hosts || []).join(" / ")],
        ["状态端点", checkin.statusPath || ""],
        ["签到端点", `${checkin.claimMethod || "POST"} ${checkin.claimPath || ""}`.trim()],
        ["登录态", [checkin.tokenStorageKey ? `localStorage:${checkin.tokenStorageKey}` : "", checkin.tokenCookieName ? `Cookie:${checkin.tokenCookieName}` : ""].filter(Boolean).join(" · ")],
        ["签到冷却", checkin.cooldownHours ? `${checkin.cooldownHours} 小时` : ""],
        ["安装时间", entry.installed && details.installedAt ? formatPluginTime(details.installedAt) : ""]
      ],
      note
    });
  }
  return pluginDetailBlocks({
    description: entry.description,
    rows: [
      ["插件 id", entry.id],
      ["版本", entry.installed ? `${entry.version}（已装 v${entry.installedVersion || entry.version}）` : entry.version],
      ["域名", (entry.hosts || []).join(" / ")],
      ["采集方式", PLUGIN_MODE_LABELS[details.mode] || ""],
      ["认证", details.authLabel || ""],
      ["分类", PLUGIN_CATEGORY_LABELS[details.category] || details.category || ""],
      ["采集端点", details.endpoint || ""],
      ["页面路径", (details.paths || []).join(" / ")],
      ["响应格式", details.responseFormat || ""],
      ["安装时间", entry.installed && details.installedAt ? formatPluginTime(details.installedAt) : ""]
    ],
    note
  });
}

function registryQuery() {
  return ($("#plugin-registry-search")?.value || "").trim().toLowerCase();
}

function registryMatchesQuery(entry, query) {
  if (!query) return true;
  return [entry.name, entry.id, entry.description, ...(entry.hosts || [])].some(value => String(value || "").toLowerCase().includes(query));
}

function registryMatchesFilter(entry, filter = state.registryFilter) {
  if (filter === "available") return !entry.installed;
  if (filter === "installed") return Boolean(entry.installed);
  if (filter === "update") return Boolean(entry.updateAvailable);
  return true;
}

function filteredRegistryEntries(entries) {
  const query = registryQuery();
  return entries.filter(entry => registryMatchesQuery(entry, query) && registryMatchesFilter(entry));
}

// Shift 点勾选框：按当前可见顺序把首尾之间整段设成同一个状态，不能选的条目跳过。
function applyRangeSelection(order, anchorId, currentId, checked, selection, isSelectable) {
  const start = order.indexOf(anchorId);
  const end = order.indexOf(currentId);
  if (start < 0 || end < 0 || start === end) return false;
  const [lo, hi] = start <= end ? [start, end] : [end, start];
  for (const id of order.slice(lo, hi + 1)) {
    if (!isSelectable(id)) continue;
    if (checked) selection.add(id);
    else selection.delete(id);
  }
  return true;
}

function updateInstalledSelection() {
  for (const id of [...state.installedSelected]) {
    if (!state.installedSelectable.has(id)) state.installedSelected.delete(id);
  }
  const count = state.installedSelected.size;
  const counter = $("#installed-selected-count");
  if (counter) counter.textContent = `已选 ${count} 项`;
  const button = $("#uninstall-selected-plugins");
  if (button) {
    button.disabled = count === 0;
    const label = button.querySelector("span:last-child");
    if (label) label.textContent = count ? `移除所选 ${count} 个` : "移除所选";
  }
  const visible = state.installedOrder.filter(id => state.installedSelectable.has(id));
  const selectAll = $("#installed-select-all");
  if (selectAll) {
    const total = visible.length;
    const chosen = visible.filter(id => state.installedSelected.has(id)).length;
    selectAll.disabled = total === 0;
    selectAll.checked = total > 0 && chosen === total;
    selectAll.indeterminate = chosen > 0 && chosen < total;
  }
}

// 已安装列表的批量移除：一次提交，后端同时清仓库安装记录与本地插件，并删掉挂在插件下的站点。
async function uninstallSelectedPlugins() {
  const ids = [...state.installedSelected].filter(id => state.installedSelectable.has(id));
  if (!ids.length) return;
  const button = $("#uninstall-selected-plugins");
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `${icon("loader-circle", { className: "icon spin" })}<span>正在移除 ${ids.length} 个</span>`;
  try {
    const workspace = await callService("UNINSTALL_PLUGINS", { ids });
    state.installedSelected.clear();
    applyPluginWorkspace(workspace);
    toast(`已移除 ${ids.length} 个插件`);
  } catch (error) {
    toast(error.message || String(error));
  } finally {
    button.innerHTML = original;
    hydrateIcons(button);
    updateInstalledSelection();
  }
}

function updateRegistrySelection() {
  const entries = state.pluginWorkspace?.registry?.entries || [];
  for (const id of [...state.registrySelected]) {
    const entry = entries.find(item => item.id === id);
    if (!entry || !registryEntrySelectable(entry)) state.registrySelected.delete(id);
  }
  const count = state.registrySelected.size;
  const counter = $("#registry-selected-count");
  if (counter) counter.textContent = `已选 ${count} 项`;
  const button = $("#install-selected-plugins");
  if (button) {
    button.disabled = count === 0;
    const label = button.querySelector("span:last-child");
    if (label) label.textContent = count ? `安装所选 ${count} 个` : "安装所选";
  }
  const visible = filteredRegistryEntries(entries);
  const selectAll = $("#registry-select-all");
  if (selectAll) {
    const selectable = visible.filter(entry => registryEntrySelectable(entry));
    const chosen = selectable.filter(entry => state.registrySelected.has(entry.id)).length;
    selectAll.disabled = selectable.length === 0;
    selectAll.checked = selectable.length > 0 && chosen === selectable.length;
    selectAll.indeterminate = chosen > 0 && chosen < selectable.length;
  }
  const query = registryQuery();
  for (const item of document.querySelectorAll("[data-registry-filter]")) {
    const filter = item.dataset.registryFilter;
    item.setAttribute("aria-pressed", String(filter === state.registryFilter));
    const total = entries.filter(entry => registryMatchesQuery(entry, query) && registryMatchesFilter(entry, filter)).length;
    item.dataset.count = String(total);
  }
}

function renderPluginRegistry() {
  const registry = state.pluginWorkspace?.registry;
  const status = $("#plugin-registry-status");
  if (status && registry) {
    const fetchedAt = formatPluginTime(registry.fetchedAt);
    if (registry.error) {
      status.dataset.status = "error";
      status.textContent = `拉取失败：${registry.error}${fetchedAt ? `（保留 ${fetchedAt} 的结果）` : ""}`;
    } else {
      status.dataset.status = fetchedAt ? "ok" : "";
      status.textContent = fetchedAt ? `上次刷新：${fetchedAt}，共 ${registry.entries.length} 个插件` : "尚未拉取插件仓库";
    }
  }
  const urlInput = $("#plugin-registry-url");
  if (urlInput && registry && !urlInput.value) urlInput.value = registry.url || "";
  const list = $("#plugin-registry-list");
  if (!list) return;
  const entries = registry?.entries || [];
  const visible = filteredRegistryEntries(entries);
  list.innerHTML = visible.length ? visible.map(registryRow).join("") : `<p class="plugin-empty">${entries.length ? "没有匹配的插件，换个关键词或筛选试试。" : "仓库里还没有条目，填好仓库地址后点「刷新仓库」。"}</p>`;
state.registryOrder = visible.map(entry => String(entry.id));
  hydrateIcons(list);
  updateRegistrySelection();
}


function renderLocalPlugins() {
  const workspace = state.pluginWorkspace;
  const devMode = workspace?.devMode === true;
  const toggle = $("#dev-mode");
  if (toggle) toggle.checked = devMode;
  const panel = $("#dev-plugin-panel");
  if (panel) panel.hidden = !devMode;
  const list = $("#local-plugin-list");
  if (!list) return;
  const catalog = workspace?.catalog || [];
  const plugins = workspace?.localPlugins || [];
  list.innerHTML = plugins.length ? plugins.map(plugin => pluginRow({
    ...plugin,
    source: "local",
    stationCount: catalog.find(item => item.id === plugin.id)?.stationCount || 0
  }, `<button class="icon-button danger-icon" data-plugin-remove="${escapeHtml(plugin.id)}" type="button" title="移除本地插件" aria-label="移除本地插件">${icon("trash-2", { className: "icon" })}</button>`), { stations: false }).join("") : `<p class="plugin-empty">开发模式下还没有加载本地插件。</p>`;
  hydrateIcons(list);
}


function renderPluginWorkspace() {
  if (!state.pluginWorkspace) return;
  state.sitePlugins = state.pluginWorkspace.catalog?.length ? state.pluginWorkspace.catalog : state.sitePlugins;
  renderPluginInstalled();
  renderPluginRegistry();
  renderLocalPlugins();
}

function applyPluginWorkspace(workspace) {
  if (!workspace) return;
  state.pluginWorkspace = workspace;
  renderPluginWorkspace();
}

async function refreshPluginRegistry() {
  const button = $("#plugin-registry-refresh");
  const label = button?.querySelector("span:last-child");
  const original = label?.textContent;
  if (button) button.disabled = true;
  if (label) label.textContent = "刷新中";
  try {
    const workspace = await callService("REFRESH_PLUGIN_REGISTRY", { url: $("#plugin-registry-url")?.value.trim() || "" });
    applyPluginWorkspace(workspace);
    const registry = workspace.registry;
    if (registry.error) toast(`插件仓库拉取失败：${registry.error}`);
    else toast(`插件仓库已刷新，共 ${registry.entries.length} 个插件`);
  } catch (error) {
    toast(error.message);
  } finally {
    if (button) button.disabled = false;
    if (label && original) label.textContent = original;
    hydrateIcons(button || document);
  }
}

async function installPluginVersion(pluginId) {
  try {
    const workspace = await callService("INSTALL_PLUGIN", { id: pluginId });
    applyPluginWorkspace(workspace);
    const entry = workspace.registry.entries.find(item => item.id === pluginId);
    const added = workspace.lastInstall?.stationsAdded || 0;
    const suffix = added ? `，${added} 个站点已加入工作区` : "";
    toast(`已安装 ${entry?.name || pluginId}${entry?.version ? ` v${entry.version}` : ""}${suffix}`);
  } catch (error) {
    toast(error.message);
  }
}
// 批量安装：一次提交所有选中项，结果按成功/跳过/失败汇总成一句提示。
async function installSelectedPlugins() {
  const entries = state.pluginWorkspace?.registry?.entries || [];
  const ids = [...state.registrySelected].filter(id => {
    const entry = entries.find(item => item.id === id);
    return entry && registryEntrySelectable(entry);
  });
  if (!ids.length) return;
  const button = $("#install-selected-plugins");
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `${icon("loader-circle", { className: "icon spin" })}<span>正在安装 ${ids.length} 个</span>`;
  try {
    const result = await callService("INSTALL_PLUGINS", { ids });
    applyPluginWorkspace(result.workspace);
    state.registrySelected.clear();
    const skipped = result.skipped?.length || 0;
    const failed = result.failed || [];
    const stations = result.stationsAdded || 0;
    const suffix = stations ? `、${stations} 个站点已加入工作区` : "";
    const installed = result.installed?.length || 0;
    if (failed.length) toast(`已安装 ${installed} 个，失败 ${failed.length} 个：${failed.map(item => item.id).join("、")}`);
    else toast(`已安装 ${installed} 个插件${suffix}${skipped ? `，${skipped} 个已经装过` : ""}`);
  } catch (error) {
    toast(error.message || String(error));
  } finally {
    button.innerHTML = original;
    hydrateIcons(button);
    updateRegistrySelection();
  }
}

async function uninstallPluginVersion(pluginId) {
  const plugin = (state.pluginWorkspace?.catalog || []).find(item => item.id === pluginId);
  try {
    const workspace = await callService("UNINSTALL_PLUGIN", { id: pluginId });
    applyPluginWorkspace(workspace);
    toast(`已移除 ${plugin?.name || pluginId}`);
  } catch (error) {
    toast(error.message);
  }
}

async function toggleDevMode(enabled) {
  try {
    const workspace = await callService("SAVE_DEV_MODE", { enabled });
    applyPluginWorkspace(workspace);
    toast(enabled ? "开发模式已打开，可以加载本地插件" : "开发模式已关闭，本地插件已卸载");
  } catch (error) {
    toast(error.message);
  }
}

async function addPluginSite(pluginId) {
  try {
    const result = await callService("ADD_SITE_PLUGINS", { ids: [pluginId] });
    const existingIds = new Set(state.stations.map(station => station.id));
    for (const station of result.stations || []) if (!existingIds.has(station.id)) state.stations.push(station);
    if (state.pluginWorkspace) applyPluginWorkspace({ ...state.pluginWorkspace, catalog: result.sitePlugins || state.sitePlugins });
    renderStations();
    toast(`已添加 ${result.added?.length || 0} 个站点`);
  } catch (error) {
    toast(error.message);
  }
}

async function loadLocalPlugin() {
  const textarea = $("#dev-plugin-spec");
  const raw = textarea?.value.trim() || "";
  if (!raw) {
    toast("先粘贴插件 JSON 或选择文件");
    return;
  }
  let spec;
  try {
    spec = JSON.parse(raw);
  } catch {
    toast("插件 JSON 解析失败");
    return;
  }
  try {
    const workspace = await callService("ADD_LOCAL_PLUGIN", { spec });
    textarea.value = "";
    applyPluginWorkspace(workspace);
    toast(`本地插件 ${spec.id || spec.name || ""} 已加载`);
  } catch (error) {
    toast(error.message);
  }
}

async function removeLocalPluginEntry(pluginId) {
  try {
    const workspace = await callService("REMOVE_LOCAL_PLUGIN", { id: pluginId });
    applyPluginWorkspace(workspace);
    toast(`已移除本地插件 ${pluginId}`);
  } catch (error) {
    toast(error.message);
  }
}




function nonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
function derivedRechargeRate(rmb, credits) {
  return rmb > 0 && credits > 0 ? rmb / credits : 1;
}

function currentExchangeRate() {
  const rate = Number($("#exchange-rate")?.value);
  return Number.isFinite(rate) && rate > 0 ? Math.max(0.0001, rate) : DEFAULT_EXCHANGE_RATE;
}

function formatRechargeAmount(value) {
  const amount = Number(value);
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 8 }).format(Number.isFinite(amount) ? amount : 0);
}

function changeRechargeCurrency(amountInput, currencySelect) {
  const previousCurrency = currencySelect.dataset.previousCurrency || "CNY";
  if (amountInput.value !== "") {
    const converted = convertRechargeAmount(amountInput.value, previousCurrency, currencySelect.value, currentExchangeRate());
    if (converted !== null) amountInput.value = String(converted);
  }
  currencySelect.dataset.previousCurrency = currencySelect.value;
}

function configRechargeRate() {
  const rmb = convertRechargeAmount($("#config-recharge-amount").value, $("#config-recharge-currency").value, "CNY", currentExchangeRate()) ?? 0;
  const credits = Number($("#config-recharge-credits").value);
  const rate = derivedRechargeRate(rmb, credits);
  $("#config-recharge-rate").value = rate.toFixed(4);
  $("#config-recharge-rate-display").textContent = `每 1 中转币成本 ¥${rate.toFixed(4)}`;
}
function stationHostName(baseUrl) {
  try { return new URL(normalizeUrl(baseUrl)).hostname.replace(/^www\./i, ""); } catch { return ""; }
}

function stationRechargeSummary(station) {
  const category = STATION_CATEGORY_LABELS[station.category] ? station.category : "paid";
  if (category === "public") return "公益站：不计算汇率";
  const rechargeRmb = nonNegativeNumber(station.rechargeRmb, 1);
  const rechargeCurrency = station.rechargeCurrency === "USD" ? "USD" : "CNY";
  const amount = convertRechargeAmount(rechargeRmb, "CNY", rechargeCurrency, currentExchangeRate());
  const credits = Number(station.rechargeCredits) > 0 ? Number(station.rechargeCredits) : 1;
  return `${formatRechargeAmount(amount)} ${rechargeCurrency} : ${credits} 中转币`;
}

function stationCard(station) {
  const category = STATION_CATEGORY_LABELS[station.category] ? station.category : "paid";
  const host = stationHostName(station.baseUrl);
  const name = station.name || host || "未命名站点";
  const verified = station.priceCurrencyVerified !== false;
  const pluginDescriptor = state.sitePlugins.find(plugin => plugin.id === station.pluginId);
  const badges = [
    `<span class="station-badge">${escapeHtml(STATION_CATEGORY_LABELS[category])}</span>`,
    `<span class="station-badge">${station.mode === "page" ? "页面模式" : "直接接口"}</span>`,
    pluginDescriptor ? `<span class="plugin-source-badge is-${pluginSourceKey(pluginDescriptor)}">${PLUGIN_SOURCE_LABELS[pluginSourceKey(pluginDescriptor)]} · ${escapeHtml(pluginDescriptor.name)}</span>` : "",
    verified ? "" : `<span class="station-badge is-warning">币种未核实</span>`
  ].join("");
  return `<article class="station-card${station.enabled ? "" : " is-disabled"}" id="station-card-${escapeHtml(station.id)}" data-station-id="${escapeHtml(station.id)}">
    <div class="station-card-main">
      <div class="station-card-head">
        <strong class="station-name" title="${escapeHtml(name)}">${escapeHtml(name)}</strong>
        <label class="switch" title="参与比价与批量查询"><input type="checkbox" data-field="enabled"${checked(station.enabled)}><span aria-hidden="true"></span></label>
        <div class="station-card-actions">
          <button class="icon-button" data-config-station type="button" title="配置站点" aria-label="配置站点">${icon("settings-2", { className: "icon" })}</button>
          <button class="icon-button" data-refresh-station type="button" title="查询模型" aria-label="查询模型">${icon("refresh-cw", { className: "icon" })}</button>
          <button class="icon-button danger-icon" data-remove-station type="button" title="删除站点" aria-label="删除站点">${icon("trash-2", { className: "icon" })}</button>
        </div>
      </div>
      <div class="station-card-meta">
        ${host && host !== name ? `<span class="station-host">${escapeHtml(host)}</span>` : ""}
        ${badges}
      </div>
      <div class="station-recharge" data-station-recharge>${escapeHtml(stationRechargeSummary(station))}</div>
      <div class="station-query-status" data-query-status role="status" aria-live="polite" aria-atomic="true" hidden>
        <progress max="1" value="0" aria-label="站点模型查询进度"></progress>
        <span data-query-message></span>
      </div>
    </div>
  </article>`;
}

function renderStations() {
  const count = $("#station-count");
  if (count) count.textContent = String(state.stations.length);
  renderPluginInstalled();
}
function updateStationQueryStatus(progress) {
  const card = document.getElementById(`station-card-${progress.stationId}`);
  const status = card?.querySelector("[data-query-status]");
  if (!status) return;
  const bar = status.querySelector("progress");
  const message = status.querySelector("[data-query-message]");
  const stationName = progress.stationName || card.querySelector(".station-name")?.textContent || "站点";
  status.hidden = false;
  status.dataset.status = progress.status || "";
  if (progress.status === "running") {
    bar.removeAttribute("value");
    message.textContent = `正在查询${progress.total ? `（并行槽位 ${progress.current || 1}）` : ""} · ${stationName}`;
    return;
  }
  bar.max = 1;
  bar.value = 1;
  const duration = Number.isFinite(progress.durationMs) ? ` · ${(progress.durationMs / 1000).toFixed(1)} 秒` : "";
  message.textContent = progress.status === "error"
    ? `查询失败${duration} · ${progress.error || "未知错误"}`
    : progress.status === "partial"
      ? `部分查询到 ${Number(progress.modelCount) || 0} 个模型${duration} · ${progress.error || "存在未解析计费模式"}`
      : `查询到 ${Number(progress.modelCount) || 0} 个模型${duration}`;
}

const USAGE_INPUTS = [
  { field: "input", id: "usage-input", million: true },
  { field: "cacheRead", id: "usage-cache-read", million: true },
  { field: "cacheWrite", id: "usage-cache-write", million: true },
  { field: "cacheWrite1h", id: "usage-cache-write-1h", million: true },
  { field: "output", id: "usage-output", million: true },
  { field: "requests", id: "usage-requests", million: false },
  { field: "imageInputTokens", id: "usage-image-input-tokens", million: true },
  { field: "imageOutputTokens", id: "usage-image-output-tokens", million: true },
  { field: "peakShare", id: "usage-peak-share", million: false, percent: true },
  { field: "images", id: "usage-images", million: false }
];

function readUsageInputs() {
  return Object.fromEntries(USAGE_INPUTS.map(({ field, id, million, percent }) => [
    field, Math.max(0, Number($(`#${id}`).value) || 0) * (percent ? 0.01 : million ? TOKENS_PER_MILLION : 1)
  ]));
}

function roundInput(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

// 输入框只显示有意义的小数位，别把 29.166666666666668 这种浮点尾巴摆到用户面前。
function usageInputValue(usage, { field, million, percent }) {
  const raw = Number(usage[field] || 0);
  if (percent) return roundInput(raw * 100, 2);
  if (million) return roundInput(raw / TOKENS_PER_MILLION, 4);
  return Math.round(raw);
}

function writeUsageInputs(usage) {
  for (const item of USAGE_INPUTS) {
    if (!Object.prototype.hasOwnProperty.call(usage, item.field)) continue;
    $(`#${item.id}`).value = usageInputValue(usage, item);
  }
}

function syncUsagePreset() {
  $("#usage-preset").value = usagePresetId(readUsageInputs(), state.settings?.magpieSync);
}

function renderUsagePresetOptions() {
  const select = $("#usage-preset");
  if (!select) return;
  const options = usagePresetOptions(state.settings?.magpieSync);
  select.innerHTML = options.map(option => `<option value="${option.id}">${escapeHtml(option.label)}</option>`).join("");
}

function applyUsagePreset(id) {
  if (id === "custom") return;
  const usage = id === "baseline" ? usagePresetUsage("baseline") : usagePresetUsage(id, state.settings?.magpieSync);
  if (usage) writeUsageInputs(usage);
  syncUsagePreset();
}

function renderMagpieUsageRow() {
  const settings = state.settings || {};
  const urlInput = $("#magpie-base-url");
  if (urlInput && document.activeElement !== urlInput) urlInput.value = settings.magpieBaseUrl || "";
  const interval = $("#magpie-sync-interval");
  if (interval && document.activeElement !== interval) interval.value = String(settings.magpieSyncIntervalMinutes ?? DEFAULT_MAGPIE_SYNC_INTERVAL_MINUTES);
  const status = $("#magpie-sync-status");
  if (status) status.textContent = magpieSyncLabel(settings.magpieSync);
}

function fillMagpieIntervalOptions() {
  const select = $("#magpie-sync-interval");
  if (!select) return;
  select.innerHTML = MAGPIE_SYNC_INTERVAL_OPTIONS.map(option => `<option value="${option.minutes}">${escapeHtml(option.label)}</option>`).join("");
}

async function saveMagpieInterval(minutes) {
  try {
    state.settings = await callService("SAVE_MAGPIE_PREFS", { intervalMinutes: minutes });
    renderMagpieUsageRow();
    toast(minutes ? `magpie 用量每 ${minutes / 60} 小时同步一次` : "已关闭 magpie 用量自动同步");
  } catch (error) {
    toast(`保存同步间隔失败：${error.message || error}`);
    renderMagpieUsageRow();
  }
}

// 同步成功后，如果当前口径正好是某个 magpie 预设，就把输入框换成新实测值。
async function syncMagpieUsage() {
  const button = $("#sync-magpie-usage");
  const presetBefore = usagePresetId(readUsageInputs(), state.settings?.magpieSync);
  button.disabled = true;
  try {
    state.settings = await callService("SYNC_MAGPIE_USAGE");
    renderUsagePresetOptions();
    renderMagpieUsageRow();
    if (presetBefore === "recent30d" || presetBefore === "recent7d") {
      const usage = usagePresetUsage(presetBefore, state.settings?.magpieSync);
      if (usage) writeUsageInputs(usage);
      scheduleSettingsSave();
    }
    syncUsagePreset();
    const failed = state.settings?.magpieSync?.error;
    toast(failed ? `同步失败：${failed}` : "已同步 magpie 用量");
  } catch (error) {
    toast(`同步失败：${error.message || error}`);
  } finally {
    button.disabled = false;
  }
}

function renderSettings() {
  const settings = state.settings;
  $("#currency").value = settings.defaultCurrency;
  $("#exchange-rate").value = Number(settings.exchangeRate || DEFAULT_EXCHANGE_RATE).toFixed(4);
  $("#evidence-threshold").value = Number.isFinite(Number(settings.evidenceThreshold)) ? String(Number(settings.evidenceThreshold)) : "60";
  renderUsagePresetOptions();
  writeUsageInputs(settings.usage);
  syncUsagePreset();
  renderMagpieUsageRow();
  $("#show-unmatched").checked = settings.showUnmatched;

  const assistant = settings.modelAssistant || {};
  $("#llm-enabled").checked = Boolean(assistant.enabled);
  $("#llm-base-url").value = assistant.baseUrl || "";
  $("#llm-model").value = assistant.model || "";
  $("#llm-temperature").value = Number.isFinite(Number(assistant.temperature)) ? String(Number(assistant.temperature)) : "0.1";
  $("#llm-api-key").value = "";
  $("#llm-api-key").placeholder = settings.hasModelAssistantKey ? "已保存，留空则不修改" : "sk-...";
}

function readStations() {
  return state.stations.map(station => {
    const rechargeRmb = nonNegativeNumber(station.rechargeRmb, station.rechargeRate || 1);
    const rechargeCurrency = station.rechargeCurrency === "USD" ? "USD" : "CNY";
    const rechargeCredits = Number(station.rechargeCredits) > 0 ? Number(station.rechargeCredits) : 1;
    const adapter = station.adapter || {};
    const auth = station.auth || {};
    return {
      id: station.id || crypto.randomUUID(),
      pluginId: station.pluginId || undefined,
      name: station.name || "",
      baseUrl: station.baseUrl || "",
      mode: station.mode === "page" ? "page" : "direct",
      category: STATION_CATEGORY_LABELS[station.category] ? station.category : "paid",
      enabled: station.enabled !== false,
      rechargeRmb,
      rechargeCurrency,
      rechargeCredits,
      rechargeRate: derivedRechargeRate(rechargeRmb, rechargeCredits),
      rechargeRateVerified: station.rechargeRateVerified !== false,
      rechargeRateNote: station.rechargeRateNote || "",
      priceCurrency: "CREDITS",
      priceCurrencyVerified: station.priceCurrencyVerified !== false,
      priceCurrencyNote: station.priceCurrencyNote || "",
      basePricePerMillion: nonNegativeNumber(station.basePricePerMillion, 2),
      auth: { type: auth.type || "none", token: auth.token || "", username: auth.username || "", password: auth.password || "" },
      adapter: { kind: "custom", endpoint: adapter.endpoint || "", body: adapter.body || "", rawJson: adapter.rawJson || "", method: adapter.method === "POST" ? "POST" : "GET", responseFormat: isSupportedResponseFormat(adapter.responseFormat) ? adapter.responseFormat : "auto" },
      tags: []
    };
  });
}
function readAssistantSettings() {
  const current = state.settings?.modelAssistant || {};
  return {
    ...current,
    enabled: $("#llm-enabled").checked,
    baseUrl: $("#llm-base-url").value.trim(),
    model: $("#llm-model").value.trim(),
    temperature: Math.min(2, Math.max(0, Number($("#llm-temperature").value) || 0.1))
  };
}
function readSettings() {
  const settings = normalizeSettings({
    ...state.settings,
    defaultCurrency: $("#currency").value,
evidenceThreshold: Math.max(0, Math.min(100, Math.round(Number($("#evidence-threshold").value) || 0))),
    exchangeRate: Math.max(0.0001, Number($("#exchange-rate").value) || DEFAULT_EXCHANGE_RATE),
    usage: readUsageInputs(),
    showUnmatched: $("#show-unmatched").checked,
    modelAssistant: readAssistantSettings(),
    magpieBaseUrl: $("#magpie-base-url").value.trim() || state.settings?.magpieBaseUrl,
  });
  // 密钥不参与设置归一，写进本机密钥区，不进导出文件。
  const assistantKey = $("#llm-api-key").value.trim();
  if (assistantKey) settings.modelAssistantKey = assistantKey;
  return settings;
}

function mergeStationSuggestion(station, suggestion) {
  if (!suggestion) return;
  if (suggestion.name) station.name = suggestion.name;
  if (suggestion.baseUrl) station.baseUrl = suggestion.baseUrl;
  if (suggestion.mode === "page" || suggestion.mode === "direct") station.mode = suggestion.mode;
  const adapter = { ...(station.adapter || {}) };
  if (suggestion.endpoint) adapter.endpoint = suggestion.endpoint;
  if (suggestion.body) adapter.body = suggestion.body;
  if (isSupportedResponseFormat(suggestion.responseFormat)) adapter.responseFormat = suggestion.responseFormat;
  if (["GET", "POST"].includes(suggestion.method)) adapter.method = suggestion.method;
  station.adapter = adapter;
  if (suggestion.authType) station.auth = { ...(station.auth || {}), type: suggestion.authType };
}

function currentConfigStation() {
  return state.stations.find(station => station.id === state.configStationId);
}

// 充值档位行用 DOM 拼，数值走 value 而不是拼字符串，避免用户输入进 HTML。
function appendTierRow(tier = {}) {
  const row = document.createElement("div");
  row.className = "tier-row";
  const amount = document.createElement("input");
  amount.type = "number";
  amount.min = "0";
  amount.step = "any";
  amount.className = "tier-amount";
  amount.placeholder = "额度";
  amount.setAttribute("aria-label", "档位额度");
  if (Number(tier.amount) > 0) amount.value = String(tier.amount);
  const discount = document.createElement("input");
  discount.type = "number";
  discount.min = "0";
  discount.max = "1";
  discount.step = "0.01";
  discount.className = "tier-discount";
  discount.placeholder = "折扣";
  discount.setAttribute("aria-label", "档位折扣");
  if (Number(tier.discount) > 0) discount.value = String(tier.discount);
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "icon-button danger-icon tier-remove";
  remove.title = "删除这一档";
  remove.setAttribute("aria-label", "删除这一档");
  remove.innerHTML = icon("trash-2", { className: "icon" });
  remove.addEventListener("click", () => row.remove());
  row.append(amount, discount, remove);
  $("#config-tier-rows").append(row);
  hydrateIcons(row);
}

function renderTierRows(tiers = []) {
  $("#config-tier-rows").replaceChildren();
  for (const tier of Array.isArray(tiers) ? tiers : []) appendTierRow(tier);
}

// 空白行和非法值直接丢弃，排序去重交给 normalizeRechargeTiers。
function collectTierRows() {
  const rows = [...$("#config-tier-rows").querySelectorAll(".tier-row")];
  return rows.map(row => ({
    amount: Number(row.querySelector(".tier-amount").value),
    discount: Number(row.querySelector(".tier-discount").value)
  })).filter(tier =>
    Number.isFinite(tier.amount) && tier.amount > 0 &&
    Number.isFinite(tier.discount) && tier.discount > 0 && tier.discount <= 1);
}

function collectConfigStation() {
  const station = currentConfigStation();
  if (!station) return null;
  const normalized = readStations().find(item => item.id === station.id);
  if (!normalized) return null;
  const rechargeCurrency = $("#config-recharge-currency").value === "USD" ? "USD" : "CNY";
  return {
    ...normalized,
    name: $("#config-station-name").value.trim() || station.name,
    auth: { ...(station.auth || {}), token: $("#config-station-token").value, username: $("#config-station-username").value, password: $("#config-station-password").value },
    rechargeRmb: convertRechargeAmount($("#config-recharge-amount").value, rechargeCurrency, "CNY", currentExchangeRate()) ?? 0,
    rechargeCurrency,
    rechargeCredits: Number($("#config-recharge-credits").value) || 1,
    priceCurrencyVerified: $("#config-price-currency-verified").checked,
    priceCurrencyNote: $("#config-price-currency-note").value.trim(),
    basePricePerMillion: nonNegativeNumber($("#config-base-price").value, 2),
    rechargeTiers: collectTierRows(),
    billingProfile: { tokensPerRequest: nonNegativeNumber($("#config-tokens-per-request").value, 0), source: "manual" }
  };
}

function fillStationConfigDialog(station) {
  $("#station-config-title").textContent = `站点配置 · ${station.name || stationHostName(station.baseUrl) || "未命名站点"}`;
  $("#config-station-host").textContent = station.baseUrl || "";
  $("#config-station-name").value = station.name || "";
  const auth = station.auth || {};
  $("#config-station-token").value = auth.token || "";
  $("#config-station-username").value = auth.username || "";
  $("#config-station-password").value = auth.password || "";
  const rechargeCurrency = station.rechargeCurrency === "USD" ? "USD" : "CNY";
  $("#config-recharge-amount").value = convertRechargeAmount(nonNegativeNumber(station.rechargeRmb, 1), "CNY", rechargeCurrency, currentExchangeRate());
  const currencySelect = $("#config-recharge-currency");
  currencySelect.value = rechargeCurrency;
  currencySelect.dataset.previousCurrency = rechargeCurrency;
  $("#config-recharge-credits").value = Number(station.rechargeCredits) > 0 ? Number(station.rechargeCredits) : 1;
  $("#config-price-currency-verified").checked = station.priceCurrencyVerified !== false;
  $("#config-price-currency-note").value = station.priceCurrencyNote || "";
  $("#config-base-price").value = nonNegativeNumber(station.basePricePerMillion, 2);
  renderTierRows(station.rechargeTiers);
  $("#config-tokens-per-request").value = Number(station.billingProfile?.tokensPerRequest) > 0 ? Number(station.billingProfile.tokensPerRequest) : 0;
  configRechargeRate();
  const origin = currentSiteOrigin(station.baseUrl);
  const isFastAiToken = ["https://fastaitoken.com", "https://www.fastaitoken.com"].includes(origin);
  $("#config-station-hint").textContent = station.mode === "page"
    ? isFastAiToken ? "复用本 Chrome 登录态，采集令牌不会保存到扩展。" : "页面模式：请先在当前标签页登录。"
    : "直接模式：读取模型列表地址，通常无需登录；需要登录时切换页面模式。";
  const warning = station.priceCurrencyVerified !== false ? "" : `模型价格映射未核实：${station.priceCurrencyNote || "请确认该站点模型列表报价可按 CREDITS 比较后勾选核实，否则该站点报价不会参与比价。"}`;
  const warningNode = $("#config-station-warning");
  warningNode.hidden = !warning;
  warningNode.textContent = warning;
}

function openStationConfig(stationId) {
  const station = state.stations.find(item => item.id === stationId);
  if (!station) return;
  state.configStationId = stationId;
  fillStationConfigDialog(station);
  $("#station-config-dialog").showModal();
  $("#config-station-name").focus();
}

async function saveStationConfig() {
  const station = currentConfigStation();
  const collected = collectConfigStation();
  if (!station || !collected) return;
  if (!$("#config-station-name").reportValidity() || !$("#config-recharge-amount").reportValidity() || !$("#config-recharge-credits").reportValidity()) return;
  const button = $("#config-save");
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `${icon("loader-circle", { className: "icon spin" })}<span>保存中</span>`;
  try {
    Object.assign(station, {
      name: collected.name,
      auth: collected.auth,
      rechargeRmb: collected.rechargeRmb,
      rechargeCurrency: collected.rechargeCurrency,
      rechargeCredits: collected.rechargeCredits,
      rechargeRate: derivedRechargeRate(collected.rechargeRmb, collected.rechargeCredits),
      rechargeRateVerified: collected.rechargeRmb > 0 && collected.rechargeCredits > 0,
      priceCurrencyVerified: collected.priceCurrencyVerified,
      priceCurrencyNote: collected.priceCurrencyNote,
      basePricePerMillion: collected.basePricePerMillion,
      rechargeTiers: collected.rechargeTiers,
      rechargeTiersVerified: collected.rechargeTiers.length > 0,
      billingProfile: collected.billingProfile
    });
    await persistStations();
    renderStations();
    $("#station-config-dialog").close();
    toast("站点配置已保存");
  } catch (error) {
    toast(error.message || String(error));
  } finally {
    button.disabled = false;
    button.innerHTML = original;
    hydrateIcons(button);
  }
}

async function autofillConfigStation() {
  const collected = collectConfigStation();
  if (!collected) return;
  const button = $("#config-autofill");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.dataset.label = button.innerHTML;
  button.innerHTML = `${icon("loader-circle", { className: "icon spin" })}<span>分析中</span>`;
  try {
    const sourceTabId = state.stationSourceTabIds.get(collected.id);
    const result = await callService("ADAPT_STATION", { station: collected, ...(Number.isInteger(sourceTabId) ? { sourceTabId } : {}) });
    mergeStationSuggestion(collected, { ...result.suggestion, ...(collected.mode === "page" ? { mode: "page" } : {}) });
    const station = currentConfigStation();
    if (station) Object.assign(station, { name: collected.name, baseUrl: collected.baseUrl, mode: collected.mode, adapter: collected.adapter, auth: collected.auth });
    fillStationConfigDialog(station || collected);
    const detail = result.discovery ? `，已探测 ${result.discovery.modelCount || 0} 个模型` : "";
    toast(`${result.warning ? `${result.warning}；` : ""}已按本地规则填充采集字段${detail}，点击“保存配置”生效`);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.innerHTML = button.dataset.label;
    hydrateIcons(button);
  }
}

async function testConfigStation() {
  const collected = collectConfigStation();
  if (!collected) return;
  const button = $("#config-test");
  const startedAt = Date.now();
  button.disabled = true;
  updateStationQueryStatus({ stationId: collected.id, stationName: collected.name, status: "running", current: 1, total: 1 });
  try {
    const result = await callService("TEST_STATION", { station: collected });
    const snapshot = result.snapshot;
    if (!["success", "partial"].includes(snapshot.status)) throw new Error(snapshot.error || "连接失败");
    updateStationQueryStatus({ stationId: collected.id, stationName: collected.name, status: snapshot.status, modelCount: snapshot.normalized?.data?.length || 0, durationMs: Date.now() - startedAt, error: snapshot.status === "partial" ? partialSnapshotMessage(snapshot) : "" });
    toast(snapshot.status === "partial" ? `连接成功，但${partialSnapshotMessage(snapshot)}` : `连接成功：${snapshot.normalized.data.length} 个模型`);
  } catch (error) {
    updateStationQueryStatus({ stationId: collected.id, stationName: collected.name, status: "error", error: error.message || String(error), durationMs: Date.now() - startedAt });
    toast(error.message || String(error));
  } finally {
    button.disabled = false;
  }
}
async function persistStations() {
  const stations = readStations();
  if (stations.some(station => !station.baseUrl)) throw new Error("请填写所有站点地址");
  state.stations = await callService("SAVE_STATIONS", { stations });
  return state.stations;
}

function partialSnapshotMessage(snapshot) {
  return getPartialDiagnostics(snapshot?.normalized).message;
}

async function refreshStation(stationId) {
  const card = document.getElementById(`station-card-${stationId}`);
  const button = card?.querySelector("[data-refresh-station]");
  const station = state.stations.find(item => item.id === stationId);
  if (!station?.baseUrl) throw new Error("请先填写站点地址");
  if (!station.enabled) throw new Error("请先启用站点再查询模型");
  const sourceTabId = state.stationSourceTabIds.get(stationId);
  const startedAt = Date.now();
  const original = button?.innerHTML || "";
  if (button) {
    button.disabled = true;
    button.innerHTML = `${icon("loader-circle", { className: "icon spin" })}`;
  }
  updateStationQueryStatus({ stationId: station.id, stationName: station.name, status: "running", current: 1, total: 1 });
  try {
    await persistStations();
    const data = await callService("REFRESH_STATION", { stationId: station.id, ...(sourceTabId === undefined ? {} : { sourceTabId }) });
    state.stations = data.stations || state.stations;
    const snapshot = (data.snapshots || []).find(row => row.stationId === station.id);
    if (!snapshot) throw new Error("未返回该站点的查询结果");
    const status = snapshot.status === "success" ? "success" : snapshot.status === "partial" ? "partial" : "error";
    const modelCount = snapshot.normalized?.data?.length || 0;
    updateStationQueryStatus({ stationId: station.id, stationName: station.name, status, modelCount, durationMs: Date.now() - startedAt, error: snapshot.error || (status === "partial" ? partialSnapshotMessage(snapshot) : "") });
    toast(status === "success" ? `已查询 ${modelCount} 个模型` : status === "partial" ? `部分查询：${modelCount} 个模型，${partialSnapshotMessage(snapshot)}` : `查询失败：${snapshot.error || "请查看仪表盘"}`);
  } catch (error) {
    updateStationQueryStatus({ stationId: station.id, stationName: station.name, status: "error", error: error.message || String(error), durationMs: Date.now() - startedAt });
    toast(error.message || String(error));
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = original;
      hydrateIcons(button);
    }
  }
}


function aboutCheckedAtLabel(timestamp) {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return "还没有检查记录";
  return `上次检查：${new Date(value).toLocaleString("zh-CN", { hour12: false })}`;
}

function aboutStatusText(last) {
  if (!last) return "尚未检查更新";
  if (last.status === "update") return `有新版本 v${last.latestVersion}`;
  if (last.status === "latest") return "已是最新版本";
  if (last.status === "none") return "仓库还没有发布版本";
  if (last.status === "error") return `检查失败：${last.error || "未知错误"}`;
  return "尚未检查更新";
}

function syncSegmented(attribute, match) {
  for (const button of document.querySelectorAll(`[${attribute}]`)) {
    button.setAttribute("aria-pressed", String(Boolean(match(button.getAttribute(attribute)))));
  }
}

function formatStorageSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

function renderAbout() {
  const update = state.update || {};
  const last = update.lastCheck || null;
  const versionNode = $("#about-current-version");
  if (versionNode) versionNode.textContent = update.currentVersion ? `v${update.currentVersion}` : "—";
  const statusNode = $("#about-version-status");
  if (statusNode) statusNode.textContent = aboutStatusText(last);
  const lastCheckNode = $("#about-last-check");
  if (lastCheckNode) lastCheckNode.textContent = aboutCheckedAtLabel(last?.checkedAt);
  const notesNode = $("#about-release-notes");
  if (notesNode) notesNode.textContent = last?.notes || (last?.status === "latest" ? "当前版本已是最新。" : "—");
  const releaseNode = $("#about-release-source");
  if (releaseNode && last?.latestVersion) releaseNode.textContent = `最近发布 v${last.latestVersion} · napstablook666/ai-price-analyzer`;
  syncSegmented("data-update-auto", value => value === (update.autoCheck === false ? "off" : "on"));
  syncSegmented("data-update-interval", value => Number(value) === Number(update.intervalMinutes || 360));
  syncSegmented("data-update-channel", value => value === (update.channel || "stable"));
  renderSelfUpdate();
}

async function renderStorageUsage() {
  const node = $("#about-storage-usage");
  if (!node) return;
  try {
    node.textContent = formatStorageSize(await chrome.storage.local.getBytesInUse(null));
  } catch {
    node.textContent = "—";
  }
}

async function refreshUpdateState() {
  try {
    state.update = await callService("GET_UPDATE_STATE");
  } catch (error) {
    toast(error.message);
    return;
  }
  renderAbout();
  renderStorageUsage();
}

async function checkUpdateNow() {
  const button = $("#about-check-update");
  if (button) button.disabled = true;
  try {
    state.update = await callService("CHECK_UPDATE");
    renderAbout();
    const last = state.update.lastCheck;
    if (last?.status === "update") toast(`发现新版本 v${last.latestVersion}`);
    else if (last?.status === "latest") toast("已是最新版本");
    else if (last?.status === "none") toast("仓库还没有发布版本");
    else toast(`检查失败：${last?.error || "未知错误"}`);
  } catch (error) {
    toast(error.message);
  } finally {
    if (button) button.disabled = false;
  }
}

async function saveUpdatePrefs(patch) {
  try {
    state.update = await callService("SAVE_UPDATE_PREFS", patch);
    renderAbout();
    toast("更新设置已保存");
  } catch (error) {
    toast(error.message);
  }
}
const SELF_UPDATE_DB = "apa-self-update";
const SELF_UPDATE_STORE = "handles";
const SELF_UPDATE_HANDLE_KEY = "extension-dir";

function selfUpdateDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SELF_UPDATE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(SELF_UPDATE_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readUpdateDirectory() {
  try {
    const db = await selfUpdateDb();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(SELF_UPDATE_STORE, "readonly").objectStore(SELF_UPDATE_STORE).get(SELF_UPDATE_HANDLE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function writeUpdateDirectory(handle) {
  const db = await selfUpdateDb();
  await new Promise((resolve, reject) => {
    const request = db.transaction(SELF_UPDATE_STORE, "readwrite").objectStore(SELF_UPDATE_STORE).put(handle, SELF_UPDATE_HANDLE_KEY);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function bindUpdateDirectory() {
  if (!window.showDirectoryPicker) {
    toast("这个浏览器不支持目录写入，请用 update.bat 更新");
    return;
  }
  let handle;
  try {
    handle = await window.showDirectoryPicker({ id: "apa-extension-dir", mode: "readwrite", startIn: "documents" });
  } catch {
    return;
  }
  if (!(await isExtensionDirectory(handle))) {
    toast("这个目录里没有 manifest.json，不是扩展目录");
    return;
  }
  await writeUpdateDirectory(handle);
  state.updateDirectoryHandle = handle;
  renderSelfUpdate();
  toast("已绑定扩展目录");
}

async function installUpdateNow() {
  const button = $("#about-install-update");
  const progress = $("#about-self-update-progress");
  const directory = state.updateDirectoryHandle || (await readUpdateDirectory());
  const say = text => { if (progress) progress.textContent = text; };
  if (!directory) {
    toast("先绑定扩展目录");
    return;
  }
  if (button) button.disabled = true;
  let backup = null;
  try {
    say("正在读取更新清单…");
    const manifest = await fetchUpdateManifest();
    const currentVersion = state.update?.currentVersion || chrome.runtime.getManifest().version;
    if (!canSelfUpdate(currentVersion, manifest)) {
      say("");
      toast("当前版本太旧，需要手动下载一次");
      return;
    }
    say("正在下载更新包…");
    const response = await fetch(manifest.zip.url, { cache: "no-store" });
    if (!response.ok) throw new Error(`下载更新包失败：HTTP ${response.status}`);
    const zipBytes = new Uint8Array(await response.arrayBuffer());
    say("正在校验…");
    const result = await applyUpdate({
      dirHandle: directory,
      zipBuffer: zipBytes,
      manifest,
      onProgress: ({ done, total }) => say(`正在写入 ${Math.min(done + 1, total)}/${total}…`),
      onBackup: value => { backup = value; }
    });
    await chrome.storage.local.set({ "self-update": { version: manifest.version, at: Date.now() } });
    say(`已写入 ${result.written.length} 个文件，正在重启扩展…`);
    chrome.runtime.reload();
  } catch (error) {
    // 中途写坏就地把旧的 manifest 和 service worker 放回去，别留一个加载不起来的目录。
    if (backup) await restoreBackup(directory, backup);
    say("");
    toast(`更新失败：${error.message}`);
    if (button) button.disabled = false;
  }
}

function renderSelfUpdate() {
  const hint = $("#about-self-update-hint");
  const bind = $("#about-bind-dir");
  const install = $("#about-install-update");
  if (!hint || !bind || !install) return;
  const bound = Boolean(state.updateDirectoryHandle);
  const pending = state.update?.lastCheck?.status === "update" ? state.update.lastCheck.latestVersion : "";
  bind.textContent = bound ? "重新绑定" : "绑定目录";
  hint.textContent = bound
    ? "已绑定扩展目录，检查到新版本时可以在这里直接更新"
    : "未绑定扩展目录，只能去 GitHub 手动下载";
  install.hidden = !(bound && pending);
}

// 目录句柄存在本页 IndexedDB 里，重启浏览器后仍是同一条记录，不需要重新授权。
(async () => {
  state.updateDirectoryHandle = await readUpdateDirectory();
  renderSelfUpdate();
  const stored = (await chrome.storage.local.get("self-update"))["self-update"];
  if (!stored) return;
  await chrome.storage.local.remove("self-update");
  toast(`已更新到 v${stored.version}`);
})();

async function exportSettingsFile() {
  try {
    const payload = await callService("EXPORT_SETTINGS");
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `ai-price-analyzer-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast("配置已导出");
  } catch (error) {
    toast(`导出失败：${error.message}`);
  }
}

function pickSettingsFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await callService("IMPORT_SETTINGS", { payload: await file.text() });
      toast("配置已导入，密钥要重新填一次");
      await load();
    } catch (error) {
      toast(`导入失败：${error.message}`);
    }
  });
  input.click();
}

async function load() {
  try {
    const [data, pluginWorkspace] = await Promise.all([callService("GET_DASHBOARD"), callService("GET_PLUGIN_WORKSPACE")]);
    state.pluginWorkspace = pluginWorkspace;
    state.stations = data.stations || [];
    state.sitePlugins = pluginWorkspace.catalog?.length ? pluginWorkspace.catalog : data.sitePlugins || [];
    state.settings = data.settings;
    renderSettings();
    renderPluginWorkspace();
    renderAbout();
    refreshUpdateState();
    renderStations();
    hydrateIcons();
    const params = new URLSearchParams(location.search);
    const siteOrigin = currentSiteOrigin(params.get("addSite"));
    if (siteOrigin) {
      const sourceTabId = params.get("sourceTabId");
      const preferredTabId = /^\d+$/.test(sourceTabId || "") ? Number(sourceTabId) : undefined;
      history.replaceState(null, "", `${location.pathname}#stations`);
      openStationDialog(siteOrigin, preferredTabId);
    }
  } catch (error) { toast(error.message); }
}

function stationPreviewBaseUrl(value, fallback) {
  try { return normalizeUrl(value || fallback); } catch { return fallback; }
}

function showStationPreview(result, rechargeRatio) {
  const pending = state.pendingStation;
  const suggestion = result.suggestion;
  if (!pending || !suggestion) throw new Error("站点分析未返回可用配置");
  suggestion.baseUrl = stationPreviewBaseUrl(suggestion.baseUrl, pending.station.baseUrl);
  pending.suggestion = suggestion;
  const authLabels = { none: "无", bearer: "Bearer Token", "api-key": "X-API-Key", basic: "Basic" };
  const formatLabels = Object.fromEntries(Object.entries(RESPONSE_FORMAT_DEFINITIONS).map(([format, definition]) => [format, definition.label]));
  const endpoint = suggestion.endpoint || "自动探测";
  const format = `${suggestion.method || "GET"} / ${formatLabels[suggestion.responseFormat] || suggestion.responseFormat || "自动识别"}`;
  const fields = {
    name: suggestion.name || pending.station.name,
    baseUrl: suggestion.baseUrl,
    mode: suggestion.mode === "page" ? "页面桥接" : suggestion.mode === "direct" ? "直接接口" : "自动识别",
    endpoint,
    format,
    authType: authLabels[suggestion.authType] || authLabels[pending.station.auth.type],
    body: suggestion.body || "无"
  };
  for (const [field, value] of Object.entries(fields)) {
    $(`[data-preview-field="${field}"]`).textContent = String(value);
  }
  const source = "本地规则";
  const modelCount = Number(result.discovery?.modelCount);
  const details = [result.warning, `分析来源：${source}${Number.isFinite(modelCount) ? `，探测到 ${modelCount} 个模型` : ""}`, suggestion.rationale].filter(Boolean);
  $("#station-preview-status").textContent = details.join("；");
  const rechargeCurrency = rechargeRatio.currency === "USD" ? "USD" : "CNY";
  const amountInput = $("#preview-recharge-amount");
  amountInput.value = rechargeRatio.amount;
  const currencySelect = $("#preview-recharge-currency");
  currencySelect.value = rechargeCurrency;
  currencySelect.dataset.previousCurrency = rechargeCurrency;
  $("#preview-recharge-credits").value = rechargeRatio.credits;
  $("#station-url-step").hidden = true;
  $("#station-preview").hidden = false;
  $("#add-station-dialog").setAttribute("aria-labelledby", "station-preview-title");
  updatePreviewRechargeRate();
  $("#confirm-add-station").focus();
}

function updatePreviewRechargeRate() {
  const amount = Number($("#preview-recharge-amount").value);
  const currency = $("#preview-recharge-currency").value;
  const rmb = convertRechargeAmount(amount, currency, "CNY", currentExchangeRate()) ?? 0;
  const credits = Number($("#preview-recharge-credits").value);
  const rate = rmb > 0 && credits > 0 ? rmb / credits : null;
  $("#preview-recharge-rate").textContent = rate === null ? "请输入大于 0 的金额和中转币" : `每 1 中转币成本 ¥${rate.toFixed(4)}`;
  return rate;
}

function refreshRechargeDisplays() {
  renderStations();
  updatePreviewRechargeRate();
  if ($("#station-config-dialog").open) configRechargeRate();
}
async function analyzeStation(siteUrl, sourceTabId) {
  const input = $("#new-station-url");
  const siteOrigin = currentSiteOrigin(siteUrl);
  if (!siteOrigin) {
    input.setCustomValidity("请输入 HTTPS 站点网址；HTTP 仅支持 localhost");
    input.reportValidity();
    return;
  }
  input.setCustomValidity("");
  const existing = state.stations.find(station => currentSiteOrigin(station.baseUrl) === siteOrigin);
  if (existing && !window.confirm("该站点已有配置。仍要添加一份独立配置吗？")) {
    const card = [...$("#plugin-installed-list").querySelectorAll(".station-card")].find(item => item.dataset.stationId === existing.id);
    card?.scrollIntoView({ behavior: "smooth", block: "center" });
    toast("已保留现有站点配置");
    return;
  }
  const previousRatio = state.pendingStation ? { amount: $("#preview-recharge-amount").value, currency: $("#preview-recharge-currency").value, credits: $("#preview-recharge-credits").value } : { amount: "1", currency: "CNY", credits: "1" };
  const station = cloneDefaultStation();
  station.id = crypto.randomUUID();
  station.name = new URL(siteOrigin).hostname.replace(/^www\./i, "");
  station.baseUrl = siteOrigin;
  station.mode = Number.isInteger(sourceTabId) ? "page" : "direct";
  state.pendingStation = { station, sourceTabId, suggestion: null };
  const requestId = ++state.previewRequestId;
  const button = $("#analyze-station");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.querySelector("span:last-child").textContent = "分析中";
  try {
    const result = await callService("ADAPT_STATION", { station, ...(Number.isInteger(sourceTabId) ? { sourceTabId } : {}) });
    if (requestId === state.previewRequestId) showStationPreview(result, previousRatio);
  } catch (error) {
    if (requestId === state.previewRequestId) {
      state.pendingStation = null;
      toast(error.message);
    }
  } finally {
    if (requestId === state.previewRequestId) {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      button.querySelector("span:last-child").textContent = "分析站点";
    }
  }
}

function resetStationDialog() {
  state.previewRequestId += 1;
  state.pendingStation = null;
  $("#add-station-form").reset();
  $("#station-url-step").hidden = false;
  $("#station-preview").hidden = true;
  $("#add-station-dialog").setAttribute("aria-labelledby", "add-station-title");
  const button = $("#analyze-station");
  button.disabled = false;
  button.removeAttribute("aria-busy");
  button.querySelector("span:last-child").textContent = "分析站点";
}

function openStationDialog(siteUrl = "", sourceTabId, { analyze = true } = {}) {
  activateSettingsView("stations");
  resetStationDialog();
  $("#new-station-url").value = siteUrl;
  $("#add-station-dialog").showModal();
  if (siteUrl && analyze) void analyzeStation(siteUrl, sourceTabId);
}

function commitStationPreview() {
  const pending = state.pendingStation;
  if (!pending?.suggestion) return;
  const amountInput = $("#preview-recharge-amount");
  const currencySelect = $("#preview-recharge-currency");
  const creditsInput = $("#preview-recharge-credits");
  if (!amountInput.reportValidity() || !creditsInput.reportValidity()) return;
  const rechargeCurrency = currencySelect.value === "USD" ? "USD" : "CNY";
  const rechargeRmb = convertRechargeAmount(amountInput.value, rechargeCurrency, "CNY", currentExchangeRate());
  const rechargeCredits = Number(creditsInput.value);
  const suggestion = pending.suggestion;
  const station = {
    ...pending.station,
    name: String(suggestion.name || pending.station.name).trim().slice(0, 120),
    baseUrl: stationPreviewBaseUrl(suggestion.baseUrl, pending.station.baseUrl),
    mode: suggestion.mode === "page" ? "page" : suggestion.mode === "direct" ? "direct" : pending.station.mode,
    rechargeRmb,
    rechargeCurrency,
    rechargeCredits,
    rechargeRate: derivedRechargeRate(rechargeRmb, rechargeCredits),
    adapter: {
      ...pending.station.adapter,
      endpoint: suggestion.endpoint || pending.station.adapter.endpoint,
      body: suggestion.body || pending.station.adapter.body,
      method: ["GET", "POST"].includes(suggestion.method) ? suggestion.method : pending.station.adapter.method,
      responseFormat: isSupportedResponseFormat(suggestion.responseFormat) ? suggestion.responseFormat : pending.station.adapter.responseFormat
    }
  };
  state.stations.push(station);
  if (Number.isInteger(pending.sourceTabId)) state.stationSourceTabIds.set(station.id, pending.sourceTabId);
  renderStations();
  const card = document.querySelector(`[data-station-id="${station.id}"]`);
  card?.scrollIntoView({ behavior: "smooth", block: "center" });
  $("#add-station-dialog").close();
  void flushStationsSave();
  toast("站点已添加，自动保存");
}

function closeStationDialog() {
  $("#add-station-dialog").close();
}

for (const view of SETTINGS_VIEWS) {
  $(`[data-settings-target="${view}"]`).addEventListener("click", () => activateSettingsView(view));
}
$(".settings-nav").addEventListener("click", event => {
  const item = event.target.closest("[data-nav-jump]");
  if (item) jumpToNavTarget(item.dataset.navJump);
});
initTopMenu();
$("#top-menu")?.addEventListener("click", event => {
  const item = event.target.closest("[data-menu-jump]");
  if (item) jumpToNavTarget(item.dataset.menuJump);
});
$("#settings-view-about")?.addEventListener("click", event => {
  const prefButton = event.target.closest("[data-update-auto], [data-update-interval], [data-update-channel]");
  if (prefButton) {
    if (prefButton.dataset.updateAuto) saveUpdatePrefs({ autoCheck: prefButton.dataset.updateAuto === "on" });
    else if (prefButton.dataset.updateInterval) saveUpdatePrefs({ intervalMinutes: Number(prefButton.dataset.updateInterval) });
    else if (prefButton.dataset.updateChannel) saveUpdatePrefs({ channel: prefButton.dataset.updateChannel });
    return;
  }
  if (event.target.closest("#about-check-update")) {
    checkUpdateNow();
    return;
  }
  if (event.target.closest("#about-bind-dir")) {
    bindUpdateDirectory();
    return;
  }
  if (event.target.closest("#about-install-update")) {
    installUpdateNow();
    return;
  }
  if (event.target.closest("#about-export-settings")) {
    exportSettingsFile();
    return;
  }
  if (event.target.closest("#about-import-settings")) {
    pickSettingsFile();
    return;
  }
  if (event.target.closest("#about-open-release")) {
    window.open(state.update?.lastCheck?.releaseUrl || "https://github.com/napstablook666/ai-price-analyzer/releases", "_blank", "noopener,noreferrer");
  }
});
const settingsContent = $(".settings-content");
settingsContent.addEventListener("scroll", scheduleNavActive, { passive: true });
for (const type of ["wheel", "touchstart", "pointerdown"]) {
  settingsContent.addEventListener(type, () => { navPinnedKey = ""; }, { passive: true });
}
window.addEventListener("resize", scheduleNavActive);
$(".settings-nav").addEventListener("keydown", event => {
  if (!event.target.matches("[data-settings-target]")) return;
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const current = SETTINGS_VIEWS.findIndex(view => $(`[data-settings-target="${view}"]`).getAttribute("aria-selected") === "true");
  const offset = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
  const next = event.key === "Home" ? 0 : event.key === "End" ? SETTINGS_VIEWS.length - 1 : (current + offset + SETTINGS_VIEWS.length) % SETTINGS_VIEWS.length;
  activateSettingsView(SETTINGS_VIEWS[next], { focus: true });
});
window.addEventListener("hashchange", () => activateSettingsView(location.hash.slice(1), { updateHash: false }));

$("#plugin-registry-refresh").addEventListener("click", refreshPluginRegistry);
$("#plugin-registry-url").addEventListener("keydown", event => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  refreshPluginRegistry();
});
$("#dev-mode").addEventListener("change", event => toggleDevMode(event.currentTarget.checked));
$("#dev-plugin-load").addEventListener("click", loadLocalPlugin);
$("#dev-plugin-file").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    $("#dev-plugin-spec").value = await file.text();
    toast("已读取插件文件，确认后点「加载本地插件」");
  } catch (error) {
    toast(error.message);
  } finally {
    event.target.value = "";
  }
});
function togglePluginEntry(kind, id) {
  if (kind === "registry") {
    state.expandedRegistryId = state.expandedRegistryId === id ? "" : id;
    renderPluginRegistry();
    return;
  }
  state.expandedInstalledId = state.expandedInstalledId === id ? "" : id;
  renderPluginInstalled();
}

$("#plugin-installed-list").addEventListener("click", event => {
  const toggle = event.target.closest("[data-plugin-toggle]");
  if (toggle) {
    togglePluginEntry("installed", toggle.dataset.pluginToggle);
    return;
  }
  const addButton = event.target.closest("[data-plugin-add]");
  if (addButton) {
    addPluginSite(addButton.dataset.pluginAdd);
    return;
  }
  const addressButton = event.target.closest("[data-plugin-address]");
  if (addressButton) {
    openStationDialog(`https://${addressButton.dataset.pluginHost}/`, undefined, { analyze: false });
    return;
  }
  const removeButton = event.target.closest("[data-plugin-uninstall]");
  if (removeButton) uninstallPluginVersion(removeButton.dataset.pluginUninstall);
});
$("#plugin-registry-list").addEventListener("click", event => {
  const toggle = event.target.closest("[data-registry-toggle]");
  if (toggle) {
    togglePluginEntry("registry", toggle.dataset.registryToggle);
    return;
  }
  const installButton = event.target.closest("[data-plugin-install]");
  if (installButton) {
    installPluginVersion(installButton.dataset.pluginInstall);
    return;
  }
  const removeButton = event.target.closest("[data-plugin-uninstall]");
  if (removeButton) uninstallPluginVersion(removeButton.dataset.pluginUninstall);
});
$("#plugin-registry-list").addEventListener("change", event => {
  const check = event.target.closest("[data-registry-check]");
  if (!check) return;
  const id = check.dataset.registryCheck;
  const entries = state.pluginWorkspace?.registry?.entries || [];
  const isSelectable = targetId => {
    const entry = entries.find(item => item.id === targetId);
    return Boolean(entry) && registryEntrySelectable(entry);
  };
  if (event.shiftKey && applyRangeSelection(state.registryOrder, state.registryAnchorId, id, check.checked, state.registrySelected, isSelectable)) {
    state.registryAnchorId = id;
    renderPluginRegistry();
    return;
  }
  if (check.checked) state.registrySelected.add(id);
  else state.registrySelected.delete(id);
  state.registryAnchorId = id;
  updateRegistrySelection();
});
$("#plugin-registry-search").addEventListener("input", renderPluginRegistry);
$("#plugin-installed-search").addEventListener("input", renderPluginInstalled);
for (const button of document.querySelectorAll("[data-registry-filter]")) {
  button.addEventListener("click", () => {
    state.registryFilter = button.dataset.registryFilter;
    renderPluginRegistry();
  });
}
$("#registry-select-all").addEventListener("change", event => {
  const entries = filteredRegistryEntries(state.pluginWorkspace?.registry?.entries || []);
  for (const entry of entries) {
    if (!registryEntrySelectable(entry)) continue;
    if (event.currentTarget.checked) state.registrySelected.add(entry.id);
    else state.registrySelected.delete(entry.id);
  }
  renderPluginRegistry();
});
$("#plugin-installed-list").addEventListener("change", event => {
  const check = event.target.closest("[data-installed-check]");
  if (!check) return;
  const id = check.dataset.installedCheck;
  const isSelectable = targetId => state.installedSelectable.has(targetId);
  if (event.shiftKey && applyRangeSelection(state.installedOrder, state.installedAnchorId, id, check.checked, state.installedSelected, isSelectable)) {
    state.installedAnchorId = id;
    renderPluginInstalled();
    return;
  }
  if (check.checked) state.installedSelected.add(id);
  else state.installedSelected.delete(id);
  state.installedAnchorId = id;
  updateInstalledSelection();
});
$("#installed-select-all").addEventListener("change", event => {
  for (const id of state.installedOrder) {
    if (event.currentTarget.checked) state.installedSelected.add(id);
    else state.installedSelected.delete(id);
  }
  renderPluginInstalled();
});
$("#uninstall-selected-plugins").addEventListener("click", uninstallSelectedPlugins);
$("#install-selected-plugins").addEventListener("click", installSelectedPlugins);
$("#local-plugin-list").addEventListener("click", event => {
  const removeButton = event.target.closest("[data-plugin-remove]");
  if (removeButton) removeLocalPluginEntry(removeButton.dataset.pluginRemove);
});

$("#add-station-top").addEventListener("click", () => openStationDialog());
$("#cancel-add-station").addEventListener("click", closeStationDialog);
$("#cancel-preview-station").addEventListener("click", closeStationDialog);
$("#back-to-station-url").addEventListener("click", () => {
  $("#station-preview").hidden = true;
  $("#station-url-step").hidden = false;
  $("#add-station-dialog").setAttribute("aria-labelledby", "add-station-title");
  $("#new-station-url").focus();
});
$("#confirm-add-station").addEventListener("click", commitStationPreview);
$("#preview-recharge-amount").addEventListener("input", updatePreviewRechargeRate);
$("#preview-recharge-currency").addEventListener("change", () => {
  changeRechargeCurrency($("#preview-recharge-amount"), $("#preview-recharge-currency"));
  updatePreviewRechargeRate();
});
$("#preview-recharge-credits").addEventListener("input", updatePreviewRechargeRate);
$("#add-station-dialog").addEventListener("close", resetStationDialog);
$("#new-station-url").addEventListener("input", event => event.target.setCustomValidity(""));
$("#add-station-form").addEventListener("submit", event => {
  event.preventDefault();
  const input = $("#new-station-url");
  if (!input.reportValidity()) return;
  void analyzeStation(input.value);
});

$("#plugin-installed-list").addEventListener("click", async event => {
  const card = event.target.closest(".station-card");
  if (!card) return;
  const stationId = card.dataset.stationId;
  if (event.target.closest("[data-remove-station]")) {
    state.stationSourceTabIds.delete(stationId);
    state.stations = state.stations.filter(station => station.id !== stationId);
    renderStations();
    scheduleStationsSave();
    return;
  }
  if (event.target.closest("[data-config-station]")) {
    openStationConfig(stationId);
    return;
  }
  if (event.target.closest("[data-refresh-station]")) {
    await refreshStation(stationId).catch(error => {
      updateStationQueryStatus({ stationId, status: "error", error: error.message || String(error) });
      toast(error.message || String(error));
    });
  }
});
$("#plugin-installed-list").addEventListener("change", event => {
  const card = event.target.closest(".station-card");
  if (!card || !event.target.matches('[data-field="enabled"]')) return;
  const station = state.stations.find(item => item.id === card.dataset.stationId);
  if (!station) return;
  station.enabled = event.target.checked;
  scheduleStationsSave();
  card.classList.toggle("is-disabled", !station.enabled);
});
$("#station-config-form").addEventListener("submit", event => {
  event.preventDefault();
  void saveStationConfig();
});
$("#config-tier-add").addEventListener("click", () => appendTierRow());
$("#config-cancel").addEventListener("click", () => $("#station-config-dialog").close());
$("#config-autofill").addEventListener("click", () => void autofillConfigStation());
$("#config-test").addEventListener("click", () => void testConfigStation());
$("#config-recharge-amount").addEventListener("input", configRechargeRate);
$("#config-recharge-credits").addEventListener("input", configRechargeRate);
$("#config-recharge-currency").addEventListener("change", () => {
  changeRechargeCurrency($("#config-recharge-amount"), $("#config-recharge-currency"));
  configRechargeRate();
});


$("#usage-preset").addEventListener("change", event => applyUsagePreset(event.target.value));
for (const { id } of USAGE_INPUTS) $(`#${id}`).addEventListener("input", syncUsagePreset);
$("#magpie-sync-interval").addEventListener("change", event => void saveMagpieInterval(Number(event.target.value)));
$("#sync-magpie-usage").addEventListener("click", () => void syncMagpieUsage());
fillMagpieIntervalOptions();

$("#exchange-rate").addEventListener("input", refreshRechargeDisplays);
$("#refresh-exchange-rate").addEventListener("click", () => refreshExchangeRate());
async function refreshExchangeRate() {
  const button = $("#refresh-exchange-rate");
  button.disabled = true;
  try {
    const data = await callService("FETCH_REFERENCES");
    const rate = Number(data.references?.exchangeRate);
    if (!Number.isFinite(rate) || rate <= 0) throw new Error("中国银行汇率数据不可用");
    $("#exchange-rate").value = rate.toFixed(4);
    scheduleSettingsSave();
    refreshRechargeDisplays();
    toast(`汇率已更新：${rate.toFixed(4)}`);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}
// 设置页不再有「保存全部」：字段改动防抖后落库，站点开关与增删即时提交，页面隐藏时补一次。
const AUTO_SAVE_DELAY = 400;
let settingsSaveTimer = 0;
let stationsSaveTimer = 0;
let settingsDirty = false;
let stationsDirty = false;
let settingsSaveChain = Promise.resolve();
let stationsSaveChain = Promise.resolve();

function notifySettingsSaved() {
  if (EMBEDDED) window.parent.postMessage({ type: "MODEL_ATLAS_SETTINGS_SAVED" }, location.origin);
}

function scheduleSettingsSave() {
  settingsDirty = true;
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(() => void flushSettingsSave(), AUTO_SAVE_DELAY);
}

function scheduleStationsSave() {
  stationsDirty = true;
  clearTimeout(stationsSaveTimer);
  stationsSaveTimer = setTimeout(() => void flushStationsSave(), AUTO_SAVE_DELAY);
}

function flushSettingsSave() {
  if (settingsSaveTimer) {
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = 0;
  }
  if (!settingsDirty) return settingsSaveChain;
  settingsDirty = false;
  settingsSaveChain = settingsSaveChain.then(async () => {
    try {
      state.settings = await callService("SAVE_SETTINGS", { settings: readSettings() });
      // 密钥已经写进本机密钥区，清空输入框，免得下一次保存再写一遍。
      const keyInput = $("#llm-api-key");
      if (keyInput?.value.trim() && document.activeElement !== keyInput) {
        keyInput.value = "";
        keyInput.placeholder = "已保存，留空则不修改";
      }
      notifySettingsSaved();
    } catch (error) {
      settingsDirty = true;
      toast(`设置保存失败：${error.message || error}`);
    }
  });
  return settingsSaveChain;
}

function stationSignature() {
  return (state.stations || []).map(station => `${station.id}:${station.enabled ? 1 : 0}:${station.name}:${station.baseUrl}`).join("|");
}

function flushStationsSave() {
  if (stationsSaveTimer) {
    clearTimeout(stationsSaveTimer);
    stationsSaveTimer = 0;
  }
  if (!stationsDirty) return stationsSaveChain;
  stationsDirty = false;
  stationsSaveChain = stationsSaveChain.then(async () => {
    try {
      const before = stationSignature();
      await persistStations();
      // 服务端会归一 id 与开关，只在结果真的变了时重绘，避免打字时列表跳动。
      if (stationSignature() !== before) renderStations();
      notifySettingsSaved();
    } catch (error) {
      stationsDirty = true;
      toast(`站点保存失败：${error.message || error}`);
    }
  });
  return stationsSaveChain;
}

function flushAutoSave() {
  return Promise.all([flushSettingsSave(), flushStationsSave()]);
}

for (const selector of ["#settings-form", "#llm-form"]) {
  const form = $(selector);
  if (!form) continue;
  form.addEventListener("input", event => {
    // 密钥框每敲一个字符就落库没有意义，等失焦（change）再写。
    if (event.target?.id === "llm-api-key") return;
    scheduleSettingsSave();
  });
  form.addEventListener("change", scheduleSettingsSave);
  // 表单里按回车直接落库，不再整页提交。
  form.addEventListener("submit", event => {
    event.preventDefault();
    void flushSettingsSave();
  });
}

window.addEventListener("pagehide", () => void flushAutoSave());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) void flushAutoSave();
});

const [initialView, initialJump] = location.hash.slice(1).split(":");
activateSettingsView(initialView);
if (initialJump) requestAnimationFrame(() => jumpToNavTarget(initialJump));
hydrateIcons();
const cards = initCardCollapse("options");
onRefreshProgress(progress => {
  if (progress.phase === "station") updateStationQueryStatus(progress);
});
void load();

// 徽章写结论本身，具体原因放在第二列：整批超时和模型漏答要能一眼分开。
const ASSIST_STATUS_LABELS = { manual: "人工指定", pending: "待识别", accepted: "AI 已匹配", none: "判为不是", invalid: "不存在的 id", failed: "失败", ignored: "已忽略" };
// 分区说明：每一区该做什么都不一样，写在这里免得用户对着列表发呆。
const ASSIST_POOL_HINTS = {
  all: "全部：每条都能点「指定」人工挑基准模型，指定后优先级最高，AI 再判也不会改。",
  matched: "已匹配：已经归到基准模型的写法，AI 判的或你指定的。判错了就点「改指定」重挑一个，或点「撤销」清掉。",
  unmatched: "未匹配：还没问过模型。点「识别当前未匹配」把它们发出去，也可以直接点「指定」自己挑。",
  confirm: "待确认：试过但没成，模型判「不是」、请求报错、或者你忽略过的都在这儿。可以点「立即重试」，也可以人工指定一个基准模型。"
};
const ASSIST_REASON_LABELS = { timeout: "超时", error: "报错", unanswered: "漏答", "no-candidates": "规则层没有相似候选" };

function setAssistantStatus(message, error = false) {
  const node = $("#llm-status");
  if (!node) return;
  node.textContent = message;
  node.dataset.error = error ? "true" : "false";
}

const ASSIST_PAGE_SIZE = 20;

// 判定队列一页放 20 条，翻页复用价格表那套 paginateRows，不做第二份分页实现。
function paginateAssistant(rows) {
  const page = paginateRows(rows, state.assistantPage, Number(state.assistantPageSize) || ASSIST_PAGE_SIZE);
  state.assistantPage = page.page;
  return page;
}

function renderAssistantPagination(page, total) {
  const nav = $("#llm-pagination");
  if (!nav) return;
  nav.hidden = total === 0;
  $("#llm-page").textContent = page.pageCount ? `第 ${page.page + 1} / ${page.pageCount} 页 · 共 ${total} 条` : "";
  $("#llm-previous").disabled = page.page === 0;
  $("#llm-next").disabled = page.page + 1 >= page.pageCount;
}

function renderAssistantQueue(data) {
  const list = $("#llm-review-list");
  if (!list) return;
  state.assistantRows = data.rows || [];
  state.assistantState = data;
  // 失效条目是缓存里发不出去的旧账，有才显示清理按钮。
  const purge = $("#llm-purge-orphans");
  if (purge) {
    const orphanCount = Number(data.orphans?.length) || 0;
    purge.hidden = !orphanCount;
    purge.title = orphanCount ? `清掉 ${orphanCount} 条已不在报价里的旧结论` : "";
  }
  // 顶部统计读分区聚合：三个数就是筛选按钮上的三个数，不再和列表对不上。
  $("#llm-cache-summary").textContent = data.configured
    ? data.poolLabel || "队列是空的"
    : "先在模型服务里填好地址、密钥与模型，再打开启用开关。";
  const filter = state.assistantFilter || "all";
  const rows = state.assistantRows.filter(row => filter === "all" || row.pool === filter);
  const hint = $("#llm-filter-hint");
  if (hint) hint.textContent = ASSIST_POOL_HINTS[filter] || "";
  if (!rows.length) {
    const empty = filter === "all"
      ? "比价表里没有待处理的模型写法，采集之后再来看。"
      : filter === "matched"
        ? "还没有已匹配的写法，识别完一批或者人工指定一个就会出现在这里。"
        : filter === "unmatched"
          ? "没有还在等识别的写法。"
          : "没有待确认的写法。";
    list.innerHTML = `<p class="assistant-review-empty">${empty}</p>`;
    renderAssistantPagination({ page: 0, pageCount: 0 }, 0);
    return;
  }
  const page = paginateAssistant(rows);
  renderAssistantPagination(page, rows.length);
  list.innerHTML = page.rows.map(row => {
    const key = escapeHtml(row.key);
    const actions = [];
    // 每条都能人工指定：AI 判不动的、判错的、你不想等的，都从这里直接钉到基准模型。
    actions.push(`<button class="button button-quiet button-small" type="button" data-pick="${key}">${row.manual ? "改指定" : "指定"}</button>`);
    if (row.manual) {
      actions.push(`<button class="button button-quiet button-small" type="button" data-unmanual="${key}">撤销人工</button>`);
    } else if (row.pool === "matched") {
      actions.push(`<button class="button button-quiet button-small" type="button" data-forget="${key}">撤销</button>`);
    }
    // 待确认里再给识别这一侧留出口：冷却中、报错、判过「不是」的都能被重新问或被忽略。
    if (row.pool === "confirm") {
      if (row.candidates > 0) actions.push(`<button class="button button-quiet button-small" type="button" data-retry="${key}">${row.cooling ? "立即重试" : "重试"}</button>`);
      if (row.status === "none") actions.push(`<button class="button button-quiet button-small" type="button" data-ignore="${key}">忽略</button>`);
      if (row.status === "ignored") actions.push(`<button class="button button-quiet button-small" type="button" data-unignore="${key}">取消忽略</button>`);
    }
    const target = row.manual
      ? `人工 → ${escapeHtml(row.targetId)}`
      : row.targetId
        ? escapeHtml(row.targetId)
        : row.failure
          ? escapeHtml(row.failure)
          : row.reason
            ? escapeHtml(ASSIST_REASON_LABELS[row.reason] || row.reason)
            : "—";
    return `
    <div class="assistant-review-row" data-pool="${escapeHtml(row.pool)}" data-key="${key}">
      <span class="assistant-review-model">${escapeHtml(row.modelName)}${row.stale ? '<em class="assistant-review-stale">已失效</em>' : ""}</span>
      <span class="assistant-review-target">${target}</span>
      <span class="assistant-review-station">${escapeHtml(row.stationName || row.stationId)} · ${row.count ? `${row.count} 条报价` : "已不在当前报价里"}</span>
      <span class="assistant-review-badge" data-status="${row.cooling ? "pending" : escapeHtml(row.status)}">${escapeHtml(row.cooling ? "冷却中" : ASSIST_STATUS_LABELS[row.status] || row.status)}</span>
      <span class="assistant-review-action">${actions.join("")}</span>
    </div>`;
  }).join("");
  hydrateIcons(list);
}

// 人工指定：行内展开一个关键词搜索框，选中基准模型就立刻写成人工覆盖。
// 输入时只重画结果区，不整表重渲染，否则每敲一个字输入框都会失焦。
let assistantPickerTimer = 0;

function assistantPickerResultsMarkup({ models = [], total = 0, query = "" } = {}, current = "") {
  if (!models.length) {
    return `<p class="assistant-picker-empty">${query ? `没有匹配「${escapeHtml(query)}」的基准模型` : "基准清单里没有模型，先到基准参考价刷新一次"}</p>`;
  }
  const options = models.map(model => {
    const current_ = model.id === current ? '<em class="assistant-picker-current">当前</em>' : "";
    const label = model.provider ? `${model.provider} · ${model.id}` : model.id;
    return `<button class="assistant-picker-option" type="button" data-target="${escapeHtml(model.id)}" title="${escapeHtml(model.id)}"><span class="assistant-picker-name">${escapeHtml(model.displayName || model.id)}${current_}</span><span class="assistant-picker-id">${escapeHtml(label)}</span></button>`;
  }).join("");
  const more = total > models.length ? `<p class="assistant-picker-more">共 ${total} 个匹配，继续输入关键词缩小范围</p>` : "";
  return options + more;
}

async function applyAssistantOverride(key, targetId) {
  try {
    renderAssistantQueue(await callService("SET_MODEL_ASSIST_OVERRIDE", { key, targetId }));
    toast(targetId ? `已指定 ${targetId}` : "已撤销人工指定");
    return true;
  } catch (error) {
    toast(error.message);
    return false;
  }
}

async function openAssistantPicker(button, row) {
  const grid = button.closest(".assistant-review-row");
  if (!grid) return;
  if (grid.querySelector(".assistant-review-picker")) {
    grid.querySelector(".assistant-review-picker").remove();
    return;
  }
  for (const node of document.querySelectorAll(".assistant-review-picker")) node.remove();
  const picker = document.createElement("div");
  picker.className = "assistant-review-picker";
  picker.innerHTML = `<input class="assistant-picker-input" type="search" autocomplete="off" placeholder="输入模型关键词，比如 claude sonnet" aria-label="按关键词搜索基准模型">
    <p class="assistant-picker-status">读取基准模型清单…</p>
    <div class="assistant-picker-results"></div>`;
  grid.append(picker);
  const input = picker.querySelector(".assistant-picker-input");
  const status = picker.querySelector(".assistant-picker-status");
  const results = picker.querySelector(".assistant-picker-results");
  const run = async query => {
    status.textContent = query ? `搜索「${query}」…` : "读取基准模型清单…";
    try {
      const data = await callService("GET_MODEL_ASSIST_CATALOG", { query, limit: 30 });
      status.textContent = query
        ? `${data.models.length} / ${data.total} 个基准模型匹配「${query}」`
        : `共 ${data.total} 个基准模型，输入关键词缩小范围`;
      results.innerHTML = assistantPickerResultsMarkup(data, row.targetId);
    } catch (error) {
      status.textContent = error.message;
    }
  };
  picker.addEventListener("click", async event => {
    const option = event.target.closest("[data-target]");
    if (!option) return;
    option.disabled = true;
    if (!await applyAssistantOverride(row.key, option.dataset.target)) option.disabled = false;
  });
  input.addEventListener("input", () => {
    clearTimeout(assistantPickerTimer);
    assistantPickerTimer = setTimeout(() => void run(input.value.trim()), 200);
  });
  input.addEventListener("keydown", event => {
    if (event.key === "Escape") picker.remove();
  });
  input.focus();
  await run("");
}

async function refreshAssistantState() {
  try {
    // 队列内容变了，页码回到第一页，避免停在已经不存在的页上。
    state.assistantPage = 0;
    renderAssistantQueue(await callService("GET_MODEL_ASSIST_STATE"));
  } catch (error) {
    console.debug("[AI比价] 读取判定队列失败", error);
  }
}

let assistProgressTimer = 0;

// 识别是并行的分批请求，进度只能靠 service worker 回报；这里只负责把回报画成条。
function renderAssistProgress(progress) {
  const panel = $("#llm-progress");
  if (!panel) return;
  clearTimeout(assistProgressTimer);
  const total = Math.max(0, Number(progress.total) || 0);
  const completed = Math.min(Math.max(0, Number(progress.completed) || 0), total);
  const totalBatches = Math.max(0, Number(progress.totalBatches) || 0);
  const doneBatches = Math.min(Math.max(0, Number(progress.completedBatches) || 0), totalBatches);
  const counts = `接受 ${Number(progress.accepted) || 0} · 判为没有 ${Number(progress.none) || 0} · 无效 ${Number(progress.invalid) || 0} · 失败 ${Number(progress.errors) || 0}`;
  const bar = $("#llm-progress-bar");
  const counter = $("#llm-progress-count");
  const message = $("#llm-progress-message");
  panel.hidden = false;
  bar.max = Math.max(total, 1);
  bar.value = progress.phase === "complete" ? bar.max : Math.min(completed, bar.max);
  counter.textContent = `${completed} / ${total} 个写法 · ${doneBatches} / ${totalBatches} 批`;
  message.dataset.error = progress.phase === "error" ? "true" : "false";
  if (progress.phase === "start") {
    message.textContent = `正在把 ${total} 个未匹配写法分 ${totalBatches} 批并行发给模型`;
  } else if (progress.phase === "request") {
    message.textContent = `正在并行问 ${Math.max(1, Number(progress.concurrency) || 1)} 批（共 ${totalBatches} 批），已完成 ${completed} / ${total} 个写法`;
  } else if (progress.phase === "batch") {
    message.textContent = `已问完 ${doneBatches} / ${totalBatches} 批 · ${counts}`;
  } else if (progress.phase === "complete") {
    message.textContent = `识别完成：${total} 个写法、${totalBatches} 批 · ${counts}`;
    assistProgressTimer = setTimeout(() => { panel.hidden = true; }, 6000);
  } else if (progress.phase === "error") {
    counter.textContent = "";
    bar.max = 1;
    bar.value = 0;
    message.textContent = progress.message || "模型识别失败";
    assistProgressTimer = setTimeout(() => { panel.hidden = true; }, 8000);
  }
}

function assistantConfigFromForm() {
  const config = readAssistantSettings();
  const apiKey = $("#llm-api-key").value.trim();
  return apiKey ? { ...config, apiKey } : config;
}

$("#llm-key-toggle").addEventListener("click", event => {
  const input = $("#llm-api-key");
  const show = input.type === "password";
  input.type = show ? "text" : "password";
  event.currentTarget.textContent = show ? "隐藏" : "显示";
});

$("#llm-test").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  setAssistantStatus("连接中…");
  try {
    const result = await callService("TEST_MODEL_CONNECTION", { config: assistantConfigFromForm() });
    setAssistantStatus(`连上了：${result.model || "模型可用"}`);
  } catch (error) {
    setAssistantStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});

$("#llm-models-refresh").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  setAssistantStatus("拉取模型列表中…");
  try {
    const data = await callService("FETCH_MODEL_CATALOG", { config: assistantConfigFromForm() });
    const ids = (data.models || []).map(model => model.id).filter(Boolean);
    $("#llm-model-options").innerHTML = ids.map(id => `<option value="${escapeHtml(id)}"></option>`).join("");
    setAssistantStatus(ids.length ? `拿到 ${ids.length} 个模型，点模型输入框挑选` : "接口没返回模型列表");
  } catch (error) {
    setAssistantStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});

async function runAssistant(button, { force = false, keys = [] } = {}) {
  button.disabled = true;
  const label = button.innerHTML;
  button.innerHTML = `${icon("loader-circle", { className: "icon spin" })}<span>识别中</span>`;
  try {
    const result = await callService("RUN_MODEL_ASSIST", { force, keys });
    if (!result.pending) {
      // 一句话说清为什么没问：没东西可问，还是都问过了。
      if (!result.unmatched) toast("比价表里没有未匹配的写法，没有要问的");
      else if (result.reused) toast(`待识别 0 条：${result.unmatched} 条写法都有结论了，想按新规则重问就点「全部重算」`);
      else toast("待识别 0 条，没有要问的");
    } else {
      const parts = [`问了 ${result.ranBatches} 批`, `接受 ${result.accepted}`, `判为没有 ${result.none}`];
      if (result.errors) parts.push(`失败 ${result.errors}${result.timeouts ? `（超时 ${result.timeouts}）` : ""}`);
      if (result.merged) parts.push(`合并 ${result.merged} 条同写法`);
      toast(parts.join("，"));
    }
    await refreshAssistantState();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = label;
    hydrateIcons(button);
  }
}

$("#llm-run").addEventListener("click", event => runAssistant(event.currentTarget, { force: false }));
$("#llm-run-force").addEventListener("click", event => runAssistant(event.currentTarget, { force: true }));

$("#llm-clear").addEventListener("click", async event => {
  if (!confirm("清空全部 AI 判定缓存？下次识别会把所有模型重新问一遍。")) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    await callService("CLEAR_MODEL_ASSIST_CACHE");
    toast("缓存已清空");
    await refreshAssistantState();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

// 清掉缓存里已经发不出去的旧结论：报价里已经没有，模型那边也没判成。
$("#llm-purge-orphans").addEventListener("click", async event => {
  const button = event.currentTarget;
  const count = Number(state.assistantState?.orphans?.length) || 0;
  if (!confirm(`清掉 ${count} 条已不在报价里的旧结论？已生效的判定不会动。`)) return;
  button.disabled = true;
  try {
    const result = await callService("PURGE_MODEL_ASSIST_ORPHANS");
    toast(`清掉 ${result.removed || 0} 条`);
    renderAssistantQueue(result);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

// 行尾动作统一分发：人工指定/撤销人工、撤销 AI 判定、单条重试、忽略、取消忽略。
$("#llm-review-list").addEventListener("click", async event => {
  const button = event.target.closest("[data-pick], [data-unmanual], [data-forget], [data-retry], [data-ignore], [data-unignore]");
  if (!button) return;
  const kind = button.dataset.pick ? "pick"
    : button.dataset.unmanual ? "unmanual"
      : button.dataset.forget ? "forget"
        : button.dataset.retry ? "retry"
          : button.dataset.ignore ? "ignore" : "unignore";
  const key = button.dataset[kind];
  const row = (state.assistantRows || []).find(item => item.key === key);
  const modelName = row?.modelName || "这条";
  if (kind === "pick") {
    await openAssistantPicker(button, row || { key, targetId: "" });
    return;
  }
  if (kind === "unmanual" && !confirm(`撤销「${modelName}」的人工指定？它会回到 AI 判定或未匹配池。`)) return;
  if (kind === "forget" && !confirm(`撤销「${modelName}」的 AI 判定？它会回到未匹配池。`)) return;
  if (kind === "ignore" && !confirm(`忽略「${modelName}」？它不会再进识别队列，会留在待确认里显示已忽略。`)) return;
  button.disabled = true;
  try {
    if (kind === "unmanual") {
      await applyAssistantOverride(key, "");
      return;
    }
    if (kind === "retry") {
      // 只重问这一条：force 会跳过缓存，冷却期也不拦。
      await runAssistant(button, { force: true, keys: [key] });
      return;
    }
    const result = kind === "forget"
      ? await callService("FORGET_MODEL_ASSIST_ENTRIES", { keys: [key] })
      : await callService("SET_MODEL_ASSIST_IGNORED", { keys: [key], ignored: kind === "ignore" });
    toast(kind === "forget" ? `已撤销 ${result.removed || 0} 条` : kind === "ignore" ? "已忽略这个写法" : "已取消忽略");
    renderAssistantQueue(result);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

$("#llm-apply").addEventListener("click", async event => {
  const accepted = (state.assistantRows || []).filter(row => row.status === "accepted" && !row.manual);
  if (!accepted.length) {
    toast("没有 AI 判定可以转成人工确认");
    return;
  }
  if (!confirm(`把 ${accepted.length} 条 AI 判定写成人工确认？写完之后优先级最高，模型再判也不会改它。`)) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const result = await callService("APPLY_MODEL_ASSIST_OVERRIDES", { keys: accepted.map(row => row.key) });
    toast(`写入 ${result.added || 0} 条，更新 ${result.updated || 0} 条`);
    state.settings = await callService("GET_SETTINGS");
    await refreshAssistantState();
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});

void refreshAssistantState();
onAssistProgress(renderAssistProgress);

for (const button of document.querySelectorAll(".assistant-filter")) {
  button.addEventListener("click", () => {
    state.assistantFilter = button.dataset.filter;
    state.assistantPage = 0;
    for (const item of document.querySelectorAll(".assistant-filter")) item.setAttribute("aria-pressed", String(item === button));
    if (state.assistantState) renderAssistantQueue(state.assistantState);
  });
}

$("#llm-previous").addEventListener("click", () => flipAssistantPage(-1));
$("#llm-next").addEventListener("click", () => flipAssistantPage(1));
$("#llm-page-size").addEventListener("change", event => {
  state.assistantPageSize = Number(event.target.value) || ASSIST_PAGE_SIZE;
  state.assistantPage = 0;
  if (state.assistantState) renderAssistantQueue(state.assistantState);
});

function flipAssistantPage(delta) {
  if (!state.assistantState) return;
  state.assistantPage = Math.max(0, (state.assistantPage || 0) + delta);
  renderAssistantQueue(state.assistantState);
  $("#assistant-review").scrollIntoView({ behavior: "smooth", block: "start" });
}
