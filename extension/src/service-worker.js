import { collectStation, createPageFetch, prepareStationInput } from "./core/collectors.js";
import { suggestStationAdapter, inferStationAdapter } from "./core/adapters.js";
import { selectPageTab } from "./core/page-tabs.js";
import { fetchReferences } from "./core/openrouter.js";
import { fetchModelCatalog, testModelConnection } from "./core/model-api.js";
import { buildComparisonRows, summarizeComparisons } from "./core/pricing.js";
import { NORMALIZATION_VERSION } from "./core/normalizers.js";
import { snapshotNeedsRefresh } from "./core/snapshot-policy.js";
import { DEFAULT_JEV_CONFIG, DEFAULT_LLM_CONFIG, isSecureRemoteUrl, normalizeSettings, normalizeStation } from "./shared/schema.js";
import { exportState, getSnapshots, getStations, getValue, importState, putSnapshot, putStations, setValue } from "./shared/db.js";
import { getJevApiKey, getLlmApiKey, getProviderApiKey, getStationCredential, hasJevApiKey, hasLlmApiKey, hasProviderApiKey, removeProviderApiKey, removeStationCredential, setJevApiKey, setLlmApiKey, setProviderApiKey, setStationCredential } from "./shared/credentials.js";

const ALARM_NAME = "refresh-stations";

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
    jev: { ...value.jev, hasApiKey: activeJevKey || legacyJevKey }
  };
}

async function stationWithCredentials(station) {
  const credential = await getStationCredential(station.id);
  const auth = { ...(station.auth || {}) };
  for (const field of ["token", "username", "password"]) if (!auth[field]) auth[field] = credential[field] || "";
  return { ...station, auth };
}

async function findPageTab(station, preferredTabId) {
  const origin = new URL(station.baseUrl).origin;
  return selectPageTab(await chrome.tabs.query({}), origin, preferredTabId);
}

async function collect(stationInput, preferredTabId) {
  const station = await stationWithCredentials(stationInput);
  if (station.mode !== "page") return collectStation(station);
  const tab = await findPageTab(station, preferredTabId);
  if (!tab?.id) throw new Error("无法唯一确定站点标签页；请从目标页重新识别添加，或关闭其他同域标签页");
  return collectStation(station, { pageFetch: createPageFetch((message, callback) => chrome.tabs.sendMessage(tab.id, message, callback)) });
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
async function dashboard() {
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
    showUnmatched: savedSettings.showUnmatched,
    recommendationProfile: savedSettings.recommendationProfile
  });
  const effectiveReferences = { ...references, exchangeRate: savedSettings.exchangeRate || references.exchangeRate };
  return { stations, snapshots: normalizedSnapshots, references: effectiveReferences, settings: savedSettings, comparisons, summary: summarizeComparisons(comparisons) };
}

async function scheduleAlarm() {
  const savedSettings = await getSettings();
  await chrome.alarms.clear(ALARM_NAME);
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: Math.max(0.5, Number(savedSettings.refreshIntervalMinutes) || 15) });
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
    discoveryWarning = `公开模型列表探测失败：${error.message}`;
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
  const baseUrl = String((isJev ? settings.jev.baseUrl : settings.llm.baseUrl) || settings.llm.baseUrl).trim();
  const modelId = String(message.modelId || (isJev ? settings.jev.modelId : settings.llm.model) || "").trim();
  const explicitKey = String(isJev ? (message.jevApiKey || message.llmApiKey || "") : (message.llmApiKey || "")).trim();
  const activeKey = await getProviderApiKey(kind, settings.activeProviders[kind]);
  const legacyKey = isJev ? await getJevApiKey() : await getLlmApiKey();
  const storedKey = activeKey || legacyKey;
  const fallbackKey = isJev && !storedKey ? await getLlmApiKey() : "";
  return { kind, baseUrl, modelId, apiKey: explicitKey || storedKey || fallbackKey };
}

async function fetchModels(message) {
  const config = await getModelRequestConfig(message);
  return fetchModelCatalog(config);
}

async function testModel(message) {
  const config = await getModelRequestConfig(message);
  return testModelConnection({ ...config, model: config.modelId });
}


async function handle(message) {
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handle(message).then(data => sendResponse({ ok: true, data })).catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => scheduleAlarm());
chrome.runtime.onStartup.addListener(() => scheduleAlarm());
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === ALARM_NAME) refreshAll().catch(() => {});
});
