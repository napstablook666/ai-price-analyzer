import { collectStation, createPageFetch, prepareStationInput } from "./core/collectors.js";
import { suggestStationAdapter, inferStationAdapter } from "./core/adapters.js";
import { addFastAiStationPreset } from "./core/station-presets.js";
import { ensurePageBridge, findOrOpenPageTab } from "./core/page-tabs.js";
import { fetchReferences } from "./core/openrouter.js";
import { fetchModelCatalog, requestJevChoices, testModelConnection } from "./core/model-api.js";
import { buildComparisonRows, flattenComparisonRows, summarizeComparisons } from "./core/pricing.js";
import { getJevModelCandidates, matchModelWithOverrides, normalizeProxyModelName } from "./core/matching.js";
import { buildJevComparisonTask, buildJevModelMatchTask, isExtensionPageSender, JEV_NO_MATCH, resolveJevTaskConfig } from "./core/jev-tasks.js";
import { NORMALIZATION_VERSION } from "./core/normalizers.js";
import { snapshotNeedsRefresh } from "./core/snapshot-policy.js";
import { DEFAULT_JEV_CONFIG, DEFAULT_LLM_CONFIG, isSecureRemoteUrl, normalizeSettings, normalizeStation } from "./shared/schema.js";
import { addStationIfNeeded, exportState, getSnapshots, getStations, getValue, importState, putSnapshot, putStations, setValue } from "./shared/db.js";
import { getJevApiKey, getLlmApiKey, getProviderApiKey, getStationCredential, hasJevApiKey, hasLlmApiKey, hasProviderApiKey, removeProviderApiKey, removeStationCredential, selectProviderApiKey, setJevApiKey, setLlmApiKey, setProviderApiKey, setStationCredential } from "./shared/credentials.js";
import { matchCheckinPreset, normalizeCheckinRecord, performCheckin, CHECKIN_PRESETS } from "./core/checkin.js";

const ALARM_NAME = "refresh-stations";
const CHECKIN_ALARM_NAME = "checkin-stations";

async function getSettings() {
  return normalizeSettings(await getValue("settings", {}));
}

async function profilesForUi(kind, profiles) {
  return Promise.all((profiles || []).map(async profile => ({
    ...profile,
    hasApiKey: await hasProviderApiKey(kind, profile.id)
  })));
}
async function settingsForUi() {
  const value = await getSettings();
  const [legacyLlmKey, legacyJevKey, activeLlmKey, activeJevKey, llmProfiles, jevProfiles] = await Promise.all([
    hasLlmApiKey(),
    hasJevApiKey(),
    hasProviderApiKey("llm", value.activeProviders.llm),
    hasProviderApiKey("jev", value.activeProviders.jev),
    profilesForUi("llm", value.providerProfiles.llm),
    profilesForUi("jev", value.providerProfiles.jev)
  ]);
  return {
    ...value,
    providerProfiles: { llm: llmProfiles, jev: jevProfiles },
    llm: { ...value.llm, hasApiKey: activeLlmKey || legacyLlmKey },
    jev: { ...value.jev, hasApiKey: value.activeProviders.jev ? activeJevKey : legacyJevKey }
  };
}

async function stationWithCredentials(station) {
  const credential = await getStationCredential(station.id);
  const auth = { ...(station.auth || {}) };
  for (const field of ["token", "username", "password"]) if (!auth[field]) auth[field] = credential[field] || "";
  return { ...station, auth };
}


async function collect(stationInput, preferredTabId) {
  const station = prepareStationInput(await stationWithCredentials(stationInput));
  if (station.mode !== "page") return collectStation(station);
  const { tab, temporary } = await findOrOpenPageTab(chrome.tabs, station, preferredTabId);
  if (!tab?.id) throw new Error("无法确定站点标签页；请先登录目标站点后重试");
  try {
    let pendingCapture = await ensurePageBridge(chrome.scripting, tab.id);
    const bridgeFetch = createPageFetch((message, callback) => chrome.tabs.sendMessage(tab.id, message, callback));
    const pageFetch = request => {
      if (request?.capture && pendingCapture) {
        const capture = pendingCapture;
        pendingCapture = null;
        return Promise.resolve(capture);
      }
      return bridgeFetch(request);
    };
    pageFetch.supportsCapture = true;
    return await collectStation(station, { pageFetch });
  } finally {
    if (temporary) await chrome.tabs.remove(tab.id).catch(() => {});
  }
}

