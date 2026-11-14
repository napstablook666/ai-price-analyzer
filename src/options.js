import { cloneDefaultStation, convertRechargeAmount, currentSiteOrigin, DEFAULT_EXCHANGE_RATE, normalizeSettings, normalizeUrl, STATION_CATEGORY_LABELS, TOKENS_PER_MILLION, USAGE_PRESETS, usagePresetId } from "./shared/schema.js";
import { callService, downloadJson, readJsonFile, escapeHtml, hydrateIcons, icon, onRefreshProgress, toast } from "./shared/ui.js";
import { initCollapsibleCards } from "./shared/collapse.js";
import { enqueueWorkspaceOperation, getStoredWorkspace, isWorkspaceSupported, pickWorkspace, readWorkspace, writeWorkspace } from "./shared/workspace.js";
import { RESPONSE_FORMAT_DEFINITIONS, isSupportedResponseFormat } from "./core/response-formats.js";
import { getPartialDiagnostics } from "./core/partial-diagnostics.js";

const state = { stations: [], sitePlugins: [], settings: null, selectedPluginIds: new Set(), selectedStationIds: new Set(), stationSourceTabIds: new Map(), configStationId: null, pluginCategory: "all", pendingStation: null, previewRequestId: 0 };
const workspace = { handle: null };
const $ = selector => document.querySelector(selector);


function setWorkspaceStatus(message, error = false) {
  const node = $("#workspace-status");
  if (!node) return;
  node.textContent = message;
  node.dataset.error = error ? "true" : "false";
}

function updateWorkspaceControls(busy = false) {
  const supported = isWorkspaceSupported();
  const connected = Boolean(workspace.handle);
  $("#workspace-connect").disabled = busy || !supported;
  $("#workspace-load").disabled = busy || !connected;
  $("#workspace-save").disabled = busy || !connected;
  if (!supported) setWorkspaceStatus("当前浏览器不支持文件夹工作区，可使用 JSON 备份");
}

async function refreshWorkspaceStatus() {
  if (!isWorkspaceSupported()) {
    updateWorkspaceControls();
    return;
  }
  try {
    workspace.handle = await getStoredWorkspace();
    if (!workspace.handle) {
      setWorkspaceStatus("尚未选择工作区");
      updateWorkspaceControls();
      return;
    }
    const data = await readWorkspace(workspace.handle);
    setWorkspaceStatus(data ? `已连接：${workspace.handle.name}` : `已连接：${workspace.handle.name}，尚无工作区文件`);
  } catch (error) {
    setWorkspaceStatus(`工作区不可用：${error.message || String(error)}`, true);
  }
  updateWorkspaceControls();
}

async function connectWorkspace() {
  const previous = workspace.handle;
  let picked = false;
  updateWorkspaceControls(true);
  try {
    workspace.handle = await pickWorkspace();
    picked = true;
    const data = await readWorkspace(workspace.handle);
    setWorkspaceStatus(data ? `已连接：${workspace.handle.name}，可从工作区加载` : `已连接：${workspace.handle.name}，请保存当前数据`);
  } catch (error) {
    if (!picked) workspace.handle = previous;
    if (error.name !== "AbortError") {
      setWorkspaceStatus(error.message || String(error), true);
      toast(error.message || String(error));
    }
  } finally {
    updateWorkspaceControls();
  }
}

async function loadWorkspaceState() {
  const handle = workspace.handle;
  if (!handle) return;
  updateWorkspaceControls(true);
  await enqueueWorkspaceOperation(async () => {
    try {
      const imported = await readWorkspace(handle);
      if (!imported) throw new Error("工作区还没有数据文件，请先保存当前数据");
      if (!window.confirm("将用工作区数据替换当前扩展数据，继续吗？")) return;
      await callService("IMPORT_STATE", { state: imported });
      await load();
      setWorkspaceStatus(`已从工作区加载：${handle.name}`);
      toast("工作区数据已加载；密钥需要重新填写");
    } catch (error) {
      setWorkspaceStatus(error.message || String(error), true);
      toast(error.message || String(error));
    } finally {
      updateWorkspaceControls();
    }
  });
}

