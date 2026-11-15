import { buildStationIndexes, flattenComparisonRows, mixLabel } from "./core/pricing.js";
import { dashboardPriceLines, formatSourcePrice } from "./dashboard-pricing.js";
import { callService, escapeHtml, formatMoney, formatRefreshSummary, hydrateIcons, icon, onRefreshProgress, toast } from "./shared/ui.js";
import { buildMonthlyCostRankings, createDashboardIndex, deltaTone, matchesModelQueries, monthlyCostBarWidth, monthlyCostRankingFor, paginateRows, rowBandClasses } from "./dashboard-index.js";
import { initCardCollapse } from "./shared/collapse.js";
import { initTopMenu } from "./shared/menu.js";
import { DEFAULT_EXCHANGE_RATE, STATION_CATEGORY_LABELS } from "./shared/schema.js";
import { providerIconMarkup, providerLogoFor } from "./shared/provider-icons.js";
import { siteIconMarkup } from "./shared/site-icon.js";

const DEFAULT_PROVIDER_FILTER = ["anthropic", "deepseek", "openai", "z-ai"];
const PAGE_SIZE = 20;
const state = { data: null, comparisonMode: "paid", rows: [], page: 0, searchTextByRow: new WeakMap(), modelTextByRow: new WeakMap(), stationById: new Map(), reference: null, refreshInProgress: false, refreshPreflight: null, preflightLoading: false, filters: { search: "", stationId: "", provider: DEFAULT_PROVIDER_FILTER, group: null, models: [], showUnmatched: true, sortBy: "blendedUnitPrice", sortSecondary: "diffPercent", sortDirection: "asc" },
  stationIndexes: new Map(), refreshStationIds: new Set(), refreshStationQuery: "", refreshStationOptionsKey: ""
};
const $ = selector => document.querySelector(selector);
let lastRefreshSummary = null;
let pageFilterKey = null;
const refreshRows = new Map();
const PRICING_REASON_LABELS = { currency_unverified: "币种待核验", cache_write_1h_missing: "缺少 1 小时缓存价", price_missing: "中转价格未收录" };



function formatPrice(value, currency = "CNY", precision = 4) {
  const number = Number(value);
  if (value === null || value === undefined || !Number.isFinite(number)) return "—";
  const rate = Number(state.data?.references?.exchangeRate) || DEFAULT_EXCHANGE_RATE;
  const displayValue = currency === "USD" ? number / rate : number;
  const symbol = currency === "USD" ? "$" : currency === "CREDITS" ? "CR" : "¥";
  return precision === 4 ? formatMoney(displayValue, symbol) : `${symbol}${displayValue.toFixed(precision)}`;
}

function rowMatches(row, query) {
  if (query && !state.searchTextByRow.get(row).includes(query)) return false;
  if (!matchesModelQueries(state.modelTextByRow.get(row), state.filters.models)) return false;
  if (state.filters.stationId && row.stationId !== state.filters.stationId) return false;
  if (state.comparisonMode !== "public" && Array.isArray(state.filters.provider) && !state.filters.provider.includes(row.provider)) return false;
  if (Array.isArray(state.filters.group) && !state.filters.group.includes(row.groupName)) return false;
  if (state.comparisonMode !== "public" && !state.filters.showUnmatched && !row.officialName) return false;
  return true;
}

function pricingUnavailableLabel(row) {
  const reasons = Array.isArray(row.pricingUnavailableReasons) ? row.pricingUnavailableReasons : [];
  return reasons.length ? reasons.map(reason => PRICING_REASON_LABELS[reason] || "价格待核验").join("、") : "价格待核验";
}

function partialStatusLabel(row) {
  const modes = [...new Set(row.unsupportedBillingModes || [])].filter(Boolean);
  const invalid = [...new Set(row.invalidPricingValues || [])].filter(Boolean);
  const unpriced = [...new Set(row.unpricedModels || [])].filter(Boolean);
  const details = [
    modes.length ? `未解析 ${modes.map(mode => escapeHtml(mode)).join("、")}` : "",
    invalid.length ? `价格字段异常 ${invalid.map(value => escapeHtml(value)).join("、")}` : "",
    unpriced.length ? `未定价模型 ${unpriced.map(value => escapeHtml(value)).join("、")}` : ""
  ].filter(Boolean);
  return details.length ? `部分解析：${details.join("；")}` : "部分解析";
}

function statusMarkup(row, includeOfficial = true) {
  const tags = [];
  if (row.incomplete) tags.push(`<span class="status-tag warning">${icon("triangle-alert", { className: "icon" })}${partialStatusLabel(row)}</span>`);
  if (includeOfficial && !row.officialName) tags.push(`<span class="status-tag muted">${icon("circle-help", { className: "icon" })}未匹配</span>`);
  if (row.evidence === "estimated") tags.push(`<span class="status-tag warning">${icon("calculator", { className: "icon" })}价格推导</span>`);
  if (row.pricingUnavailable) tags.push(`<span class="status-tag warning">${icon("circle-alert", { className: "icon" })}${pricingUnavailableLabel(row)}</span>`);
  if (!tags.length) return "";
  return `<div class="status-cluster">${tags.join("")}</div>`;
}

function stationFor(row) {
  return state.stationById.get(row.stationId) || {};
}

function renderSummary(rows) {
  const isPublic = state.comparisonMode === "public";
  const matched = rows.filter(row => row.officialName);
  const recommended = rows.filter(row => row.recommended).length;
  const needsReview = rows.filter(row => (state.comparisonMode !== "public" && !row.officialName) || row.evidence === "estimated" || row.incomplete || row.pricingUnavailable).length;
  const reviewReasons = rows.flatMap(row => row.pricingUnavailableReasons || []).reduce((counts, reason) => ({ ...counts, [reason]: (counts[reason] || 0) + 1 }), {});
  const reviewNote = [
    rows.filter(row => row.incomplete).length ? `${rows.filter(row => row.incomplete).length} 条部分解析` : "",
    ...Object.entries(reviewReasons).map(([reason, count]) => `${count} 条${PRICING_REASON_LABELS[reason] || "价格待核验"}`)
  ].filter(Boolean).join("、") || (isPublic ? "部分解析数据" : "未匹配或推导数据");
  const modelCount = new Set(rows.map(row => row.canonicalModel)).size;
  const stationCount = new Set(rows.map(row => row.stationId)).size;
  const matchRate = rows.length ? Math.round(matched.length / rows.length * 100) : 0;
  const cards = isPublic ? [
    ["公益模型", String(modelCount), `${rows.length} 条报价 · ${stationCount} 个公益站`],
    ["公益站点", String(stationCount), "仅公益站"],
    ["价格单位", "站点积分/额度", "比例 1:1"],
    ["数据状态", String(needsReview), reviewNote]
  ] : [
    ["覆盖模型", String(modelCount), `${rows.length} 条报价 · ${stationCount} 个启用站点`],
    ["官方匹配", String(matched.length), `${matchRate}% 有官方参考价`],
    ["首选方案", String(recommended), "同模型推荐"],
    ["需核验", String(needsReview), reviewNote]
  ];
  $("#summary").innerHTML = cards.map(([label, value, note], index) => `<span class="summary-item${index === 0 ? " is-primary" : ""}" title="${escapeHtml(note)}"><span class="summary-label">${escapeHtml(label)}</span><strong class="summary-value">${escapeHtml(value)}</strong></span>`).join("");
}
function renderStationFilter(rows) {
  const current = state.filters.stationId;
  const stationsById = new Map();
  for (const row of rows) if (!stationsById.has(row.stationId)) stationsById.set(row.stationId, row.stationName);
  const stations = [...stationsById.entries()];
  const selectedName = stations.find(([id]) => id === current)?.[1];
  $("#station-filter-label").textContent = selectedName || "全部中转站";
  $("#station-filters").innerHTML = `<label class="facet-option"><input type="radio" name="station-filter" data-station-filter value=""${current ? "" : " checked"}><span>全部中转站</span></label>${stations.map(([id, name]) => `<label class="facet-option"><input type="radio" name="station-filter" data-station-filter value="${escapeHtml(id)}"${id === current ? " checked" : ""}>${siteIconMarkup(state.stationById.get(id)?.pluginId, name, { size: 15 })}<span>${escapeHtml(name)}</span>${state.stationIndexes.get(id) ? `<span class="facet-metric" title="本站混合单价 / 官方混合单价的中位数（样本 ${state.stationIndexes.get(id).sampleSize} 个模型）">×${(state.stationIndexes.get(id).median).toFixed(2)}</span>` : ""}</label>`).join("")}<span class="facet-empty" data-no-matches hidden>无匹配项</span>`;
  filterFacetOptions("station");
}
function selectedRefreshStationIds() {
  const enabledIds = new Set((state.data?.stations || []).filter(station => station.enabled === true).map(station => station.id));
  return [...state.refreshStationIds].filter(id => enabledIds.has(id));
}
function updateRefreshStationButton() {
  const button = $("#refresh-station");
  const count = selectedRefreshStationIds().length;
  $("#refresh-station-count").textContent = count ? `已选 ${count} 个` : "未选择";
  button.disabled = !count || state.refreshInProgress || state.preflightLoading;
  button.title = count ? `刷新已选的 ${count} 个站点` : "先选择至少一个启用站点";
}
function filterRefreshStationOptions() {
  const query = state.refreshStationQuery.trim().toLowerCase();
  let matches = 0;
  for (const option of document.querySelectorAll("#refresh-station-options .refresh-station-option")) {
    option.hidden = !option.textContent.toLowerCase().includes(query);
    if (!option.hidden) matches += 1;
  }
  $("#refresh-station-empty").hidden = matches > 0;
}
function renderRefreshStationOptions() {
  const stations = state.data?.stations || [];
  const enabledIds = new Set(stations.filter(station => station.enabled === true).map(station => station.id));
  for (const id of state.refreshStationIds) if (!enabledIds.has(id)) state.refreshStationIds.delete(id);
  const optionsKey = JSON.stringify(stations.map(station => [station.id, station.name, station.enabled, station.pluginId]));
  if (optionsKey !== state.refreshStationOptionsKey) {
    $("#refresh-station-options").innerHTML = stations.map(station => `<label class="facet-option refresh-station-option"><input type="checkbox" data-refresh-station-id value="${escapeHtml(station.id)}"${state.refreshStationIds.has(station.id) ? " checked" : ""}${station.enabled === true ? "" : " disabled"}>${siteIconMarkup(station.pluginId, station.name || station.id, { size: 15 })}<span>${escapeHtml(station.name || station.id)}</span>${station.enabled === true ? "" : "<small>未启用</small>"}</label>`).join("");
    state.refreshStationOptionsKey = optionsKey;
  }
  for (const input of document.querySelectorAll("#refresh-station-options input[data-refresh-station-id]")) {
    input.checked = state.refreshStationIds.has(input.value);
    input.disabled = !enabledIds.has(input.value);
  }
  filterRefreshStationOptions();
  updateRefreshStationButton();
}