function errorSnapshot(station, error, previous) {
  return {
    id: `${station.id}:${Date.now()}`,
    normalizationVersion: NORMALIZATION_VERSION,
    stationId: station.id,
    stationName: station.name,
    collectedAt: Date.now(),
    status: "error",
    source: station.adapter?.kind || "unknown",
    normalized: previous?.normalized || { sourceFormat: "error", data: [], group_ratio: {} },
    error: error.message || String(error)
  };
}

async function refreshReferences(force = false) {
  const cache = await getValue("references", {});
  if (!force && cache.fetchedAt && Date.now() - cache.fetchedAt < 24 * 60 * 60 * 1000) return cache;
  const result = await fetchReferences({ cache });
  await setValue("references", result);
  return result;
}

async function refreshAllInternal({ forceReferences = false, stationId, sourceTabId } = {}) {
  const allStations = (await getStations()).filter(station => station.enabled && (!stationId || station.id === stationId));
  const references = await refreshReferences(forceReferences);
  const results = [];
  for (const station of allStations) {
    try {
      const snapshot = await collect(station, sourceTabId);
      await putSnapshot(snapshot);
      results.push(snapshot);
    } catch (error) {
      const previous = (await getSnapshots({ stationId: station.id, limit: 1 }))[0];
      const snapshot = errorSnapshot(station, error, previous);
      await putSnapshot(snapshot);
      results.push(snapshot);
    }
  }
  return { results, references };
}

let refreshAllPromise = null;
async function refreshAll(options = {}) {
  if (refreshAllPromise) return refreshAllPromise;
  refreshAllPromise = refreshAllInternal(options);
  try {
    return await refreshAllPromise;
  } finally {
    refreshAllPromise = null;
  }
}


let legacySnapshotRefreshPromise = null;
async function refreshLegacySnapshots(stations, snapshots) {
  if (legacySnapshotRefreshPromise) return legacySnapshotRefreshPromise;
  const latestByStation = new Map();
  for (const snapshot of snapshots) {
    if (!latestByStation.has(snapshot.stationId)) latestByStation.set(snapshot.stationId, snapshot);
  }
  const candidates = stations.filter(station => {
    const snapshot = latestByStation.get(station.id);
    return station.enabled && snapshot && snapshotNeedsRefresh(station, snapshot);
  });
  if (!candidates.length) return false;
  legacySnapshotRefreshPromise = (async () => {
    for (const station of candidates) {
      try {
        await refreshAll({ stationId: station.id });
      } catch (error) {
        console.warn("AI Pricing: 旧版快照迁移失败", station.id, error);
      }
    }
    return true;
  })();
  try {
    await legacySnapshotRefreshPromise;
  } finally {
    legacySnapshotRefreshPromise = null;
  }
  return true;
}
async function ensureFastAiStationPreset() {
  await addStationIfNeeded(stations => {
    if (!stations.length) return null;
    const next = addFastAiStationPreset(stations);
    return next === stations ? null : normalizeStation(prepareStationInput(next[next.length - 1]));
  });
}


async function dashboard() {
  await ensureFastAiStationPreset();
  let [stations, snapshots, references, savedSettings] = await Promise.all([
    getStations(),
    getSnapshots({ limit: 500 }),
    getValue("references", {}),
    settingsForUi()
  ]);
  const migrated = await refreshLegacySnapshots(stations, snapshots);
  if (migrated) {
    [stations, snapshots, references] = await Promise.all([
      getStations(),
      getSnapshots({ limit: 500 }),
      getValue("references", {})
    ]);
  }
  const staleAfter = savedSettings.refreshIntervalMinutes * 60 * 1000 * 2;
  const stationsById = new Map(stations.map(station => [station.id, station]));
  const usableSnapshots = snapshots.filter(snapshot => !snapshotNeedsRefresh(stationsById.get(snapshot.stationId), snapshot));
  const normalizedSnapshots = usableSnapshots.map(snapshot => ({
    ...snapshot,
    stale: snapshot.status !== "success" || Date.now() - snapshot.collectedAt > staleAfter
  }));
  const comparisons = buildComparisonRows({
    stations,
    snapshots: normalizedSnapshots,
    references: { ...references, exchangeRate: savedSettings.exchangeRate || references.exchangeRate },
    usage: savedSettings.usage,
    rules: savedSettings.matchingRules,
    modelMatchOverrides: savedSettings.modelMatchOverrides,
    showUnmatched: savedSettings.showUnmatched,
    recommendationProfile: savedSettings.recommendationProfile
  });
  const effectiveReferences = { ...references, exchangeRate: savedSettings.exchangeRate || references.exchangeRate };
  const checkinStations = CHECKIN_PRESETS.map(preset => {
    const linked = stations.find(station => station.enabled && matchCheckinPreset(station)?.id === preset.id);
    return { id: preset.id, name: preset.name, linkedStationId: linked ? linked.id : null, autoEnabled: Boolean(linked?.checkin?.autoEnabled) };
  });
  return { stations, snapshots: normalizedSnapshots, references: effectiveReferences, settings: savedSettings, comparisons, summary: summarizeComparisons(comparisons), checkinState: await getCheckinState(), checkinStations };
}

