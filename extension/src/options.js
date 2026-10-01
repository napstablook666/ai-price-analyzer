import { cloneDefaultStation, convertRechargeAmount, currentSiteOrigin, DEFAULT_EXCHANGE_RATE, normalizeSettings, normalizeUrl, REFRESH_PRESETS, TOKENS_PER_MILLION, USAGE_PRESETS, usagePresetId } from "./shared/schema.js";
import { callService, downloadJson, escapeHtml, hydrateIcons, icon } from "./shared/ui.js";

const state = { stations: [], settings: null, modelCatalog: { llm: [], jev: [] }, collapsedStationIds: new Set(), pendingStation: null, previewRequestId: 0 };
const $ = selector => document.querySelector(selector);

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { node.hidden = true; }, 3600);
}

function selected(value, expected) { return value === expected ? " selected" : ""; }
function checked(value) { return value ? " checked" : ""; }

function modelSelect(kind) {
  return $(kind === "jev" ? "#jev-model-id" : "#llm-model");
}


function profileSelect(kind) {
  return $(kind === "jev" ? "#jev-profile" : "#llm-profile");
}
function profileNameInput(kind) {
  return $(kind === "jev" ? "#jev-profile-name" : "#llm-profile-name");
}
function renderProviderProfiles(kind) {
  const select = profileSelect(kind);
  const nameInput = profileNameInput(kind);
  if (!select || !nameInput) return;
  const profiles = state.settings?.providerProfiles?.[kind] || [];
  const activeId = state.settings?.activeProviders?.[kind] || "";
  select.innerHTML = `<option value="">当前配置（未保存）</option>${profiles.map(profile => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name || profile.baseUrl || profile.id)}</option>`).join("")}`;
  select.value = activeId;
  nameInput.value = profiles.find(profile => profile.id === activeId)?.name || "";
}
function renderModelOptions(kind, selectedValue = "") {
  const field = modelSelect(kind);
  if (!field) return;
  const selected = String(selectedValue || "").trim();
  const models = [...(state.modelCatalog[kind] || [])];
  if (selected && !models.some(model => String(model.id || "") === selected)) models.unshift({ id: selected, name: "已保存" });
  const options = models.map(model => {
    const id = String(model.id || "").trim();
    const name = String(model.name || "").trim();
    return id ? { id, label: name && name !== id ? `${id} · ${name}` : id } : null;
  }).filter(Boolean);
  if (field instanceof HTMLInputElement) {
    const datalist = $(`#${kind}-model-list`);
    if (datalist) datalist.innerHTML = options.map(({ id, label }) => `<option value="${escapeHtml(id)}" label="${escapeHtml(label)}"></option>`).join("");
    field.value = selected;
    return;
  }
  field.innerHTML = `<option value="">${options.length ? "选择模型" : "先获取模型列表"}</option>${options.map(({ id, label }) => `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`).join("")}`;
  field.value = selected;
}

function modelStatus(kind, message, error = false) {
  const node = $(`#${kind}-model-status`);
  node.textContent = message;
  node.dataset.error = error ? "true" : "false";
}