function filterFacetOptions(key) {
  const query = $(`[data-facet-search="${key}"]`).value.trim().toLowerCase();
  const container = $(`#${key}-filters`);
  const options = [...container.querySelectorAll(".facet-option")];
  let matches = 0;
  for (const option of options) {
    option.hidden = !option.textContent.toLowerCase().includes(query);
    if (!option.hidden) matches++;
  }
  const noMatches = container.querySelector("[data-no-matches]");
  if (noMatches) noMatches.hidden = !query || matches > 0;
}
function renderFacetFilters(rows) {
  for (const key of state.comparisonMode === "public" ? ["group"] : ["provider", "group"]) {
    const container = $(`#${key}-filters`);
    const values = [...new Set(rows.map(row => row[key === "provider" ? "provider" : "groupName"]).filter(Boolean))].sort();
    const selected = state.filters[key] === null ? new Set(values) : new Set(state.filters[key]);
    container.innerHTML = values.length
      ? `${values.map(value => `<label class="facet-option"><input type="checkbox" data-facet-key="${key}" value="${escapeHtml(value)}"${selected.has(value) ? " checked" : ""}>${key === "provider" && providerLogoFor(value) ? providerIconMarkup(value, { size: 14 }) : ""}<span>${escapeHtml(value)}</span></label>`).join("")}<span class="facet-empty" data-no-matches hidden>无匹配项</span>`
      : `<span class="facet-empty">暂无可选项</span>`;
    filterFacetOptions(key);
  }
}

const MODEL_FILTER_BOXES = 4;
const MODEL_FILTER_BOX_LIMIT = 24;
const MODEL_FILTER_BOX_STORE = "model-atlas:model-filter-boxes";
function readModelFilterBoxCount() {
  try {
    const stored = Math.trunc(Number(localStorage.getItem(MODEL_FILTER_BOX_STORE)));
    if (Number.isFinite(stored) && stored > MODEL_FILTER_BOXES) return Math.min(stored, MODEL_FILTER_BOX_LIMIT);
  } catch { /* 隐私模式读不到，按默认四个框渲染 */ }
  return MODEL_FILTER_BOXES;
}
function saveModelFilterBoxCount() {
  try { localStorage.setItem(MODEL_FILTER_BOX_STORE, String(modelFilterBoxCount)); } catch { /* 写不进去不影响本次会话 */ }
}
let modelFilterBoxCount = readModelFilterBoxCount();
function updateModelFilterLabel() {
  const count = state.filters.models.filter(query => query.trim()).length;
  $("#model-filter-label").textContent = count ? `模型对比 · ${count}` : "模型对比";
}
function syncModelFilterActions() {
  const removeBox = $("#model-filter-remove-box");
  if (removeBox) removeBox.hidden = modelFilterBoxCount <= MODEL_FILTER_BOXES;
}
function renderModelFilter() {
  const queries = state.filters.models;
  modelFilterBoxCount = Math.max(modelFilterBoxCount, MODEL_FILTER_BOXES, queries.length);
  const boxes = Array.from({ length: modelFilterBoxCount }, (_, index) => queries[index] || "");
  $("#model-filter-inputs").innerHTML = boxes.map((value, index) => {
    const removable = index >= MODEL_FILTER_BOXES;
    const removeButton = removable
      ? `<button class="model-filter-remove" type="button" data-model-filter-remove="${index}" aria-label="移除模型 ${index + 1}" title="移除这个筛选框"><span data-icon="x" class="icon"></span></button>`
      : "";
    return `<span class="model-filter-field${removable ? " is-removable" : ""}"><input class="facet-search model-filter-input" type="search" data-model-filter="${index}" value="${escapeHtml(value)}" placeholder="模型 ${index + 1}" autocomplete="off" aria-label="模型对比 ${index + 1}">${removeButton}</span>`;
  }).join("");
  hydrateIcons($("#model-filter-inputs"));
  syncModelFilterActions();
  updateModelFilterLabel();
}

// 模型对比固定展开，折叠操作直接弹回。
$("#model-filter-menu").addEventListener("toggle", event => {
  const menu = event.currentTarget;
  if (!menu.open) {
    menu.open = true;
    return;
  }
  if (!menu.querySelector("input[data-model-filter]")) renderModelFilter();
});