async function scheduleAlarm() {
  const savedSettings = await getSettings();
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: Math.max(0.5, Number(savedSettings.refreshIntervalMinutes) || 15) });
  await chrome.alarms.clear(CHECKIN_ALARM_NAME);
  chrome.alarms.create(CHECKIN_ALARM_NAME, { periodInMinutes: 240 });
}

// ---- 站点签到 ----
async function getCheckinState() {
  return await getValue("checkinState", {});
}

async function updateCheckinRecord(stationId, updater) {
  const state = await getCheckinState();
  const record = updater(normalizeCheckinRecord(state[stationId] || {}));
  await setValue("checkinState", { ...state, [stationId]: record });
  return record;
}

async function runCheckinForStation(station, { claim = true, autoOnly = false } = {}) {
  const preset = matchCheckinPreset(station);
  if (!preset) return null;
  const record = (await getCheckinState())[preset.id] || {};
  if (autoOnly && !record.autoEnabled) return null;
  // 冷却期内（cooldownHours）不重复查询状态，减少无效请求
  if (record.lastClaimedAt && Date.now() - record.lastClaimedAt < preset.cooldownHours * 60 * 60 * 1000) return null;
  try {
    const result = await performCheckin({ station, claim, preset });
    await updateCheckinRecord(preset.id, prev => ({
      ...prev,
      lastCheckedAt: Date.now(),
      lastClaimedAt: result.claimed ? Date.now() : prev.lastClaimedAt,
      lastResult: result.message,
      lastStatus: "ok",
      streak: result.streak,
      rewardAmount: result.rewardAmount,
      bonusPercent: result.bonusPercent,
      totalClaimed: result.totalClaimed,
      lastClaimDate: result.lastClaimDate || prev.lastClaimDate,
      autoEnabled: record.autoEnabled
    }));
    return { stationId: preset.id, stationName: station.name, ...result };
  } catch (error) {
    await updateCheckinRecord(preset.id, prev => ({
      ...prev,
      lastCheckedAt: Date.now(),
      lastResult: error.message || String(error),
      lastStatus: "error",
      autoEnabled: record.autoEnabled
    }));
    return { stationId: preset.id, stationName: station.name, ok: false, error: error.message || String(error) };
  }
}

async function checkinAll({ stationId, stationOrigin, claim = true, autoOnly = false } = {}) {
  let origin = "";
  if (stationOrigin) {
    try { origin = new URL(stationOrigin).origin; } catch { origin = String(stationOrigin || "").trim(); }
  }
  let stations = (await getStations()).filter(station => {
    if (!station.enabled) return false;
    if (stationId) { const preset = CHECKIN_PRESETS.find(item => item.id === String(stationId)); return station.id === stationId || (preset ? matchCheckinPreset(station)?.id === preset.id : false); }
    if (origin) {
      try { return new URL(station.baseUrl).origin === origin; } catch { return false; }
    }
    return true;
  });
  // 预设兜底：指定预设 id 但没有已保存站点，或自动签到遍历时，构造签到专用伪站点（record 按预设 id 统一存储，无需手动添加站点）
  if (!stations.length && stationId) {
    const preset = CHECKIN_PRESETS.find(item => item.id === String(stationId));
    if (preset) stations = [{ id: preset.id, name: preset.name, baseUrl: `https://${preset.matchHosts[0]}`, enabled: true }];
  } else if (!stationOrigin && !stationId) {
    const linkedIds = new Set((await getStations()).map(item => matchCheckinPreset(item)?.id).filter(Boolean));
    for (const preset of CHECKIN_PRESETS) {
      if (!linkedIds.has(preset.id)) stations.push({ id: preset.id, name: preset.name, baseUrl: `https://${preset.matchHosts[0]}`, enabled: true });
    }
  }
  const results = [];
  for (const station of stations) {
    const result = await runCheckinForStation(station, { claim, autoOnly });
    if (result) results.push(result);
  }
  return { results, state: await getCheckinState() };
}