async function saveWorkspace({ notify = true } = {}) {
  const handle = workspace.handle;
  if (!handle) return;
  await enqueueWorkspaceOperation(async () => {
    try {
      await writeWorkspace(handle, await callService("EXPORT_STATE"));
      setWorkspaceStatus(`已保存到工作区：${handle.name}`);
      if (notify) toast("数据已保存到本地工作区");
    } catch (error) {
      const message = error.message || String(error);
      setWorkspaceStatus(message, true);
      toast(message);
    }
  });
}
function selected(value, expected) { return value === expected ? " selected" : ""; }
function checked(value) { return value ? " checked" : ""; }


const SETTINGS_VIEWS = ["stations", "costs", "workspace"];
const PLUGIN_CATEGORY_LABELS = { paid: "付费", public: "公益" };

function activateSettingsView(requested, { focus = false, updateHash = true } = {}) {
  const view = SETTINGS_VIEWS.includes(requested) ? requested : "stations";
  for (const name of SETTINGS_VIEWS) {
    const active = name === view;
    const tab = $(`[data-settings-target="${name}"]`);
    const panel = $(`#settings-view-${name}`);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    panel.hidden = !active;
    if (active && focus) tab.focus();
  }
  if (updateHash && location.hash !== `#${view}`) history.replaceState(null, "", `${location.pathname}${location.search}#${view}`);
}

function filteredSitePlugins() {
  const query = $("#plugin-search").value.trim().toLowerCase();
  return state.sitePlugins.filter(plugin => {
    if (state.pluginCategory !== "all" && plugin.category !== state.pluginCategory) return false;
    return !query || [plugin.name, plugin.host, plugin.description].some(value => String(value || "").toLowerCase().includes(query));
  });
}

function updatePluginSelection() {
  const count = state.selectedPluginIds.size;
  $("#plugin-selected-count").textContent = `已选 ${count} 项`;
  const button = $("#add-selected-plugins");
  button.disabled = count === 0;
  button.querySelector("span:last-child").textContent = count ? `一键添加 ${count} 个站点` : "添加所选站点";
}

function renderSitePlugins() {
  const list = $("#site-plugin-list");
  const byId = new Map(state.sitePlugins.map(plugin => [plugin.id, plugin]));
  for (const id of state.selectedPluginIds) {
    const plugin = byId.get(id);
    if (!plugin?.addable || plugin.added) state.selectedPluginIds.delete(id);
  }
  const plugins = filteredSitePlugins();
  list.innerHTML = plugins.length ? plugins.map(plugin => {
    const added = Boolean(plugin.added);
    const selectable = plugin.addable && !added;
    const badges = [
      `<span class="site-plugin-badge">${escapeHtml(PLUGIN_CATEGORY_LABELS[plugin.category] || plugin.category)}</span>`,
      `<span class="site-plugin-badge">${plugin.mode === "page" ? "页面模式" : "直接接口"}</span>`,
      `<span class="site-plugin-badge">${escapeHtml(plugin.authLabel || "无需登录")}</span>`,
      added ? `<span class="site-plugin-badge is-added">已添加 ${plugin.stationCount || 1} 个</span>` : "",
      !plugin.addable ? `<span class="site-plugin-badge">需按地址添加</span>` : ""
    ].join("");
    return `<label class="site-plugin-card${added ? " is-added" : ""}${!plugin.addable ? " is-address-only" : ""}">
      <input type="checkbox" data-plugin-id="${escapeHtml(plugin.id)}" aria-label="选择 ${escapeHtml(plugin.name)}"${state.selectedPluginIds.has(plugin.id) ? " checked" : ""}${selectable ? "" : " disabled"}>
      <span class="site-plugin-content">
        <span class="site-plugin-title"><strong>${escapeHtml(plugin.name)}</strong></span>
        <span class="site-plugin-host">${escapeHtml(plugin.host)}</span>
        <span class="site-plugin-description">${escapeHtml(plugin.description || "本地站点采集插件")}</span>
        <span class="site-plugin-badges">${badges}</span>
      </span>
    </label>`;
  }).join("") : `<p class="site-plugin-empty">没有匹配的站点插件。</p>`;
  updatePluginSelection();
}

