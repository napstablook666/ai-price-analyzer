import { buildStationIndexes, filterComparisonsByMediaMode, flattenComparisonRows, mixLabel } from "./core/pricing.js";
import { dashboardPriceLines, formatSourcePrice, priceEntryTone } from "./dashboard-pricing.js";
import { callService, escapeHtml, formatMoney, formatRefreshSummary, hydrateIcons, icon, onRefreshProgress, toast } from "./shared/ui.js";
import { buildMonthlyCostRankings, createDashboardIndex, deltaTone, matchesModelQueries, mediaModeSwitchFilters, monthlyCostBarWidth, monthlyCostRankingFor, modeSwitchFilters, paginateRows, parsePageInput, rowBandClasses } from "./dashboard-index.js";
import { initCardCollapse } from "./shared/collapse.js";
import { initTopMenu } from "./shared/menu.js";
import { DEFAULT_EXCHANGE_RATE, STATION_CATEGORY_LABELS } from "./shared/schema.js";
import { COMPARISON_MEDIA_MODES, MEDIA_MODE_LABELS, mediaModeOf, normalizeMediaType } from "./core/media.js";
import { providerIconMarkup, providerLogoFor } from "./shared/provider-icons.js";
import { siteIconMarkup } from "./shared/site-icon.js";
import { IMAGE_UNIT_LABELS, IMAGE_UNIT_SUFFIXES, mediaUnitLabel, mediaUnitRank } from "./core/image-billing.js";

const DEFAULT_PROVIDER_FILTER = ["anthropic", "deepseek", "openai", "z-ai"];
const PAGE_SIZE = 20;
const state = {
  data: null,
  comparisonMode: "paid",
  mediaMode: "text",
  comparisons: [],
  unclassifiedMediaCount: 0,
  rows: [],
  page: 0,
  pageCount: 0,
  searchTextByRow: new WeakMap(),
  modelTextByRow: new WeakMap(),
  stationById: new Map(),
  reference: null,
  refreshInProgress: false,
  refreshPreflight: null,
  preflightLoading: false,
  filters: { search: "", stationId: "", provider: DEFAULT_PROVIDER_FILTER, group: null, models: [], showUnmatched: true, sortBy: "blendedUnitPrice", sortSecondary: "diffPercent", sortDirection: "asc" },
  stationIndexes: new Map(),
  refreshStationIds: new Set(),
  refreshStationQuery: "",
  refreshStationOptionsKey: ""
};
const $ = selector => document.querySelector(selector);
let lastRefreshSummary = null;
let pageFilterKey = null;
const refreshRows = new Map();
// 采集结束后进度面板再留 5 秒给用户看清结果，然后自动收起，不长期占着首屏。
const PROGRESS_HIDE_DELAY_MS = 5000;
let progressHideTimer = null;
const PRICING_REASON_LABELS = { currency_unverified: "币种待核验", cache_write_1h_missing: "缺少 1 小时缓存价", price_missing: "中转价格未收录" };



function formatPrice(value, currency = "CNY", precision = 4) {
  const number = Number(value);
  if (value === null || value === undefined || !Number.isFinite(number)) return "—";
  const rate = Number(state.data?.references?.exchangeRate) || DEFAULT_EXCHANGE_RATE;
  const displayValue = currency === "USD" ? number / rate : number;
  const symbol = currency === "USD" ? "$" : currency === "CREDITS" ? "CR" : "¥";
  return precision === 4 ? formatMoney(displayValue, symbol) : `${symbol}${displayValue.toFixed(precision)}`;
}

// 主表一行只放一类报价，但三类报价的单位不同，所以费用项和单价列按 billingMode 换算法。
// 按 token 的原样展示；按次的把单次价摊成元/1M 并给出平衡点；按张的折成元/张。
function mediaSpecsLabel(row) {
  const specs = row.mediaSpecs && typeof row.mediaSpecs === "object" ? row.mediaSpecs : {};
  const resolution = Array.isArray(specs.resolution?.enum) ? specs.resolution.enum.join(" / ") : "";
  const seconds = specs.seconds ? "按时长参数" : "";
  return [resolution && `分辨率 ${resolution}`, seconds].filter(Boolean).join(" · ");
}