async function saveCheckinConfig({ stationId, autoEnabled } = {}) {
  const stations = await getStations();
  const station = stations.find(item => item.id === String(stationId || ""));
  if (!station) {
    // 预设 id（未保存站点）：签到开关存到 checkinState，无需手动添加站点
    if (!CHECKIN_PRESETS.some(item => item.id === String(stationId || ""))) throw new Error("站点不存在");
    await updateCheckinRecord(String(stationId), prev => ({ ...prev, autoEnabled: Boolean(autoEnabled) }));
    return checkinAll({ stationId: String(stationId), claim: false, autoOnly: false });
  }
  const next = stations.map(item => item.id === station.id ? normalizeStation({ ...item, checkin: { ...item.checkin, autoEnabled: Boolean(autoEnabled) } }) : item);
  await putStations(next);
  return checkinAll({ stationId: station.id, claim: false, autoOnly: false });
}
async function saveStations(input) {
  const current = await getStations();
  const currentById = new Map(current.map(station => [station.id, station]));
  const wanted = new Set(input.map(station => station.id));
  for (const station of current) {
    if (!wanted.has(station.id)) await removeStationCredential(station.id);
  }
  const stations = [];
  for (const raw of input) {
    const station = normalizeStation(prepareStationInput(raw));
    const submitted = station.auth || {};
    const previous = currentById.get(station.id);
    if (!previous || previous.baseUrl !== station.baseUrl || previous.auth?.type !== submitted.type) await removeStationCredential(station.id);
    const stored = await getStationCredential(station.id);
    if (submitted.type === "none") await removeStationCredential(station.id);
    else await setStationCredential(station.id, {
      token: submitted.token || stored.token,
      username: submitted.username || stored.username,
      password: submitted.password || stored.password
    });
    stations.push({ ...station, auth: { type: submitted.type, token: "", username: "", password: "" } });
  }
  await putStations(stations);
  return stations;
}