async function addSelectedPlugins() {
  const ids = [...state.selectedPluginIds];
  if (!ids.length) return;
  const button = $("#add-selected-plugins");
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `${icon("loader-circle", { className: "icon spin" })}<span>正在添加</span>`;
  try {
    const result = await callService("ADD_SITE_PLUGINS", { ids });
    const existingIds = new Set(state.stations.map(station => station.id));
    for (const station of result.stations || []) if (!existingIds.has(station.id)) state.stations.push(station);
    state.sitePlugins = result.sitePlugins || state.sitePlugins;
    state.selectedPluginIds.clear();
    renderSitePlugins();
    renderStations();
    await saveWorkspace({ notify: false });
    const skipped = result.alreadyAdded?.length || 0;
    toast(`已添加 ${result.added?.length || 0} 个站点${skipped ? `，${skipped} 个已在列表中` : ""}`);
  } catch (error) {
    toast(error.message || String(error));
  } finally {
    button.innerHTML = original;
    hydrateIcons(button);
    updatePluginSelection();
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
  const badges = [
    `<span class="station-badge">${escapeHtml(STATION_CATEGORY_LABELS[category])}</span>`,
    `<span class="station-badge">${station.mode === "page" ? "页面模式" : "直接接口"}</span>`,
    verified ? "" : `<span class="station-badge is-warning">币种未核实</span>`
  ].join("");
  return `<article class="station-card${station.enabled ? "" : " is-disabled"}" id="station-card-${escapeHtml(station.id)}" data-station-id="${escapeHtml(station.id)}">
    <input type="checkbox" class="station-select" data-select-station aria-label="选择站点"${state.selectedStationIds.has(station.id) ? " checked" : ""}>
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

function updateStationBatchBar() {
  const total = state.stations.length;
  const selected = state.selectedStationIds.size;
  $("#station-selected-count").textContent = `已选 ${selected} / ${total}`;
  const selectAll = $("#station-select-all");
  selectAll.checked = total > 0 && selected === total;
  selectAll.indeterminate = selected > 0 && selected < total;
  for (const button of document.querySelectorAll("[data-station-batch]")) button.disabled = selected === 0;
}

function renderStations() {
  const activeIds = new Set(state.stations.map(station => station.id));
  for (const id of state.selectedStationIds) if (!activeIds.has(id)) state.selectedStationIds.delete(id);
  const list = $("#stations-list");
  list.innerHTML = state.stations.length
    ? state.stations.map(stationCard).join("")
    : `<div class="station-empty"><span data-icon="database" class="icon empty-icon"></span><strong>还没有站点</strong><span>添加后开始跨站点比较。</span></div>`;
  $("#station-count").textContent = String(state.stations.length);
  updateStationBatchBar();
  hydrateIcons(list);
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

function writeUsageInputs(usage) {
  for (const { field, id, million, percent } of USAGE_INPUTS) {
    if (!Object.prototype.hasOwnProperty.call(usage, field)) continue;
    $(`#${id}`).value = Number(usage[field] || 0) / (percent ? 0.01 : million ? TOKENS_PER_MILLION : 1);
  }
}

function syncUsagePreset() {
  $("#usage-preset").value = usagePresetId(readUsageInputs());
}

function applyUsagePreset(id) {
  if (id === "custom") return;
  const preset = USAGE_PRESETS.find(item => item.id === id);
  if (preset) writeUsageInputs(preset.usage);
  syncUsagePreset();
}