function sortValue(row, key) {
  return key === "model" ? `${row.displayName} ${row.modelName}` : row[key];
}
function compareSortValues(left, right, direction) {
  if (left === null || left === undefined || left === "") return right === null || right === undefined || right === "" ? 0 : 1;
  if (right === null || right === undefined || right === "") return -1;
  if (left === right) return 0;
  const result = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
  return result * direction;
}
function sortRows(rows) {
  const direction = state.filters.sortDirection === "desc" ? -1 : 1;
  const keys = [state.filters.sortBy, state.filters.sortSecondary].filter((key, index, list) => key && key !== "none" && list.indexOf(key) === index);
  return [...rows].sort((left, right) => {
    for (const key of keys) {
      const result = compareSortValues(sortValue(left, key), sortValue(right, key), direction);
      if (result) return result;
    }
    return `${left.stationName} ${left.modelName}`.localeCompare(`${right.stationName} ${right.modelName}`);
  });
}
function priceGridMarkup(row, currency, officialQuotedPrices, chartMarkup = "") {
  const relayLines = row.quotedPrices ? dashboardPriceLines(row.quotedPrices, row, false).filter(([, value]) => value !== null && value !== undefined) : [];
  const officialSource = officialQuotedPrices || row.officialPrices || null;
  const officialBlocked = row.stationCategory === "public";
  const officialLines = officialSource && !officialBlocked ? dashboardPriceLines(officialSource, row, true).filter(([, value]) => value !== null && value !== undefined) : [];
  const officialNote = officialBlocked ? "公益站仅与公益站比较" : officialLines.length ? null : row.officialName ? "官方价格未收录" : "无官方匹配价";
  const relayNote = relayLines.length ? null : "中转价格未收录";
  if (!relayLines.length && !officialLines.length) return `<span class="price-empty">${relayNote || officialNote}</span>`;
  const grid = new Map();
  const collect = (lines, side) => {
    for (const [label, value, precise] of lines) {
      const estimated = label.endsWith("（估算）");
      const base = estimated ? label.replace(/（估算）$/, "") : label;
      const entry = grid.get(base) || { base, relay: null, official: null };
      entry[side] = { value, precise, estimated };
      grid.set(base, entry);
    }
  };
  collect(relayLines, "relay");
  collect(officialLines, "official");
  const officialFormat = officialQuotedPrices
    ? cell => formatSourcePrice(cell.value, row.officialCurrency || "CREDITS", cell.precise ? 6 : 4)
    : cell => formatPrice(cell.value, currency, cell.precise ? 6 : 4);
  const relayFormat = cell => formatSourcePrice(cell.value, row.sourceCurrency, cell.precise ? 6 : 4);
  const cellMarkup = (cell, format) => cell
    ? `<span class="price-value${cell.estimated ? " is-estimated" : ""}"${cell.estimated ? ' title="估算值"' : ""}>${cell.estimated ? "≈ " : ""}${format(cell)}</span>`
    : `<span class="price-value price-value-missing">—</span>`;
  const bodyRows = [...grid.values()].map((entry, index) => {
    const primary = index < 2 ? " price-line-primary" : "";
    return `<div class="price-grid-row${primary}"><span class="price-key">${escapeHtml(entry.base)}</span>${cellMarkup(entry.official, officialFormat)}${cellMarkup(entry.relay, relayFormat)}</div>`;
  }).join("");
  const notes = [officialNote, relayNote].filter(Boolean).map(note => `<span class="price-grid-note">${note}</span>`).join("");
  return `<div class="price-grid">${bodyRows}</div>${notes ? `<div class="price-grid-notes">${notes}</div>` : ""}${chartMarkup ? `<div class="price-chart">${chartMarkup}</div>` : ""}`;
}













function renderStationErrors() {
  const container = $("#station-errors");
  const errors = (state.data?.stationErrors || []).filter(item => state.comparisonMode === "public" ? item.category === "public" : item.category !== "public");
  container.hidden = errors.length === 0;
  container.innerHTML = errors.length
    ? `<strong>站点采集失败</strong><ul>${errors.map(item => `<li><span>${escapeHtml(item.stationName)}</span><span>${escapeHtml(item.error)}</span></li>`).join("")}</ul>`
    : "";
}

