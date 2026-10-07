import { flattenComparisonRows } from "./core/pricing.js";
import { buildJevComparisonTask, getJevModelBatchTargets, JEV_COMPARISON_LABELS, JEV_NO_MATCH } from "./core/jev-tasks.js";
import { getJevModelCandidates } from "./core/matching.js";
import { callService, escapeHtml, formatMoney, hydrateIcons, icon, onRefreshProgress } from "./shared/ui.js";
import { createDashboardIndex, matchesModelQueries, paginateRows } from "./dashboard-index.js";
import { initCollapsibleCards } from "./shared/collapse.js";
import { DEFAULT_EXCHANGE_RATE } from "./shared/schema.js";

const DEFAULT_PROVIDER_FILTER = ["anthropic", "deepseek", "openai", "z-ai"];
const PAGE_SIZE = 20;
const JEV_AUTO_MATCH_CONFIDENCE = 0.5;
const state = { data: null, rows: [], page: 0, searchTextByRow: new WeakMap(), modelTextByRow: new WeakMap(), stationById: new Map(), reference: null, jevResults: new Map(), jevPending: new Set(), jevIgnored: new Set(), jevBatchRunning: false, jevBatchControlStates: new Map(), refreshInProgress: false, filters: { search: "", stationId: "", provider: DEFAULT_PROVIDER_FILTER, group: null, models: [], showUnmatched: true, showStale: true, sortBy: "dailyCost", sortSecondary: "recommendationScore", sortDirection: "asc" } };
const $ = selector => document.querySelector(selector);
let lastRefreshSummary = null;
let pageFilterKey = null;
const refreshRows = new Map();
const RATING_LABELS = { excellent: "神价", good: "折扣", fair: "公道", bad: "溢价" };


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

function formatPrice(value, currency = "CNY", precision = 4) {
  const number = Number(value);
  if (value === null || value === undefined || !Number.isFinite(number)) return "—";
  const rate = Number(state.data?.references?.exchangeRate) || DEFAULT_EXCHANGE_RATE;
  const displayValue = currency === "USD" ? number / rate : number;
  const symbol = currency === "USD" ? "$" : "¥";
  return precision === 4 ? formatMoney(displayValue, symbol) : `${symbol}${displayValue.toFixed(precision)}`;
}

function rowMatches(row, query) {
  if (query && !state.searchTextByRow.get(row).includes(query)) return false;
  if (!matchesModelQueries(state.modelTextByRow.get(row), state.filters.models)) return false;
  if (state.filters.stationId && row.stationId !== state.filters.stationId) return false;
  if (Array.isArray(state.filters.provider) && !state.filters.provider.includes(row.provider)) return false;
  if (Array.isArray(state.filters.group) && !state.filters.group.includes(row.groupName)) return false;
  if (!state.filters.showUnmatched && !row.officialName) return false;
  if (!state.filters.showStale && row.stale) return false;
  return true;
}

function statusMarkup(row) {
  const tags = [];
  if (row.stale) tags.push(`<span class="status-tag warning">${icon("clock-3", { className: "icon" })}过期</span>`);
  if (!row.officialName) tags.push(`<span class="status-tag muted">${icon("circle-help", { className: "icon" })}未匹配</span>`);
  if (row.evidence === "estimated") tags.push(`<span class="status-tag warning">${icon("calculator", { className: "icon" })}价格推导</span>`);
  if (!tags.length) tags.push(`<span class="status-tag">${icon("badge-check", { className: "icon" })}已校准</span>`);
  return `<div class="status-cluster">${tags.join("")}</div>`;
}

function stationFor(row) {
  return state.stationById.get(row.stationId) || {};
}