async function saveSettings(input, { llmApiKey, clearLlmApiKey, jevApiKey, clearJevApiKey } = {}) {
  const llmBaseUrl = String(input?.llm?.baseUrl || "").trim();
  const jevBaseUrl = String(input?.jev?.baseUrl || "").trim();
  if (llmBaseUrl && !isSecureRemoteUrl(llmBaseUrl)) throw new Error("LLM 地址必须使用 HTTPS；仅允许 localhost 使用 HTTP");
  if (jevBaseUrl && !isSecureRemoteUrl(jevBaseUrl)) throw new Error("JEV 地址必须使用 HTTPS；仅允许 localhost 使用 HTTP");
  const next = normalizeSettings(input);
  for (const kind of ["llm", "jev"]) {
    const activeId = next.activeProviders[kind];
    if (!activeId) continue;
    next.providerProfiles[kind] = next.providerProfiles[kind].map(profile => profile.id === activeId ? { ...profile, ...next[kind] } : profile);
  }
  if (clearLlmApiKey) {
    await setLlmApiKey("");
    if (next.activeProviders.llm) await removeProviderApiKey("llm", next.activeProviders.llm);
  } else if (llmApiKey !== undefined && String(llmApiKey).trim()) {
    await setLlmApiKey(llmApiKey);
    if (next.activeProviders.llm) await setProviderApiKey("llm", next.activeProviders.llm, llmApiKey);
  }
  if (clearJevApiKey) {
    await setJevApiKey("");
    if (next.activeProviders.jev) await removeProviderApiKey("jev", next.activeProviders.jev);
  } else if (jevApiKey !== undefined && String(jevApiKey).trim()) {
    await setJevApiKey(jevApiKey);
    if (next.activeProviders.jev) await setProviderApiKey("jev", next.activeProviders.jev, jevApiKey);
  }
  await setValue("settings", next);
  await scheduleAlarm();
  return settingsForUi();
}
async function saveProviderProfile({ kind, profileId, name, config = {}, apiKey, clearApiKey } = {}) {
  const normalizedKind = kind === "jev" ? "jev" : "llm";
  const baseUrl = String(config.baseUrl || "").trim();
  if (!baseUrl) throw new Error("请先填写 API 地址");
  if (!isSecureRemoteUrl(baseUrl)) throw new Error(`${normalizedKind === "jev" ? "JEV" : "LLM"} 地址必须使用 HTTPS；仅允许 localhost 使用 HTTP`);
  const current = await getSettings();
  const id = String(profileId || crypto.randomUUID()).trim();
  const displayName = String(name || "").trim() || new URL(baseUrl).hostname;
  const profile = normalizeSettings({
    providerProfiles: { [normalizedKind]: [{ id, name: displayName, ...config, baseUrl }] }
  }).providerProfiles[normalizedKind][0];
  const profiles = current.providerProfiles[normalizedKind].filter(item => item.id !== id);
  const next = normalizeSettings({
    ...current,
    [normalizedKind]: profile,
    providerProfiles: { ...current.providerProfiles, [normalizedKind]: [...profiles, profile] },
    activeProviders: { ...current.activeProviders, [normalizedKind]: id }
  });
  if (clearApiKey) await removeProviderApiKey(normalizedKind, id);
  else if (String(apiKey || "").trim()) await setProviderApiKey(normalizedKind, id, apiKey);
  else if (!await hasProviderApiKey(normalizedKind, id)) {
    const legacyKey = normalizedKind === "jev" ? await getJevApiKey() : await getLlmApiKey();
    if (legacyKey) await setProviderApiKey(normalizedKind, id, legacyKey);
  }
  const storedKey = await getProviderApiKey(normalizedKind, id);
  if (normalizedKind === "jev") await setJevApiKey(storedKey);
  else await setLlmApiKey(storedKey);
  await setValue("settings", next);
  await scheduleAlarm();
  return settingsForUi();
}
async function switchProvider({ kind, profileId } = {}) {
  const normalizedKind = kind === "jev" ? "jev" : "llm";
  const current = await getSettings();
  const profile = current.providerProfiles[normalizedKind].find(item => item.id === String(profileId || ""));
  if (!profile) throw new Error("供应商档案不存在或已删除");
  const next = normalizeSettings({
    ...current,
    [normalizedKind]: profile,
    activeProviders: { ...current.activeProviders, [normalizedKind]: profile.id }
  });
  const key = await getProviderApiKey(normalizedKind, profile.id);
  if (normalizedKind === "jev") await setJevApiKey(key);
  else await setLlmApiKey(key);
  await setValue("settings", next);
  await scheduleAlarm();
  return dashboard();
}
async function deleteProviderProfile({ kind, profileId } = {}) {
  const normalizedKind = kind === "jev" ? "jev" : "llm";
  const current = await getSettings();
  const id = String(profileId || "");
  if (!id) return settingsForUi();
  const wasActive = current.activeProviders[normalizedKind] === id;
  const remaining = current.providerProfiles[normalizedKind].filter(profile => profile.id !== id);
  const nextProfile = remaining[0] || null;
  const next = normalizeSettings({
    ...current,
    [normalizedKind]: nextProfile || (normalizedKind === "jev" ? DEFAULT_JEV_CONFIG : DEFAULT_LLM_CONFIG),
    providerProfiles: { ...current.providerProfiles, [normalizedKind]: remaining },
    activeProviders: { ...current.activeProviders, [normalizedKind]: nextProfile?.id || "" }
  });
  await removeProviderApiKey(normalizedKind, id);
  if (wasActive) {
    const key = nextProfile ? await getProviderApiKey(normalizedKind, nextProfile.id) : "";
    if (normalizedKind === "jev") await setJevApiKey(key);
    else await setLlmApiKey(key);
  }
  await setValue("settings", next);
  await scheduleAlarm();
  return settingsForUi();
}