function renderComparisonMode() {
  const isPublic = state.comparisonMode === "public";
  document.body.classList.toggle("comparison-is-public", isPublic);
  document.querySelector(".comparison-table")?.classList.toggle("is-public", isPublic);
  for (const button of document.querySelectorAll("[data-comparison-mode]")) {
    const active = button.dataset.comparisonMode === state.comparisonMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  $("#comparison-mode-note").textContent = isPublic ? "公益站模式：仅显示公益站报价；价格单位为站点积分/额度，默认比例 1:1。" : "付费中转站模式：保留官方价格、月成本和推荐逻辑。";
  $("#provider-filters").closest("details").hidden = isPublic;
  for (const element of document.querySelectorAll(".paid-only-control, .paid-only-column, [data-paid-only='true']")) element.hidden = isPublic;
  for (const element of document.querySelectorAll(".public-only-column")) element.hidden = !isPublic;
  if (isPublic && ["provider", "monthlyCost", "blendedUnitPrice", "diffPercent"].includes(state.filters.sortBy)) state.filters.sortBy = "model";
  if (isPublic && ["monthlyCost", "blendedUnitPrice", "diffPercent"].includes(state.filters.sortSecondary)) state.filters.sortSecondary = "none";
  $("#sort-by").value = state.filters.sortBy;
  $("#sort-secondary").value = state.filters.sortSecondary;
  renderStationErrors();
  renderReferenceStatus();
}

function sanitizeFiltersForRows(rows) {
  const stationIds = new Set(rows.map(row => row.stationId));
  if (state.filters.stationId && !stationIds.has(state.filters.stationId)) state.filters.stationId = "";
  for (const key of ["provider", "group"]) {
    if (!Array.isArray(state.filters[key])) continue;
    const values = new Set(rows.map(row => key === "provider" ? row.provider : row.groupName));
    state.filters[key] = state.filters[key].filter(value => values.has(value));
  }
}
// 切模式时先清掉上一种模式的筛选和模型对比框，再交给 render 重新派生下拉项。
function resetFiltersForModeSwitch() {
  state.filters = modeSwitchFilters(state.filters, DEFAULT_PROVIDER_FILTER);
  state.page = 0;
  modelFilterBoxCount = MODEL_FILTER_BOXES;
  saveModelFilterBoxCount();
  $("#search").value = "";
  for (const input of document.querySelectorAll("[data-facet-search]")) input.value = "";
}

function modelMatchMarkup(row, currency) {
  const candidates = Array.isArray(row.officialCandidates) ? row.officialCandidates : [];
  const confidence = Math.max(0, Math.min(100, Math.round(Number(row.confidenceScore) || 0)));
  const hasOfficial = Boolean(row.officialName);
  const officialName = hasOfficial ? row.officialName : "没有对应的官方目录记录";
  const provider = row.provider && row.provider !== "未匹配" ? row.provider : "未匹配";
  const rule = row.matchRule || (hasOfficial ? "官方匹配" : "未匹配");
  const candidateItems = candidates.map(candidate => {
    const name = candidate.name || "未命名候选";
    const cost = Number.isFinite(candidate.monthlyCost) ? formatPrice(candidate.monthlyCost, currency, 2) : "—";
    const delta = Number.isFinite(candidate.diffPercent)
      ? `${candidate.diffPercent < 0 ? "低" : candidate.diffPercent > 0 ? "高" : "持平"} ${Math.abs(candidate.diffPercent).toFixed(1)}%`
      : "—";
    return `<div class="candidate-item"><span class="candidate-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span><span class="candidate-cost">${cost}</span><span class="candidate-delta">${delta}</span></div>`;
  }).join("");
  const candidatesMarkup = candidateItems ? `<div class="match-candidates"><div class="match-detail-heading">官方候选（${candidates.length}）</div><div class="candidate-list">${candidateItems}</div></div>` : "";
  return `<details class="model-match-details"><summary class="confidence-tag" aria-label="匹配置信度 ${confidence}%，查看官方匹配详情">${confidence}%</summary><div class="model-match-popover" aria-label="官方匹配详情"><div class="match-detail-primary"><span class="match-detail-label">官方模型</span><strong>${escapeHtml(officialName)}</strong></div><div class="match-detail-line"><span>供应商</span><span>${escapeHtml(provider)}</span></div><div class="match-detail-line"><span>匹配规则</span><span>${escapeHtml(rule)}</span></div><div class="match-detail-line"><span>置信度</span><span>${confidence}%</span></div>${candidatesMarkup}</div></details>`;
}

function closeModelMatchDetails(except = null) {
  for (const details of document.querySelectorAll(".model-match-details[open]")) {
    if (details !== except) {
      details.open = false;
      delete details.dataset.hoverOpen;
    }
  }
}


// 月成本排名浮层：固定定位挂在 body 层的浮层里，鼠标移进浮层滚动列表不会把它关掉。
const monthlyCostPanelHome = new WeakMap();
let monthlyCostPanelState = null;
let monthlyCostOpenTimer = 0;
let monthlyCostCloseTimer = 0;

function monthlyCostLayer() {
  let layer = document.getElementById("monthly-cost-layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "monthly-cost-layer";
    layer.className = "floating-layer";
    document.body.append(layer);
  }
  return layer;
}

function monthlyCostPanelFor(trigger) {
  const row = trigger?.closest("tr");
  return row ? row.querySelector("[data-monthly-cost-panel]") : null;
}

function placeMonthlyCostPanel(trigger, panel) {
  const rect = trigger.getBoundingClientRect();
  const margin = 8;
  const width = panel.offsetWidth || 430;
  const height = panel.offsetHeight || 320;
  const left = Math.min(Math.max(margin, rect.right - width), Math.max(margin, window.innerWidth - width - margin));
  let top = rect.bottom + 8;
  if (top + height > window.innerHeight - margin) {
    const above = rect.top - height - 8;
    top = above >= margin ? above : Math.max(margin, window.innerHeight - height - margin);
  }
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
}

function openMonthlyCostPanel(trigger) {
  clearTimeout(monthlyCostOpenTimer);
  clearTimeout(monthlyCostCloseTimer);
  monthlyCostOpenTimer = 0;
  monthlyCostCloseTimer = 0;
  if (!trigger?.isConnected) return;
  const panel = monthlyCostPanelFor(trigger);
  if (!panel) return;
  if (monthlyCostPanelState?.panel === panel) {
    placeMonthlyCostPanel(trigger, panel);
    return;
  }
  closeMonthlyCostPanel();
  if (!monthlyCostPanelHome.has(panel)) monthlyCostPanelHome.set(panel, panel.parentElement);
  monthlyCostLayer().append(panel);
  panel.hidden = false;
  panel.dataset.floating = "true";
  monthlyCostPanelState = { trigger, panel };
  trigger.setAttribute("aria-expanded", "true");
  placeMonthlyCostPanel(trigger, panel);
}

function closeMonthlyCostPanel() {
  clearTimeout(monthlyCostOpenTimer);
  clearTimeout(monthlyCostCloseTimer);
  monthlyCostOpenTimer = 0;
  monthlyCostCloseTimer = 0;
  const current = monthlyCostPanelState;
  if (!current) return;
  monthlyCostPanelState = null;
  current.panel.hidden = true;
  delete current.panel.dataset.floating;
  current.panel.style.left = "";
  current.panel.style.top = "";
  const home = monthlyCostPanelHome.get(current.panel);
  if (home?.isConnected) home.append(current.panel);
  current.trigger.setAttribute("aria-expanded", "false");
}

function scheduleMonthlyCostOpen(trigger) {
  clearTimeout(monthlyCostCloseTimer);
  monthlyCostCloseTimer = 0;
  if (monthlyCostPanelState?.trigger === trigger) return;
  clearTimeout(monthlyCostOpenTimer);
  monthlyCostOpenTimer = setTimeout(() => openMonthlyCostPanel(trigger), 110);
}

function scheduleMonthlyCostClose() {
  clearTimeout(monthlyCostOpenTimer);
  monthlyCostOpenTimer = 0;
  clearTimeout(monthlyCostCloseTimer);
  monthlyCostCloseTimer = setTimeout(closeMonthlyCostPanel, 160);
}

function repositionMonthlyCostPanel() {
  const current = monthlyCostPanelState;
  if (!current) return;
  const rect = current.trigger.getBoundingClientRect();
  if (!current.trigger.isConnected || !current.panel.isConnected || rect.bottom < 0 || rect.top > window.innerHeight) {
    closeMonthlyCostPanel();
    return;
  }
  placeMonthlyCostPanel(current.trigger, current.panel);
}

function modelIconMarkup(row) {
  return providerIconMarkup([row.provider, row.canonicalModel, row.modelName, row.displayName], { size: 15 });
}
function renderRows() {
  closeMonthlyCostPanel();
  const currency = state.data?.settings?.defaultCurrency || "CNY";
  const query = state.filters.search.trim().toLowerCase();
  const filterKey = JSON.stringify([state.filters.search, state.filters.stationId, state.filters.provider, state.filters.group, state.filters.models, state.filters.showUnmatched, state.filters.sortBy, state.filters.sortSecondary, state.filters.sortDirection]);
  if (pageFilterKey !== null && pageFilterKey !== filterKey) state.page = 0;
  pageFilterKey = filterKey;
  const filtered = sortRows(state.rows.filter(row => rowMatches(row, query)));
  const page = paginateRows(filtered, state.page, Number($("#page-size").value) || PAGE_SIZE);
  state.page = page.page;
  const visible = page.rows;
  const monthlyCostRankings = buildMonthlyCostRankings(filtered);
  const bandClasses = rowBandClasses(visible);
  const pagination = $("#comparison-pagination");
  pagination.hidden = filtered.length === 0;
  $("#comparison-page").textContent = page.pageCount ? `第 ${page.page + 1} / ${page.pageCount} 页` : "";
  $("#comparison-previous").disabled = page.page === 0;
  $("#comparison-next").disabled = page.page + 1 >= page.pageCount;
  $("#result-count").textContent = `${filtered.length} 条报价`;
  $("#comparison-body").innerHTML = visible.map((row, index) => {
    const station = stationFor(row);
    const delta = row.pricingUnavailable || !Number.isFinite(row.monthlyCost) ? null : (Number.isFinite(row.diffPercent) ? row.diffPercent : null);
    const deltaClass = delta === null || Math.abs(delta) < 0.005 ? "neutral" : `delta-${deltaTone(delta)}`;
    const deltaLabel = delta === null ? (row.pricingUnavailable ? pricingUnavailableLabel(row) : row.stationCategory === "public" ? "仅公益站比较" : "无官方价") : Math.abs(delta) < 0.005 ? "持平" : `${delta < 0 ? "低" : "高"} ${Number(Math.abs(delta).toFixed(2))}%`;
    const isPublic = state.comparisonMode === "public";
    const categoryClass = ["excellent", "good", "fair", "bad"].includes(row.category) ? row.category : "";
    const monthlyCostCurrency = row.costCurrency || currency;
    const officialQuotedPrices = row.officialQuotedPrices || null;
    const monthlyRanking = monthlyCostRankingFor(row, monthlyCostRankings);
    const modelName = row.displayNameOverride || row.modelName || row.displayName;
    const officialNote = !isPublic ? modelMatchMarkup(row, currency) : "";
    const rowClasses = [bandClasses[index], categoryClass && `category-${categoryClass}`].filter(Boolean).join(" ");
    return `<tr class="${rowClasses}">
      <td data-label="模型"><div class="model-cell"><div class="model-head">${modelIconMarkup(row)}<span class="model-name">${escapeHtml(modelName)}</span>${!isPublic && row.officialName ? `<span class="provider-tag">${escapeHtml(row.provider)}</span>` : ""}</div>${officialNote ? `<span class="model-meta">${officialNote}</span>` : ""}</div></td>
      <td data-label="中转站"><div class="station-cell"><button class="station-filter-link" type="button" title="筛选此站点" aria-label="筛选站点：${escapeHtml(row.stationName)}" data-focus-station="${escapeHtml(row.stationId)}">${siteIconMarkup(station.pluginId, row.stationName, { size: 16 })}<span>${escapeHtml(row.stationName)}</span></button><span class="station-meta">${escapeHtml(row.groupName || "未分组")}${row.groupRatio ? ` · ×${escapeHtml(row.groupRatio)}` : ""}</span></div></td>
      <td colspan="3" data-label="单价 / 每 M tokens" class="price-cell is-section-start paid-only-column"${isPublic ? " hidden" : ""}>${priceGridMarkup(row, currency, officialQuotedPrices, monthlyCostChartMarkup(row, currency, monthlyRanking))}</td>
      <td data-label="月成本 · 混合单价" class="cost-combined-cell is-section-start paid-only-column"${isPublic ? " hidden" : ""}>${costCombinedMarkup(row, currency, monthlyRanking, deltaClass, deltaLabel)}</td>
      <td data-label="状态" class="public-only-column"${isPublic ? "" : " hidden"}><div class="recommendation-cell">${statusMarkup(row, false)}</div></td>
    </tr>`;
  }).join("");
  for (const heading of document.querySelectorAll("th[data-sort-keys]")) {
    const keys = heading.dataset.sortKeys.split(" ");
    heading.setAttribute("aria-sort", keys.includes(state.filters.sortBy) ? (state.filters.sortDirection === "asc" ? "ascending" : "descending") : "none");
  }
  $("#empty-state").hidden = visible.length > 0;
  $(".table-wrap").hidden = visible.length === 0;
  hydrateIcons($("#comparison-body"));
}

// 条长只做同模型月成本相对比较，排名来自完整筛选结果。
function cellChartMarkup({ width, kind = "is-monthly-cost", title, trigger = false }) {
  const safeWidth = Number.isFinite(width) ? Math.max(0, Math.min(100, width)) : 0;
  const bar = `<span class="chart-bar" style="width:${safeWidth.toFixed(2)}%"></span>`;
  if (trigger) {
    return `<span class="cell-chart ${kind}" data-monthly-cost-trigger role="button" tabindex="0" aria-haspopup="true" aria-expanded="false" aria-label="${escapeHtml(title)}"><span class="chart-track">${bar}</span></span>`;
  }
  return `<span class="cell-chart ${kind}" role="img" aria-label="${escapeHtml(title)}"><span class="chart-track" title="${escapeHtml(title)}">${bar}</span></span>`;
}

// 月成本和混合单价合并成一格：上面是月成本与同模型名次，下面是价差和混合单价。
function costCombinedMarkup(row, currency, ranking, deltaClass, deltaLabel) {
  const blended = Number.isFinite(row.blendedUnitPrice)
    ? `<span class="blended-cost"${row.blendedMix ? ` title="按 ${mixLabel(row.blendedMix)} 混合"` : ""}>${formatPrice(row.blendedUnitPrice, row.costCurrency || currency, 4)}<small>/M</small></span>`
    : `<span class="price-empty">${row.stationCategory === "public" ? "仅公益站比较" : "无混合价"}</span>`;
  return `<div class="cost-combined"><div class="cost-combined-main">${monthlyCostSummaryMarkup(row, currency, ranking)}<span class="delta-tag ${deltaClass}">${deltaLabel}</span></div><span class="blended-line"><span class="blended-label">混合</span>${blended}</span>${monthlyCostPanelMarkup(row, currency, ranking)}</div>`;
}

function monthlyCostSummaryMarkup(row, currency, ranking) {
  const { rank, total, top } = ranking;
  const amount = formatPrice(row.monthlyCost, row.costCurrency || currency);
  const ariaLabel = rank
    ? `月成本 ${amount}，同模型第 ${rank} / ${total} 名，查看月成本最低的前 ${top.length} 条报价`
    : `月成本 ${amount}，暂无同模型排名`;
  return `<strong class="cost-amount" data-monthly-cost-trigger role="button" tabindex="0" aria-haspopup="true" aria-expanded="false" aria-label="${escapeHtml(ariaLabel)}">${amount}</strong>`;
}
// 长条只做同模型月成本相对比较，放在单价单元格底部；名次和价差仍在月成本列。
function monthlyCostRankTitle(row, currency, { rank, total, baseline }) {
  return rank
    ? `同模型第 ${rank} / ${total} 名，月成本 ${formatPrice(row.monthlyCost, row.costCurrency || currency)}；柱长按组内最高月成本 ${formatPrice(baseline, row.costCurrency || currency)} 归一`
    : "月成本不可用，无法参与同模型排名";
}

function monthlyCostChartMarkup(row, currency, ranking) {
  const width = ranking.rank ? monthlyCostBarWidth(row.monthlyCost, ranking.baseline) : null;
  return cellChartMarkup({ width, title: monthlyCostRankTitle(row, currency, ranking), trigger: true });
}

// 排名浮层只在悬停或点击月成本、长条时出现，表格里不再常驻名次。
function monthlyCostPanelMarkup(row, currency, ranking) {
  const { rank, total, baseline, top } = ranking;
  const items = top.map(entry => {
    const entryRow = entry.row;
    const entryCurrency = entryRow.costCurrency || currency;
    const entryTitle = `第 ${entry.rank} 名，${entryRow.stationName}，月成本 ${formatPrice(entry.monthlyCost, entryCurrency)}`;
    const entryWidth = monthlyCostBarWidth(entry.monthlyCost, baseline) ?? 0;
    return `<li class="monthly-cost-ranking-item${entryRow === row ? " is-current" : ""}"><div class="monthly-cost-ranking-meta"><span class="monthly-cost-ranking-position">#${entry.rank}</span><span class="monthly-cost-ranking-station" title="${escapeHtml(`${entryRow.stationName} · ${entryRow.groupName || "未分组"}`)}">${escapeHtml(entryRow.stationName)}</span><strong class="monthly-cost-ranking-cost">${formatPrice(entry.monthlyCost, entryCurrency)}</strong></div><span class="monthly-cost-ranking-group">${escapeHtml(entryRow.groupName || "未分组")}</span>${cellChartMarkup({ width: entryWidth, title: entryTitle })}</li>`;
  }).join("");
  return `<div class="monthly-cost-popover" data-monthly-cost-panel role="group" aria-label="同模型月成本排名" hidden><div class="monthly-cost-popover-heading"><strong>月成本最低前 ${top.length} 条</strong><span>当前第 ${rank || "—"} / ${total} 名</span></div><ol class="monthly-cost-ranking-list">${items || '<li class="monthly-cost-ranking-empty">暂无可排名报价</li>'}</ol></div>`;
}


function renderReferenceStatus() {
  const ref = state.reference;
  const pill = $("#reference-pill");
  if (!ref || !pill) return;
  if (state.comparisonMode === "public") {
    pill.hidden = true;
    $("#freshness-sep").hidden = true;
    return;
  }
  const count = ref.models?.length || 0;
  const fetched = ref.fetchedAt ? new Date(ref.fetchedAt) : null;
  $("#reference-status").textContent = count ? `官方价 ${count}` : "官方价未加载";
  $("#reference-note").textContent = fetched ? fetched.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "";
  $("#reference-dot").classList.toggle("is-live", count > 0);
  const warnings = ref.warnings?.length ? ref.warnings.join("；") : "";
  const cacheNote = "官方目录每日缓存 · USD credit 1:1 · 人民币按设置汇率";
  pill.title = fetched ? `${cacheNote}${warnings ? `；${warnings}` : ""}` : warnings || cacheNote;
  pill.hidden = false;
  $("#freshness-sep").hidden = false;
}
// 顶栏合并读数：中转站快照时间 · 官方价缓存时间，两边齐全就折叠成一行。
function renderFreshness() {
  const collectedAt = (state.data?.snapshots || [])
    .map(snapshot => snapshot?.collectedAt)
    .filter(Number.isFinite)
    .sort((a, b) => b - a)[0];
  $("#last-updated").textContent = collectedAt ? `更新于 ${new Date(collectedAt).toLocaleTimeString("zh-CN", { hour12: false })}` : "尚未刷新";
  $("#connection-dot").classList.toggle("is-live", state.rows.length > 0);
}
function renderCheckin(data) {
  const list = $("#checkin-list");
  const menu = $("#checkin-menu");
  if (!list || !menu) return;
  const stations = data.checkinStations || [];
  // 签到能力由插件仓库的签到插件提供，扩展里不再内置站点适配
  const installed = data.checkinPluginInstalled === true || stations.length > 0;
  menu.hidden = false;
  if (!installed) {
    list.innerHTML = `
      <div class="checkin-empty">
        <span class="checkin-empty-text">签到来自插件仓库的「站点签到插件」，装好这里就出现站点卡片。</span>
        <button class="button button-quiet" type="button" data-checkin-action="install"><span data-icon="puzzle" class="icon"></span><span>去插件仓库</span></button>
      </div>`;
    hydrateIcons(list);
    return;
  }
  const state = data.checkinState || {};
  if (!stations.length) {
    list.innerHTML = `<div class="checkin-empty"><span class="checkin-empty-text">已装签到插件，但没有匹配到已启用的站点。先添加或启用对应站点。</span></div>`;
    hydrateIcons(list);
    return;
  }
  list.innerHTML = stations.map(station => {
    const record = state[station.id] || {};
    const claimedToday = record.lastStatus === "ok" && !record.lastResult?.includes("可签到");
    const statusText = record.lastStatus === "error" ? record.lastResult || "查询失败" : record.lastResult || "尚未查询";
    const statusClass = record.lastStatus === "error" ? "checkin-status-error" : claimedToday ? "checkin-status-ok" : "checkin-status-idle";
    const host = (station.hosts || [])[0];
    return `
      <div class="checkin-item" data-station-id="${escapeHtml(station.id)}">
        <div class="checkin-info">
          <strong>${escapeHtml(station.name)}</strong>
          <span class="checkin-meta">${host ? `${escapeHtml(host)} · ` : ""}连续签到 ${Number(record.streak) || 0} 天 · <span class="${statusClass}">${escapeHtml(statusText)}</span></span>
        </div>
        <div class="checkin-actions">
          <label class="check-label"><input type="checkbox" data-checkin-action="auto" data-station-id="${escapeHtml(station.id)}" ${station.autoEnabled ? "checked" : ""}><span>自动签到</span></label>
          <button class="button button-quiet" type="button" data-checkin-action="claim" data-station-id="${escapeHtml(station.id)}"><span data-icon="sparkles" class="icon"></span><span>立即签到</span></button>
        </div>
      </div>`;
  }).join("");
  hydrateIcons(list);
}
const REFRESH_PREFLIGHT_LABELS = { ready: "已登录", needsLogin: "需要登录", uncertain: "需人工确认", noLoginRequired: "无需登录" };
function renderRefreshPreflight(preflight = state.refreshPreflight) {
  const panel = $("#refresh-preflight-panel");
  panel.hidden = !preflight && !state.preflightLoading;
  const status = $("#refresh-preflight-status");
  const list = $("#refresh-preflight-results");
  const confirm = $("#confirm-refresh-all");
  const cancel = $("#cancel-refresh-preflight");
  const scope = preflight || state.data?.refreshScope || {};
  const label = preflight?.comparisonLabel || (state.comparisonMode === "public" ? "公益站" : "付费中转站");
  const count = preflight ? Number(preflight.stationCount) || 0 : scope.comparisonMode === state.comparisonMode ? Number(scope.stationCount) || 0 : 0;
  if (state.preflightLoading) {
    status.textContent = `正在检查${label}（${count} 个启用站点）`;
    list.replaceChildren();
  } else if (preflight) {
    const needsLogin = preflight.results.filter(result => result.status === "needsLogin").length;
    const uncertain = preflight.results.filter(result => result.status === "uncertain").length;
    status.textContent = !count
      ? `当前${label}没有启用的站点，未发起刷新。`
      : needsLogin || uncertain
        ? `${label}：${count} 个启用站点，${needsLogin} 个需要登录，${uncertain} 个无法确认。登录或检查页面后再确认。`
        : `${label}：${count} 个启用站点，页面预检已完成。确认后开始刷新。`;
    list.innerHTML = preflight.results.map(result => `<li class="preflight-result preflight-${escapeHtml(result.status)}"><span class="preflight-site">${escapeHtml(result.stationName)}</span><span class="preflight-label">${REFRESH_PREFLIGHT_LABELS[result.status] || "需人工确认"}</span><span class="preflight-reason">${escapeHtml(result.reason || "")}</span></li>`).join("");
  } else {
    status.textContent = "";
    list.replaceChildren();
  }
  confirm.disabled = !preflight || !count || state.preflightLoading || state.refreshInProgress;
  cancel.disabled = !preflight || state.preflightLoading || state.refreshInProgress;
}

function render(data) {
  state.data = data;
  state.refreshInProgress = Boolean(data.refreshInProgress);
  state.comparisonMode = data.settings?.comparisonMode === "public" ? "public" : "paid";
  state.refreshPreflight = data.refreshPreflight || null;
  renderRefreshPreflight();
  state.page = 0;
  pageFilterKey = null;
  state.rows = flattenComparisonRows(data.comparisons || []);
  state.stationIndexes = new Map(buildStationIndexes(data.comparisons || []).map(item => [item.stationId, item]));
  sanitizeFiltersForRows(state.rows);
  const index = createDashboardIndex(state.rows, data.stations || []);
  state.searchTextByRow = index.searchTextByRow;
  state.modelTextByRow = index.modelTextByRow;
  state.stationById = index.stationById;
  state.reference = data.references;
  renderComparisonMode();
  state.filters.showUnmatched = Boolean(data.settings?.showUnmatched);
  $("#show-unmatched").checked = state.filters.showUnmatched;
  renderSummary(state.rows);
  renderStationFilter(state.rows);
  renderRefreshStationOptions();
  renderFacetFilters(state.rows);
  renderModelFilter();
  $("#sort-by").value = state.filters.sortBy;
  $("#sort-secondary").value = state.filters.sortSecondary;
  $("#sort-direction").value = state.filters.sortDirection;
  renderRows();
  const hasStations = Number(data.refreshScope?.stationCount) > 0;
  const emptyState = $("#empty-state");
  const publicEmpty = state.comparisonMode === "public";
  emptyState.querySelector("h3").textContent = publicEmpty ? (hasStations ? "暂无公益站报价" : "还没有公益站") : (hasStations ? "站点已保存，尚未采集报价" : "还没有可比较的报价");
  emptyState.querySelector("p").textContent = publicEmpty ? "启用公益站后刷新。" : (hasStations ? "点右上角刷新开始采集。" : "添加中转站并刷新即可。");
  $("#empty-state-action-label").textContent = hasStations ? "管理站点" : "添加第一个站点";
  renderReferenceStatus();
  renderCheckin(data);
  renderFreshness();
  hydrateIcons();
}

async function load() {
  try { render(await callService("GET_DASHBOARD")); }
  catch (error) { toast(error.message); }
}


document.querySelectorAll("[data-comparison-mode]").forEach(button => {
  button.addEventListener("click", async () => {
    const mode = button.dataset.comparisonMode;
    if (mode === state.comparisonMode) return;
    const previousMode = state.comparisonMode;
    state.comparisonMode = mode === "public" ? "public" : "paid";
    state.refreshPreflight = null;
    renderRefreshPreflight();
    button.disabled = true;
    try {
      const data = await callService("SAVE_COMPARISON_MODE", { mode });
      resetFiltersForModeSwitch();
      render(data);
    } catch (error) {
      state.comparisonMode = previousMode;
      renderComparisonMode();
      renderRefreshPreflight();
      toast(error.message);
    } finally {
      button.disabled = false;
    }
  });
});

$("#search").addEventListener("input", event => { state.filters.search = event.target.value; renderRows(); });
document.addEventListener("change", event => {
  const station = event.target.closest("input[data-station-filter]");
  if (station) {
    state.filters.stationId = station.value;
    const menu = $("#station-filter-menu");
    menu.open = false;
    menu.querySelector("summary").focus();
    renderStationFilter(state.rows);
    renderRows();
    return;
  }
  const input = event.target.closest("input[data-facet-key]");
  if (!input) return;
  const key = input.dataset.facetKey;
  state.filters[key] = [...document.querySelectorAll(`#${key}-filters input[data-facet-key]:checked`)].map(option => option.value);
  renderFacetFilters(state.rows);
  renderRows();
});
document.addEventListener("input", event => {
  if (event.target.matches("input[data-model-filter]")) {
    state.filters.models = [...document.querySelectorAll("input[data-model-filter]")].map(input => input.value);
    updateModelFilterLabel();
    renderRows();
    return;
  }
  const input = event.target.closest("[data-facet-search]");
  if (input) filterFacetOptions(input.dataset.facetSearch);
});
document.addEventListener("mouseover", event => {
  const summary = event.target.closest(".model-match-details > .confidence-tag");
  if (!summary) return;
  const details = summary.closest("details");
  if (!details) return;
  if (event.relatedTarget && details.contains(event.relatedTarget)) return;
  // 未展开的 details 不渲染子内容，悬停必须由 JS 打开，CSS :hover 起不到作用。
  closeModelMatchDetails(details);
  if (!details.open) {
    details.open = true;
    details.dataset.hoverOpen = "true";
  }
});
document.addEventListener("click", event => {
  const matchDetails = event.target.closest(".model-match-details");
  closeModelMatchDetails(matchDetails);
  if (matchDetails?.dataset.hoverOpen === "true" && event.target.closest(".confidence-tag")) {
    // 悬停已展开时，点击只固定当前展开态，避免 summary 默认行为立刻关掉。
    event.preventDefault();
    matchDetails.open = true;
    delete matchDetails.dataset.hoverOpen;
  }
});
document.addEventListener("mouseout", event => {
  const details = event.target.closest(".model-match-details");
  if (!details?.open) return;
  if (event.relatedTarget && details.contains(event.relatedTarget)) return;
  details.open = false;
  delete details.dataset.hoverOpen;
});
const MONTHLY_COST_TRIGGER = "[data-monthly-cost-trigger]";
const MONTHLY_COST_PANEL = "[data-monthly-cost-panel]";
document.addEventListener("pointerover", event => {
  const target = event.target;
  if (!target?.closest) return;
  const trigger = target.closest(MONTHLY_COST_TRIGGER);
  if (trigger) {
    scheduleMonthlyCostOpen(trigger);
    return;
  }
  if (target.closest(MONTHLY_COST_PANEL)) {
    clearTimeout(monthlyCostCloseTimer);
    monthlyCostCloseTimer = 0;
  }
});
document.addEventListener("pointerout", event => {
  const target = event.target;
  if (!target?.closest) return;
  if (!target.closest(`${MONTHLY_COST_TRIGGER}, ${MONTHLY_COST_PANEL}`)) return;
  const next = event.relatedTarget;
  if (next?.closest && next.closest(`${MONTHLY_COST_TRIGGER}, ${MONTHLY_COST_PANEL}`)) return;
  scheduleMonthlyCostClose();
});
document.addEventListener("click", event => {
  const target = event.target;
  if (!target?.closest) return;
  const trigger = target.closest(MONTHLY_COST_TRIGGER);
  if (trigger) {
    event.preventDefault();
    openMonthlyCostPanel(trigger);
    return;
  }
  if (!target.closest(MONTHLY_COST_PANEL)) closeMonthlyCostPanel();
});
document.addEventListener("keydown", event => {
  const target = event.target;
  const trigger = target?.closest ? target.closest(MONTHLY_COST_TRIGGER) : null;
  if (trigger && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    openMonthlyCostPanel(trigger);
    return;
  }
  if (event.key === "Escape") closeMonthlyCostPanel();
});
document.addEventListener("scroll", repositionMonthlyCostPanel, true);
window.addEventListener("resize", repositionMonthlyCostPanel);
document.addEventListener("click", event => {
  const activeMenu = event.target.closest(".facet-menu");
  for (const menu of document.querySelectorAll(".facet-menu[open]")) {
    if (menu !== activeMenu) menu.open = false;
  }
  const activeHint = event.target.closest(".unit-hint");
  for (const hint of document.querySelectorAll(".unit-hint[open]")) {
    if (hint !== activeHint) hint.open = false;
  }
  if (event.target.closest("#model-filter-add")) {
    if (modelFilterBoxCount >= MODEL_FILTER_BOX_LIMIT) return;
    modelFilterBoxCount += 1;
    saveModelFilterBoxCount();
    renderModelFilter();
    const inputs = [...document.querySelectorAll("input[data-model-filter]")];
    inputs[inputs.length - 1]?.focus();
    return;
  }
  const removeButton = event.target.closest("[data-model-filter-remove]");
  if (removeButton) {
    const index = Number(removeButton.dataset.modelFilterRemove);
    const values = [...document.querySelectorAll("input[data-model-filter]")].map(input => input.value);
    values.splice(index, 1);
    state.filters.models = values;
    modelFilterBoxCount = Math.max(MODEL_FILTER_BOXES, values.length);
    saveModelFilterBoxCount();
    renderModelFilter();
    renderRows();
    return;
  }
  if (event.target.closest("#model-filter-remove-box")) {
    const values = [...document.querySelectorAll("input[data-model-filter]")].map(input => input.value);
    values.pop();
    state.filters.models = values;
    modelFilterBoxCount = Math.max(MODEL_FILTER_BOXES, values.length);
    saveModelFilterBoxCount();
    renderModelFilter();
    renderRows();
    return;
  }
  const button = event.target.closest("[data-facet-action]");
  if (!button) return;
  const key = button.dataset.facetKey;
  state.filters[key] = button.dataset.facetAction === "all" ? null : [];
  renderFacetFilters(state.rows);
  renderRows();
});
$("#sort-by").addEventListener("change", event => { state.filters.sortBy = event.target.value; renderRows(); });
$("#sort-secondary").addEventListener("change", event => { state.filters.sortSecondary = event.target.value; renderRows(); });
$("#sort-direction").addEventListener("change", event => { state.filters.sortDirection = event.target.value; renderRows(); });
$("#reset-filters").addEventListener("click", () => {
resetFiltersForModeSwitch();
  state.filters = { ...state.filters, showUnmatched: true, sortBy: "blendedUnitPrice", sortSecondary: "diffPercent", sortDirection: "asc" };
  renderModelFilter();
  renderStationFilter(state.rows);
  $("#sort-by").value = "blendedUnitPrice";
  $("#sort-secondary").value = "diffPercent";
  $("#sort-direction").value = "asc";
  $("#show-unmatched").checked = true;
  renderFacetFilters(state.rows);
  renderRows();
});
$("#show-unmatched").addEventListener("change", event => { state.filters.showUnmatched = event.target.checked; renderRows(); });




function renderRefreshProgress(progress) {
  state.refreshInProgress = progress.refreshInProgress ?? !["complete", "error"].includes(progress.phase);
  const panel = $("#refresh-progress-panel");
  panel.hidden = false;
  const total = Math.max(0, Number(progress.total) || 0);
  const completed = Math.max(0, Number(progress.completed) || 0);
  const label = progress.comparisonLabel || (state.comparisonMode === "public" ? "公益站" : "付费中转站");
  const bar = $("#refresh-progress-bar");
  bar.max = Math.max(total, 1);
  bar.value = Math.min(completed, bar.max);
  $("#refresh-progress-count").textContent = `${label}：${completed} / ${total} 站点`;
  const message = $("#refresh-progress-message");
  if (progress.phase === "start") {
    lastRefreshSummary = null;
    refreshRows.clear();
    $("#refresh-progress-results").replaceChildren();
    message.textContent = total ? `${label}：准备查询 ${total} 个启用站点` : `当前${label}没有启用的站点，未发起刷新`;
  } else if (progress.phase === "references") {
    message.textContent = `${label}：${progress.message}`;
  } else if (progress.phase === "station") {
    let row = refreshRows.get(progress.stationId);
    if (!row) {
      row = document.createElement("li");
      refreshRows.set(progress.stationId, row);
      $("#refresh-progress-results").append(row);
    }
    row.dataset.status = progress.status;
    const duration = Number.isFinite(progress.durationMs) ? ` · ${(progress.durationMs / 1000).toFixed(1)} 秒` : "";
    const detail = progress.status === "running" ? "查询中" : progress.status === "error" ? `失败 · ${progress.error || "未知错误"}` : progress.status === "partial" ? `部分成功 · ${Number(progress.modelCount) || 0} 个模型 · ${progress.error || "存在未解析计费模式"}` : `${Number(progress.modelCount) || 0} 个模型${duration}`;
    row.textContent = `${progress.stationName || progress.stationId} · ${detail}`;
    message.textContent = progress.status === "running"
      ? `${label}：正在查询 ${progress.stationName}（并行槽位 ${progress.current}）`
      : `${label}：已查询 ${completed}/${total} 个站点`;
  } else if (progress.phase === "complete") {
    lastRefreshSummary = progress.summary;
    const summary = progress.summary;
    message.textContent = formatRefreshSummary(summary);
    // 进度里的完成信号先于消息响应到达，这里主动同步一次，避免响应丢失时表格停在旧数据。
    load();
  } else if (progress.phase === "error") {
    message.textContent = progress.message;
  }
}

$("#comparison-previous").addEventListener("click", () => { state.page--; renderRows(); });
$("#comparison-next").addEventListener("click", () => { state.page++; renderRows(); });
$("#page-size").addEventListener("change", () => { state.page = 0; renderRows(); });
const backToTop = $("#back-to-top");
const pageShell = $(".page-shell");
const tableWrap = $(".table-wrap");
const updateBackToTop = () => { backToTop.hidden = window.scrollY < 400 && pageShell.scrollTop < 400 && tableWrap.scrollTop < 400; };
window.addEventListener("scroll", updateBackToTop, { passive: true });
pageShell.addEventListener("scroll", updateBackToTop, { passive: true });
tableWrap.addEventListener("scroll", updateBackToTop, { passive: true });
backToTop.addEventListener("click", () => {
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  pageShell.scrollTo({ top: 0, behavior });
  tableWrap.scrollTo({ top: 0, behavior });
});

$("#comparison-body").addEventListener("click", async event => {
  const button = event.target.closest("[data-focus-station]");
  if (!button) return;
  state.filters.stationId = button.dataset.focusStation;
  renderStationFilter(state.rows);
  renderRows();
});

$("#refresh-station-search").addEventListener("input", event => {
  state.refreshStationQuery = event.target.value;
  filterRefreshStationOptions();
});
$("#refresh-station-options").addEventListener("change", event => {
  const input = event.target.closest("input[data-refresh-station-id]");
  if (!input) return;
  if (input.checked) state.refreshStationIds.add(input.value);
  else state.refreshStationIds.delete(input.value);
  updateRefreshStationButton();
});
$("#refresh-station-select-all").addEventListener("click", () => {
  for (const input of document.querySelectorAll("#refresh-station-options input[data-refresh-station-id]")) {
    if (input.disabled || input.closest("label").hidden) continue;
    input.checked = true;
    state.refreshStationIds.add(input.value);
  }
  updateRefreshStationButton();
});
$("#refresh-station-clear").addEventListener("click", () => {
  state.refreshStationIds.clear();
  for (const input of document.querySelectorAll("#refresh-station-options input[data-refresh-station-id]")) input.checked = false;
  updateRefreshStationButton();
});
$("#refresh-station").addEventListener("click", async event => {
  if (state.refreshInProgress || state.preflightLoading) return;
  const stationIds = selectedRefreshStationIds();
  if (!stationIds.length) return;
  const button = event.currentTarget;
  button.disabled = true;
  $("#refresh-all").disabled = true;
  button.innerHTML = `${icon("loader-circle", { className: "icon spin" })}<span>查询中</span>`;
  lastRefreshSummary = null;
  try {
    const data = await callService("REFRESH_STATION", { stationIds });
    lastRefreshSummary = data.refreshSummary;
    render(data);
    $("#refresh-station-menu").open = false;
    if (!lastRefreshSummary?.total) toast("所选站点没有可查询的数据");
    else toast(`指定站点查询完成，${lastRefreshSummary.successCount} 成功，${lastRefreshSummary.errorCount} 失败`);
  } catch (error) {
    toast(error.message);
  } finally {
    $("#refresh-all").disabled = false;
    button.innerHTML = `${icon("refresh-cw", { className: "icon" })}<span>刷新已选站点</span>`;
    updateRefreshStationButton();
  }
});

$("#refresh-all").addEventListener("click", async event => {
  if (state.preflightLoading || state.refreshInProgress) return;
  const button = event.currentTarget;
  button.disabled = true;
  $("#refresh-station").disabled = true;
  button.innerHTML = `${icon("loader-circle", { className: "icon spin" })}<span>检查登录状态</span>`;
  state.refreshPreflight = null;
  state.preflightLoading = true;
  renderRefreshPreflight();
  try {
    const data = await callService("REFRESH_PREFLIGHT");
    state.refreshPreflight = data;
    renderRefreshPreflight();
    const needsLogin = data.results.filter(result => result.status === "needsLogin").length;
    const uncertain = data.results.filter(result => result.status === "uncertain").length;
    const label = data.comparisonLabel || "当前分组";
    toast(!data.stationCount ? `${label}没有启用的站点，未发起刷新` : needsLogin || uncertain ? `${label}预检完成：${needsLogin} 个站点需要登录，${uncertain} 个站点需人工确认` : `${label}预检完成，请确认开始刷新 ${data.stationCount} 个站点`);
  } catch (error) { toast(error.message); }
  finally {
    state.preflightLoading = false;
    button.disabled = false;
    button.innerHTML = `${icon("refresh-cw", { className: "icon" })}<span>刷新全部</span>`;
    $("#refresh-station").disabled = false;
    updateRefreshStationButton();
    renderRefreshPreflight();
  }
});

$("#confirm-refresh-all").addEventListener("click", async event => {
  const button = event.currentTarget;
  const preflight = state.refreshPreflight;
  if (!preflight) return;
  button.disabled = true;
  $("#cancel-refresh-preflight").disabled = true;
  $("#refresh-all").disabled = true;
  $("#refresh-station").disabled = true;
  state.refreshPreflight = null;
  state.preflightLoading = true;
  renderRefreshPreflight();
  button.innerHTML = `${icon("loader-circle", { className: "icon spin" })}<span>正在刷新</span>`;
  lastRefreshSummary = null;
  try {
    const data = await callService("REFRESH_ALL", { preflightToken: preflight.token, confirmed: true });
    lastRefreshSummary = data.refreshSummary;
    render(data);
    toast(formatRefreshSummary(lastRefreshSummary));
  } catch (error) {
    const channelLost = /message port closed|Could not establish connection|Receiving end does not exist/i.test(error.message || "");
    toast(channelLost ? "刷新已完成，正在同步最新结果" : error.message);
    if (error.code === "REFRESH_CONFIRMATION_REQUIRED") {
      await callService("CANCEL_REFRESH_PREFLIGHT").catch(() => {});
      state.refreshPreflight = null;
    }
  } finally {
    state.preflightLoading = false;
    $("#refresh-all").disabled = false;
    $("#refresh-station").disabled = false;
    button.innerHTML = `${icon("check", { className: "icon" })}<span>确认开始刷新全部</span>`;
    updateRefreshStationButton();
    // 采集数据在 service worker 里已经落库，响应可能因为长任务丢包，这里统一再同步一次。
    await load();
    renderRefreshPreflight();
  }
});

$("#cancel-refresh-preflight").addEventListener("click", async () => {
  try {
    await callService("CANCEL_REFRESH_PREFLIGHT");
    state.refreshPreflight = null;
    renderRefreshPreflight();
  } catch (error) { toast(error.message); }
});

$("#fetch-references").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try { render(await callService("FETCH_REFERENCES")); toast("官方参考价已更新"); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});

