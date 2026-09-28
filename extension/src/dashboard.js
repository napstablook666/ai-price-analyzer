import { flattenComparisonRows } from "./core/pricing.js";
import { callService, escapeHtml, formatMoney, hydrateIcons, icon } from "./shared/ui.js";
import { currentSiteOrigin, DEFAULT_EXCHANGE_RATE } from "./shared/schema.js";

const state = { data: null, rows: [], reference: null, filters: { search: "", stationId: "", provider: null, group: null, showUnmatched: true, showStale: true, sortBy: "groupName", sortSecondary: "recommendationScore", sortDirection: "desc" } };
const $ = selector => document.querySelector(selector);


function renderProviderSwitchers(settings) {
  for (const kind of ["llm", "jev"]) {
    const select = $(`#${kind}-provider-switch`);
    const profiles = settings?.providerProfiles?.[kind] || [];
    const activeId = settings?.activeProviders?.[kind] || "";
    select.innerHTML = `<option value="">未保存档案</option>${profiles.map(profile => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name || profile.baseUrl || profile.id)}</option>`).join("")}`;
    select.value = activeId;
    select.disabled = !profiles.length;
  }
}
function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, 3600);
}

function formatPrice(value, currency = "CNY") {
  const number = Number(value);
  if (value === null || value === undefined || Number.isNaN(number)) return "—";
  const rate = Number(state.data?.references?.exchangeRate) || DEFAULT_EXCHANGE_RATE;
  const displayValue = currency === "USD" ? number / rate : number;
  return formatMoney(displayValue, currency === "USD" ? "$" : "¥");
}

function rowMatches(row) {
  const query = state.filters.search.trim().toLowerCase();
  const haystack = [row.displayName, row.modelName, row.stationName, row.groupName, row.officialName, row.provider].join(" ").toLowerCase();
  if (query && !haystack.includes(query)) return false;
  if (state.filters.stationId && row.stationId !== state.filters.stationId) return false;
  if (Array.isArray(state.filters.provider) && !state.filters.provider.includes(row.provider)) return false;
  if (Array.isArray(state.filters.group) && !state.filters.group.includes(row.groupName)) return false;
  if (!state.filters.showUnmatched && !row.officialName) return false;
  if (!state.filters.showStale && row.stale) return false;
  return true;
}

function statusMarkup(row) {
  if (row.stale) return `<span class="status-tag warning">${icon("clock-3", { className: "icon" })}过期</span>`;
  if (!row.officialName) return `<span class="status-tag muted">${icon("circle-help", { className: "icon" })}未匹配</span>`;
  if (row.evidence === "estimated") return `<span class="status-tag warning">${icon("calculator", { className: "icon" })}估算</span>`;
  return `<span class="status-tag">${icon("badge-check", { className: "icon" })}已校准</span>`;
}

function stationFor(row) {
  return state.data?.stations?.find(station => station.id === row.stationId) || {};
}

function renderSummary(rows) {
  const matched = rows.filter(row => row.officialName);
  const prices = matched.filter(row => Number.isFinite(row.dailyCost)).map(row => row.dailyCost);
  const cheapest = prices.length ? Math.min(...prices) : null;
  const stationCount = (state.data?.stations || []).filter(station => station.enabled).length;
  $("#summary").innerHTML = [
    ["报价总数", String(rows.length), "当前缓存的有效报价"],
    ["已匹配", String(matched.length), `${rows.length ? Math.round(matched.length / rows.length * 100) : 0}% 可比较`],
    ["参与站点", String(stationCount), "来自已启用配置"],
    ["最低日成本", formatPrice(cheapest, state.data?.settings?.defaultCurrency), "按当前用量估算"]
  ].map(([label, value, note]) => `<article class="summary-card"><span class="summary-label">${label}</span><strong class="summary-value">${escapeHtml(value)}</strong><span class="summary-note">${escapeHtml(note)}</span></article>`).join("");
}

function renderStationFilter(rows) {
  const select = $("#station-filter");
  const current = state.filters.stationId;
  const stations = [...new Map(rows.map(row => [row.stationId, row.stationName])).entries()];
  select.innerHTML = `<option value="">全部中转站</option>${stations.map(([id, name]) => `<option value="${escapeHtml(id)}"${id === current ? " selected" : ""}>${escapeHtml(name)}</option>`).join("")}`;
}
function renderFacetFilters(rows) {
  for (const key of ["provider", "group"]) {
    const container = $(`#${key}-filters`);
    const values = [...new Set(rows.map(row => row[key === "provider" ? "provider" : "groupName"]).filter(Boolean))].sort();
    const selected = state.filters[key] === null ? new Set(values) : new Set(state.filters[key]);
    container.innerHTML = values.length
      ? values.map(value => `<label class="facet-option"><input type="checkbox" data-facet-key="${key}" value="${escapeHtml(value)}"${selected.has(value) ? " checked" : ""}><span>${escapeHtml(value)}</span></label>`).join("")
      : `<span class="facet-empty">暂无可选项</span>`;
  }
}

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
function renderRows() {
  const currency = state.data?.settings?.defaultCurrency || "CNY";
  const visible = sortRows(state.rows.filter(rowMatches));
  $("#result-count").textContent = `${visible.length} 条报价`;
  $("#comparison-body").innerHTML = visible.map(row => {
    const prices = row.prices || {};
    const station = stationFor(row);
    const delta = row.diffPercent;
    return `<tr>
      <td><div class="model-cell"><span class="model-name">${escapeHtml(row.displayName || row.modelName)}</span><span class="model-meta">${row.officialName ? `官方匹配：${escapeHtml(row.officialName)}` : "没有对应的官方目录记录"}</span></div></td>
      <td><div class="station-cell"><span class="station-name"><span class="status-dot ${station.enabled ? "is-live" : ""}"></span>${escapeHtml(row.stationName)}</span><span class="station-meta">${escapeHtml(row.groupName || row.provider || "未分组")}${row.tierName && row.tierName !== "标准" ? ` · ${escapeHtml(row.tierName)}` : ""}</span></div></td>
      <td class="price-cell"><strong>${formatPrice(prices.input, currency)}</strong><span class="model-meta">官方 ${formatPrice(row.officialPrices?.input, currency)}</span><span class="model-meta">缓存读 ${formatPrice(prices.cacheRead ?? prices.input, currency)}${prices.cacheRead === null || prices.cacheRead === undefined ? "（估算）" : ""}</span>${row.evidence === "estimated" ? `<span class="estimate-tag">推导</span>` : ""}</td>
      <td class="price-cell"><strong>${formatPrice(prices.output, currency)}</strong><span class="model-meta">官方 ${formatPrice(row.officialPrices?.output, currency)}</span><span class="model-meta">缓存写 ${formatPrice(prices.cacheWrite ?? prices.input, currency)}${prices.cacheWrite === null || prices.cacheWrite === undefined ? "（估算）" : ""}</span><span class="model-meta">按次 ${formatPrice(prices.request, currency)}</span></td>
      <td class="price-cell">${prices.imageOutput !== null && prices.imageOutput !== undefined ? `<span class="model-meta">图 tokens ${formatPrice(prices.imageOutput, currency)}</span>` : ""}${prices.imagePrice !== null && prices.imagePrice !== undefined ? `<span class="model-meta">按张 ${formatPrice(prices.imagePrice, currency)}</span>` : ""}${prices.imageOutput === null && prices.imageOutput === undefined && prices.imagePrice === null && prices.imagePrice === undefined ? "—" : ""}</td>
      <td class="price-cell"><strong>${formatPrice(row.dailyCost, currency)}</strong><span class="model-meta"> / 天</span></td>
      <td>${delta === null || delta === undefined ? `<span class="delta-tag neutral">—</span>` : `<span class="delta-tag ${delta > 10 ? "expensive" : ""}">${delta > 0 ? "+" : ""}${Math.round(delta)}%</span>`}</td>
      <td><span class="recommendation-tag ${row.recommended ? "is-best" : ""}">${escapeHtml(row.recommendationLabel || "—")}</span>${Number.isFinite(row.recommendationScore) ? `<span class="model-meta">${row.recommendationScore} 分</span>` : ""}</td>
      <td>${statusMarkup(row)}</td>
      <td><button class="icon-button row-action" title="查看站点" aria-label="查看站点" data-focus-station="${escapeHtml(row.stationId)}">${icon("arrow-up-right", { className: "icon" })}</button></td>
    </tr>`;
  }).join("");
  $("#empty-state").hidden = visible.length > 0;
  $(".table-wrap").hidden = visible.length === 0;
  hydrateIcons($("#comparison-body"));
}