function discoveryFromSnapshot(snapshot) {
  const models = (snapshot.normalized?.data || []).map(row => {
    const id = String(row.model_name || "").trim().slice(0, 160);
    return id ? { id, name: String(row.model_display_name || "").trim().slice(0, 160), inputPrice: Number.isFinite(Number(row.input_price)) ? Number(row.input_price) : null, outputPrice: Number.isFinite(Number(row.output_price)) ? Number(row.output_price) : null } : null;
  }).filter(Boolean);
  return { url: snapshot.rawMeta?.url || "", status: snapshot.rawMeta?.status || 200, sourceFormat: snapshot.normalized?.sourceFormat || "unknown", modelCount: models.length, models: models.slice(0, 24) };
}

async function adaptStation(message) {
  const current = normalizeSettings(message.settings || await getSettings());
  const station = message.station || {};
  const local = inferStationAdapter(station, current.jev);
  const probeStation = { ...station, adapter: { ...(station.adapter || {}), endpoint: local.endpoint, method: "GET", responseFormat: "auto" } };
  let discovery = null;
  let discoveryWarning = "";
  try {
    discovery = discoveryFromSnapshot(await collect(probeStation, message.sourceTabId));
    if (!discovery.modelCount) discoveryWarning = "地址已响应，但没有识别到模型列表或价格数据";
  } catch (error) {
    discovery = { url: station.baseUrl || "", status: 0, sourceFormat: "error", modelCount: 0, models: [] };
    discoveryWarning = `公开模型列表探测失败（仍可确认添加）：${error.message}`;
  }
  const activeKey = await getProviderApiKey("llm", current.activeProviders.llm);
  const apiKey = String(message.llmApiKey || "").trim() || activeKey || await getLlmApiKey();
  const notices = discoveryWarning ? [discoveryWarning] : [];
  try {
    const suggestion = await suggestStationAdapter({ station, llm: current.llm, jev: current.jev, discovery, apiKey });
    if (!current.llm.enabled) notices.push("未启用 LLM，已使用本地规则");
    return { suggestion, discovery, warning: notices.join("；") };
  } catch (error) {
    return {
      suggestion: { ...local, source: "fallback" },
      discovery,
      warning: [...notices, `LLM 未响应，已使用本地规则：${error.message}`].join("；")
    };
  }
}

async function getModelRequestConfig(message) {
  const kind = message.kind === "jev" ? "jev" : "llm";
  const settings = normalizeSettings(message.settings || await getSettings());
  const isJev = kind === "jev";
  const baseUrl = String(isJev ? settings.jev.baseUrl : settings.llm.baseUrl).trim();
  const modelId = String(message.modelId || (isJev ? settings.jev.modelId : settings.llm.model) || "").trim();
  const explicitKey = String(isJev ? (message.jevApiKey || "") : (message.llmApiKey || "")).trim();
  const profileId = settings.activeProviders[kind];
  const activeKey = await getProviderApiKey(kind, profileId);
  const legacyKey = isJev ? (profileId ? "" : await getJevApiKey()) : await getLlmApiKey();
  const storedKey = selectProviderApiKey(kind, profileId, activeKey, legacyKey);
  return { kind, baseUrl, modelId, apiKey: explicitKey || storedKey };
}

async function fetchModels(message) {
  const config = await getModelRequestConfig(message);
  return fetchModelCatalog(config);
}

async function testModel(message) {
  const config = await getModelRequestConfig(message);
  return testModelConnection({ ...config, model: config.modelId });
}


function activeJevProfile(settings) {
  return settings.providerProfiles.jev.find(item => item.id === settings.activeProviders.jev) || settings.jev;
}


async function jevRequestConfig(settings) {
  const profile = activeJevProfile(settings);
  const profileId = settings.activeProviders.jev;
  const activeKey = await getProviderApiKey("jev", profileId);
  const legacyKey = profileId ? "" : await getJevApiKey();
  const apiKey = selectProviderApiKey("jev", profileId, activeKey, legacyKey);
  return resolveJevTaskConfig({ jev: profile }, apiKey);
}