$("#checkin-refresh").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try { render(await callService("CHECKIN_STATUS", {})); toast("签到状态已刷新"); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});

document.addEventListener("click", async event => {
  const installButton = event.target.closest("[data-checkin-action='install']");
  if (installButton) {
    openSettingsView("installed");
    return;
  }
  const claimButton = event.target.closest("[data-checkin-action='claim']");
  if (!claimButton) return;
  const stationId = claimButton.dataset.stationId;
  claimButton.disabled = true;
  claimButton.innerHTML = `${icon("loader-circle", { className: "icon spin" })}<span>签到中</span>`;
  try {
    const data = await callService("CHECKIN_NOW", { stationId });
    const result = (data.results || [])[0];
    if (result?.error) throw new Error(result.error);
    toast(result?.message || "签到完成");
    render(await callService("GET_DASHBOARD"));
  } catch (error) {
    toast(error.message || "签到失败");
    render(await callService("GET_DASHBOARD"));
  } finally {
    claimButton.disabled = false;
    claimButton.innerHTML = `${icon("sparkles", { className: "icon" })}<span>立即签到</span>`;
  }
});

document.addEventListener("change", async event => {
  const toggle = event.target.closest("[data-checkin-action='auto']");
  if (!toggle) return;
  try {
    await callService("SAVE_CHECKIN", { stationId: toggle.dataset.stationId, autoEnabled: toggle.checked });
    toast(toggle.checked ? "已开启自动签到（每 4 小时检查）" : "已关闭自动签到");
  } catch (error) {
    toast(error.message || "保存失败");
    toggle.checked = !toggle.checked;
  }
});