function renderSettings() {
  const settings = state.settings;
  $("#currency").value = settings.defaultCurrency;
  $("#exchange-rate").value = Number(settings.exchangeRate || DEFAULT_EXCHANGE_RATE).toFixed(4);
  $("#recommendation-profile").value = settings.recommendationProfile || "price";
  writeUsageInputs(settings.usage);
  syncUsagePreset();
  $("#show-unmatched").checked = settings.showUnmatched;

  for (const rule of settings.matchingRules || []) {
    const input = document.querySelector(`[data-matching-rule="${rule.id}"]`);
    if (input) input.checked = Boolean(rule.enabled);
  }
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
function readSettings() {
  return normalizeSettings({
    ...state.settings,
    defaultCurrency: $("#currency").value,
    recommendationProfile: $("#recommendation-profile").value,
    exchangeRate: Math.max(0.0001, Number($("#exchange-rate").value) || DEFAULT_EXCHANGE_RATE),
    matchingRules: [...document.querySelectorAll("[data-matching-rule]")].map(input => ({ id: input.dataset.matchingRule, name: input.parentElement.textContent.trim(), enabled: input.checked })),
    usage: readUsageInputs(),
    showUnmatched: $("#show-unmatched").checked,
  });
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
    basePricePerMillion: nonNegativeNumber($("#config-base-price").value, 2)
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
  configRechargeRate();
  const origin = currentSiteOrigin(station.baseUrl);
  const isFastAiToken = ["https://fastaitoken.com", "https://www.fastaitoken.com"].includes(origin);
  const isLinuxDoMarketplace = station.adapter?.kind === "linux-do-marketplace";
  $("#config-station-hint").textContent = isLinuxDoMarketplace
    ? "页面模式：请先在当前 Chrome 配置文件登录 Linux.do，扩展只通过页面会话读取价格。"
    : station.mode === "page"
      ? isFastAiToken ? "复用本 Chrome 登录态，采集令牌不会保存到扩展。" : "页面模式：请先在当前标签页登录。"
      : "直接模式：读取模型列表地址，通常无需登录；需要登录时切换页面模式。";
  const warning = isLinuxDoMarketplace
    ? "仅使用当前页面登录会话读取 Linux.do Marketplace；令牌不会写入站点配置或扩展存储。站点积分仅按 1:1 作为展示基准，不代表人民币成本。"
    : station.priceCurrencyVerified !== false ? "" : `模型价格映射未核实：${station.priceCurrencyNote || "请确认该站点模型列表报价可按 CREDITS 比较后勾选核实，否则该站点报价不会参与比价。"}`;
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
      basePricePerMillion: collected.basePricePerMillion
    });
    await persistStations();
    await saveWorkspace({ notify: false });
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
    await saveWorkspace({ notify: false });
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