async function runJevTask(message) {
  const task = message.task === "model_match" ? "model_match" : message.task === "comparison_review" ? "comparison_review" : "";
  if (!task) throw new Error("未知 JEV 任务");
  const stationId = String(message.stationId || "").trim();
  const modelName = String(message.modelName || "").trim();
  if (!stationId || !modelName) throw new Error("缺少站点或模型标识");

  const data = await dashboard();
  const station = data.stations.find(item => item.id === stationId);
  const snapshot = data.snapshots.find(item => item.stationId === stationId);
  const source = snapshot?.normalized?.data?.find(item => item.model_name === modelName && !item.catalogOnly);
  if (!station || !source) throw new Error("当前站点中没有此模型报价");

  const settings = await getSettings();
  const config = await jevRequestConfig(settings);
  if (Number(message.collectedAt) !== Number(snapshot.collectedAt) || (message.referencesFetchedAt ?? null) !== (data.references.fetchedAt ?? null) || message.jevProfileId !== settings.activeProviders.jev || message.jevBaseUrl !== config.baseUrl || message.jevModelId !== config.model) {
    throw new Error("报价、官方目录或 JEV 配置已变化，请刷新页面后重试");
  }
  let requestTask;
  let questionId;
  let collectedAt = snapshot.collectedAt;
  if (task === "model_match") {
    if (settings.modelMatchOverrides.some(item => item.stationId === stationId && normalizeProxyModelName(item.modelName) === normalizeProxyModelName(modelName))) throw new Error("该模型已有人工确认的匹配");
    const { directMatches, candidates } = getJevModelCandidates(modelName, data.references.models || [], settings.matchingRules);
    if (directMatches.length === 1 && directMatches[0].ruleId === "exact") throw new Error("该模型已有精确匹配，无需 JEV 建议");
    requestTask = buildJevModelMatchTask(modelName, candidates);
    questionId = "model_match";
  } else {
    const groupName = String(message.groupName || "").trim();
    const tierName = String(message.tierName || "").trim();
    const offer = flattenComparisonRows(data.comparisons).find(item => item.stationId === stationId && item.modelName === modelName && item.groupName === groupName && item.tierName === tierName && item.officialName === String(message.officialName || "").trim());
    if (!offer?.officialName) throw new Error("找不到当前官方匹配报价");
    collectedAt = offer.collectedAt;
    requestTask = buildJevComparisonTask(offer);
    questionId = "comparison_review";
  }

  const result = await requestJevChoices({ ...config, ...requestTask });
  return {
    task, stationId, modelName, groupName: String(message.groupName || ""), tierName: String(message.tierName || ""), collectedAt,
    jevProfileId: settings.activeProviders.jev, jevBaseUrl: config.baseUrl, jevModelId: config.model,
    referencesFetchedAt: data.references.fetchedAt ?? null, taskState: requestTask.state,
    candidateIds: task === "model_match" ? Object.keys(requestTask.questions[questionId].criteria).filter(id => id !== JEV_NO_MATCH).sort() : [],
    choice: result.answers[questionId].choice, confidence: result.answers[questionId].confidence
  };
}

async function saveJevModelMatch(message) {
  const stationId = String(message.stationId || "").trim();
  const modelName = String(message.modelName || "").trim();
  const officialModelId = String(message.officialModelId || "").trim();
  const [stations, snapshots, references, settings] = await Promise.all([
    getStations(), getSnapshots({ stationId, limit: 500 }), getValue("references", {}), getSettings()
  ]);
  if (!stations.some(station => station.id === stationId)) throw new Error("中转站不存在");
  const activeJev = activeJevProfile(settings);
  if (Number(message.collectedAt) !== Number(snapshots[0]?.collectedAt) || (message.referencesFetchedAt ?? null) !== (references.fetchedAt ?? null) || message.jevProfileId !== settings.activeProviders.jev || message.jevBaseUrl !== String(activeJev.baseUrl || "").trim() || message.jevModelId !== String(activeJev.modelId || "").trim()) {
    throw new Error("报价、官方目录或 JEV 配置已变化，请刷新页面后重试");
  }
  if (snapshots[0]?.status !== "success" || !snapshots[0].normalized?.data?.some(item => item.model_name === modelName && !item.catalogOnly)) throw new Error("最新报价已变化或采集失败，请先重新采集");
  if (!references.models?.some(model => (model.id || model.name) === officialModelId)) throw new Error("官方模型候选已失效，请重新获取官方数据");
  if (settings.modelMatchOverrides.some(item => item.stationId === stationId && normalizeProxyModelName(item.modelName) === normalizeProxyModelName(modelName))) throw new Error("该模型已有人工确认的匹配");
  const { directMatches, candidates } = getJevModelCandidates(modelName, references.models, settings.matchingRules);
  const currentCandidateIds = candidates.map(model => String(model.id || model.name)).sort();
  if (JSON.stringify(message.candidateIds) !== JSON.stringify(currentCandidateIds)) throw new Error("官方模型候选已变化，请重新获取 JEV 建议");
  if (directMatches.length === 1 && directMatches[0].ruleId === "exact") throw new Error("该模型已有精确匹配，无需人工覆盖");
  if (officialModelId === JEV_NO_MATCH || !candidates.some(model => (model.id || model.name) === officialModelId)) throw new Error("模型不在当前 JEV 候选范围内");
  const modelMatchOverrides = [...settings.modelMatchOverrides, { stationId, modelName, officialModelId }];
  await setValue("settings", normalizeSettings({ ...settings, modelMatchOverrides }));
  return dashboard();
}