hydrateIcons();
// 价格明细表的标题行已移除，只剩筛选面板参与折叠。
initCardCollapse("dashboard");
initTopMenu("refresh-station-menu");
initTopMenu("checkin-menu");
// 设置抽屉：顶栏齿轮就地打开站点与设置，不再跳到独立的设置页
const settingsLayer = $("#settings-layer");
const settingsFrame = $("#settings-frame");
const settingsTrigger = $("#open-settings");
let settingsReloadToken = 0;
let settingsDirty = false;
function openSettingsView(view = "installed") {
  if (!settingsLayer || !settingsFrame) return;
  const src = `options.html?embed=1${settingsDirty ? `&r=${++settingsReloadToken}` : ""}#${view}`;
  if (settingsFrame.getAttribute("src") !== src) settingsFrame.setAttribute("src", src);
  settingsLayer.hidden = false;
  settingsTrigger?.setAttribute("aria-expanded", "true");
  $("#close-settings")?.focus();
}
function closeSettingsView() {
  if (!settingsLayer || settingsLayer.hidden) return;
  settingsLayer.hidden = true;
  settingsTrigger?.setAttribute("aria-expanded", "false");
  settingsTrigger?.focus();
}
settingsTrigger?.addEventListener("click", () => {
  if (settingsLayer && !settingsLayer.hidden) closeSettingsView();
  else openSettingsView();
});
for (const trigger of document.querySelectorAll("[data-open-settings]")) {
  trigger.addEventListener("click", () => openSettingsView(trigger.dataset.openSettings || "installed"));
}
settingsLayer?.addEventListener("click", event => {
  if (event.target.closest("[data-close-settings]")) closeSettingsView();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && settingsLayer && !settingsLayer.hidden) closeSettingsView();
});
// 设置页自己落库：抽屉里改过就先标脏，关掉抽屉再重拉仪表盘
window.addEventListener("message", event => {
  if (event.origin !== location.origin || event.data?.type !== "MODEL_ATLAS_SETTINGS_SAVED") return;
  settingsDirty = true;
  settingsStale = true;
});
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === "REFERENCES_REFRESHING") state.refreshInProgress = Boolean(message.active);
});
onRefreshProgress(renderRefreshProgress);
load();


document.addEventListener("visibilitychange", () => {
  if (!document.hidden) load();
});
// 设置页会自己落库，抽屉里每改一下就重拉一次仪表盘太费；标脏，等抽屉关掉再拉。
let settingsStale = false;
if (settingsStale) {
    settingsStale = false;
    settingsDirty = false;
    load();
  }