function renderReferenceStatus() {
  const ref = state.reference;
  if (!ref) return;
  $("#reference-status").textContent = ref.models?.length ? `官方参考价已加载 · ${ref.models.length} 个模型` : "官方参考价未加载";
  $("#reference-note").textContent = ref.fetchedAt ? `最近更新 ${new Date(ref.fetchedAt).toLocaleString("zh-CN", { hour12: false })}；${ref.warnings?.length ? ref.warnings.join("；") : "OpenRouter 模型目录与中国银行美元汇率"}` : "OpenRouter 模型目录与中国银行美元汇率会每日缓存，可在上方手动更新。";
}

function render(data) {
  state.data = data;
  state.rows = flattenComparisonRows(data.comparisons || []);
  renderProviderSwitchers(data.settings);
  state.reference = data.references;
  state.filters.showUnmatched = Boolean(data.settings?.showUnmatched);
  state.filters.showStale = data.settings?.showStale !== false;
  $("#show-unmatched").checked = state.filters.showUnmatched;
  $("#show-stale").checked = state.filters.showStale;
  renderSummary(state.rows);
  renderStationFilter(state.rows);
  renderFacetFilters(state.rows);
  $("#sort-by").value = state.filters.sortBy;
  $("#sort-secondary").value = state.filters.sortSecondary;
  $("#sort-direction").value = state.filters.sortDirection;
  renderRows();
  const hasStations = (data.stations || []).length > 0;
  const emptyState = $("#empty-state");
  emptyState.querySelector("h3").textContent = hasStations ? "站点已保存，尚未采集报价" : "还没有可比较的报价";
  emptyState.querySelector("p").textContent = hasStations ? "点击上方“刷新全部”开始采集价格。" : "先添加一个中转站，再刷新采集价格。";
  emptyState.querySelector("a span:last-child").textContent = hasStations ? "管理站点" : "添加第一个站点";
  renderReferenceStatus();
  $("#last-updated").textContent = data.snapshots?.[0]?.collectedAt ? `更新于 ${new Date(data.snapshots[0].collectedAt).toLocaleTimeString("zh-CN", { hour12: false })}` : "尚未刷新";
  $("#connection-dot").classList.toggle("is-live", state.rows.length > 0);
  hydrateIcons();
}
function configureCurrentSiteAction() {
  const params = new URLSearchParams(location.search);
  const siteOrigin = currentSiteOrigin(params.get("siteOrigin"));
  if (!siteOrigin) return;
  const target = new URL(chrome.runtime.getURL("options.html"));
  target.searchParams.set("addSite", siteOrigin);
  const sourceTabId = params.get("sourceTabId");
  if (/^\d+$/.test(sourceTabId || "")) target.searchParams.set("sourceTabId", sourceTabId);
  const link = $("#add-current-site");
  link.href = target.toString();
  link.hidden = false;
}