async function removeJevModelMatch(message) {
  const stationId = String(message.stationId || "").trim();
  const modelName = String(message.modelName || "").trim();
  const settings = await getSettings();
  const modelMatchOverrides = settings.modelMatchOverrides.filter(item => !(item.stationId === stationId && normalizeProxyModelName(item.modelName) === normalizeProxyModelName(modelName)));
  await setValue("settings", normalizeSettings({ ...settings, modelMatchOverrides }));
  return dashboard();
}

function requireExtensionPage(sender) {
  if (!isExtensionPageSender(sender, chrome.runtime.getURL(""))) throw new Error("此 JEV 操作仅能从扩展面板发起");
}


async function handle(message, sender) {
  switch (message.type) {
    case "GET_DASHBOARD": return dashboard();
    case "GET_SETTINGS": return settingsForUi();
    case "SAVE_SETTINGS": return saveSettings(message.settings, message);
    case "SAVE_PROVIDER_PROFILE": return saveProviderProfile(message);
    case "SWITCH_PROVIDER": return switchProvider(message);
    case "DELETE_PROVIDER_PROFILE": return deleteProviderProfile(message);
    case "SAVE_STATIONS": return saveStations(message.stations);
    case "ADAPT_STATION": return adaptStation(message);
    case "FETCH_MODELS": return fetchModels(message);
    case "TEST_MODEL": return testModel(message);
    case "ANALYZE_JEV":
      requireExtensionPage(sender);
      return runJevTask(message);
    case "SAVE_JEV_MODEL_MATCH":
      requireExtensionPage(sender);
      return saveJevModelMatch(message);
    case "REMOVE_JEV_MODEL_MATCH":
      requireExtensionPage(sender);
      return removeJevModelMatch(message);
    case "CHECKIN_STATUS":
      return checkinAll({ stationId: message.stationId, stationOrigin: message.stationOrigin, claim: false, autoOnly: false });
    case "CHECKIN_NOW":
      return checkinAll({ stationId: message.stationId, stationOrigin: message.stationOrigin, claim: true, autoOnly: false });
    case "SAVE_CHECKIN":
      return saveCheckinConfig(message);
    case "REFRESH_ALL":
      await refreshAll({ forceReferences: Boolean(message.forceReferences) });
      return dashboard();
    case "REFRESH_STATION":
      await refreshAll({ stationId: message.stationId, sourceTabId: message.sourceTabId });
      return dashboard();
    case "FETCH_REFERENCES":
      await refreshReferences(true);
      return dashboard();
    case "EXPORT_STATE": return exportState();
    case "IMPORT_STATE": {
      const imported = Array.isArray(message.state?.stations) ? message.state.stations : [];
      const importedById = new Map(imported.map(station => [station.id, station]));
      for (const station of imported) await removeStationCredential(station.id);
      for (const current of await getStations()) {
        const next = importedById.get(current.id);
        if (!next || String(next.baseUrl || "") !== current.baseUrl || String(next.auth?.type || "none") !== current.auth?.type) await removeStationCredential(current.id);
      }
      await importState(message.state);
      await scheduleAlarm();
      return dashboard();
    }
    case "TEST_STATION": {
      const snapshot = await collect(message.station);
      return { ok: true, snapshot };
    }
    default: throw new Error(`未知操作：${message.type}`);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(data => sendResponse({ ok: true, data })).catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => scheduleAlarm());
chrome.runtime.onStartup.addListener(() => scheduleAlarm());
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) refreshAll().catch(() => {});
  if (alarm.name === CHECKIN_ALARM_NAME) checkinAll({ claim: true, autoOnly: true }).catch(() => {});
});