function renderSummary(rows) {
  const matched = rows.filter(row => row.officialName);
  const recommended = rows.filter(row => row.recommended).length;
  const needsReview = rows.filter(row => !row.officialName || row.evidence === "estimated" || row.stale).length;
  const modelCount = new Set(rows.map(row => row.canonicalModel)).size;
  const stationCount = (state.data?.stations || []).filter(station => station.enabled).length;
  const matchRate = rows.length ? Math.round(matched.length / rows.length * 100) : 0;
  $("#summary").innerHTML = [
    ["覆盖模型", String(modelCount), `${rows.length} 条报价 · ${stationCount} 个启用站点`],
    ["官方匹配", String(matched.length), `${matchRate}% 有官方参考价`],
    ["首选方案", String(recommended), "同一模型内的推荐报价"],
    ["需核验", String(needsReview), "未匹配、推导或过期数据"]
  ].map(([label, value, note]) => `<article class="summary-card"><span class="summary-label">${label}</span><strong class="summary-value">${escapeHtml(value)}</strong><span class="summary-note">${escapeHtml(note)}</span></article>`).join("");
}
function renderStationFilter(rows) {
  const current = state.filters.stationId;
  const stationsById = new Map((state.data?.stations || []).map(station => [station.id, station.name]));
  for (const row of rows) if (!stationsById.has(row.stationId)) stationsById.set(row.stationId, row.stationName);
  const stations = [...stationsById.entries()];
  const selectedName = stations.find(([id]) => id === current)?.[1];
  $("#station-filter-label").textContent = selectedName || "全部中转站";
  $("#station-filters").innerHTML = `<label class="facet-option"><input type="radio" name="station-filter" data-station-filter value=""${current ? "" : " checked"}><span>全部中转站</span></label>${stations.map(([id, name]) => `<label class="facet-option"><input type="radio" name="station-filter" data-station-filter value="${escapeHtml(id)}"${id === current ? " checked" : ""}><span>${escapeHtml(name)}</span></label>`).join("")}<span class="facet-empty" data-no-matches hidden>无匹配项</span>`;
  filterFacetOptions("station");
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
  for (const key of ["provider", "group"]) {
    const container = $(`#${key}-filters`);
    const values = [...new Set(rows.map(row => row[key === "provider" ? "provider" : "groupName"]).filter(Boolean))].sort();
    const selected = state.filters[key] === null ? new Set(values) : new Set(state.filters[key]);
    container.innerHTML = values.length
      ? `${values.map(value => `<label class="facet-option"><input type="checkbox" data-facet-key="${key}" value="${escapeHtml(value)}"${selected.has(value) ? " checked" : ""}><span>${escapeHtml(value)}</span></label>`).join("")}<span class="facet-empty" data-no-matches hidden>无匹配项</span>`
      : `<span class="facet-empty">暂无可选项</span>`;
    filterFacetOptions(key);
  }
}