async function load() {
  try { render(await callService("GET_DASHBOARD")); }
  catch (error) { toast(error.message); }
}

async function switchDashboardProvider(kind, select) {
  if (!select.value) return;
  select.disabled = true;
  try {
    render(await callService("SWITCH_PROVIDER", { kind, profileId: select.value }));
    toast(`已切换 ${kind === "jev" ? "JEV" : "LLM"} 供应商`);
  } catch (error) {
    select.disabled = false;
    toast(error.message);
  }
}
["llm", "jev"].forEach(kind => {
  $(`#${kind}-provider-switch`).addEventListener("change", event => switchDashboardProvider(kind, event.currentTarget));
});

$("#search").addEventListener("input", event => { state.filters.search = event.target.value; renderRows(); });
$("#station-filter").addEventListener("change", event => { state.filters.stationId = event.target.value; renderRows(); });
document.addEventListener("change", event => {
  const input = event.target.closest("input[data-facet-key]");
  if (!input) return;
  const key = input.dataset.facetKey;
  state.filters[key] = [...document.querySelectorAll(`#${key}-filters input[data-facet-key]:checked`)].map(option => option.value);
  renderRows();
});
document.addEventListener("click", event => {
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
  state.filters = { search: "", stationId: "", provider: null, group: null, showUnmatched: true, showStale: true, sortBy: "groupName", sortSecondary: "recommendationScore", sortDirection: "desc" };
  $("#search").value = "";
  $("#station-filter").value = "";
  $("#sort-by").value = "groupName";
  $("#sort-secondary").value = "recommendationScore";
  $("#sort-direction").value = "desc";
  $("#show-unmatched").checked = true;
  $("#show-stale").checked = true;
  renderFacetFilters(state.rows);
  renderRows();
});
$("#show-unmatched").addEventListener("change", event => { state.filters.showUnmatched = event.target.checked; renderRows(); });
$("#show-stale").addEventListener("change", event => { state.filters.showStale = event.target.checked; renderRows(); });
$("#comparison-body").addEventListener("click", event => {
  const button = event.target.closest("[data-focus-station]");
  if (!button) return;
  state.filters.stationId = button.dataset.focusStation;
  $("#station-filter").value = state.filters.stationId;
  renderRows();
});

$("#refresh-all").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  button.innerHTML = `${icon("loader-circle", { className: "icon spin" })}<span>刷新中</span>`;
  try { render(await callService("REFRESH_ALL")); toast("全部站点已刷新"); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; button.innerHTML = `${icon("refresh-cw", { className: "icon" })}<span>刷新全部</span>`; }
});

$("#fetch-references").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try { render(await callService("FETCH_REFERENCES")); toast("官方参考价已更新"); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});

hydrateIcons();
configureCurrentSiteAction();
load();

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) load();
});