async function load() {
  try {
    const data = await callService("GET_DASHBOARD");
    state.stations = data.stations || [];
    state.sitePlugins = data.sitePlugins || [];
    state.selectedPluginIds.clear();
    state.settings = data.settings;
    renderSettings();
    renderSitePlugins();
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
    const card = [...$("#stations-list").querySelectorAll(".station-card")].find(item => item.dataset.stationId === existing.id);
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

function openStationDialog(siteUrl = "", sourceTabId) {
  activateSettingsView("stations");
  resetStationDialog();
  $("#new-station-url").value = siteUrl;
  $("#add-station-dialog").showModal();
  if (siteUrl) void analyzeStation(siteUrl, sourceTabId);
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
  toast("站点已添加，请点击“保存站点”使配置生效");
}

function closeStationDialog() {
  $("#add-station-dialog").close();
}

for (const view of SETTINGS_VIEWS) {
  $(`[data-settings-target="${view}"]`).addEventListener("click", () => activateSettingsView(view));
}
$(".settings-nav").addEventListener("keydown", event => {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const current = SETTINGS_VIEWS.findIndex(view => $(`[data-settings-target="${view}"]`).getAttribute("aria-selected") === "true");
  const offset = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
  const next = event.key === "Home" ? 0 : event.key === "End" ? SETTINGS_VIEWS.length - 1 : (current + offset + SETTINGS_VIEWS.length) % SETTINGS_VIEWS.length;
  activateSettingsView(SETTINGS_VIEWS[next], { focus: true });
});
window.addEventListener("hashchange", () => activateSettingsView(location.hash.slice(1), { updateHash: false }));
$("#plugin-search").addEventListener("input", renderSitePlugins);
for (const button of document.querySelectorAll("[data-plugin-category]")) {
  button.addEventListener("click", () => {
    state.pluginCategory = button.dataset.pluginCategory;
    for (const item of document.querySelectorAll("[data-plugin-category]")) item.setAttribute("aria-pressed", String(item === button));
    renderSitePlugins();
  });
}
$("#site-plugin-list").addEventListener("change", event => {
  const id = event.target.dataset.pluginId;
  if (!id) return;
  event.target.checked ? state.selectedPluginIds.add(id) : state.selectedPluginIds.delete(id);
  updatePluginSelection();
});
$("#select-visible-plugins").addEventListener("click", () => {
  for (const plugin of filteredSitePlugins()) if (plugin.addable && !plugin.added) state.selectedPluginIds.add(plugin.id);
  renderSitePlugins();
});
$("#add-selected-plugins").addEventListener("click", addSelectedPlugins);

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

$("#stations-list").addEventListener("click", async event => {
  const card = event.target.closest(".station-card");
  if (!card) return;
  const stationId = card.dataset.stationId;
  if (event.target.closest("[data-remove-station]")) {
    state.selectedStationIds.delete(stationId);
    state.stationSourceTabIds.delete(stationId);
    state.stations = state.stations.filter(station => station.id !== stationId);
    renderStations();
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
    return;
  }
});
$("#stations-list").addEventListener("change", event => {
  const card = event.target.closest(".station-card");
  if (event.target.matches("[data-select-station]")) {
    const stationId = card?.dataset.stationId;
    if (!stationId) return;
    event.target.checked ? state.selectedStationIds.add(stationId) : state.selectedStationIds.delete(stationId);
    updateStationBatchBar();
    return;
  }
  if (!event.target.matches('[data-field="enabled"]') || !card) return;
  const station = state.stations.find(item => item.id === card.dataset.stationId);
  if (!station) return;
  station.enabled = event.target.checked;
  card.classList.toggle("is-disabled", !station.enabled);
});
$("#station-select-all").addEventListener("click", event => {
  state.selectedStationIds = event.target.checked ? new Set(state.stations.map(station => station.id)) : new Set();
  renderStations();
});
for (const button of document.querySelectorAll("[data-station-batch]")) {
  button.addEventListener("click", () => {
    const selected = new Set(state.selectedStationIds);
    if (button.dataset.stationBatch === "remove") {
      if (!selected.size || !window.confirm(`确定删除选中的 ${selected.size} 个站点？`)) return;
      state.stations = state.stations.filter(station => !selected.has(station.id));
      for (const id of selected) state.stationSourceTabIds.delete(id);
      state.selectedStationIds.clear();
      renderStations();
      toast(`已移除 ${selected.size} 个站点，点击“保存全部”生效`);
      return;
    }
    const enabled = button.dataset.stationBatch === "enable";
    for (const station of state.stations) if (selected.has(station.id)) station.enabled = enabled;
    renderStations();
    toast(`已${enabled ? "启用" : "停用"} ${selected.size} 个站点，点击“保存全部”生效`);
  });
}
$("#station-config-form").addEventListener("submit", event => {
  event.preventDefault();
  void saveStationConfig();
});
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
    refreshRechargeDisplays();
    toast(`官方汇率已更新：${rate.toFixed(4)}`);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}
$("#save-all").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  button.dataset.label = button.innerHTML;
  button.innerHTML = `${icon("loader-circle", { className: "icon spin" })}<span>保存中</span>`;
  try {
    await persistStations();
    renderStations();
    state.settings = await callService("SAVE_SETTINGS", {
      settings: readSettings(),
    });
    renderSettings();
    await saveWorkspace({ notify: false });
    toast("站点与设置已保存");
  } catch (error) { toast(error.message); }
  finally {
    button.disabled = false;
    button.innerHTML = button.dataset.label;
    hydrateIcons(button);
  }
});

$("#workspace-connect").addEventListener("click", connectWorkspace);
$("#workspace-load").addEventListener("click", loadWorkspaceState);
$("#workspace-save").addEventListener("click", () => saveWorkspace());
$("#export-state").addEventListener("click", async () => {
  try { await downloadJson(`ai-relay-price-${new Date().toISOString().slice(0, 10)}.json`, await callService("EXPORT_STATE")); }
  catch (error) { toast(error.message); }
});

$("#import-file").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await callService("IMPORT_STATE", { state: await readJsonFile(file) });
    await load();
    toast("数据已导入；密钥需要重新填写");
  } catch (error) { toast(error.message); }
  finally { event.target.value = ""; }
});

activateSettingsView(location.hash.slice(1));
hydrateIcons();
const cards = initCollapsibleCards("options");
const setAllSections = collapsed => cards.setAll(collapsed);
$("#expand-all").addEventListener("click", () => setAllSections(false));
$("#collapse-all").addEventListener("click", () => setAllSections(true));
onRefreshProgress(progress => {
  if (progress.phase === "station") updateStationQueryStatus(progress);
});
void load().then(refreshWorkspaceStatus);