function requestPriceGridMarkup(row, currency, chartMarkup = "") {
  const requestPrice = Number(row.costPrices?.request ?? row.prices?.request);
  const officialRequest = Number(row.officialPrices?.request);
  const costCurrency = row.costCurrency || currency;
  // 视频按秒计价的档要单独标注，否则 0.35 元/秒 会被读成 0.35 元/次。
  const perSecond = row.requestUnit === "second";
  const relayUnit = perSecond ? "/秒" : "/次";
  const relayText = Number.isFinite(requestPrice) && requestPrice > 0
    ? `${formatPrice(requestPrice, costCurrency, 3)}<small>${relayUnit}</small>`
    : "—";
  const officialText = Number.isFinite(officialRequest) && officialRequest > 0
    ? `${formatPrice(officialRequest, currency, 3)}<small>/次</small>`
    : "—";
  if (state.mediaMode === "video") {
    const specs = mediaSpecsLabel(row);
    const chips = [
      `<span class="price-mini"><span class="price-mini-key">单位</span><span class="price-mini-pair"><span class="price-mini-relay">元${relayUnit}</span></span></span>`,
      `<span class="price-mini"><span class="price-mini-key">规格</span><span class="price-mini-pair">${escapeHtml(specs || "插件未提供")}</span></span>`
    ].join("");
    return `<div class="price-grid"><div class="price-grid-row price-line-primary"><span class="price-key">${perSecond ? "每秒" : "每次"}</span><span class="price-value">${officialText}</span><span class="price-value">${relayText}</span></div><div class="price-grid-detail">${chips}</div></div>${chartMarkup ? `<div class="price-chart">${chartMarkup}</div>` : ""}`;
  }
  const unitPrice = Number.isFinite(row.requestUnitPrice)
    ? `${formatPrice(row.requestUnitPrice, "CNY")}<small>/M</small>`
    : "—";
  const balanced = Number.isFinite(row.breakEvenTokens) && row.breakEvenTokens > 0;
  const profile = Number.isFinite(row.tokensPerRequest) && row.tokensPerRequest > 0
    ? `${Math.round(row.tokensPerRequest).toLocaleString("zh-CN")}${row.tokensPerRequestEstimated ? '<small class="tier-estimated">估算</small>' : ""}`
    : "—";
  const chips = [
    `<span class="price-mini"><span class="price-mini-key">折算</span><span class="price-mini-pair"><span class="price-mini-relay">${unitPrice}</span></span></span>`,
    `<span class="price-mini" title="一次跑多少 token 以内，这个按次报价才比同模型按量便宜"><span class="price-mini-key">平衡点</span><span class="price-mini-pair">${balanced ? `${Math.round(row.breakEvenTokens).toLocaleString("zh-CN")}<small>/次</small>` : "—"}</span></span>`,
    `<span class="price-mini"><span class="price-mini-key">你的单次</span><span class="price-mini-pair">${profile}</span></span>`
  ].join("");
  return `<div class="price-grid"><div class="price-grid-row price-line-primary"><span class="price-key">单次</span><span class="price-value">${officialText}</span><span class="price-value">${relayText}</span></div><div class="price-grid-detail">${chips}</div></div>${chartMarkup ? `<div class="price-chart">${chartMarkup}</div>` : ""}`;
}
function imagePriceGridMarkup(row, currency, chartMarkup = "") {
  const station = row.imageQuote ?? row.imageQuoteQuoted;
  const official = row.imageOfficialQuote;
  const unit = station ? (IMAGE_UNIT_LABELS[station.unit] || "—") : "—";
  const suffix = station ? (IMAGE_UNIT_SUFFIXES[station.unit] || "") : "";
  const officialSuffix = official ? (IMAGE_UNIT_SUFFIXES[official.unit] || "") : "";
  const relayText = station ? `${formatPrice(station.value, currency, 3)}<small>${suffix}</small>` : "—";
  const officialText = official ? `${formatPrice(official.value, currency, 4)}<small>${officialSuffix}</small>` : "—";
  const compare = row.imageCompare;
  const converted = compare?.kind === "converted";
  const gap = Number.isFinite(compare?.diffPercent) ? compare.diffPercent : null;
  const gapClass = gap === null ? "" : gap < -0.5 ? "is-cheap" : gap > 0.5 ? "is-expensive" : "";
  const gapLabel = gap === null ? "—" : Math.abs(gap) <= 0.5 ? "持平" : `${converted ? "≈" : ""}${gap < 0 ? "低" : "高"} ${Math.abs(gap).toFixed(1)}%`;
  const perImage = Number.isFinite(row.imagePerImage)
    ? `${converted ? "≈" : ""}${formatPrice(row.imagePerImage, "CNY", 4)}<small>/张</small>`
    : "—";
  const chips = [
    `<span class="price-mini"><span class="price-mini-key">折合</span><span class="price-mini-pair"><span class="price-mini-relay">${perImage}</span></span></span>`,
    `<span class="price-mini"><span class="price-mini-key">对比基准</span><span class="price-mini-pair"><span class="price-mini-relay ${gapClass}">${gapLabel}</span></span></span>`,
    `<span class="price-mini"><span class="price-mini-key">单位</span><span class="price-mini-pair">${escapeHtml(unit)}</span></span>`
  ].join("");
  return `<div class="price-grid"><div class="price-grid-row price-line-primary"><span class="price-key">每张</span><span class="price-value">${officialText}</span><span class="price-value">${relayText}</span></div><div class="price-grid-detail">${chips}</div></div>${chartMarkup ? `<div class="price-chart">${chartMarkup}</div>` : ""}`;
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
  const mediaPending = Number(state.unclassifiedMediaCount) || 0;
  const needsReview = rows.filter(row => (state.comparisonMode !== "public" && !row.officialName) || row.evidence === "estimated" || row.incomplete || row.pricingUnavailable).length + mediaPending;
  const reviewReasons = rows.flatMap(row => row.pricingUnavailableReasons || []).reduce((counts, reason) => ({ ...counts, [reason]: (counts[reason] || 0) + 1 }), {});
  const reviewNote = [
    rows.filter(row => row.incomplete).length ? `${rows.filter(row => row.incomplete).length} 条部分解析` : "",
    mediaPending ? `${mediaPending} 条媒体类型待核验` : "",
    ...Object.entries(reviewReasons).map(([reason, count]) => `${count} 条${PRICING_REASON_LABELS[reason] || "价格待核验"}`)
  ].filter(Boolean).join("、") || (isPublic ? "部分解析数据" : "未匹配或推导数据");
  const modelCount = new Set(rows.map(row => row.canonicalModel)).size;
  const stationCount = new Set(rows.map(row => row.stationId)).size;
  const matchRate = rows.length ? Math.round(matched.length / rows.length * 100) : 0;
  const comparable = state.mediaMode === "image"
    ? rows.filter(row => row.imageCompare?.kind && row.imageCompare.kind !== "none")
    : rows.filter(row => row.officialName && !row.pricingUnavailable);
  const cards = isPublic ? [
    ["公益模型", String(modelCount), `${rows.length} 条报价 · ${stationCount} 个公益站`],
    ["公益站点", String(stationCount), "仅公益站"],
    ["价格单位", "站点积分/额度", "比例 1:1"],
    ["数据状态", String(needsReview), reviewNote]
  ] : state.mediaMode === "text" ? [
    ["覆盖模型", String(modelCount), `${rows.length} 条报价 · ${stationCount} 个启用站点`],
    ["基准匹配", String(matched.length), `${matchRate}% 有基准参考价`],
    ["首选方案", String(recommended), "同模型推荐"],
    ["需核验", String(needsReview), reviewNote]
  ] : [
    [`${MEDIA_MODE_LABELS[state.mediaMode]}模型`, String(modelCount), `${rows.length} 条报价 · ${stationCount} 个启用站点`],
    ["基准匹配", String(matched.length), `${matchRate}% 有基准参考价`],
    ["可比报价", String(comparable.length), state.mediaMode === "image" ? "同单位或可折合到元/张" : "按次报价已折算成元/1M"],
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
  $("#station-filters").innerHTML = `<label class="facet-option"><input type="radio" name="station-filter" data-station-filter value=""${current ? "" : " checked"}><span>全部中转站</span></label>${stations.map(([id, name]) => `<label class="facet-option"><input type="radio" name="station-filter" data-station-filter value="${escapeHtml(id)}"${id === current ? " checked" : ""}>${siteIconMarkup(state.stationById.get(id)?.pluginId, name, { size: 15 })}<span>${escapeHtml(name)}</span>${state.stationIndexes.get(id) ? `<span class="facet-metric" title="本站混合单价 / 基准混合单价的中位数（样本 ${state.stationIndexes.get(id).sampleSize} 个模型）">×${(state.stationIndexes.get(id).median).toFixed(2)}</span>` : ""}</label>`).join("")}<span class="facet-empty" data-no-matches hidden>无匹配项</span>`;
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

// 「混合单价」这一列现在装着三种单位：按 token 是元/1M，按次折算后也是元/1M，可以一起排；
// 按张是元/张，和元/1M 不是同一个量纲，给它 null 让它排在末尾，不硬混进同一把尺子。
function unitPriceSortValue(row) {
  if (row.billingMode === "request") return Number.isFinite(row.requestUnitPrice) ? row.requestUnitPrice : null;
  if (row.billingMode === "image") return null;
  return Number.isFinite(row.blendedUnitPrice) ? row.blendedUnitPrice : null;
}

function mediaUnitPriceSortValue(row) {
  if (state.mediaMode === "image") return Number.isFinite(row.mediaUnitPrice) ? row.mediaUnitPrice : null;
  if (state.mediaMode === "video") {
    const price = Number(row.mediaUnitPrice);
    return Number.isFinite(price) && price > 0 ? price : null;
  }
  return unitPriceSortValue(row);
}

function billingModeTagMarkup(row) {
  if (row.billingMode === "request") return ` · <span class="billing-mode-tag is-request">按次</span>`;
  if (row.billingMode === "image") return ` · <span class="billing-mode-tag is-image">按张</span>`;
  return "";
}

function sortValue(row, key) {
  if (key === "model") return `${row.displayName} ${row.modelName}`;
  if (key === "blendedUnitPrice") return unitPriceSortValue(row);
  if (key === "mediaUnitPrice") return mediaUnitPriceSortValue(row);
  if (key === "monthlyCost") return paidMonthlyCost(row);
  return row[key];
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
  // 「单位价格」先按单位分榜再排价：元/张 和 元/1M 图token 不是同一个量纲，
  // 直接按数值升序会把 0.04 元/张 排在 30 元/1M 后面，看起来像它更贵。
  const groupedByUnit = state.filters.sortBy === "mediaUnitPrice" && state.mediaMode !== "text";
  return [...rows].sort((left, right) => {
    if (groupedByUnit) {
      const unitOrder = mediaUnitRank(left.mediaUnit) - mediaUnitRank(right.mediaUnit);
      if (unitOrder) return unitOrder;
    }
    for (const key of keys) {
      const result = compareSortValues(sortValue(left, key), sortValue(right, key), direction);
      if (result) return result;
    }
    return `${left.stationName} ${left.modelName}`.localeCompare(`${right.stationName} ${right.modelName}`);
  });
}

// 分榜横条：单位换了就插一行，标清这一组是哪个量纲、是不是规格未标。
function unitGroupMarkup(row, previousRow, force = false) {
  const unit = row.mediaUnit || "unknown";
  const continues = Boolean(previousRow) && (previousRow.mediaUnit || "unknown") === unit;
  if (continues && !force) return "";
  const label = mediaUnitLabel(unit, "未标单位");
  const tier = row.mediaUnit === "image" && row.imageTierText ? row.imageTierText : "";
  const note = tier === "规格未标注"
    ? `<span class="unit-group-note">站内没标尺寸，不能和基准具名档直接比</span>`
    : tier ? `<span class="unit-group-note">${escapeHtml(tier)}</span>` : "";
  const suffix = continues ? `<span class="unit-group-note">（续）</span>` : "";
  return `<tr class="unit-group-row"><th colspan="7" scope="colgroup"><span class="unit-group-label">${escapeHtml(label)}</span>${note}${suffix}</th></tr>`;
}
// 三类报价同一个表格，单价单元格按计费模式换渲染，列标题和排序不变。
function priceCellMarkup(row, currency, officialQuotedPrices, chartMarkup = "") {
  if (row.billingMode === "request") return requestPriceGridMarkup(row, currency, chartMarkup);
  if (row.billingMode === "image") return imagePriceGridMarkup(row, currency, chartMarkup);
  return priceGridMarkup(row, currency, officialQuotedPrices, chartMarkup);
}
function priceGridMarkup(row, currency, officialQuotedPrices, chartMarkup = "") {
  const relayLines = row.quotedPrices ? dashboardPriceLines(row.quotedPrices, row, false).filter(([, value]) => value !== null && value !== undefined) : [];
  const officialSource = officialQuotedPrices || row.officialPrices || null;
  const officialBlocked = row.stationCategory === "public";
  const officialLines = officialSource && !officialBlocked ? dashboardPriceLines(officialSource, row, true).filter(([, value]) => value !== null && value !== undefined) : [];
  const officialNote = officialBlocked ? "公益站仅与公益站比较" : officialLines.length ? null : row.officialName ? "基准价格未收录" : "无基准匹配价";
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
  // 基准和中转同口径，同一费用项直接比大小上色：中转更贵标红，更便宜标绿。
  const toneOf = entry => {
    const dir = priceEntryTone(entry);
    if (dir === "neutral") return null;
    return { dir, percent: Math.abs((entry.relay.value / entry.official.value - 1) * 100).toFixed(1) };
  };
  const toneClass = tone => tone ? ` is-${tone.dir}` : "";
  const toneMark = tone => tone ? `<span class="price-tone-mark" aria-hidden="true">${tone.dir === "up" ? "▲" : "▼"}</span>` : "";
  const toneTitle = tone => tone ? ` · 比基准${tone.dir === "up" ? "贵" : "便宜"} ${tone.percent}%` : "";
  const cellMarkup = (cell, format, tone = null) => cell
    ? `<span class="price-value${cell.estimated ? " is-estimated" : ""}${toneClass(tone)}"${cell.estimated ? ' title="估算值"' : ""}>${toneMark(tone)}${cell.estimated ? "≈ " : ""}${format(cell)}</span>`
    : `<span class="price-value price-value-missing">—</span>`;
  // 输入/输出是常看的，留成对齐的两行；其余费用项压成一行「基准 → 中转」，行高不再随费用项数量增长。
  const primaryKeys = ["输入", "输出"];
  const cacheLabels = new Map([["缓存读", "读"], ["缓存写", "写"], ["缓存写入（1h）", "1h"]]);
  const entries = [...grid.values()];
  const primaryRows = entries.filter(entry => primaryKeys.includes(entry.base)).map(entry => {
    const tone = toneOf(entry);
    const relayCell = cellMarkup(entry.relay, relayFormat, tone);
    return `<div class="price-grid-row price-line-primary"><span class="price-key">${escapeHtml(entry.base)}</span>${cellMarkup(entry.official, officialFormat)}${relayCell}</div>`;
  }).join("");
  const miniText = (cell, format) => cell ? `${cell.estimated ? "≈" : ""}${format(cell)}` : "—";
  // 一个费用项压缩成「基准 → 中转」，完整文字放 title，鼠标悬停能看全
  const chip = (label, entry) => {
    const officialText = miniText(entry.official, officialFormat);
    const relayText = miniText(entry.relay, relayFormat);
    const tone = toneOf(entry);
    const title = `${entry.base} · 基准 ${officialText} / 中转 ${relayText}${toneTitle(tone)}`;
    // 基准和中转同价时只留一个数，箭头省掉，一排三个缓存项才放得下
    if (entry.official && entry.relay && officialText === relayText) {
      return `<span class="price-mini" title="${escapeHtml(title)}"><span class="price-mini-key">${escapeHtml(label)}</span><span class="price-mini-pair"><span class="price-mini-relay">${escapeHtml(relayText)}</span></span></span>`;
    }
    return `<span class="price-mini" title="${escapeHtml(title)}"><span class="price-mini-key">${escapeHtml(label)}</span><span class="price-mini-pair"><span class="price-mini-official">${escapeHtml(officialText)}</span><span class="price-mini-arrow" aria-hidden="true">→</span><span class="price-mini-relay${toneClass(tone)}">${toneMark(tone)}${escapeHtml(relayText)}</span></span></span>`;
  };
  const cacheEntries = entries.filter(entry => cacheLabels.has(entry.base));
  const cacheGroup = cacheEntries.length
    ? `<span class="price-mini-label">缓存</span>${cacheEntries.map(entry => chip(cacheLabels.get(entry.base), entry)).join("")}`
    : "";
  const otherEntries = entries.filter(entry => !primaryKeys.includes(entry.base) && !cacheLabels.has(entry.base));
  const otherChips = otherEntries.map(entry => chip(entry.base, entry)).join("");
  // 「基准价格未收录」这类说明并到同一行末尾，不再单独占一行
  const notes = [officialNote, relayNote].filter(Boolean).map(note => `<span class="price-mini-note">${note}</span>`).join("");
  const detailRow = cacheGroup || otherChips || notes ? `<div class="price-grid-detail">${cacheGroup}${otherChips}${notes}</div>` : "";
  return `<div class="price-grid">${primaryRows}${detailRow}</div>${chartMarkup ? `<div class="price-chart">${chartMarkup}</div>` : ""}`;
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
  $("#comparison-mode-note").textContent = isPublic ? "公益站模式：仅显示公益站报价；价格单位为站点积分/额度，默认比例 1:1。" : "付费中转站模式：保留基准价格、月成本和推荐逻辑。";
  $("#provider-filters").closest("details").hidden = isPublic;
  for (const element of document.querySelectorAll(".paid-only-control, .paid-only-column, [data-paid-only='true']")) element.hidden = isPublic;
  for (const element of document.querySelectorAll(".public-only-column")) element.hidden = !isPublic;
  if (isPublic && ["provider", "monthlyCost", "blendedUnitPrice", "mediaUnitPrice", "diffPercent"].includes(state.filters.sortBy)) state.filters.sortBy = "model";
  if (isPublic && ["monthlyCost", "blendedUnitPrice", "diffPercent"].includes(state.filters.sortSecondary)) state.filters.sortSecondary = "none";
  $("#sort-by").value = state.filters.sortBy;
  $("#sort-secondary").value = state.filters.sortSecondary;
  renderStationErrors();
  renderReferenceStatus();
}

function renderMediaMode() {
  const mode = mediaModeOf(state.mediaMode);
  state.mediaMode = mode;
  const isPublic = state.comparisonMode === "public";
  const title = mode === "image" ? "生图模型" : mode === "video" ? "视频模型" : "文本模型";
  const note = mode === "image"
    ? "按图片单位比较，折合价格显示为元/张；不混入 token 报价。"
    : mode === "video"
      ? "按片段请求比较，优先显示元/次和插件提供的分辨率、时长规格。"
      : "按 token、缓存和混合单价比较。";
  document.body.classList.remove("media-mode-text", "media-mode-image", "media-mode-video");
  document.body.classList.add(`media-mode-${mode}`);
  for (const button of document.querySelectorAll("[data-media-mode]")) {
    const active = button.dataset.mediaMode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  $("#media-mode-title").textContent = title;
  $("#media-mode-note").textContent = note;
  const unit = mode === "image" ? "图片单位 · 元/张" : mode === "video" ? "视频单位 · 元/次" : "中转币 · 每 1M token";
  $(".price-head-key").firstChild.textContent = mode === "image" ? "图片费用" : mode === "video" ? "视频费用" : "费用项";
  $("#price-unit-title").textContent = `价格单位 · ${unit}`;
  $(".monthly-cost-heading").textContent = mode === "image" ? "月成本 · 元/张" : mode === "video" ? "月成本 · 元/次" : "月成本 · 折算单价";
  const sortBy = $("#sort-by");
  for (const option of sortBy.options) {
    const modes = option.dataset.mediaModes;
    option.hidden = Boolean(modes && !modes.split(/\s+/).includes(mode)) || (isPublic && option.dataset.paidOnly === "true");
    option.disabled = option.hidden;
  }
  if (isPublic && ["monthlyCost", "blendedUnitPrice", "mediaUnitPrice", "diffPercent"].includes(state.filters.sortBy)) state.filters.sortBy = "model";
  else if (!isPublic && mode !== "text" && state.filters.sortBy === "blendedUnitPrice") state.filters.sortBy = "mediaUnitPrice";
  else if (!isPublic && mode === "text" && state.filters.sortBy === "mediaUnitPrice") state.filters.sortBy = "blendedUnitPrice";
  $("#sort-by").value = state.filters.sortBy;
  $("#sort-secondary").value = state.filters.sortSecondary;
  $("#comparison-panel").setAttribute("aria-label", `${title}价格明细表`);
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

function resetFiltersForMediaMode() {
  state.filters = mediaModeSwitchFilters(state.filters, state.mediaMode, DEFAULT_PROVIDER_FILTER);
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
  const officialName = hasOfficial ? row.officialName : "没有对应的基准目录记录";
  const provider = row.provider && row.provider !== "未匹配" ? row.provider : "未匹配";
  const rule = row.matchRule || (hasOfficial ? "基准匹配" : "未匹配");
  const candidateItems = candidates.map(candidate => {
    const name = candidate.name || "未命名候选";
    const cost = Number.isFinite(candidate.monthlyCost) ? formatPrice(candidate.monthlyCost, currency, 2) : "—";
    const delta = Number.isFinite(candidate.diffPercent)
      ? `${candidate.diffPercent < 0 ? "低" : candidate.diffPercent > 0 ? "高" : "持平"} ${Math.abs(candidate.diffPercent).toFixed(1)}%`
      : "—";
    return `<div class="candidate-item"><span class="candidate-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span><span class="candidate-cost">${cost}</span><span class="candidate-delta">${delta}</span></div>`;
  }).join("");
  const candidatesMarkup = candidateItems ? `<div class="match-candidates"><div class="match-detail-heading">基准候选（${candidates.length}）</div><div class="candidate-list">${candidateItems}</div></div>` : "";
  return `<details class="model-match-details"><summary class="confidence-tag" aria-label="匹配置信度 ${confidence}%，查看基准匹配详情">${confidence}%</summary><div class="model-match-popover" aria-label="基准匹配详情"><div class="match-detail-primary"><span class="match-detail-label">基准模型</span><strong>${escapeHtml(officialName)}</strong></div><div class="match-detail-line"><span>供应商</span><span>${escapeHtml(provider)}</span></div><div class="match-detail-line"><span>匹配规则</span><span>${escapeHtml(rule)}</span></div><div class="match-detail-line"><span>置信度</span><span>${confidence}%</span></div>${candidatesMarkup}</div></details>`;
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
let monthlyCostPendingTrigger = null;
// 长条上要停够这么久才弹排名，划过就闪出来太吵。
const MONTHLY_COST_OPEN_DELAY = 2000;

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

// 列表现在是同模型全部报价，打开时把当前这条滚到浮层中部，省得每次手动翻。
function revealMonthlyCostCurrent(panel) {
  const current = panel.querySelector(".monthly-cost-ranking-item.is-current");
  if (!current) return;
  const top = current.offsetTop - (panel.clientHeight - current.offsetHeight) / 2;
  panel.scrollTop = Math.max(0, Math.min(top, panel.scrollHeight - panel.clientHeight));
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
  monthlyCostPendingTrigger = null;
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
  revealMonthlyCostCurrent(panel);
}

function closeMonthlyCostPanel() {
  clearTimeout(monthlyCostOpenTimer);
  clearTimeout(monthlyCostCloseTimer);
  monthlyCostOpenTimer = 0;
  monthlyCostCloseTimer = 0;
  monthlyCostPendingTrigger = null;
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

// 点浮层里的名次卡片：翻到这条报价所在的页，把那一行滚到眼前再连闪两下。
function jumpToMonthlyCostOffer(position) {
  const index = Number(position);
  if (!Number.isInteger(index) || index < 0) return;
  const pageSize = Number($("#page-size").value) || PAGE_SIZE;
  const page = Math.floor(index / pageSize);
  closeMonthlyCostPanel();
  if (state.page !== page) {
    state.page = page;
    renderRows();
  }
  const row = $("#comparison-body")?.children[index % pageSize];
  if (!row) return;
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  row.scrollIntoView({ block: "center", behavior });
  // 先摘再挂，连着点同一条也能重新闪。
  row.classList.remove("is-flash");
  void row.offsetWidth;
  row.classList.add("is-flash");
  setTimeout(() => row.classList.remove("is-flash"), 1100);
}

function scheduleMonthlyCostOpen(trigger) {
  clearTimeout(monthlyCostCloseTimer);
  monthlyCostCloseTimer = 0;
  if (monthlyCostPanelState?.trigger === trigger) return;
  // 停到另一条长条上，先把上一条的浮层收掉，别让旧排名挂在那儿等新的。
  if (monthlyCostPanelState) closeMonthlyCostPanel();
  // 已经在同一条长条上等着了就别重开计时，鼠标在长条里挪来挪去不该重置停留时间。
  if (monthlyCostOpenTimer && monthlyCostPendingTrigger === trigger) return;
  clearTimeout(monthlyCostOpenTimer);
  monthlyCostPendingTrigger = trigger;
  monthlyCostOpenTimer = setTimeout(() => openMonthlyCostPanel(trigger), MONTHLY_COST_OPEN_DELAY);
}

function scheduleMonthlyCostClose() {
  clearTimeout(monthlyCostOpenTimer);
  monthlyCostOpenTimer = 0;
  monthlyCostPendingTrigger = null;
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
  state.pageCount = page.pageCount;
  $("#comparison-page-total").textContent = String(Math.max(1, page.pageCount));
  restorePageInput();
  $("#comparison-previous").disabled = page.page === 0;
  $("#comparison-next").disabled = page.page + 1 >= page.pageCount;
  $("#result-count").textContent = `${filtered.length} 条报价`;
  // 分榜只在「单位价格」排序下生效：其他排序键不承诺任何单位分组。
  const groupedByUnit = state.filters.sortBy === "mediaUnitPrice" && state.mediaMode !== "text";
  const firstVisibleIndex = filtered.indexOf(visible[0]);
  $("#comparison-body").innerHTML = visible.map((row, index) => {
    const station = stationFor(row);
    // 按张的价差按元/张算，和月成本的差不是一回事，用生图那套比较结果。
    const imageGap = row.billingMode === "image" && Number.isFinite(row.imageCompare?.diffPercent) ? row.imageCompare.diffPercent : null;
    const delta = row.pricingUnavailable ? null
      : row.billingMode === "image" ? imageGap
        : !Number.isFinite(row.monthlyCost) ? null : (Number.isFinite(row.diffPercent) ? row.diffPercent : null);
    const deltaClass = delta === null || Math.abs(delta) < 0.005 ? "neutral" : `delta-${deltaTone(delta)}`;
    const deltaLabel = delta === null
      ? (row.pricingUnavailable ? pricingUnavailableLabel(row)
        : row.stationCategory === "public" ? "仅公益站比较"
          : row.imageCompare?.kind === "tier-mismatch" ? "规格不同"
            : "无基准价")
      : Math.abs(delta) < 0.005 ? "持平" : `${delta < 0 ? "低" : "高"} ${Number(Math.abs(delta).toFixed(2))}%`;
    const isPublic = state.comparisonMode === "public";
    const categoryClass = ["excellent", "good", "fair", "bad"].includes(row.category) ? row.category : "";
    const monthlyCostCurrency = row.costCurrency || currency;
    const officialQuotedPrices = row.officialQuotedPrices || null;
    const monthlyRanking = monthlyCostRankingFor(row, monthlyCostRankings);
    const modelName = row.displayNameOverride || row.modelName || row.displayName;
    const officialNote = !isPublic ? modelMatchMarkup(row, currency) : "";
    const rowClasses = [bandClasses[index], categoryClass && `category-${categoryClass}`].filter(Boolean).join(" ");
    const previousRow = index === 0 ? (firstVisibleIndex > 0 ? filtered[firstVisibleIndex - 1] : null) : visible[index - 1];
    const unitGroup = groupedByUnit ? unitGroupMarkup(row, previousRow, index === 0) : "";
    return `${unitGroup}<tr class="${rowClasses}">
      <td data-label="模型"><div class="model-cell"><div class="model-head">${modelIconMarkup(row)}<span class="model-name" title="${escapeHtml(modelName)}">${escapeHtml(modelName)}</span>${!isPublic && row.officialName ? `<span class="provider-tag">${escapeHtml(row.provider)}</span>` : ""}</div>${officialNote ? `<span class="model-meta">${officialNote}</span>` : ""}</div></td>
      <td data-label="中转站"><div class="station-cell"><button class="station-filter-link" type="button" title="筛选此站点" aria-label="筛选站点：${escapeHtml(row.stationName)}" data-focus-station="${escapeHtml(row.stationId)}">${siteIconMarkup(station.pluginId, row.stationName, { size: 16 })}<span>${escapeHtml(row.stationName)}</span></button><span class="station-meta">${escapeHtml(row.groupName || "未分组")}${row.groupRatio ? ` · ×${escapeHtml(row.groupRatio)}` : ""}${billingModeTagMarkup(row)}</span></div></td>
      <td colspan="3" data-label="费用项" class="price-cell is-section-start paid-only-column"${isPublic ? " hidden" : ""}>${priceCellMarkup(row, currency, officialQuotedPrices, monthlyCostChartMarkup(row, currency, monthlyRanking))}</td>
      <td data-label="月成本 · 折算单价" class="cost-combined-cell is-section-start paid-only-column"${isPublic ? " hidden" : ""}>${costCombinedMarkup(row, currency, monthlyRanking, deltaClass, deltaLabel)}</td>
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
// 单价行跟着计费模式换标签和单位：按 token 是混合价，按次是折算到每 M，按张是折合每张。
function unitPriceLineMarkup(row, currency) {
  const money = (value, precision, suffix, title = "") => `<span class="blended-cost"${title ? ` title="${escapeHtml(title)}"` : ""}>${formatPrice(value, row.costCurrency || currency, precision)}<small>${suffix}</small></span>`;
  if (row.billingMode === "request") {
    if (state.mediaMode === "video") {
      const requestPrice = Number(row.costPrices?.request ?? row.prices?.request);
      const perSecondUnit = row.requestUnit === "second" ? "/秒" : "/次";
      const value = Number.isFinite(requestPrice) && requestPrice > 0
        ? money(requestPrice, 3, perSecondUnit, perSecondUnit === "/秒" ? "视频每秒价格" : "视频单次价格")
        : `<span class="price-empty">无单次价</span>`;
      return `<span class="blended-line"><span class="blended-label">${perSecondUnit === "/秒" ? "每秒" : "单次"}</span>${value}</span>`;
    }
    const value = Number.isFinite(row.requestUnitPrice)
      ? money(row.requestUnitPrice, 4, "/M", `单次价 ÷ ${Math.round(row.tokensPerRequest).toLocaleString("zh-CN")} 字/次`)
      : `<span class="price-empty">无折算价</span>`;
    return `<span class="blended-line"><span class="blended-label">折算</span>${value}</span>`;
  }
  if (row.billingMode === "image") {
    const value = Number.isFinite(row.imagePerImage)
      ? money(row.imagePerImage, 4, "/张", row.imagePerImageAssumption || "")
      : `<span class="price-empty">无法折合</span>`;
    return `<span class="blended-line"><span class="blended-label">折合</span>${value}</span>`;
  }
  const blended = Number.isFinite(row.blendedUnitPrice)
    ? money(row.blendedUnitPrice, 4, "/M", row.blendedMix ? `按 ${mixLabel(row.blendedMix)} 混合` : "")
    : `<span class="price-empty">${row.stationCategory === "public" ? "仅公益站比较" : "无混合价"}</span>`;
  return `<span class="blended-line"><span class="blended-label">混合</span>${blended}</span>`;
}

function costCombinedMarkup(row, currency, ranking, deltaClass, deltaLabel) {
  return `<div class="cost-combined"><div class="cost-combined-main">${monthlyCostSummaryMarkup(row, currency)}<span class="delta-tag ${deltaClass}">${deltaLabel}</span></div>${unitPriceLineMarkup(row, currency)}${monthlyCostPanelMarkup(row, currency, ranking)}</div>`;
}

// 有充值阶梯的站点，月成本按落档后的实付金额显示；排名和柱长也用这个数，不然名次和金额会打架。
function paidMonthlyCost(row) {
  if (row.billingMode === "image") {
    if (Number.isFinite(row.imageMonthlyCostPaid)) return row.imageMonthlyCostPaid;
    return row.imageMonthlyCost;
  }
  return Number.isFinite(row.monthlyCostPaid) ? row.monthlyCostPaid : row.monthlyCost;
}

// 金额只是显示，浮层只挂在下面那根长条上，免得鼠标扫过金额就弹东西。
function monthlyCostSummaryMarkup(row, currency) {
  const amount = formatPrice(paidMonthlyCost(row), row.costCurrency || currency);
  const plan = row.billingMode === "image" ? row.imageRechargePlan : row.rechargePlan;
  const tierHint = plan
    ? `<small class="cost-paid-hint" title="按估算月用量自动落档">充 ${formatPrice(plan.amount, "CNY", 2)} 档 ${plan.discount.toFixed(2)} 折</small>`
    : "";
  const noUsage = row.billingMode === "image" && !Number.isFinite(paidMonthlyCost(row)) && row.stationCategory !== "public";
  if (noUsage) return `<strong class="cost-amount cost-amount-missing">填出图张数</strong>`;
  return `<strong class="cost-amount">${amount}</strong>${tierHint}`;
}
// 长条只做同模型月成本相对比较，放在单价单元格底部；名次和价差仍在月成本列。
function monthlyCostRankTitle(row, currency, { rank, total, baseline }) {
  return rank
    ? `同模型第 ${rank} / ${total} 名，实付月成本 ${formatPrice(paidMonthlyCost(row), row.costCurrency || currency)}；柱长按组内最高月成本 ${formatPrice(baseline, row.costCurrency || currency)} 归一`
    : "月成本不可用，无法参与同模型排名";
}

// 长条是唯一能弹出排名的入口；排不出名次的报价（缺价、公益口径）不挂浮层。
function monthlyCostChartMarkup(row, currency, ranking) {
  const width = ranking.rank ? monthlyCostBarWidth(paidMonthlyCost(row), ranking.baseline) : null;
  return cellChartMarkup({ width, title: monthlyCostRankTitle(row, currency, ranking), trigger: Boolean(ranking.rank) });
}

// 排名浮层只挂在长条上，停留够久或点一下才出现，表格里不再常驻名次。
function monthlyCostPanelMarkup(row, currency, ranking) {
  const { rank, total, baseline, entries } = ranking;
  const items = entries.map(entry => {
    const entryRow = entry.row;
    const entryCurrency = entryRow.costCurrency || currency;
    const entryTitle = `第 ${entry.rank} 名，${entryRow.stationName}，月成本 ${formatPrice(entry.monthlyCost, entryCurrency)}`;
    const entryWidth = monthlyCostBarWidth(entry.monthlyCost, baseline) ?? 0;
    const jumpTitle = `${entryTitle}，点击跳到这条报价`;
    const isCurrent = entryRow === row;
    return `<li class="monthly-cost-ranking-item${isCurrent ? " is-current" : ""}" role="button" tabindex="0" data-monthly-cost-jump="${entry.position}" title="${escapeHtml(jumpTitle)}"><div class="monthly-cost-ranking-meta"><span class="monthly-cost-ranking-position">#${entry.rank}</span><span class="monthly-cost-ranking-station" title="${escapeHtml(`${entryRow.stationName} · ${entryRow.groupName || "未分组"}`)}">${escapeHtml(entryRow.stationName)}</span><strong class="monthly-cost-ranking-cost">${formatPrice(entry.monthlyCost, entryCurrency)}</strong></div><span class="monthly-cost-ranking-group"><span class="monthly-cost-ranking-group-name">${escapeHtml(entryRow.groupName || "未分组")}</span>${isCurrent ? '<span class="monthly-cost-ranking-current">当前</span>' : ""}</span>${cellChartMarkup({ width: entryWidth, title: entryTitle })}</li>`;
  }).join("");
  return `<div class="monthly-cost-popover" data-monthly-cost-panel role="group" aria-label="同模型月成本排名" hidden><div class="monthly-cost-popover-heading"><strong>月成本排名 ${entries.length} 条</strong><span>当前第 ${rank || "—"} / ${total} 名</span></div><ol class="monthly-cost-ranking-list">${items || '<li class="monthly-cost-ranking-empty">暂无可排名报价</li>'}</ol></div>`;
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
  $("#reference-status").textContent = count ? `基准价 ${count}` : "基准价未加载";
  $("#reference-note").textContent = fetched ? fetched.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "";
  $("#reference-dot").classList.toggle("is-live", count > 0);
  const warnings = ref.warnings?.length ? ref.warnings.join("；") : "";
  const cacheNote = "基准目录每日缓存 · USD credit 1:1 · 人民币按设置汇率";
  pill.title = fetched ? `${cacheNote}${warnings ? `；${warnings}` : ""}` : warnings || cacheNote;
  pill.hidden = false;
  $("#freshness-sep").hidden = false;
}
// 顶栏合并读数：中转站快照时间 · 基准价缓存时间，两边齐全就折叠成一行。
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
    const needsLogin = station.needsLogin === true || record.lastStatus === "needs-login";
    const statusText = needsLogin ? "未登录" : record.lastStatus === "error" ? record.lastResult || "查询失败" : record.lastResult || "尚未查询";
    const statusClass = needsLogin ? "checkin-status-warn" : record.lastStatus === "error" ? "checkin-status-error" : claimedToday ? "checkin-status-ok" : "checkin-status-idle";
    const host = (station.hosts || [])[0];
    const tokenHint = station.tokenHint || "粘贴站点令牌或 Cookie 值";
    const sessionNote = station.hasSession ? " · 登录已保存" : "";
    return `
      <div class="checkin-item" data-station-id="${escapeHtml(station.id)}">
        <div class="checkin-info">
          <strong>${escapeHtml(station.name)}</strong>
          <span class="checkin-meta">${host ? `${escapeHtml(host)} · ` : ""}连续签到 ${Number(record.streak) || 0} 天 · <span class="${statusClass}">${escapeHtml(statusText)}</span>${sessionNote}</span>
        </div>
        <div class="checkin-actions">
          <label class="check-label"><input type="checkbox" data-checkin-action="auto" data-station-id="${escapeHtml(station.id)}" ${station.autoEnabled ? "checked" : ""}><span>自动签到</span></label>
          ${needsLogin
            ? `<button class="button button-quiet" type="button" data-checkin-action="login" data-station-id="${escapeHtml(station.id)}"><span>打开站点登录</span></button>`
            : `<button class="button button-quiet" type="button" data-checkin-action="claim" data-station-id="${escapeHtml(station.id)}"><span data-icon="sparkles" class="icon"></span><span>立即签到</span></button>`}
          <button class="button button-quiet" type="button" data-checkin-action="token" data-station-id="${escapeHtml(station.id)}" aria-expanded="false"><span>${station.hasManualToken ? "改令牌" : "填令牌"}</span></button>
        </div>
        <div class="checkin-token" data-token-row="${escapeHtml(station.id)}" hidden>
          <input class="checkin-token-input" type="text" spellcheck="false" placeholder="${escapeHtml(tokenHint)}" data-checkin-token="${escapeHtml(station.id)}">
          <button class="button button-quiet" type="button" data-checkin-action="save-token" data-station-id="${escapeHtml(station.id)}"><span>保存令牌</span></button>
          ${station.hasSession ? `<button class="button button-quiet" type="button" data-checkin-action="forget-session" data-station-id="${escapeHtml(station.id)}"><span>清除已存登录</span></button>` : ""}
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
  state.mediaMode = mediaModeOf(state.mediaMode);
  state.refreshPreflight = data.refreshPreflight || null;
  renderRefreshPreflight();
  state.page = 0;
  pageFilterKey = null;
  const allComparisons = data.comparisons || [];
  state.unclassifiedMediaCount = flattenComparisonRows(allComparisons)
    .filter(row => normalizeMediaType(row.mediaType ?? row.media_type) === "unknown").length;
  const modeComparisons = filterComparisonsByMediaMode(allComparisons, state.mediaMode);
  state.comparisons = modeComparisons;
  state.rows = flattenComparisonRows(modeComparisons);
  state.stationIndexes = new Map(buildStationIndexes(modeComparisons).map(item => [item.stationId, item]));
  sanitizeFiltersForRows(state.rows);
  const index = createDashboardIndex(state.rows, data.stations || []);
  state.searchTextByRow = index.searchTextByRow;
  state.modelTextByRow = index.modelTextByRow;
  state.stationById = index.stationById;
  state.reference = data.references;
  renderComparisonMode();
  renderMediaMode();
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
  const mediaLabel = MEDIA_MODE_LABELS[state.mediaMode];
  const modeEmptyTitle = state.mediaMode === "text" ? "还没有可比较的报价" : `暂无${mediaLabel}报价`;
  emptyState.querySelector("h3").textContent = publicEmpty
    ? (hasStations ? `暂无公益站${mediaLabel}报价` : "还没有公益站")
    : (hasStations ? (state.rows.length ? "站点已保存，尚未采集报价" : modeEmptyTitle) : modeEmptyTitle);
  emptyState.querySelector("p").textContent = publicEmpty
    ? "启用公益站后刷新。"
    : (hasStations ? (state.rows.length ? "点右上角刷新开始采集。" : `当前站点没有${mediaLabel}计费字段。`) : "添加中转站并刷新即可。");
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


for (const button of document.querySelectorAll("[data-media-mode]")) {
  button.addEventListener("click", () => {
    const mode = button.dataset.mediaMode;
    if (!COMPARISON_MEDIA_MODES.includes(mode) || mode === state.mediaMode || !state.data) return;
    state.mediaMode = mode;
    resetFiltersForMediaMode();
    render(state.data);
  });
}

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
const MONTHLY_COST_JUMP = "[data-monthly-cost-jump]";
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
  const jump = target.closest(MONTHLY_COST_JUMP);
  if (jump) {
    event.preventDefault();
    jumpToMonthlyCostOffer(jump.dataset.monthlyCostJump);
    return;
  }
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
  const jump = target?.closest ? target.closest(MONTHLY_COST_JUMP) : null;
  if (jump && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    jumpToMonthlyCostOffer(jump.dataset.monthlyCostJump);
    return;
  }
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
  clearTimeout(progressHideTimer);
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
    progressHideTimer = setTimeout(() => {
      progressHideTimer = null;
      panel.hidden = true;
    }, PROGRESS_HIDE_DELAY_MS);
  } else if (progress.phase === "error") {
    message.textContent = progress.message;
  }
}

$("#comparison-previous").addEventListener("click", () => { state.page--; renderRows(); });
$("#comparison-next").addEventListener("click", () => { state.page++; renderRows(); });
$("#page-size").addEventListener("change", () => { state.page = 0; renderRows(); });
// 页码输入框：回车、失焦或点其它地方都按一次提交处理，越界夹到首/末页，非法输入回填当前页。
function restorePageInput(force) {
  const input = $("#comparison-page-input");
  input.max = String(Math.max(1, state.pageCount));
  // 正在输入时不回写，避免重渲染覆盖用户打了一半的页号。
  if (!force && document.activeElement === input) return;
  input.value = state.pageCount ? String(state.page + 1) : "";
}
let cancelPageInput = false;
const commitPageInput = () => {
  if (cancelPageInput) {
    cancelPageInput = false;
    return;
  }
  const next = parsePageInput($("#comparison-page-input").value, state.pageCount);
  if (next === null || next === state.page) return restorePageInput();
  state.page = next;
  renderRows();
};
$("#comparison-page-input").addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    commitPageInput();
    event.currentTarget.blur();
  } else if (event.key === "Escape") {
    cancelPageInput = true;
    restorePageInput(true);
    event.currentTarget.blur();
  }
});
$("#comparison-page-input").addEventListener("change", commitPageInput);
$("#comparison-page-input").addEventListener("blur", commitPageInput);
// 聚焦即全选，方便直接输入覆盖；紧接着的那次 mouseup 阻止默认行为，否则点击会把全选清掉。
let selectOnFocus = false;
$("#comparison-page-input").addEventListener("focus", event => {
  event.currentTarget.select();
  selectOnFocus = true;
});
$("#comparison-page-input").addEventListener("mouseup", event => {
  if (!selectOnFocus) return;
  selectOnFocus = false;
  event.preventDefault();
});
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
  try { render(await callService("FETCH_REFERENCES")); toast("基准参考价已更新"); }
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
  const tokenButton = event.target.closest("[data-checkin-action='token']");
  if (tokenButton) {
    const row = tokenButton.closest(".checkin-item")?.querySelector("[data-token-row]");
    if (row) {
      row.hidden = !row.hidden;
      tokenButton.setAttribute("aria-expanded", String(!row.hidden));
      if (!row.hidden) row.querySelector("input")?.focus();
    }
    return;
  }
  const loginButton = event.target.closest("[data-checkin-action='login']");
  if (loginButton) {
    loginButton.disabled = true;
    try {
      await callService("OPEN_CHECKIN_LOGIN", { stationId: loginButton.dataset.stationId });
      toast("已打开登录页，登录成功后签到状态会自动更新");
    } catch (error) {
      toast(error.message || "打开登录页失败");
    } finally {
      loginButton.disabled = false;
    }
    return;
  }
  const saveTokenButton = event.target.closest("[data-checkin-action='save-token']");
  if (saveTokenButton) {
    const input = saveTokenButton.closest(".checkin-item")?.querySelector("[data-checkin-token]");
    saveTokenButton.disabled = true;
    try {
      const data = await callService("SAVE_CHECKIN", { stationId: saveTokenButton.dataset.stationId, token: input?.value || "" });
      const result = (data.results || [])[0];
      if (result?.error) throw new Error(result.error);
      toast(result?.message || "令牌已保存");
      render(await callService("GET_DASHBOARD"));
    } catch (error) {
      toast(error.message || "保存失败");
    } finally {
      saveTokenButton.disabled = false;
    }
    return;
  }
  const forgetButton = event.target.closest("[data-checkin-action='forget-session']");
  if (forgetButton) {
    forgetButton.disabled = true;
    try {
      await callService("CLEAR_CHECKIN_SESSION", { stationId: forgetButton.dataset.stationId });
      toast("已清除保存的登录");
      render(await callService("GET_DASHBOARD"));
    } catch (error) {
      toast(error.message || "清除失败");
    } finally {
      forgetButton.disabled = false;
    }
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
// 设置页会自己落库，抽屉里每改一下就重拉一次仪表盘太费；标脏，等抽屉关掉再拉。
let settingsStale = false;
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
if (settingsStale) {
    settingsStale = false;
    settingsDirty = false;
    load();
  }
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
  if (message?.type === "CHECKIN_UPDATED") load();
});
onRefreshProgress(renderRefreshProgress);
load();


document.addEventListener("visibilitychange", () => {
  if (!document.hidden) load();
});