async function runModelAction(kind, action) {
  const button = $(`#${action === "fetch" ? `fetch-${kind}-models` : `test-${kind}-model`}`);
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `${icon("loader-circle", { className: "icon spin" })}<span>${action === "fetch" ? "获取中" : "测试中"}</span>`;
  modelStatus(kind, action === "fetch" ? "正在获取模型列表..." : "正在测试模型...");
  try {
    const message = {
      kind,
      settings: readSettings(),
      llmApiKey: $("#llm-api-key").value.trim(),
      jevApiKey: $("#jev-api-key").value.trim()
    };
    if (action === "test") message.modelId = modelSelect(kind).value;
    const result = await callService(action === "fetch" ? "FETCH_MODELS" : "TEST_MODEL", message);
    if (action === "fetch") {
      state.modelCatalog[kind] = result.models || [];
      renderModelOptions(kind, modelSelect(kind).value);
      modelStatus(kind, result.models?.length ? `已获取 ${result.models.length} 个模型` : "接口未返回模型");
    } else {
      modelStatus(kind, result.message || "模型可用");
      toast(result.message || "模型测试通过");
    }
  } catch (error) {
    modelStatus(kind, error.message, true);
    toast(error.message);
  } finally {
    button.disabled = false;
    button.innerHTML = original;
    hydrateIcons(button);
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

function updateStationRechargeRate(card) {
  const amountInput = card.querySelector('[data-field="rechargeAmount"]');
  const currencySelect = card.querySelector('[data-field="rechargeCurrency"]');
  const creditsInput = card.querySelector('[data-field="rechargeCredits"]');
  const rmb = convertRechargeAmount(amountInput.value, currencySelect.value, "CNY", currentExchangeRate()) ?? 0;
  const credits = Number(creditsInput.value);
  const rate = derivedRechargeRate(rmb, credits);
  card.querySelector('[data-field="rechargeRate"]').value = rate.toFixed(4);
  card.querySelector("[data-recharge-rate-display]").textContent = `每 1 中转币成本 ¥${rate.toFixed(4)}`;
  card.querySelector(".station-summary-meta").children[1].textContent = `${formatRechargeAmount(amountInput.value || 0)} ${currencySelect.value} : ${creditsInput.value || 0} 中转币`;
}

function stationCard(station, index) {
  const adapter = station.adapter || {};
  const auth = station.auth || {};
  const rechargeRmb = nonNegativeNumber(station.rechargeRmb, station.rechargeRate || 1);
  const rechargeCurrency = station.rechargeCurrency === "USD" ? "USD" : "CNY";
  const rechargeAmount = convertRechargeAmount(rechargeRmb, "CNY", rechargeCurrency, currentExchangeRate());
  const rechargeCredits = Number(station.rechargeCredits) > 0 ? Number(station.rechargeCredits) : 1;
  const origin = currentSiteOrigin(station.baseUrl);
  const isFastAiToken = ["https://fastaitoken.com", "https://www.fastaitoken.com"].includes(origin);
  const stationHint = station.mode === "page"
    ? isFastAiToken ? "FastAIToken 会复用本 Chrome 配置文件中的登录状态，采集令牌不会保存到扩展。" : "页面模式：请先在当前标签页登录；采集会复用该页面会话。"
    : "直接模式：智能填充会先读取上面的模型列表地址，通常无需登录；需要登录时切换页面模式。";
  return `<article class="station-card" data-station-id="${escapeHtml(station.id)}" data-index="${index}">
    <details class="station-disclosure"${state.collapsedStationIds.has(station.id) ? "" : " open"}>
      <summary class="station-summary">
        <div class="station-title"><span class="status-dot ${station.enabled ? "is-live" : ""}"></span><div><p class="station-kicker">STATION ${String(index + 1).padStart(2, "0")}</p><h3>${escapeHtml(station.name || "未命名站点")}</h3><span class="station-id">${escapeHtml(station.id)}</span></div></div>
        <div class="station-summary-meta"><span>${station.enabled ? "已启用" : "已停用"}</span><span>${formatRechargeAmount(rechargeAmount)} ${rechargeCurrency} : ${rechargeCredits} 中转币</span><span data-icon="chevron-down" class="icon station-chevron" aria-hidden="true"></span></div>
      </summary>
      <div class="station-content">
        <div class="station-actions"><button class="button button-primary button-small" data-save-station type="button">${icon("bookmark-plus", { className: "icon" })}<span>保存站点</span></button><button class="button button-quiet button-small" data-autofill-station type="button">${icon("wand-sparkles", { className: "icon" })}<span>智能填充</span></button><button class="button button-quiet button-small" data-test-station type="button">${icon("plug-zap", { className: "icon" })}<span>测试连接</span></button><button class="icon-button danger-icon" data-remove-station type="button" title="删除站点" aria-label="删除站点">${icon("trash-2", { className: "icon" })}</button></div>
        <div class="station-grid">
          <label><span>站点名称</span><input data-field="name" value="${escapeHtml(station.name)}" placeholder="例如：主用站"></label>
          <label class="wide"><span>模型列表 / 站点地址</span><input data-field="baseUrl" type="url" value="${escapeHtml(station.baseUrl)}" placeholder="https://relay.example.com/v1/models" required></label>
          <label><span>采集模式</span><select data-field="mode"><option value="direct"${selected(station.mode, "direct")}>直接接口</option><option value="page"${selected(station.mode, "page")}>页面桥接</option></select></label>
          <label class="wide"><span>请求体 JSON（可选）</span><textarea data-field="body" rows="2" placeholder='{"model":"..."}'>${escapeHtml(adapter.body || "")}</textarea></label>
          <label><span>接口路径（可选）</span><input data-field="endpoint" value="${escapeHtml(adapter.endpoint || "")}" placeholder="留空自动探测，例如 /api/pricing"></label>
          <label><span>响应格式</span><select data-field="responseFormat"><option value="auto"${selected(adapter.responseFormat, "auto")}>自动识别</option><option value="pqh"${selected(adapter.responseFormat, "pqh")}>P站 / PQH</option><option value="sora"${selected(adapter.responseFormat, "sora")}>Sora</option></select></label>
          <label class="wide"><span>手动价格 JSON（可选）</span><textarea data-field="rawJson" rows="3" placeholder='{"data":[{"model":"gpt-4o","input":2,"output":8}]}'>${escapeHtml(adapter.rawJson || "")}</textarea></label>
          <label><span>请求方式</span><select data-field="method"><option value="GET"${selected(adapter.method, "GET")}>GET</option><option value="POST"${selected(adapter.method, "POST")}>POST</option></select></label>
          <label><span>认证方式</span><select data-field="authType"><option value="none"${selected(auth.type, "none")}>无</option><option value="bearer"${selected(auth.type, "bearer")}>Bearer Token</option><option value="api-key"${selected(auth.type, "api-key")}>X-API-Key</option><option value="basic"${selected(auth.type, "basic")}>Basic</option></select></label>
          <label><span>Token / 密钥</span><input data-field="token" type="password" value="${escapeHtml(auth.token || "")}" placeholder="留空则保留已有密钥"></label>
          <label><span>用户名</span><input data-field="username" value="${escapeHtml(auth.username || "")}" autocomplete="off"></label>
          <label><span>密码</span><input data-field="password" type="password" value="${escapeHtml(auth.password || "")}" autocomplete="off"></label>
          <div class="station-money-field"><label for="station-recharge-amount-${index}">充值金额</label><div class="station-money-input"><input id="station-recharge-amount-${index}" data-field="rechargeAmount" type="number" min="0" step="any" value="${rechargeAmount}"><select data-field="rechargeCurrency" data-previous-currency="${rechargeCurrency}" aria-label="充值金额币种"><option value="CNY"${selected(rechargeCurrency, "CNY")}>人民币 CNY</option><option value="USD"${selected(rechargeCurrency, "USD")}>美元 USD</option></select></div></div>
          <label><span>到账中转币</span><input data-field="rechargeCredits" type="number" min="0.000001" step="0.01" value="${rechargeCredits}"></label>
          <label><span>充值比例（¥ / 币）</span><input data-field="rechargeRate" type="number" min="0" step="0.0001" value="${derivedRechargeRate(rechargeRmb, rechargeCredits).toFixed(4)}" readonly><small data-recharge-rate-display>每 1 中转币成本 ¥${derivedRechargeRate(rechargeRmb, rechargeCredits).toFixed(4)}</small></label>
          <label><span>基础价 / 1M USD</span><input data-field="basePricePerMillion" type="number" min="0" step="0.0001" value="${nonNegativeNumber(station.basePricePerMillion, 2)}"></label>
          <label class="check-label"><input data-field="enabled" type="checkbox"${checked(station.enabled)}><span>参与自动刷新</span></label>
        </div>
        <p class="station-hint"><span data-icon="${station.mode === "page" ? "panel-top" : "activity"}" class="icon"></span>${stationHint}</p>
      </div>
    </details>
  </article>`;
}

function renderStations() {
  const list = $("#stations-list");
  list.innerHTML = state.stations.length
    ? state.stations.map(stationCard).join("")
    : `<div class="station-empty"><span data-icon="database" class="icon empty-icon"></span><strong>还没有站点</strong><span>添加后开始跨站点比较。</span></div>`;
  hydrateIcons(list);
}

const USAGE_INPUTS = [
  { field: "input", id: "usage-input", million: true },
  { field: "cacheRead", id: "usage-cache-read", million: true },
  { field: "cacheWrite", id: "usage-cache-write", million: true },
  { field: "output", id: "usage-output", million: true },
  { field: "requests", id: "usage-requests", million: false },
  { field: "imageTokens", id: "usage-image-tokens", million: true },
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

function syncPresetControls() {
  const refresh = REFRESH_PRESETS.find(preset => preset.minutes === Number($("#refresh-interval").value));
  $("#refresh-preset").value = refresh?.id || "custom";
  $("#usage-preset").value = usagePresetId(readUsageInputs());
}

function applyRefreshPreset(id) {
  if (id === "custom") return;
  const preset = REFRESH_PRESETS.find(item => item.id === id);
  if (preset) $("#refresh-interval").value = preset.minutes;
  syncPresetControls();
}

function applyUsagePreset(id) {
  if (id === "custom") return;
  const preset = USAGE_PRESETS.find(item => item.id === id);
  if (preset) writeUsageInputs(preset.usage);
  syncPresetControls();
}

function renderSettings() {
  const settings = state.settings;
  $("#refresh-interval").value = settings.refreshIntervalMinutes;
  $("#currency").value = settings.defaultCurrency;
  $("#exchange-rate").value = Number(settings.exchangeRate || DEFAULT_EXCHANGE_RATE).toFixed(4);
  $("#recommendation-profile").value = settings.recommendationProfile || "price";
  writeUsageInputs(settings.usage);
  syncPresetControls();
  $("#show-unmatched").checked = settings.showUnmatched;

  for (const rule of settings.matchingRules || []) {
    const input = document.querySelector(`[data-matching-rule="${rule.id}"]`);
    if (input) input.checked = Boolean(rule.enabled);
  }
  const llm = settings.llm || {};
  $("#llm-enabled").checked = Boolean(llm.enabled);
  renderProviderProfiles("llm");
  $("#llm-provider").value = llm.provider || "openai-compatible";
  $("#llm-base-url").value = llm.baseUrl || "";
  renderModelOptions("llm", llm.model);
  $("#llm-temperature").value = llm.temperature ?? 0.1;
  $("#llm-system-prompt").value = llm.systemPrompt || "";
  $("#llm-api-key").value = "";
  $("#clear-llm-key").checked = false;
  $("#llm-api-key").placeholder = llm.hasApiKey ? "已配置，留空保持当前密钥" : "sk-...";
  $("#llm-key-status").textContent = llm.hasApiKey ? "已配置 API Key" : "尚未配置 API Key";

  const jev = settings.jev || {};
  renderProviderProfiles("jev");
  $("#jev-enabled").checked = Boolean(jev.enabled);
  $("#jev-base-url").value = jev.baseUrl || "";
  $("#jev-api-key").value = "";
  $("#clear-jev-key").checked = false;
  $("#jev-api-key").placeholder = jev.hasApiKey ? "已配置，留空保持当前密钥" : "sk-...";
  $("#jev-key-status").textContent = jev.hasApiKey ? "已配置 API Key" : "尚未配置 API Key";
  renderModelOptions("jev", jev.modelId);
  $("#jev-model-name").value = jev.modelName || "";
  $("#jev-version").value = jev.version || "";
  $("#jev-endpoint").value = jev.endpoint || "";
  $("#jev-response-format").value = jev.responseFormat || "auto";
  $("#jev-notes").value = jev.notes || "";
}

function readStations() {
  return [...document.querySelectorAll(".station-card")].map(card => {
    const value = field => card.querySelector(`[data-field="${field}"]`)?.value || "";
    const rechargeCurrency = value("rechargeCurrency") === "USD" ? "USD" : "CNY";
    const rechargeRmb = convertRechargeAmount(value("rechargeAmount"), rechargeCurrency, "CNY", currentExchangeRate()) ?? 0;
    return {
      id: card.dataset.stationId || crypto.randomUUID(),
      name: value("name"),
      baseUrl: value("baseUrl"),
      mode: value("mode"),
      enabled: card.querySelector('[data-field="enabled"]')?.checked ?? true,
      rechargeRmb,
      rechargeCurrency,
      rechargeCredits: Number(value("rechargeCredits")) > 0 ? Number(value("rechargeCredits")) : 1,
      rechargeRate: derivedRechargeRate(rechargeRmb, Number(value("rechargeCredits")) || 0),
      basePricePerMillion: nonNegativeNumber(value("basePricePerMillion"), 2),
      auth: { type: value("authType"), token: value("token"), username: value("username"), password: value("password") },
      adapter: { kind: "custom", endpoint: value("endpoint"), body: value("body"), rawJson: value("rawJson"), method: value("method"), responseFormat: value("responseFormat") },
      tags: []
    };
  });
}

function readSettings() {
  return normalizeSettings({
    ...state.settings,
    refreshIntervalMinutes: Math.max(1, Number($("#refresh-interval").value) || 15),
    defaultCurrency: $("#currency").value,
    recommendationProfile: $("#recommendation-profile").value,
    exchangeRate: Math.max(0.0001, Number($("#exchange-rate").value) || DEFAULT_EXCHANGE_RATE),
    matchingRules: [...document.querySelectorAll("[data-matching-rule]")].map(input => ({ id: input.dataset.matchingRule, name: input.parentElement.textContent.trim(), enabled: input.checked })),
    usage: readUsageInputs(),
    showUnmatched: $("#show-unmatched").checked,
    llm: {
      enabled: $("#llm-enabled").checked,
      provider: $("#llm-provider").value,
      baseUrl: $("#llm-base-url").value,
      model: $("#llm-model").value,
      temperature: Number($("#llm-temperature").value),
      systemPrompt: $("#llm-system-prompt").value
    },
    jev: {
      enabled: $("#jev-enabled").checked,
      baseUrl: $("#jev-base-url").value,
      modelId: $("#jev-model-id").value,
      modelName: $("#jev-model-name").value,
      version: $("#jev-version").value,
      endpoint: $("#jev-endpoint").value,
      responseFormat: $("#jev-response-format").value,
      notes: $("#jev-notes").value
    }
  });
}

function applySuggestion(card, suggestion) {
  const set = (field, value, replace = false) => {
    const input = card.querySelector(`[data-field="${field}"]`);
    if (!input || !value) return;
    if (replace || !input.value || input.value === "/api/ai/pricing" || input.value === "auto" || input.value === "none") input.value = value;
  };
  set("name", suggestion.name);
  set("baseUrl", suggestion.baseUrl);
  set("mode", suggestion.mode, true);
  set("endpoint", suggestion.endpoint);
  set("body", suggestion.body);
  set("responseFormat", suggestion.responseFormat);
  set("method", suggestion.method);
  set("authType", suggestion.authType);
}

async function adaptStation(card, preservePageMode = false, sourceTabId) {
  const button = card.querySelector("[data-autofill-station]");
  const station = readStations().find(item => item.id === card.dataset.stationId);
  if (!station) return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.dataset.label = button.innerHTML;
  button.innerHTML = `${icon("loader-circle", { className: "icon spin" })}<span>分析中</span>`;
  try {
    const result = await callService("ADAPT_STATION", { station, settings: readSettings(), llmApiKey: $("#llm-api-key").value.trim(), ...(Number.isInteger(sourceTabId) ? { sourceTabId } : {}) });
    applySuggestion(card, { ...result.suggestion, ...(preservePageMode ? { mode: "page" } : {}) });
    const source = result.suggestion?.source === "llm" ? "LLM" : result.suggestion?.source === "fallback" ? "本地规则" : "本地探测";
    const detail = result.discovery ? `，已探测 ${result.discovery.modelCount || 0} 个模型` : "";
    toast(`${result.warning ? `${result.warning}；` : ""}已用 ${source}填充采集字段${detail}，请点击当前站点的“保存站点”`);
  } catch (error) { toast(error.message); }
  finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.innerHTML = button.dataset.label;
    hydrateIcons(button);
  }
}
async function saveStation(card) {
  const button = card.querySelector("[data-save-station]");
  const stations = readStations();
  const station = stations.find(item => item.id === card.dataset.stationId);
  const sourceTabId = /^\d+$/.test(card.dataset.sourceTabId || "") ? Number(card.dataset.sourceTabId) : undefined;
  if (!station?.baseUrl) throw new Error("请先填写站点地址");
  if (stations.some(item => !item.baseUrl)) throw new Error("请填写所有站点地址");
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `${icon("loader-circle", { className: "icon spin" })}<span>保存中</span>`;
  try {
    state.stations = await callService("SAVE_STATIONS", { stations });
    renderStations();
    try {
      const data = await callService("REFRESH_STATION", { stationId: station.id, ...(sourceTabId === undefined ? {} : { sourceTabId }) });
      state.stations = data.stations || state.stations;
      renderStations();
      const snapshot = (data.snapshots || []).find(row => row.stationId === station.id);
      const count = snapshot?.normalized?.data?.length || 0;
      if (snapshot?.status === "success") toast(`中转站已保存并采集 ${count} 条报价`);
      else toast(`中转站已保存，但采集失败：${snapshot?.error || "请查看仪表盘"}`);
    } catch (error) {
      toast(`中转站已保存，但刷新失败：${error.message}`);
    }
  } finally {
    button.disabled = false;
    button.innerHTML = original;
    hydrateIcons(button);
  }
}


async function saveProviderProfile(kind) {
  const settings = readSettings();
  const result = await callService("SAVE_PROVIDER_PROFILE", {
    kind,
    profileId: profileSelect(kind).value,
    name: profileNameInput(kind).value.trim(),
    config: settings[kind],
    apiKey: $(`#${kind}-api-key`).value.trim(),
    clearApiKey: $(`#clear-${kind}-key`).checked
  });
  state.settings = result;
  state.modelCatalog[kind] = [];
  renderSettings();
  toast("供应商档案已保存");
}
async function saveModelSettings(kind) {
  const button = $(`#save-${kind}-settings`);
  const current = readSettings();
  const settings = normalizeSettings({ ...state.settings, [kind]: current[kind] });
  const apiKey = $(`#${kind}-api-key`).value.trim();
  const clearApiKey = $(`#clear-${kind}-key`).checked;
  const keyFields = kind === "llm"
    ? { llmApiKey: apiKey, clearLlmApiKey: clearApiKey }
    : { jevApiKey: apiKey, clearJevApiKey: clearApiKey };
  const original = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `${icon("loader-circle", { className: "icon spin" })}<span>保存中</span>`;
  try {
    state.settings = await callService("SAVE_SETTINGS", { settings, ...keyFields });
    renderSettings();
    toast(`${kind === "jev" ? "JEV" : "LLM"} 配置已保存；API Key 已安全保存，不会回显`);
  } finally {
    button.disabled = false;
    button.innerHTML = original;
    hydrateIcons(button);
  }
}

async function switchProvider(kind, profileId) {
  if (!profileId) return;
  const result = await callService("SWITCH_PROVIDER", { kind, profileId });
  state.settings = result.settings;
  state.modelCatalog[kind] = [];
  renderSettings();
  toast(`已切换 ${kind === "jev" ? "JEV" : "LLM"} 供应商`);
}
async function deleteProviderProfile(kind) {
  const profileId = profileSelect(kind).value;
  if (!profileId) return toast("当前配置还没有保存为供应商档案");
  if (!window.confirm("删除当前供应商档案？对应 API Key 也会删除。")) return;
  state.settings = await callService("DELETE_PROVIDER_PROFILE", { kind, profileId });
  state.modelCatalog[kind] = [];
  renderSettings();
  toast("供应商档案已删除");
}
async function load() {
  try {
    const data = await callService("GET_DASHBOARD");
    state.stations = data.stations || [];
    state.collapsedStationIds = new Set(state.stations.map(station => station.id));
    state.settings = data.settings;
    state.modelCatalog = { llm: [], jev: [] };
    renderSettings();
    renderStations();
    hydrateIcons();
    const params = new URLSearchParams(location.search);
    const siteOrigin = currentSiteOrigin(params.get("addSite"));
    if (siteOrigin) {
      const sourceTabId = params.get("sourceTabId");
      const preferredTabId = /^\d+$/.test(sourceTabId || "") ? Number(sourceTabId) : undefined;
      history.replaceState(null, "", location.pathname);
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
  const formatLabels = { auto: "自动识别", pqh: "P站 / PQH", sora: "Sora" };
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
  const source = suggestion.source === "llm" ? "LLM" : suggestion.source === "fallback" ? "本地规则" : "本地探测";
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
  for (const card of $("#stations-list").querySelectorAll(".station-card")) updateStationRechargeRate(card);
  updatePreviewRechargeRate();
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
    state.collapsedStationIds.delete(existing.id);
    const disclosure = card?.querySelector(".station-disclosure");
    if (disclosure) disclosure.open = true;
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
    const result = await callService("ADAPT_STATION", { station, settings: readSettings(), llmApiKey: $("#llm-api-key").value.trim(), ...(Number.isInteger(sourceTabId) ? { sourceTabId } : {}) });
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
      responseFormat: ["auto", "pqh", "sora"].includes(suggestion.responseFormat) ? suggestion.responseFormat : pending.station.adapter.responseFormat
    }
  };
  state.collapsedStationIds.delete(station.id);
  state.stations.push(station);
  renderStations();
  const card = document.querySelector(`[data-station-id="${station.id}"]`);
  if (Number.isInteger(pending.sourceTabId) && card) card.dataset.sourceTabId = String(pending.sourceTabId);
  card?.scrollIntoView({ behavior: "smooth", block: "center" });
  $("#add-station-dialog").close();
  toast("站点已添加，请点击“保存站点”使配置生效");
}

function closeStationDialog() {
  $("#add-station-dialog").close();
}

$("#add-station").addEventListener("click", () => openStationDialog());
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

$("#stations-list").addEventListener("toggle", event => {
  const details = event.target;
  if (!details.matches(".station-disclosure")) return;
  const stationId = details.closest(".station-card")?.dataset.stationId;
  if (!stationId) return;
  details.open ? state.collapsedStationIds.delete(stationId) : state.collapsedStationIds.add(stationId);
}, true);
$("#stations-list").addEventListener("click", async event => {
  const card = event.target.closest(".station-card");
  if (!card) return;
  if (event.target.closest("[data-remove-station]")) {
    state.collapsedStationIds.delete(card.dataset.stationId);
    state.stations = readStations().filter(station => station.id !== card.dataset.stationId);
    renderStations();
    return;
  }
  if (event.target.closest("[data-save-station]")) {
    await saveStation(card).catch(error => toast(error.message));
    return;
  }
  if (event.target.closest("[data-autofill-station]")) {
    await adaptStation(card);
    return;
  }
  if (event.target.closest("[data-test-station]")) {
    const button = event.target.closest("[data-test-station]");
    button.disabled = true;
    try {
      const station = readStations().find(item => item.id === card.dataset.stationId);
      const result = await callService("TEST_STATION", { station });
      toast(`连接成功：${result.snapshot.normalized.data.length} 条价格记录`);
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  }
});
$("#stations-list").addEventListener("input", event => {
  const card = event.target.closest(".station-card");
  if (!card) return;
  const summary = card.querySelector(".station-summary-meta");
  if (event.target.matches('[data-field="name"]')) {
    card.querySelector(".station-title h3").textContent = event.target.value || "未命名站点";
    return;
  }
  if (event.target.matches('[data-field="enabled"]')) {
    summary.children[0].textContent = event.target.checked ? "已启用" : "已停用";
    card.querySelector(".status-dot").classList.toggle("is-live", event.target.checked);
    return;
  }
  if (!event.target.matches('[data-field="rechargeAmount"], [data-field="rechargeCredits"]')) return;
  updateStationRechargeRate(card);
});
$("#stations-list").addEventListener("change", event => {
  if (!event.target.matches('[data-field="rechargeCurrency"]')) return;
  const card = event.target.closest(".station-card");
  if (!card) return;
  changeRechargeCurrency(card.querySelector('[data-field="rechargeAmount"]'), event.target);
  updateStationRechargeRate(card);
});

$("#fetch-llm-models").addEventListener("click", () => runModelAction("llm", "fetch"));
$("#test-llm-model").addEventListener("click", () => runModelAction("llm", "test"));
$("#fetch-jev-models").addEventListener("click", () => runModelAction("jev", "fetch"));
$("#test-jev-model").addEventListener("click", () => runModelAction("jev", "test"));
$("#save-llm-profile").addEventListener("click", () => saveProviderProfile("llm").catch(error => toast(error.message)));
$("#delete-llm-profile").addEventListener("click", () => deleteProviderProfile("llm").catch(error => toast(error.message)));
$("#save-jev-profile").addEventListener("click", () => saveProviderProfile("jev").catch(error => toast(error.message)));
$("#save-llm-settings").addEventListener("click", () => saveModelSettings("llm").catch(error => toast(error.message)));
$("#save-jev-settings").addEventListener("click", () => saveModelSettings("jev").catch(error => toast(error.message)));
$("#delete-jev-profile").addEventListener("click", () => deleteProviderProfile("jev").catch(error => toast(error.message)));
$("#llm-profile").addEventListener("change", event => switchProvider("llm", event.target.value).catch(error => toast(error.message)));
$("#jev-profile").addEventListener("change", event => switchProvider("jev", event.target.value).catch(error => toast(error.message)));
["llm", "jev"].forEach(kind => {
  const maybeFetchModels = () => {
    const hasBaseUrl = $(`#${kind}-base-url`).value.trim();
    const hasKey = $(`#${kind}-api-key`).value.trim() || state.settings?.[kind]?.hasApiKey || (kind === "jev" && ($("#llm-api-key").value.trim() || state.settings?.llm?.hasApiKey));
    if (hasBaseUrl && hasKey) runModelAction(kind, "fetch");
  };
  $(`#${kind}-base-url`).addEventListener("change", maybeFetchModels);
  $(`#${kind}-api-key`).addEventListener("change", maybeFetchModels);
});

$("#refresh-preset").addEventListener("change", event => applyRefreshPreset(event.target.value));
$("#usage-preset").addEventListener("change", event => applyUsagePreset(event.target.value));
$("#refresh-interval").addEventListener("input", syncPresetControls);
for (const { id } of USAGE_INPUTS) $(`#${id}`).addEventListener("input", syncPresetControls);

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
    const stations = readStations();
    if (stations.some(station => !station.baseUrl)) throw new Error("请填写所有站点地址");
    state.stations = await callService("SAVE_STATIONS", { stations });
    renderStations();
    const settings = await callService("SAVE_SETTINGS", {
      settings: readSettings(),
      llmApiKey: $("#llm-api-key").value.trim(),
      clearLlmApiKey: $("#clear-llm-key").checked,
      jevApiKey: $("#jev-api-key").value.trim(),
      clearJevApiKey: $("#clear-jev-key").checked
    });
    state.settings = settings;
    try {
      const data = await callService("REFRESH_ALL");
      state.settings = data.settings || settings;
      state.stations = data.stations || [];
      renderSettings();
      renderStations();
      toast("设置已保存并刷新报价");
    } catch (error) {
      renderSettings();
      toast(`设置已保存，但刷新失败：${error.message}`);
    }
  } catch (error) { toast(error.message); }
  finally {
    button.disabled = false;
    button.innerHTML = button.dataset.label;
    hydrateIcons(button);
  }
});

$("#export-state").addEventListener("click", async () => {
  try { downloadJson(`ai-relay-price-${new Date().toISOString().slice(0, 10)}.json`, await callService("EXPORT_STATE")); }
  catch (error) { toast(error.message); }
});

$("#import-file").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    await callService("IMPORT_STATE", { state: JSON.parse(await file.text()) });
    await load();
    toast("数据已导入；密钥需要重新填写");
  } catch (error) { toast(error.message); }
  finally { event.target.value = ""; }
});

hydrateIcons();
load();