const MODEL_FILTER_BOXES = 4;
function updateModelFilterLabel() {
  const count = state.filters.models.filter(query => query.trim()).length;
  $("#model-filter-label").textContent = count ? `模型对比 · ${count}` : "模型对比";
}
function renderModelFilter() {
  const queries = state.filters.models;
  const boxes = Array.from({ length: MODEL_FILTER_BOXES }, (_, index) => queries[index] || "");
  $("#model-filter-inputs").innerHTML = boxes.map((value, index) => `<input class="facet-search model-filter-input" type="search" data-model-filter="${index}" value="${escapeHtml(value)}" placeholder="模型 ${index + 1}" autocomplete="off" aria-label="模型对比 ${index + 1}">`).join("");
  updateModelFilterLabel();
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
function unitPricesMarkup(prices, currency, row, official = false) {
  if (!prices) return `<span class="price-empty">${official ? (row.officialName ? "官方价格未收录" : "无官方匹配价") : "中转价格未收录"}</span>`;
  const readEstimated = official ? prices.cacheRead === null || prices.cacheRead === undefined : row.cacheReadEstimated;
  const writeEstimated = official ? prices.cacheWrite === null || prices.cacheWrite === undefined : row.cacheWriteEstimated;
  const lines = [
    ["输入", prices.input, false],
    ["输出", prices.output, false],
    [`缓存读${readEstimated ? "（估算）" : ""}`, prices.cacheRead ?? prices.input, false],
    [`缓存写${writeEstimated ? "（估算）" : ""}`, prices.cacheWrite ?? prices.input, false],
    ...(prices.request === null || prices.request === undefined ? [] : [["按次", prices.request, false]]),
    ...(prices.imageOutput === null || prices.imageOutput === undefined ? [] : [["图 token", prices.imageOutput, true]]),
    ...(prices.imagePrice === null || prices.imagePrice === undefined ? [] : [["图 / 张", prices.imagePrice, true]])
  ];
  return `<div class="price-lines">${lines.filter(([, value]) => value !== null && value !== undefined).map(([label, value, precise], index) => `<div class="price-line${index < 2 ? " price-line-primary" : ""}"><span class="price-key">${label}</span><span class="price-value">${formatPrice(value, currency, precise ? 6 : 4)}</span></div>`).join("")}</div>`;
}

function jevResultKey(task, row) {
  const identity = [task, row.stationId, row.modelName];
  if (task === "comparison_review") identity.push(row.groupName, row.tierName, row.officialName);
  return JSON.stringify(identity);
}

function activeJevProfile() {
  const settings = state.data?.settings;
  return settings?.providerProfiles?.jev?.find(profile => profile.id === settings.activeProviders?.jev) || settings?.jev || {};
}

function jevRequestPayload(task, row) {
  const settings = state.data?.settings || {};
  const profile = activeJevProfile();
  return {
    task,
    stationId: row.stationId,
    modelName: row.modelName,
    groupName: row.groupName || "",
    tierName: row.tierName || "",
    officialName: row.officialName || "",
    collectedAt: Number(row.collectedAt),
    referencesFetchedAt: state.data?.references?.fetchedAt ?? null,
    jevProfileId: settings.activeProviders?.jev,
    jevBaseUrl: profile.baseUrl,
    jevModelId: profile.modelId
  };
}

function setBatchJevButton(running, current = 0, total = 0) {
  const button = $("#batch-jev-match");
  if (!button) return;
  button.disabled = running;
  const label = running ? `JEV 核验模型匹配 ${current}/${total}` : "批量 JEV 核验模型匹配 ≥50%";
  button.innerHTML = `${icon(running ? "loader-circle" : "sparkles", { className: running ? "icon spin" : "icon" })}<span>${label}</span>`;
  setBatchControlsLocked(running);
}

function setBatchControlsLocked(locked) {
  if (locked) {
    for (const selector of ["#refresh-all", "#refresh-station", "#fetch-references", "#llm-provider-switch", "#jev-provider-switch"]) {
      const element = $(selector);
      if (!element) continue;
      if (!state.jevBatchControlStates.has(element)) state.jevBatchControlStates.set(element, element.disabled);
      element.disabled = true;
    }
    return;
  }
  for (const [element, wasDisabled] of state.jevBatchControlStates) element.disabled = wasDisabled;
  state.jevBatchControlStates.clear();
}

async function analyzeJev(task, row) {
  return callService("ANALYZE_JEV", jevRequestPayload(task, row));
}

async function saveJevModelMatch(row, result) {
  return callService("SAVE_JEV_MODEL_MATCH", {
    stationId: row.stationId,
    modelName: row.modelName,
    officialModelId: result.choice,
    collectedAt: result.collectedAt,
    referencesFetchedAt: result.referencesFetchedAt,
    jevProfileId: result.jevProfileId,
    jevBaseUrl: result.jevBaseUrl,
    jevModelId: result.jevModelId,
    candidateIds: result.candidateIds
  });
}

function jevResultFor(task, row) {
  const result = state.jevResults.get(jevResultKey(task, row));
  const settings = state.data?.settings;
  const activeJev = activeJevProfile();
  if (Number(result?.collectedAt) !== Number(row.collectedAt) || result?.jevProfileId !== settings?.activeProviders?.jev || result?.jevBaseUrl !== activeJev.baseUrl || result?.jevModelId !== activeJev.modelId || result?.referencesFetchedAt !== (state.data?.references?.fetchedAt ?? null)) return null;
  if (task === "comparison_review" && JSON.stringify(result.taskState) !== JSON.stringify(buildJevComparisonTask(row).state)) return null;
  if (task === "model_match") {
    const candidateIds = getJevModelCandidates(row.modelName, state.data?.references?.models || [], settings?.matchingRules).candidates.map(model => String(model.id || model.name)).sort();
    if (JSON.stringify(result.candidateIds) !== JSON.stringify(candidateIds)) return null;
  }
  return result;
}

function jevActionButton(task, row, label) {
  const config = activeJevProfile();
  if (!config.baseUrl || !config.modelId || !config.hasApiKey) return `<a class="jev-config-link" href="options.html">配置 JEV</a>`;
  const key = jevResultKey(task, row);
  const pending = state.jevPending.has(key);
  const locked = pending || state.jevBatchRunning;
  const shownLabel = pending ? "判断中" : state.jevBatchRunning && task === "model_match" ? "批量核验中" : state.jevIgnored.has(key) ? "再次建议" : label;
  return `<button class="jev-action" type="button" data-jev-action="analyze" data-jev-task="${escapeHtml(task)}" data-station-id="${escapeHtml(row.stationId)}" data-model-name="${escapeHtml(row.modelName)}" data-group-name="${escapeHtml(row.groupName || "")}" data-tier-name="${escapeHtml(row.tierName || "")}" data-official-name="${escapeHtml(row.officialName || "")}" data-collected-at="${escapeHtml(row.collectedAt || "")}" aria-label="${escapeHtml(shownLabel)}：${escapeHtml(row.displayNameOverride || row.modelName)}"${locked ? " disabled" : ""}${pending ? " aria-busy=\"true\"" : ""}><span class="jev-action-icon" aria-hidden="true">${icon(pending ? "loader-circle" : "sparkles", { className: pending ? "icon spin" : "icon" })}</span><span>${shownLabel}</span></button>`;
}

function modelJevMarkup(row, showAction) {
  if (!showAction) return "";
  if (row.matchRuleId === "manual") return `<div class="jev-assist"><span class="jev-result" role="status">人工确认匹配</span><button class="jev-icon-action" type="button" data-jev-action="remove"${state.jevBatchRunning ? " disabled" : ""} data-station-id="${escapeHtml(row.stationId)}" data-model-name="${escapeHtml(row.modelName)}" title="取消人工匹配" aria-label="取消 ${escapeHtml(row.modelName)} 的人工匹配">${icon("x", { className: "icon" })}</button></div>`;
  const result = jevResultFor("model_match", row);
  if (!result) return `<div class="jev-assist">${jevActionButton("model_match", row, "JEV 核验")}</div>`;
  const confidence = `${Math.round(result.confidence * 100)}%`;
  const locked = state.jevBatchRunning || state.jevPending.has(jevResultKey("model_match", row));
  if (result.choice === JEV_NO_MATCH) return `<div class="jev-assist"><span class="jev-result" role="status">JEV 未确认官方匹配 · ${confidence}</span><button class="jev-icon-action" type="button" data-jev-action="ignore"${locked ? " disabled" : ""} data-jev-task="model_match" data-station-id="${escapeHtml(row.stationId)}" data-model-name="${escapeHtml(row.modelName)}" title="忽略此核验结果" aria-label="忽略 ${escapeHtml(row.modelName)} 的 JEV 核验结果">${icon("x", { className: "icon" })}</button>${jevActionButton("model_match", row, "重新核验")}</div>`;
  const model = state.reference?.models?.find(item => (item.id || item.name) === result.choice);
  const name = model?.name || result.choice;
  return `<div class="jev-assist"><span class="jev-result" role="status">JEV 核验建议 ${escapeHtml(name)} · ${confidence}</span><button class="jev-action" type="button" data-jev-action="apply"${locked ? " disabled" : ""} data-station-id="${escapeHtml(row.stationId)}" data-model-name="${escapeHtml(row.modelName)}" data-collected-at="${escapeHtml(row.collectedAt || "")}" aria-label="确认 ${escapeHtml(row.modelName)} 匹配到 ${escapeHtml(name)}"><span class="jev-action-icon" aria-hidden="true">${icon("check", { className: "icon" })}</span><span>确认匹配</span></button><button class="jev-icon-action" type="button" data-jev-action="ignore"${locked ? " disabled" : ""} data-jev-task="model_match" data-station-id="${escapeHtml(row.stationId)}" data-model-name="${escapeHtml(row.modelName)}" title="忽略此核验结果" aria-label="忽略 ${escapeHtml(row.modelName)} 的 JEV 核验结果">${icon("x", { className: "icon" })}</button></div>`;
}

function comparisonJevMarkup(row) {
  if (!row.officialName) return "";
  const result = jevResultFor("comparison_review", row);
  const label = result ? JEV_COMPARISON_LABELS[result.choice] || result.choice : "";
  const note = result ? `<span class="jev-result" role="status">JEV 复核：${escapeHtml(label)} · ${Math.round(result.confidence * 100)}%</span>` : "";
  return `<div class="jev-assist">${note}${jevActionButton("comparison_review", row, result ? "重新复核" : "JEV 复核")}</div>`;
}


function renderRows() {
  const currency = state.data?.settings?.defaultCurrency || "CNY";
  const query = state.filters.search.trim().toLowerCase();
  const filterKey = JSON.stringify([state.filters.search, state.filters.stationId, state.filters.provider, state.filters.group, state.filters.models, state.filters.showUnmatched, state.filters.showStale, state.filters.sortBy, state.filters.sortSecondary, state.filters.sortDirection]);
  if (pageFilterKey !== null && pageFilterKey !== filterKey) state.page = 0;
  pageFilterKey = filterKey;
  const filtered = sortRows(state.rows.filter(row => rowMatches(row, query)));
  const page = paginateRows(filtered, state.page, Number($("#page-size").value) || PAGE_SIZE);
  state.page = page.page;
  const visible = page.rows;
  const pagination = $("#comparison-pagination");
  pagination.hidden = filtered.length === 0;
  $("#comparison-page").textContent = page.pageCount ? `第 ${page.page + 1} / ${page.pageCount} 页` : "";
  $("#comparison-previous").disabled = page.page === 0;
  $("#comparison-next").disabled = page.page + 1 >= page.pageCount;
  $("#result-count").textContent = `${filtered.length} 条报价`;
  const seenModelAssists = new Set();
  $("#comparison-body").innerHTML = visible.map(row => {
    const station = stationFor(row);
    const delta = Number.isFinite(row.diffPercent) ? row.diffPercent : null;
    const deltaClass = delta === null || Math.abs(delta) < 0.005 ? "neutral" : delta < 0 ? "cheaper" : "expensive";
    const deltaLabel = delta === null ? "无官方价" : Math.abs(delta) < 0.005 ? "持平" : `${delta < 0 ? "低" : "高"} ${Number(Math.abs(delta).toFixed(2))}%`;
    const score = Number.isFinite(row.recommendationScore) ? `${row.recommendationScore}分` : "暂无评分";
    const rating = RATING_LABELS[row.category] || "";
    const dailyCost = formatPrice(row.dailyCost, currency);
    const hasOfficialCost = Number.isFinite(row.officialDailyCost);
    const dailyDifference = hasOfficialCost ? row.officialDailyCost - row.dailyCost : null;
    const modelName = row.displayNameOverride || row.modelName || row.displayName;
    const matchNote = row.officialName
      ? `匹配 ${row.officialName} · ${row.matchRule || "官方目录"} · 置信 ${row.confidenceScore}%`
      : "没有对应的官方目录记录";
    const modelAssistKey = JSON.stringify([row.stationId, row.modelName]);
    const needsModelAssist = row.matchRuleId === "manual" || row.matchCandidateCount !== 1 || row.matchConfidence < 1;
    const showModelAssist = needsModelAssist && !seenModelAssists.has(modelAssistKey);
    if (showModelAssist) seenModelAssists.add(modelAssistKey);
    return `<tr>
      <td data-label="模型"><div class="model-cell"><div class="model-head"><span class="model-name">${escapeHtml(modelName)}</span>${row.officialName ? `<span class="provider-tag">${escapeHtml(row.provider)}</span>` : ""}</div><span class="model-meta">${escapeHtml(matchNote)}</span>${modelJevMarkup(row, showModelAssist)}</div></td>
      <td data-label="中转站 / 分组"><div class="station-cell"><button class="station-filter-link" type="button" title="筛选此站点" aria-label="筛选站点：${escapeHtml(row.stationName)}" data-focus-station="${escapeHtml(row.stationId)}"><span class="status-dot ${station.enabled ? "is-live" : ""}" aria-hidden="true"></span><span>${escapeHtml(row.stationName)}</span></button><span class="group-tag">${escapeHtml(row.groupName || "未分组")}</span><span class="station-meta">${escapeHtml(row.tierName || "标准")} · 倍率 ×${escapeHtml(row.groupRatio)}</span></div></td>
      <td data-label="中转单价">${unitPricesMarkup(row.prices, currency, row)}</td>
      <td data-label="官方单价">${unitPricesMarkup(row.officialPrices, currency, row, true)}</td>
      <td data-label="24 小时成本"><div class="cost-cell"><strong>${dailyCost}<small> / 天</small></strong><span class="cost-meta">官方 ${hasOfficialCost ? `${formatPrice(row.officialDailyCost, currency)} / 天` : "暂无参考"}</span>${dailyDifference === null ? "" : `<span class="cost-gap ${dailyDifference >= 0 ? "is-saving" : "is-extra"}">${dailyDifference >= 0 ? "日省" : "日多付"} ${formatPrice(Math.abs(dailyDifference), currency)}</span>`}</div></td>
      <td data-label="相对官方"><span class="delta-tag ${deltaClass}">${deltaLabel}</span></td>
      <td data-label="推荐与状态"><div class="recommendation-cell"><span class="recommendation-tag ${row.recommended ? "is-best" : ""}">${escapeHtml(row.recommendationLabel || "—")}</span>${rating ? `<span class="rating-tag rating-${row.category}">${rating}</span>` : ""}<span class="model-meta">${score} · 置信${row.confidenceScore}%</span>${statusMarkup(row)}${comparisonJevMarkup(row)}</div></td>
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

function renderReferenceStatus() {
  const ref = state.reference;
  if (!ref) return;
  $("#reference-status").textContent = ref.models?.length ? `官方参考价已加载 · ${ref.models.length} 个模型` : "官方参考价未加载";
  $("#reference-note").textContent = ref.fetchedAt ? `最近更新 ${new Date(ref.fetchedAt).toLocaleString("zh-CN", { hour12: false })}；${ref.warnings?.length ? ref.warnings.join("；") : "OpenRouter 模型目录与中国银行美元汇率"}` : "OpenRouter 模型目录与中国银行美元汇率会每日缓存，可在上方手动更新。";
}
function renderCheckin(data) {
  const panel = $("#checkin-panel");
  const list = $("#checkin-list");
  const stations = data.checkinStations || [];
  const state = data.checkinState || {};
  if (!stations.length) {
    panel.hidden = false;
    list.innerHTML = `<div class="checkin-empty"><span class="checkin-empty-text">暂无可签到的站点 —— 添加 <strong>vyceai.com</strong> 中转站后，这里会自动出现每日签到入口。</span><a class="button button-quiet" href="options.html"><span data-icon="plus" class="icon"></span><span>去添加站点</span></a></div>`;
    hydrateIcons(list);
    return;
  }
  panel.hidden = false;
  list.innerHTML = stations.map(station => {
    const record = state[station.id] || {};
    const claimedToday = record.lastStatus === "ok" && !record.lastResult?.includes("可签到");
    const statusText = record.lastStatus === "error" ? record.lastResult || "查询失败" : record.lastResult || "尚未查询";
    const statusClass = record.lastStatus === "error" ? "checkin-status-error" : claimedToday ? "checkin-status-ok" : "checkin-status-idle";
    return `
      <div class="checkin-item" data-station-id="${escapeHtml(station.id)}">
        <div class="checkin-info">
          <strong>${escapeHtml(station.name)}</strong>
          <span class="checkin-meta">连续签到 ${Number(record.streak) || 0} 天 · ${escapeHtml(statusText)}</span>
        </div>
        <div class="checkin-actions">
          <label class="check-label"><input type="checkbox" data-checkin-action="auto" data-station-id="${escapeHtml(station.id)}" ${station.autoEnabled ? "checked" : ""}><span>自动签到</span></label>
          <button class="button button-quiet" type="button" data-checkin-action="claim" data-station-id="${escapeHtml(station.id)}"><span data-icon="sparkles" class="icon"></span><span>立即签到</span></button>
        </div>
      </div>`;
  }).join("");
  hydrateIcons(list);
}

function render(data) {
  state.data = data;
  state.refreshInProgress = Boolean(data.refreshInProgress);
  state.page = 0;
  pageFilterKey = null;
  state.rows = flattenComparisonRows(data.comparisons || []);
  const index = createDashboardIndex(state.rows, data.stations || []);
  state.searchTextByRow = index.searchTextByRow;
  state.modelTextByRow = index.modelTextByRow;
  state.stationById = index.stationById;
  renderProviderSwitchers(data.settings);
  state.reference = data.references;
  state.filters.showUnmatched = Boolean(data.settings?.showUnmatched);
  state.filters.showStale = data.settings?.showStale !== false;
  $("#show-unmatched").checked = state.filters.showUnmatched;
  $("#show-stale").checked = state.filters.showStale;
  renderSummary(state.rows);
  renderStationFilter(state.rows);
  renderFacetFilters(state.rows);
  renderModelFilter();
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
  renderCheckin(data);
  $("#last-updated").textContent = data.snapshots?.[0]?.collectedAt ? `更新于 ${new Date(data.snapshots[0].collectedAt).toLocaleTimeString("zh-CN", { hour12: false })}` : "尚未刷新";
  $("#connection-dot").classList.toggle("is-live", state.rows.length > 0);
  hydrateIcons();
  setBatchControlsLocked(state.jevBatchRunning);
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
    if (kind === "jev") {
      state.jevResults.clear();
      state.jevIgnored.clear();
    }
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
document.addEventListener("click", event => {
  const activeMenu = event.target.closest(".facet-menu");
  for (const menu of document.querySelectorAll(".facet-menu[open]")) {
    if (menu !== activeMenu) menu.open = false;
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
  state.filters = { search: "", stationId: "", provider: DEFAULT_PROVIDER_FILTER, group: null, models: [], showUnmatched: true, showStale: true, sortBy: "dailyCost", sortSecondary: "recommendationScore", sortDirection: "asc" };
  $("#search").value = "";
  renderModelFilter();
  renderStationFilter(state.rows);
  for (const input of document.querySelectorAll("[data-facet-search]")) input.value = "";
  $("#sort-by").value = "dailyCost";
  $("#sort-secondary").value = "recommendationScore";
  $("#sort-direction").value = "asc";
  $("#show-unmatched").checked = true;
  $("#show-stale").checked = true;
  renderFacetFilters(state.rows);
  renderRows();
});
$("#show-unmatched").addEventListener("change", event => { state.filters.showUnmatched = event.target.checked; renderRows(); });
$("#show-stale").addEventListener("change", event => { state.filters.showStale = event.target.checked; renderRows(); });
async function handleJevAction(button) {
  const action = button.dataset.jevAction;
  const task = button.dataset.jevTask || "model_match";
  const row = { stationId: button.dataset.stationId, modelName: button.dataset.modelName, groupName: button.dataset.groupName || "", tierName: button.dataset.tierName || "", officialName: button.dataset.officialName || "", collectedAt: Number(button.dataset.collectedAt) };
  const key = jevResultKey(task, row);
  if (action === "ignore") {
    state.jevResults.delete(key);
    state.jevIgnored.add(key);
    renderRows();
    return;
  }
  button.disabled = true;
  try {
    if (action === "analyze") {
      state.jevPending.add(key);
      state.jevIgnored.delete(key);
      renderRows();
      const result = await analyzeJev(task, row);
      state.jevResults.set(key, result);
      toast(task === "model_match" ? "JEV 模型 / 官方匹配核验已返回" : "JEV 复核已完成");
      return;
    }
    if (action === "apply") {
      const result = jevResultFor("model_match", row);
      if (!result || result.choice === JEV_NO_MATCH) return;
      const data = await saveJevModelMatch(row, result);
      state.jevResults.delete(jevResultKey("model_match", row));
      state.jevIgnored.delete(jevResultKey("model_match", row));
      render(data);
      toast("已保存人工确认的模型匹配");
      return;
    }
    if (action === "remove") {
      render(await callService("REMOVE_JEV_MODEL_MATCH", { stationId: row.stationId, modelName: row.modelName }));
      toast("已取消人工匹配");
    }
  } catch (error) {
    toast(error.message);
  } finally {
    state.jevPending.delete(key);
    button.disabled = false;
    renderRows();
  }
}


async function runBatchJevMatches() {
  if (state.jevBatchRunning) return;
  const profile = activeJevProfile();
  if (!profile.baseUrl || !profile.modelId || !profile.hasApiKey) {
    toast("请先在设置中配置 JEV");
    return;
  }
  if (state.jevPending.size) {
    toast("当前有 JEV 请求进行中，请完成后再试");
    return;
  }

  if (state.refreshInProgress || ["#refresh-all", "#fetch-references"].some(selector => $(selector)?.disabled)) {
    toast("当前正在刷新或更新官方价，请稍后再试");
    return;
  }
  const rows = getJevModelBatchTargets(state.rows);
  if (!rows.length) {
    toast("没有需要 JEV 核验的模型 / 官方匹配");
    return;
  }

  state.jevBatchRunning = true;
  let applied = 0;
  let waiting = 0;
  let noMatch = 0;
  let failed = 0;
  let interrupted = 0;
  try {
    for (let index = 0; index < rows.length; index += 1) {
      if (state.refreshInProgress) {
        interrupted = rows.length - index;
        break;
      }
      const row = rows[index];
      const key = jevResultKey("model_match", row);
      setBatchJevButton(true, index + 1, rows.length);
      state.jevPending.add(key);
      renderRows();
      try {
        const result = await analyzeJev("model_match", row);
        if (state.refreshInProgress) {
          interrupted = rows.length - index;
          break;
        }
        state.jevResults.set(key, result);
        if (result.choice === JEV_NO_MATCH) {
          noMatch += 1;
          continue;
        }
        if (!Number.isFinite(Number(result.confidence)) || Number(result.confidence) < JEV_AUTO_MATCH_CONFIDENCE) {
          waiting += 1;
          continue;
        }
        const data = await saveJevModelMatch(row, result);
        state.jevResults.delete(key);
        state.jevIgnored.delete(key);
        render(data);
        applied += 1;
      } catch (error) {
        if (state.refreshInProgress
          || error.message === "数据刷新中，模型匹配核验已停止"
          || error.message === "报价、官方目录或 JEV 配置已变化，请刷新页面后重试") {
          interrupted = rows.length - index;
          break;
        }
        failed += 1;
      } finally {
        state.jevPending.delete(key);
        renderRows();
      }
    }
    const summary = `自动确认 ${applied} 个，待人工确认 ${waiting} 个，未匹配 ${noMatch} 个${failed ? `，失败 ${failed} 个` : ""}`;
    toast(interrupted
      ? `数据或配置已变化，批量 JEV 核验已停止：${summary}，剩余 ${interrupted} 个未处理`
      : `批量 JEV 模型匹配核验完成：${summary}`);
  } finally {
    state.jevBatchRunning = false;
    setBatchJevButton(false);
    renderRows();
  }
}


function renderRefreshProgress(progress) {
  state.refreshInProgress = progress.refreshInProgress ?? !["complete", "error"].includes(progress.phase);
  const panel = $("#refresh-progress-panel");
  panel.hidden = false;
  const total = Math.max(0, Number(progress.total) || 0);
  const completed = Math.max(0, Number(progress.completed) || 0);
  const bar = $("#refresh-progress-bar");
  bar.max = Math.max(total, 1);
  bar.value = Math.min(completed, bar.max);
  $("#refresh-progress-count").textContent = `${completed} / ${total} 站点`;
  const message = $("#refresh-progress-message");
  if (progress.phase === "start") {
    lastRefreshSummary = null;
    refreshRows.clear();
    $("#refresh-progress-results").replaceChildren();
    message.textContent = total ? `准备查询 ${total} 个启用站点` : "没有启用的站点可查询";
  } else if (progress.phase === "references") {
    message.textContent = progress.message;
  } else if (progress.phase === "station") {
    let row = refreshRows.get(progress.stationId);
    if (!row) {
      row = document.createElement("li");
      refreshRows.set(progress.stationId, row);
      $("#refresh-progress-results").append(row);
    }
    row.dataset.status = progress.status;
    const duration = Number.isFinite(progress.durationMs) ? ` · ${(progress.durationMs / 1000).toFixed(1)} 秒` : "";
    const detail = progress.status === "running" ? "查询中" : progress.status === "error" ? `失败 · ${progress.error || "未知错误"}` : `${Number(progress.modelCount) || 0} 个模型${duration}`;
    row.textContent = `${progress.stationName || progress.stationId} · ${detail}`;
    message.textContent = progress.status === "running"
      ? `正在查询 ${progress.current}/${total}：${progress.stationName}`
      : `已查询 ${completed}/${total} 个站点`;
  } else if (progress.phase === "complete") {
    lastRefreshSummary = progress.summary;
    const summary = progress.summary;
    message.textContent = total
      ? `查询完成：${summary.successCount} 成功，${summary.errorCount} 失败，${summary.totalModels} 个模型 · ${(summary.durationMs / 1000).toFixed(1)} 秒`
      : "没有启用的站点可查询";
  } else if (progress.phase === "error") {
    message.textContent = progress.message;
  }
}

$("#comparison-previous").addEventListener("click", () => { state.page--; renderRows(); });
$("#comparison-next").addEventListener("click", () => { state.page++; renderRows(); });
$("#page-size").addEventListener("change", () => { state.page = 0; renderRows(); });
const backToTop = $("#back-to-top");
window.addEventListener("scroll", () => { backToTop.hidden = window.scrollY < 400; }, { passive: true });
backToTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }));
$("#comparison-body").addEventListener("click", async event => {
  const action = event.target.closest("[data-jev-action]");
  if (action) {
    event.preventDefault();
    await handleJevAction(action);
    return;
  }
  const button = event.target.closest("[data-focus-station]");
  if (!button) return;
  state.filters.stationId = button.dataset.focusStation;
  renderStationFilter(state.rows);
  renderRows();
});

$("#refresh-all").addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  button.innerHTML = `${icon("loader-circle", { className: "icon spin" })}<span>查询中</span>`;
  lastRefreshSummary = null;
  try {
    const data = await callService("REFRESH_ALL");
    lastRefreshSummary = data.refreshSummary;
    render(data);
    if (!lastRefreshSummary?.total) toast("没有启用的站点可查询");
    else toast(`查询完成：${lastRefreshSummary.successCount} 成功，${lastRefreshSummary.errorCount} 失败`);
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; button.innerHTML = `${icon("refresh-cw", { className: "icon" })}<span>刷新全部</span>`; }
});

$("#batch-jev-match").addEventListener("click", runBatchJevMatches);
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
const cards = initCollapsibleCards("dashboard");
$("#expand-all").addEventListener("click", () => cards.setAll(false));
$("#collapse-all").addEventListener("click", () => cards.setAll(true));
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === "REFERENCES_REFRESHING") state.refreshInProgress = Boolean(message.active);
});
onRefreshProgress(renderRefreshProgress);
load();

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) load();
});
