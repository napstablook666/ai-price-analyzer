import { collectStation, createPageFetch } from "./core/collectors.js";
import { modelAliasesForStations, prepareStationInput, providerForStation } from "./core/provider-registry.js";
import { buildStationRequest, resolveStationCollection } from "./core/request-strategy.js";
import { REFRESH_CONFIRMATION_REQUIRED_CODE, REFRESH_CONFIRMATION_REQUIRED_MESSAGE, REFRESH_PREFLIGHT_TTL_MS, assertRefreshConfirmation, classifyPageSessionError, classifyPageSessionResponse, refreshStationSignature, requiresPageSessionPreflight, sanitizePreflightUrl } from "./core/refresh-preflight.js";
import { inferStationAdapter } from "./core/adapters.js";
import { addProviderStationPresets } from "./core/station-presets.js";
import { loadSitePluginForStation, loadSitePlugins, pruneSitePlugins, syncSitePlugins, syncSpecSitePlugins, unloadSpecSitePlugin } from "./site-plugins/loader.js";
import { sitePluginById, sitePluginCatalogForStations, sitePluginForStation } from "./site-plugins/catalog.js";
import { activeCatalogForStations, activePluginIds, activeSitePluginForStation, installedPluginIds, setActivePluginIds } from "./site-plugins/activation.js";
import { PLUGIN_REGISTRY_SNAPSHOT } from "./site-plugins/registry-snapshot.js";
import { DEFAULT_PLUGIN_REGISTRY_URL, comparePluginVersions, installedCheckinSpecs, installedPluginSpecs, normalizeLocalPlugins, normalizePluginSpec, normalizeRegistryPayload, normalizeRegistryState } from "./core/declarative-plugin.js";
import { ensurePageBridge, findOrOpenPageTab } from "./core/page-tabs.js";
import { withKeyedLock } from "./core/concurrency.js";
import { runRefreshAll } from "./core/refresh-scheduler.js";
import { fetchReferences } from "./core/openrouter.js";
import { buildComparisonRows, buildStationIndexes, filterComparisonsByMode, flattenComparisonRows, summarizeComparisons } from "./core/pricing.js";
import { normalizeProxyModelName } from "./core/matching.js";
import { NORMALIZATION_VERSION } from "./core/normalizers.js";
import { snapshotNeedsRefresh } from "./core/snapshot-policy.js";
import { normalizeSettings, normalizeStation } from "./shared/schema.js";
import { exportState, getComparisonRevision, getLatestSnapshots, getSnapshots, getStations, getValue, importState, putSnapshot, putStations, setValue } from "./shared/db.js";
import { getModelAssistantKey, getStationCredential, removeStationCredential, setStationCredential, setModelAssistantKey } from "./shared/credentials.js";
import { completeChat, fetchModelCatalog, testModelConnection } from "./core/model-api.js";
import { ASSIST_BATCH_SIZE, applyAssistResults, buildAssistEntries, buildAssistPrompt, collectUnmatchedModels, llmMatchesFromCache, overrideFromAssist, parseAssistResponse, selectPendingEntries, summarizeCache } from "./core/llm-matching.js";
import { checkinPresetsFromSpecs, matchCheckinPreset, normalizeCheckinRecord, performCheckin } from "./core/checkin.js";

const LEGACY_REFRESH_ALARM_NAME = "refresh-stations";
const CHECKIN_ALARM_NAME = "checkin-stations";

const REFRESH_CONCURRENCY = 3;
const REFRESH_PREFLIGHT_SESSION_KEY = "ai-price-analyzer:refresh-preflight";
const REFRESH_PREFLIGHT_TABS_SESSION_KEY = "ai-price-analyzer:refresh-preflight-tabs";
const REFRESH_GROUP_LABELS = Object.freeze({ paid: "付费中转站", public: "公益站" });
const REFRESH_NO_STATIONS_CODE = "REFRESH_NO_STATIONS";
const REFRESH_NO_STATIONS_MESSAGE = "当前分组没有启用的站点，未发起刷新";

function isMissingTabError(error) {
  return /No tab with id|tab not found/i.test(String(error?.message || error));
}
let comparisonCache = null;
async function getSettings() {
  return normalizeSettings(await getValue("settings", {}));
}

async function settingsForUi() {
  const settings = await getSettings();
  return { ...settings, hasModelAssistantKey: Boolean(await getModelAssistantKey()) };
}

function bundledPluginVersion() {
  try {
    return chrome.runtime.getManifest?.().version || "";
  } catch {
    return "";
  }
}
let workspacePluginsSynced = false;

// 出厂不带插件：老工作区里已经加过站点，就把站点对应的插件补记成已安装，只写一次。
async function adoptStationPlugins(stations, settings) {
  const registry = normalizeRegistryState(settings.pluginRegistry);
  const installed = { ...registry.installed };
  let changed = false;
  for (const station of stations) {
    const plugin = sitePluginForStation(station);
    if (!plugin || !sitePluginById(plugin.id) || installed[plugin.id]) continue;
    installed[plugin.id] = { version: bundledPluginVersion(), installedAt: Date.now() };
    changed = true;
  }
  if (!changed) return settings;
  const next = normalizeSettings({
    ...settings,
    pluginInstallMigrated: true,
    pluginRegistry: { ...settings.pluginRegistry, installed }
  });
  await persistSettings(next);
  return next;
}

// 仓库安装与本地开发的声明式插件只在内存注册表里，service worker 重启后要重新拼一次。
async function ensureWorkspacePlugins({ force = false } = {}) {
  if (workspacePluginsSynced && !force) return;
  try {
    const settings = await getSettings();
    setActivePluginIds(installedPluginIds(settings));
    syncSpecSitePlugins(installedPluginSpecs(settings));
    workspacePluginsSynced = true;
  } catch (error) {
    // 注册失败不能拖垮采集与刷新，下一次调用再试。
    workspacePluginsSynced = false;
    console.debug("[AI比价] 插件注册失败", error);
  }
}

async function persistSettings(settings) {
  await setValue("settings", normalizeSettings(settings));
  workspacePluginsSynced = false;
  await ensureWorkspacePlugins({ force: true });
  return getSettings();
}

async function stationWithCredentials(station) {
  if (station.adapter?.kind === "linux-do-marketplace") return { ...station, auth: { type: "none" } };
  const credential = await getStationCredential(station.id);
  const auth = { ...(station.auth || {}) };
  for (const field of ["token", "username", "password"]) if (!auth[field]) auth[field] = credential[field] || "";
  return { ...station, auth };
}

export async function withPageFetch(station, preferredTabId, task, { existingTab } = {}) {
  const origin = new URL(station.baseUrl).origin;
  return withKeyedLock(origin, async () => {
    const { tab, temporary } = existingTab?.id
      ? { tab: existingTab, temporary: false }
      : await findOrOpenPageTab(chrome.tabs, station, preferredTabId);
    if (!tab?.id) throw new Error("请先在当前 Chrome 配置文件登录目标站点一次后重试");
    try {
      let pendingCapture = await ensurePageBridge(chrome.scripting, tab.id);
      const bridgeFetch = createPageFetch((message, callback) => chrome.tabs.sendMessage(tab.id, message, callback));
      let bridgeRetryUsed = false;
      const recoverBridge = async () => {
        if (bridgeRetryUsed) return;
        bridgeRetryUsed = true;
        await ensurePageBridge(chrome.scripting, tab.id, { forceContent: true });
      };
      const pageFetch = request => {
        if (request?.capture && pendingCapture) {
          const capture = pendingCapture;
          pendingCapture = null;
          return Promise.resolve(capture);
        }
        return bridgeFetch(request).catch(async error => {
          if (!/Receiving end does not exist|message channel closed before a response was received/i.test(error.message || "")) throw error;
          await recoverBridge();
          return bridgeFetch(request);
        });
      };
      pageFetch.supportsCapture = true;
      return await task(pageFetch);
    } finally {
      if (temporary) {
        try {
          await chrome.tabs.remove(tab.id);
        } catch (error) {
          if (!isMissingTabError(error)) console.warn("[AI比价] 临时标签页清理失败", error);
        }
      }
    }
  });
}

async function collect(stationInput, preferredTabId) {
  await ensureWorkspacePlugins();
  await loadSitePluginForStation(stationInput);
  const collection = resolveStationCollection(await stationWithCredentials(stationInput));
  const { station } = collection;
  if (station.mode !== "page") return collectStation(station, { collection });
  return withPageFetch(station, preferredTabId, pageFetch => collectStation(station, { pageFetch, collection }));
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

function notifyRefreshProgress(progress) {
  chrome.runtime.sendMessage({ type: "REFRESH_PROGRESS", progress: { ...progress, refreshInProgress: !["complete", "error"].includes(progress.phase) || Boolean(refreshReferencesTask) } }, () => void chrome.runtime.lastError);
}

function notifyReferencesRefresh(active) {
  chrome.runtime.sendMessage({ type: "REFERENCES_REFRESHING", active: Boolean(refreshAllTask || active) }, () => void chrome.runtime.lastError);
}

function prepareComparisonStation(station) {
  const prepared = normalizeStation(prepareStationInput(station));
  // 没装的插件不参与匹配，站点退回手动适配器。
  return { ...prepared, pluginId: activeSitePluginForStation(prepared)?.id || "" };
}

async function getPreparedStations() {
  const stations = await getStations();
  const settings = await adoptStationPlugins(stations, await getSettings());
  setActivePluginIds(installedPluginIds(settings));
  await syncSitePlugins(stations);
  return stations.map(prepareComparisonStation);
}

function refreshScope(stations, comparisonMode) {
  const mode = comparisonMode === "public" ? "public" : "paid";
  const scopedStations = (stations || []).filter(station => station.enabled === true && station.category === mode);
  return {
    comparisonMode: mode,
    comparisonLabel: REFRESH_GROUP_LABELS[mode],
    stationCount: scopedStations.length,
    stations: scopedStations
  };
}

let activeRefreshPreflight = null;
let refreshConfirmationInProgress = false;
let refreshPreflightRevision = 0;
let refreshPreflightPersistence = Promise.resolve();
const refreshPreflightCreatedTabIds = new Set();
const refreshPreflightTabRevisions = new Map();
const refreshPreflightStaleTabRevisions = new Map();
const refreshPreflightTabClaims = new Map();

function newRefreshPreflightToken() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

function refreshConfirmationRequiredError() {
  const error = new Error(REFRESH_CONFIRMATION_REQUIRED_MESSAGE);
  error.code = REFRESH_CONFIRMATION_REQUIRED_CODE;
  return error;
}

function queueRefreshPreflightPersistence(operation) {
  const task = refreshPreflightPersistence.then(operation, operation);
  refreshPreflightPersistence = task.then(() => undefined, () => undefined);
  return task;
}

async function closeRefreshPreflightTabs(tabIds) {
  for (const tabId of tabIds) {
    try {
      await chrome.tabs.remove(tabId);
    } catch (error) {
      if (!isMissingTabError(error)) console.warn("[AI比价] 失效刷新预检临时标签页清理失败", error);
    }
  }
}


async function restoreRefreshPreflightState() {
  const session = chrome.storage?.session;
  if (!session) return;
  const restoreRevision = refreshPreflightRevision;
  const stored = await queueRefreshPreflightPersistence(() => session.get([REFRESH_PREFLIGHT_SESSION_KEY, REFRESH_PREFLIGHT_TABS_SESSION_KEY]));
  if (restoreRevision !== refreshPreflightRevision) return;
  if (!activeRefreshPreflight && stored[REFRESH_PREFLIGHT_SESSION_KEY]) activeRefreshPreflight = stored[REFRESH_PREFLIGHT_SESSION_KEY];
  if (Array.isArray(stored[REFRESH_PREFLIGHT_TABS_SESSION_KEY])) {
    refreshPreflightCreatedTabIds.clear();
    refreshPreflightTabRevisions.clear();
    for (const tabId of stored[REFRESH_PREFLIGHT_TABS_SESSION_KEY]) if (Number.isInteger(tabId)) {
      refreshPreflightCreatedTabIds.add(tabId);
      refreshPreflightTabRevisions.set(tabId, refreshPreflightRevision);
      refreshPreflightStaleTabRevisions.delete(tabId);
    }
  }
}

async function persistRefreshPreflightState(expectedRevision = refreshPreflightRevision) {
  const session = chrome.storage?.session;
  if (!session) return;
  return queueRefreshPreflightPersistence(() => {
    if (expectedRevision !== refreshPreflightRevision) return undefined;
    return session.set({
      [REFRESH_PREFLIGHT_SESSION_KEY]: activeRefreshPreflight,
      [REFRESH_PREFLIGHT_TABS_SESSION_KEY]: [...refreshPreflightCreatedTabIds]
    });
  });
}

function invalidateRefreshPreflight() {
  for (const tabId of refreshPreflightCreatedTabIds) {
    const tabRevision = refreshPreflightTabRevisions.get(tabId);
    if (Number.isInteger(tabRevision)) refreshPreflightStaleTabRevisions.set(tabId, tabRevision);
  }
  refreshPreflightRevision += 1;
  activeRefreshPreflight = null;
  refreshPreflightCreatedTabIds.clear();
  refreshPreflightTabRevisions.clear();
  const session = chrome.storage?.session;
  if (!session) return Promise.resolve();
  return queueRefreshPreflightPersistence(() => session.set({
    [REFRESH_PREFLIGHT_SESSION_KEY]: null,
    [REFRESH_PREFLIGHT_TABS_SESSION_KEY]: []
  }));
}

function safePreflightTabUrl(value) {
  return sanitizePreflightUrl(value);
}

function pageSessionStatusReason(status) {
  if (status === "ready") return "页面会话检查通过";
  if (status === "needsLogin") return "未找到有效登录会话，请在打开的页面手动登录";
  return "无法确认登录状态，请检查页面后再手动确认";
}

async function preflightPageStation(station, requestRevision) {
  let opened;
  try {
    opened = await findOrOpenPageTab(chrome.tabs, station, undefined, {
      allowTemporaryWhenAmbiguous: true,
      keepOnLoadFailure: true,
      onTemporaryTabCreated: async created => {
        if (requestRevision === refreshPreflightRevision) {
          refreshPreflightCreatedTabIds.add(created.id);
          refreshPreflightTabRevisions.set(created.id, requestRevision);
          await persistRefreshPreflightState(requestRevision);
        } else {
          refreshPreflightStaleTabRevisions.set(created.id, requestRevision);
        }
      }
    });
  } catch (error) {
    if (error.temporary && Number.isInteger(error.tabId)) {
      if (requestRevision === refreshPreflightRevision) {
        refreshPreflightCreatedTabIds.add(error.tabId);
        refreshPreflightTabRevisions.set(error.tabId, requestRevision);
        await persistRefreshPreflightState(requestRevision);
      } else if (refreshPreflightStaleTabRevisions.get(error.tabId) === requestRevision) {
        refreshPreflightStaleTabRevisions.delete(error.tabId);
        await closeRefreshPreflightTabs([error.tabId]);
      }
    }
    const stale = requestRevision !== refreshPreflightRevision;
    return {
      stationId: station.id,
      stationName: station.name,
      status: "uncertain",
      reason: pageSessionStatusReason("uncertain"),
      tabId: stale ? null : (Number.isInteger(error.tabId) ? error.tabId : null),
      tabUrl: stale ? "" : safePreflightTabUrl(station.baseUrl)
    };
  }

  const tab = opened?.tab;
  if (!tab?.id) return {
    stationId: station.id,
    stationName: station.name,
    status: "uncertain",
    reason: pageSessionStatusReason("uncertain"),
    tabId: null,
    tabUrl: safePreflightTabUrl(station.baseUrl)
  };
  const claimedReusedTab = !opened.temporary && requestRevision === refreshPreflightRevision
    && refreshPreflightStaleTabRevisions.has(tab.id);
  if (claimedReusedTab) refreshPreflightTabClaims.set(tab.id, requestRevision);
  if (opened.temporary) {
    if (requestRevision !== refreshPreflightRevision) {
      if (refreshPreflightStaleTabRevisions.get(tab.id) === requestRevision) {
        refreshPreflightStaleTabRevisions.delete(tab.id);
        await closeRefreshPreflightTabs([tab.id]);
      }
      return {
        stationId: station.id,
        stationName: station.name,
        status: "uncertain",
        reason: pageSessionStatusReason("uncertain"),
        tabId: null,
        tabUrl: ""
      };
    }
    refreshPreflightCreatedTabIds.add(tab.id);
    refreshPreflightTabRevisions.set(tab.id, requestRevision);
    await persistRefreshPreflightState(requestRevision);
  }

  let status = "uncertain";
  try {
    const collection = resolveStationCollection(station);
    const probe = collection.request.preflight || null;
    if (!probe) {
      if (String(collection.station.adapter?.method || "GET").toUpperCase() !== "GET") {
        throw new Error("No safe GET session probe is available");
      }
    }
    const probeEndpoint = probe?.endpoint ? new URL(probe.endpoint, collection.station.baseUrl).toString() : collection.endpoints[0];
    const request = buildStationRequest(collection.station, probeEndpoint, collection.request);
    const pageAuth = request.pageRequest.pageAuth ? { ...request.pageRequest.pageAuth, refresh: undefined } : undefined;
    const pageRequest = { ...request.pageRequest, url: probeEndpoint, method: probe?.method || "GET", body: undefined, pageAuth };
    const response = await withPageFetch(station, tab.id, pageFetch => pageFetch(pageRequest), { existingTab: tab });
    status = classifyPageSessionResponse(response);
  } catch (error) {
    status = classifyPageSessionError(error);
  }

  if (requestRevision !== refreshPreflightRevision) {
    const claimedByThisRequest = refreshPreflightTabClaims.get(tab.id) === requestRevision;
    if (opened.temporary && refreshPreflightStaleTabRevisions.get(tab.id) === requestRevision
      && !claimedByThisRequest && !refreshPreflightTabClaims.has(tab.id)) {
      refreshPreflightStaleTabRevisions.delete(tab.id);
      await closeRefreshPreflightTabs([tab.id]);
    }
    if (claimedByThisRequest) {
      refreshPreflightTabClaims.delete(tab.id);
      refreshPreflightStaleTabRevisions.delete(tab.id);
    }
    return {
      stationId: station.id,
      stationName: station.name,
      status: "uncertain",
      reason: pageSessionStatusReason("uncertain"),
      tabId: null,
      tabUrl: ""
    };
  }

  const ownedTemporary = refreshPreflightCreatedTabIds.has(tab.id)
    && refreshPreflightTabRevisions.get(tab.id) === requestRevision;
  let closedTemporary = false;
  if (status === "ready" && ownedTemporary) {
    try {
      await chrome.tabs.remove(tab.id);
      refreshPreflightCreatedTabIds.delete(tab.id);
      refreshPreflightTabRevisions.delete(tab.id);
      refreshPreflightStaleTabRevisions.delete(tab.id);
      closedTemporary = true;
    } catch (error) {
      if (!isMissingTabError(error)) console.warn("[AI比价] 刷新预检临时标签页清理失败", error);
    }
    await persistRefreshPreflightState(requestRevision);
  }
  if (claimedReusedTab && refreshPreflightTabClaims.get(tab.id) === requestRevision) {
    refreshPreflightTabClaims.delete(tab.id);
    refreshPreflightStaleTabRevisions.delete(tab.id);
  }
  return {
    stationId: station.id,
    stationName: station.name,
    status,
    reason: pageSessionStatusReason(status),
    tabId: closedTemporary ? null : tab.id,
    tabUrl: closedTemporary ? "" : safePreflightTabUrl(tab.url || station.baseUrl)
  };
}

async function createRefreshPreflight() {
  await restoreRefreshPreflightState();
  if (refreshAllTask || refreshReferencesTask) throw new Error("当前正在刷新，请稍后再执行登录预检");
  const carriedTemporaryTabIds = [...refreshPreflightCreatedTabIds];
  const invalidation = invalidateRefreshPreflight();
  const requestRevision = refreshPreflightRevision;
  await invalidation;
  for (const tabId of carriedTemporaryTabIds) {
    refreshPreflightStaleTabRevisions.delete(tabId);
    refreshPreflightCreatedTabIds.add(tabId);
    refreshPreflightTabRevisions.set(tabId, requestRevision);
  }
  const settings = await getSettings();
  const scope = refreshScope(await getPreparedStations(), settings.comparisonMode);
  const { stations } = scope;
  const requestMode = scope.comparisonMode;
  const requestSignature = refreshStationSignature(stations, requestMode);
  const results = [];
  for (const station of stations) {
    const provider = providerForStation(station);
    if (!requiresPageSessionPreflight(station, provider)) {
      results.push({ stationId: station.id, stationName: station.name, status: "noLoginRequired", reason: "无需页面登录预检" });
      continue;
    }
    results.push(await preflightPageStation(station, requestRevision));
  }
  const currentSettings = await getSettings();
  const currentScope = refreshScope(await getPreparedStations(), currentSettings.comparisonMode);
  const currentSignature = refreshStationSignature(currentScope.stations, currentScope.comparisonMode);
  if (requestRevision !== refreshPreflightRevision || requestMode !== currentScope.comparisonMode || requestSignature !== currentSignature) {
    throw refreshConfirmationRequiredError();
  }
  const publishedPreflight = {
    token: newRefreshPreflightToken(),
    expiresAt: Date.now() + REFRESH_PREFLIGHT_TTL_MS,
    comparisonMode: requestMode,
    comparisonLabel: scope.comparisonLabel,
    stationCount: stations.length,
    stationSignature: requestSignature,
    results
  };
  activeRefreshPreflight = publishedPreflight;
  await persistRefreshPreflightState();
  if (requestRevision !== refreshPreflightRevision || activeRefreshPreflight !== publishedPreflight) {
    throw refreshConfirmationRequiredError();
  }
  return { ...publishedPreflight, results: publishedPreflight.results };
}

async function cancelRefreshPreflight() {
  const invalidation = invalidateRefreshPreflight();
  await restoreRefreshPreflightState();
  await invalidation;
  return { cancelled: true };
}

async function refreshAllInternal(options = {}) {
  const { preparedStations, refreshMetadata, ...refreshOptions } = options;
  const result = await runRefreshAll({
    ...refreshOptions,
    concurrency: REFRESH_CONCURRENCY,
    getStations: preparedStations ? async () => preparedStations : getPreparedStations,
    getValue,
    refreshOfficialReferences,
    collect,
    putSnapshot,
    getSnapshots,
    errorSnapshot,
    notifyProgress: progress => notifyRefreshProgress(refreshMetadata ? {
      ...progress,
      ...refreshMetadata,
      ...(progress.summary ? { summary: { ...progress.summary, ...refreshMetadata } } : {})
    } : progress)
  });
  if (refreshMetadata) result.summary = { ...result.summary, ...refreshMetadata };
  return result;
}

let refreshAllTask = null;
let refreshReferencesTask = null;
let refreshReferencesForced = false;

async function refreshOfficialReferences(force = false) {
  if (refreshReferencesTask) {
    const activeTask = refreshReferencesTask;
    const activeForced = refreshReferencesForced;
    try {
      const result = await activeTask;
      if (!force || activeForced) return result;
    } catch (error) {
      if (!force || activeForced) throw error;
    }
    return refreshOfficialReferences(true);
  }

  let task;
  task = Promise.resolve().then(() => refreshReferences(force)).finally(() => {
    if (refreshReferencesTask === task) {
      refreshReferencesTask = null;
      refreshReferencesForced = false;
      notifyReferencesRefresh(false);
    }
  });
  refreshReferencesTask = task;
  refreshReferencesForced = Boolean(force);
  notifyReferencesRefresh(true);
  return task;
}

async function refreshAll(options = {}) {
  if (refreshAllTask) {
    const active = refreshAllTask;
    const sameRequest = active.stationId === options.stationId
      && active.sourceTabId === options.sourceTabId
      && active.forceReferences === Boolean(options.forceReferences);
    if (sameRequest) return active.promise;
    await active.promise.catch(() => {});
    return refreshAll(options);
  }
  const task = { ...options, forceReferences: Boolean(options.forceReferences), promise: refreshAllInternal(options) };
  refreshAllTask = task;
  try {
    return await task.promise;
  } finally {
    if (refreshAllTask === task) refreshAllTask = null;
  }
}




async function dashboard() {
  await restoreRefreshPreflightState();
  await ensureWorkspacePlugins();
  const savedSettings = await settingsForUi();
  if (activeRefreshPreflight?.expiresAt <= Date.now()) await invalidateRefreshPreflight();
  const revisionAtStart = getComparisonRevision();
  const [stations, references] = await Promise.all([
    getPreparedStations(),
    getValue("references", {})
  ]);
  const comparisonStations = stations.filter(station => station.enabled === true);
  const refresh = refreshScope(stations, savedSettings.comparisonMode);
  const stationsById = new Map(comparisonStations.map(station => [station.id, station]));
  const snapshots = await getLatestSnapshots(comparisonStations.map(station => station.id), snapshot => !snapshotNeedsRefresh(stationsById.get(snapshot.stationId), snapshot));
  const staleAfter = 30 * 60 * 1000;
  const now = Date.now();
  const normalizedSnapshots = snapshots.map(snapshot => ({
    ...snapshot,
    stale: snapshot.status !== "success" && snapshot.status !== "partial" || now - snapshot.collectedAt > staleAfter,
  incomplete: snapshot.status === "partial" || Boolean(snapshot.normalized?.incomplete),
  unsupportedBillingModes: snapshot.normalized?.unsupportedBillingModes || snapshot.rawMeta?.unsupportedBillingModes || [],
  unpricedModels: snapshot.normalized?.unpricedModels || snapshot.rawMeta?.unpricedModels || []
  }));
  const effectiveReferences = { ...references, exchangeRate: savedSettings.exchangeRate || references.exchangeRate, openRouterRechargeRate: savedSettings.exchangeRate || references.openRouterRechargeRate || references.exchangeRate };
  const llmCache = await getValue("llmMatchCache", {});
  const llmMatches = llmMatchesFromCache(llmCache);
  const revision = getComparisonRevision();
  const cacheable = revisionAtStart === revision;
  const comparisonKey = JSON.stringify([revision, normalizedSnapshots.map(snapshot => [snapshot.id, snapshot.stale]), llmMatches]);
  let comparisonResult = cacheable && comparisonCache?.key === comparisonKey ? comparisonCache : null;
  if (!comparisonResult) {
    const comparisons = buildComparisonRows({
      stations: comparisonStations,
      snapshots: normalizedSnapshots,
      references: effectiveReferences,
      usage: savedSettings.usage,
      rules: savedSettings.matchingRules,
      modelMatchOverrides: savedSettings.modelMatchOverrides,
      modelAliases: modelAliasesForStations(comparisonStations),
      llmMatches,
      showUnmatched: savedSettings.showUnmatched,
      evidenceThreshold: savedSettings.evidenceThreshold
    });
    comparisonResult = { key: comparisonKey, comparisons, summary: summarizeComparisons(comparisons) };
    if (cacheable) comparisonCache = comparisonResult;
  }
  const checkinPresets = await resolveCheckinPresets(savedSettings);
  const checkinRecords = await getCheckinState();
  const checkinStations = checkinPresets.map(preset => {
    const linked = stations.find(station => station.enabled && matchCheckinPreset(station, checkinPresets)?.id === preset.id);
    return {
      id: preset.id,
      name: preset.name,
      hosts: preset.matchHosts,
      linkedStationId: linked ? linked.id : null,
      autoEnabled: Boolean(linked?.checkin?.autoEnabled || checkinRecords[preset.id]?.autoEnabled),
      presetAutoEnabled: Boolean(checkinRecords[preset.id]?.autoEnabled)
    };
  });
  const refreshPreflight = activeRefreshPreflight?.stationSignature === refreshStationSignature(refresh.stations, refresh.comparisonMode)
    && activeRefreshPreflight.comparisonMode === refresh.comparisonMode
    ? { token: activeRefreshPreflight.token, expiresAt: activeRefreshPreflight.expiresAt, comparisonMode: activeRefreshPreflight.comparisonMode, comparisonLabel: activeRefreshPreflight.comparisonLabel, stationCount: activeRefreshPreflight.stationCount, results: activeRefreshPreflight.results }
    : null;
  const visibleSnapshots = normalizedSnapshots.filter(snapshot => stationsById.get(snapshot.stationId)?.category === savedSettings.comparisonMode);
  const stationErrors = visibleSnapshots
    .filter(snapshot => snapshot.status === "error" && stationsById.has(snapshot.stationId))
    .map(snapshot => ({ stationId: snapshot.stationId, stationName: snapshot.stationName || stationsById.get(snapshot.stationId)?.name || snapshot.stationId, category: stationsById.get(snapshot.stationId)?.category || "paid", error: snapshot.error || "采集失败", collectedAt: snapshot.collectedAt }));
  const selectedComparisons = filterComparisonsByMode(comparisonResult.comparisons, savedSettings.comparisonMode);
  return { stations, sitePlugins: sitePluginCatalogForStations(stations, { bundledVersion: bundledPluginVersion() }), snapshots: visibleSnapshots, stationErrors, references: effectiveReferences, settings: savedSettings, comparisons: selectedComparisons, summary: summarizeComparisons(selectedComparisons), stationIndexes: buildStationIndexes(selectedComparisons), checkinState: await getCheckinState(), checkinStations, checkinPluginInstalled: checkinPresets.length > 0, refreshInProgress: Boolean(refreshAllTask || refreshReferencesTask), refreshScope: { comparisonMode: refresh.comparisonMode, comparisonLabel: refresh.comparisonLabel, stationCount: refresh.stationCount }, refreshPreflight };
}

async function scheduleCheckinAlarm() {
  await chrome.alarms.clear(LEGACY_REFRESH_ALARM_NAME);
  await chrome.alarms.clear(CHECKIN_ALARM_NAME);
  chrome.alarms.create(CHECKIN_ALARM_NAME, { periodInMinutes: 240 });
}

async function resolveCheckinPresets(settings = null) {
  const source = settings || await getSettings();
  return checkinPresetsFromSpecs(installedCheckinSpecs(source));
}

async function getCheckinState() {
  return await getValue("checkinState", {});
}

async function updateCheckinRecord(stationId, updater) {
  const state = await getCheckinState();
  const record = updater(normalizeCheckinRecord(state[stationId] || {}));
  await setValue("checkinState", { ...state, [stationId]: record });
  return record;
}

async function runCheckinForStation(station, { claim = true, autoOnly = false, presets = [] } = {}) {
  const preset = matchCheckinPreset(station, presets);
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
  const presets = await resolveCheckinPresets();
  if (!presets.length) return { results: [], state: await getCheckinState(), presets: [] };
  let origin = "";
  if (stationOrigin) {
    try { origin = new URL(stationOrigin).origin; } catch { origin = String(stationOrigin || "").trim(); }
  }
  let stations = (await getStations()).filter(station => {
    if (!station.enabled) return false;
    if (stationId) { const preset = presets.find(item => item.id === String(stationId)); return station.id === stationId || (preset ? matchCheckinPreset(station, presets)?.id === preset.id : false); }
    if (origin) {
      try { return new URL(station.baseUrl).origin === origin; } catch { return false; }
    }
    return true;
  });
  // 预设兜底：指定预设 id 但没有已保存站点，或自动签到遍历时，构造签到专用伪站点（record 按预设 id 统一存储，无需手动添加站点）
  if (!stations.length && stationId) {
    const preset = presets.find(item => item.id === String(stationId));
    if (preset) stations = [{ id: preset.id, name: preset.name, baseUrl: `https://${preset.matchHosts[0]}`, enabled: true }];
  } else if (!stationOrigin && !stationId) {
    const linkedIds = new Set((await getStations()).map(item => matchCheckinPreset(item, presets)?.id).filter(Boolean));
    for (const preset of presets) {
      if (!linkedIds.has(preset.id)) stations.push({ id: preset.id, name: preset.name, baseUrl: `https://${preset.matchHosts[0]}`, enabled: true });
    }
  }
  const results = [];
  for (const station of stations) {
    const result = await runCheckinForStation(station, { claim, autoOnly, presets });
    if (result) results.push(result);
  }
  return { results, state: await getCheckinState() };
}

async function saveCheckinConfig({ stationId, autoEnabled } = {}) {
  const stations = await getStations();
  const presets = await resolveCheckinPresets();
  const station = stations.find(item => item.id === String(stationId || ""));
  if (!station) {
    // 预设 id（未保存站点）：签到开关存到 checkinState，无需手动添加站点
    if (!presets.some(item => item.id === String(stationId || ""))) throw new Error("站点不存在");
    await updateCheckinRecord(String(stationId), prev => ({ ...prev, autoEnabled: Boolean(autoEnabled) }));
    return checkinAll({ stationId: String(stationId), claim: false, autoOnly: false });
  }
  const next = stations.map(item => item.id === station.id ? normalizeStation({ ...item, checkin: { ...item.checkin, autoEnabled: Boolean(autoEnabled) } }) : item);
  await putStations(next);
  return checkinAll({ stationId: station.id, claim: false, autoOnly: false });
}
async function addSitePlugins(ids) {
  await ensureWorkspacePlugins();
  const requested = [...new Set((Array.isArray(ids) ? ids : []).map(id => String(id || "").trim()))]
    .filter(id => sitePluginById(id)?.addable && [...activePluginIds()].includes(id));
  if (!requested.length) throw new Error("请至少选择一个已安装插件里的站点");
  return withKeyedLock("site-plugins:add", async () => {
    const providers = await loadSitePlugins(requested);
    const current = await getStations();
    const settings = await getSettings();
    const next = addProviderStationPresets(current, providers, { exchangeRate: settings.exchangeRate });
    const addedStations = next.slice(current.length).map(prepareComparisonStation);
    const added = addedStations.map(station => activeSitePluginForStation(station)?.id).filter(Boolean);
    if (addedStations.length) await putStations([...current, ...addedStations]);
    pruneSitePlugins([...current, ...addedStations], [...installedPluginIds(settings)]);
    return {
      stations: [...current, ...addedStations],
      added,
      alreadyAdded: requested.filter(id => !added.includes(id)),
      sitePlugins: activeCatalogForStations([...current, ...addedStations])
    };
  });
}

async function saveStations(input) {
  const invalidation = invalidateRefreshPreflight();
  await ensureWorkspacePlugins();
  await syncSitePlugins(input);
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
  const pluginSettings = await getSettings();
  setActivePluginIds(installedPluginIds(pluginSettings));
  pruneSitePlugins(stations, [...installedPluginIds(pluginSettings)]);
  await invalidation;
  return stations;
}

async function saveComparisonMode(mode) {
  const current = await getSettings();
  const nextMode = mode === "public" ? "public" : "paid";
  const invalidation = current.comparisonMode === nextMode ? Promise.resolve() : invalidateRefreshPreflight();
  await setValue("settings", normalizeSettings({ ...current, comparisonMode: nextMode }));
  await invalidation;
  return dashboard();
}

async function saveSettings(rawInput = {}) {
  const { modelAssistantKey, ...input } = rawInput && typeof rawInput === "object" ? rawInput : {};
  if (modelAssistantKey !== undefined) await setModelAssistantKey(modelAssistantKey);
  const current = await getSettings();
  const next = normalizeSettings({
    ...input,
    // 插件来源只走插件管理接口，普通设置保存不能把它们清掉。
    devMode: current.devMode,
    pluginInstallMigrated: current.pluginInstallMigrated,
    localPlugins: current.localPlugins,
    pluginRegistry: current.pluginRegistry
  });
  const invalidation = invalidateRefreshPreflight();
  await setValue("settings", next);
  await invalidation;
  return settingsForUi();
}

// 测试与拉列表都要用「界面上当前填的值」，不能只读已保存的设置。
async function modelAssistantTarget(override = {}) {
  const settings = await getSettings();
  const config = settings.modelAssistant || {};
  const baseUrl = String(override.baseUrl ?? config.baseUrl ?? "").trim();
  const model = String(override.model ?? config.model ?? "").trim();
  const apiKey = String(override.apiKey ?? "").trim() || await getModelAssistantKey();
  return { baseUrl, model, apiKey, temperature: Number(override.temperature ?? config.temperature ?? 0.1) };
}

async function testModelAssistant(override = {}) {
  const target = await modelAssistantTarget(override);
  const result = await testModelConnection({ baseUrl: target.baseUrl, apiKey: target.apiKey, model: target.model });
  return { model: result.model, usage: result.usage };
}

async function fetchModelAssistantCatalog(override = {}) {
  const target = await modelAssistantTarget(override);
  return fetchModelCatalog({ baseUrl: target.baseUrl, apiKey: target.apiKey });
}
let modelAssistTask = null;

function chunkList(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function assistContext() {
  const [cache, data] = await Promise.all([getValue("llmMatchCache", {}), dashboard()]);
  const references = data.references || {};
  const officialList = Array.isArray(references.models) ? references.models : [];
  const unmatched = collectUnmatchedModels(flattenComparisonRows(data.comparisons));
  const entries = buildAssistEntries({ unmatched, officialList, referencesFetchedAt: Number(references.fetchedAt) || 0 });
  return {
    cache,
    entries,
    entryByKey: new Map(entries.map(entry => [entry.key, entry])),
    unmatched,
    referencesFetchedAt: Number(references.fetchedAt) || 0
  };
}

async function modelAssistState() {
  const { cache, entries, entryByKey, unmatched, referencesFetchedAt } = await assistContext();
  const rows = unmatched.map(entry => {
    const assigned = entryByKey.get(entry.key);
    const cached = cache[entry.key] || null;
    return {
      key: entry.key,
      stationId: entry.stationId,
      stationName: entry.stationName,
      modelName: entry.modelName,
      displayName: entry.displayName,
      count: entry.count,
      candidates: assigned?.candidates?.length || 0,
      // 规则层给不出候选的写法，只能等官方清单更新，不进判定队列。
      status: assigned ? (cached?.status || "pending") : "no-candidates",
      targetId: cached?.targetId || "",
      attempts: Number(cached?.attempts) || 0,
      at: Number(cached?.at) || 0
    };
  });
  return {
    configured: await getModelAssistantEnabled(),
    referencesFetchedAt,
    assigned: entries.length,
    noCandidates: unmatched.length - entries.length,
    summary: summarizeCache(cache),
    rows
  };
}

async function getModelAssistantEnabled() {
  const settings = await getSettings();
  const config = settings.modelAssistant || {};
  return Boolean(config.enabled && String(config.baseUrl || "").trim() && String(config.model || "").trim()) && Boolean(await getModelAssistantKey());
}

async function runModelAssist({ force = false } = {}) {
  if (modelAssistTask) throw new Error("模型识别正在运行，请等这一轮结束");
  modelAssistTask = (async () => {
    const settings = await getSettings();
    const config = settings.modelAssistant || {};
    if (!config.enabled) throw new Error("先到设置里启用模型识别");
    if (!String(config.baseUrl || "").trim() || !String(config.model || "").trim()) throw new Error("先填好模型服务地址与模型");
    const apiKey = await getModelAssistantKey();
    if (!apiKey) throw new Error("先填好模型服务密钥");

    const { cache, entries, referencesFetchedAt } = await assistContext();
    if (!entries.length) return { ...summarizeCache(cache), ranBatches: 0, pending: 0, reused: 0, invalidAnswers: 0, errors: 0 };

    const { pending, reused } = selectPendingEntries({ cache, entries, referencesFetchedAt, force });
    if (!pending.length) return { ...summarizeCache(cache), ranBatches: 0, pending: 0, reused: reused.length, invalidAnswers: 0, errors: 0 };

    const results = [];
    const notAsked = [];
    const fingerprintByKey = {};
    let ranBatches = 0;
    let errors = 0;

    for (const batch of chunkList(pending, ASSIST_BATCH_SIZE)) {
      for (const entry of batch) fingerprintByKey[entry.key] = entry.fingerprint;
      let parsed;
      try {
        const { content } = await completeChat({
          baseUrl: config.baseUrl,
          apiKey,
          model: config.model,
          temperature: config.temperature,
          messages: [
            { role: "system", content: "你只输出「序号 => id」的行，不要任何解释。" },
            { role: "user", content: buildAssistPrompt(batch) }
          ]
        });
        parsed = parseAssistResponse(content, { entries: batch });
      } catch (error) {
        console.debug("[AI比价] 模型识别批次失败", error);
        errors += 1;
        notAsked.push(...batch);
        continue;
      }
      results.push(...parsed.accepted, ...parsed.invalid);
      const answered = new Set([...parsed.accepted, ...parsed.invalid].map(item => item.key));
      notAsked.push(...batch.filter(entry => !answered.has(entry.key)));
      ranBatches += 1;
    }

    const nextCache = applyAssistResults(cache, results, { fingerprintByKey, notAsked });
    await setValue("llmMatchCache", nextCache);
    // 缓存不进 comparisonRevision，这里手动让下一次 dashboard 重算。
    comparisonCache = null;
    return {
      ...summarizeCache(nextCache),
      ranBatches,
      pending: pending.length,
      reused: reused.length,
      invalidAnswers: results.filter(item => item.status === "invalid").length,
      errors
    };
  })();
  try {
    return await modelAssistTask;
  } finally {
    modelAssistTask = null;
  }
}

async function clearModelAssistCache() {
  await setValue("llmMatchCache", {});
  comparisonCache = null;
  return modelAssistState();
}

async function applyModelAssistOverrides(keys = []) {
  const settings = await getSettings();
  const cache = await getValue("llmMatchCache", {});
  const keyOf = item => `${item.stationId}\u0000${normalizeProxyModelName(item.modelName)}`;
  const overrides = settings.modelMatchOverrides.map(item => ({ ...item }));
  const indexByKey = new Map(overrides.map((item, index) => [keyOf(item), index]));
  let added = 0;
  let updated = 0;
  for (const key of Array.isArray(keys) ? keys : []) {
    const override = overrideFromAssist(cache[key]);
    if (!override) continue;
    const index = indexByKey.get(keyOf(override));
    if (index === undefined) {
      indexByKey.set(keyOf(override), overrides.length);
      overrides.push(override);
      added += 1;
    } else {
      overrides[index] = override;
      updated += 1;
    }
  }
  if (added || updated) {
    await persistSettings({ ...settings, modelMatchOverrides: overrides });
    comparisonCache = null;
  }
  return { added, updated, total: overrides.length };
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
  const local = inferStationAdapter(station);
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
  const notices = discoveryWarning ? [discoveryWarning] : [];
  return { suggestion: local, discovery, warning: notices.join("；") };
}
const PLUGIN_REGISTRY_FETCH_TIMEOUT_MS = 15000;
const PLUGIN_REGISTRY_MAX_BYTES = 512 * 1024;

function registryHttpError(url, status) {
  if (status === 404) return `插件仓库地址 404：${url} 上没有 plugins.json，确认仓库、分支与文件名；刚推送的清单可能还要等几分钟缓存`;
  if (status === 403) return `插件仓库拒绝了请求（403）：${url} 可能是私有仓库或触发了限流`;
  return `插件仓库返回 HTTP ${status}`;
}

async function fetchPluginRegistryIndex(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PLUGIN_REGISTRY_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: "omit", cache: "no-store", redirect: "follow", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(registryHttpError(url, response.status));
    const body = await response.text();
    if (body.length > PLUGIN_REGISTRY_MAX_BYTES) throw new Error("插件仓库索引超过 512KB");
    try {
      return JSON.parse(body);
    } catch {
      throw new Error("插件仓库索引不是合法 JSON");
    }
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("插件仓库请求超时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function pluginRegistryView(registry) {
  return {
    url: registry.url,
    fetchedAt: registry.fetchedAt,
    error: registry.error,
    entries: registry.entries.map(entry => {
      const record = registry.installed[entry.id];
      const builtin = sitePluginById(entry.id);
      const descriptor = builtin && builtin.source === "bundled" ? builtin : null;
      const spec = entry.spec || null;
      const mode = spec?.mode || descriptor?.mode || "";
      return {
        id: entry.id,
        name: entry.name,
        version: entry.version,
        description: entry.description,
        hosts: entry.hosts,
        kind: spec?.kind || "price",
        needsCode: entry.needsCode,
        installed: Boolean(record),
        installedVersion: record?.version || "",
        updateAvailable: Boolean(record) && comparePluginVersions(record.version, entry.version) < 0,
        builtin: Boolean(descriptor),
        // 界面展开详情用：仓库条目本身没有采集方式这些字段，从内置描述符或声明式规格补齐。
        details: {
          mode,
          category: spec?.category || descriptor?.category || "",
          authLabel: descriptor?.authLabel || (mode === "page" ? "使用当前浏览器登录态" : mode === "direct" ? "公开接口，无需登录" : ""),
          paths: spec?.paths || descriptor?.paths || [],
          endpoint: spec?.request?.endpoint || "",
          responseFormat: spec?.responseFormat || "",
          addable: spec ? spec.addable !== false : descriptor ? descriptor.addable !== false : true,
          installedAt: record?.installedAt || 0,
          checkin: spec?.kind === "checkin" ? spec.checkin : null
        }
      };
    })
  };
}

// 还没成功拉取过仓库时，先用随扩展发布的内置快照，避免插件商店空白。
function seededRegistry(registry) {
  const current = normalizeRegistryState(registry);
  if (current.entries.length) return current;
  return normalizeRegistryState({ ...current, entries: PLUGIN_REGISTRY_SNAPSHOT.plugins });
}
function describePlugin(id, { registry, record, local }) {
  const entry = registry.entries.find(item => item.id === id) || null;
  const descriptor = sitePluginById(id);
  const spec = local || entry?.spec || null;
  return {
    id,
    name: spec?.name || entry?.name || descriptor?.name || id,
    version: record?.version || spec?.version || entry?.version || descriptor?.version || "",
    hosts: spec?.hosts || entry?.hosts || descriptor?.hosts || [],
    mode: spec?.mode || descriptor?.mode || "",
    kind: spec?.kind || "price",
    description: spec?.description || entry?.description || descriptor?.description || "",
    needsCode: Boolean(!entry?.spec && descriptor)
  };
}

async function pluginWorkspaceState() {
  await ensureWorkspacePlugins();
  const [settings, stations] = await Promise.all([getSettings(), getStations()]);
  const manifest = chrome.runtime.getManifest?.() || {};
  const registry = normalizeRegistryState(settings.pluginRegistry);
  const activeIds = installedPluginIds(settings);
  const localPlugins = normalizeLocalPlugins(settings.devMode === true ? settings.localPlugins : []).specs;
  const localIds = new Set(localPlugins.map(spec => spec.id));
  const describe = spec => ({ id: spec.id, name: spec.name, version: spec.version, hosts: spec.hosts, mode: spec.mode, description: spec.description });
  return {
    catalog: activeCatalogForStations(stations, { bundledVersion: manifest.version || "" }),
    registry: pluginRegistryView(seededRegistry(settings.pluginRegistry)),
    devMode: settings.devMode === true,
    localPlugins: localPlugins.map(describe),
    repositoryPlugins: [...activeIds]
      .filter(id => !localIds.has(id))
      .map(id => describePlugin(id, { registry, record: registry.installed[id] })),
    extension: { id: manifest.id || "", version: manifest.version || "", updateUrl: manifest.update_url || "" }
  };
}

async function refreshPluginRegistry(message = {}) {
  return withKeyedLock("plugin-registry:refresh", async () => {
    const settings = await getSettings();
    const current = normalizeRegistryState(settings.pluginRegistry);
    const url = String(message.url || current.url || DEFAULT_PLUGIN_REGISTRY_URL).trim();
    let next;
    try {
      const { entries, rejected } = normalizeRegistryPayload(await fetchPluginRegistryIndex(url));
      if (!entries.length) throw new Error(rejected.length ? `插件仓库没有可用条目：${rejected[0].error}` : "插件仓库是空的");
      const installed = {};
      for (const [id, record] of Object.entries(current.installed)) {
        const entry = entries.find(item => item.id === id);
        if (entry && !entry.needsCode) installed[id] = { version: entry.version, installedAt: record.installedAt || Date.now() };
      }
      next = { url, fetchedAt: Date.now(), error: "", entries, installed };
    } catch (error) {
      // 拉取失败保留上次成功的缓存，只记错误。
      next = { ...current, url, error: error.message || String(error) };
    }
    await persistSettings({ ...settings, pluginRegistry: next });
    return pluginWorkspaceState();
  });
}

async function installPlugin(id) {
  const { workspace, results } = await installPlugins([id]);
  const failure = results.find(item => !item.ok && !item.skipped);
  if (failure) throw new Error(failure.error);
  return workspace;
}

// 批量安装：一次加锁、一次落库、一次重算工作区，返回逐项结果，界面据此提示跳过与失败。
async function installPlugins(ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(id => String(id || "").trim()).filter(Boolean))];
  if (!wanted.length) throw new Error("没有选中要安装的插件");
  return withKeyedLock("plugin-install", async () => {
    const settings = await getSettings();
    const registry = normalizeRegistryState(settings.pluginRegistry);
    const installed = { ...registry.installed };
    const results = [];
    for (const id of wanted) {
      const entry = registry.entries.find(item => item.id === id);
      if (!entry) {
        results.push({ id, ok: false, skipped: false, error: "插件仓库里没有这个插件，先刷新插件仓库" });
        continue;
      }
      const hasBundledCode = Boolean(sitePluginById(entry.id));
      if (!entry.spec && !hasBundledCode) {
        results.push({ id, ok: false, skipped: false, error: `这个插件需要更新版本的扩展（仓库版本 ${entry.version}）` });
        continue;
      }
      const record = installed[id];
      if (record && comparePluginVersions(record.version, entry.version) >= 0) {
        results.push({ id, ok: false, skipped: true, version: record.version, error: "已经装过了" });
        continue;
      }
      installed[id] = { version: entry.version, installedAt: Date.now() };
      results.push({ id, ok: true, skipped: false, version: entry.version });
    }
    if (results.some(item => item.ok)) {
      await persistSettings({ ...settings, pluginRegistry: { ...registry, installed } });
      workspacePluginsSynced = false;
      await ensureWorkspacePlugins({ force: true });
    }
    const workspace = await pluginWorkspaceState();
    return {
      workspace,
      results,
      installed: results.filter(item => item.ok).map(item => item.id),
      skipped: results.filter(item => item.skipped).map(item => item.id),
      failed: results.filter(item => !item.ok && !item.skipped).map(({ id, error }) => ({ id, error }))
    };
  });
}

async function uninstallPlugin(id) {
  const pluginId = String(id || "").trim();
  if (!pluginId) throw new Error("插件不存在");
  const settings = await getSettings();
  const registry = normalizeRegistryState(settings.pluginRegistry);
  const installed = { ...registry.installed };
  delete installed[pluginId];
  const localPlugins = settings.localPlugins.filter(spec => spec.id !== pluginId);
  unloadSpecSitePlugin(pluginId);
  // 移除插件等于把这个插件的采集能力一起带走，挂在它下面的站点也删掉。
  const stations = await getStations();
  const kept = stations.filter(station => sitePluginForStation(station)?.id !== pluginId);
  for (const station of stations) {
    if (!kept.includes(station)) await removeStationCredential(station.id);
  }
  if (kept.length !== stations.length) await putStations(kept);
  await persistSettings({ ...settings, pluginRegistry: { ...registry, installed }, localPlugins });
  workspacePluginsSynced = false;
  await ensureWorkspacePlugins({ force: true });
  pruneSitePlugins(kept, [...installedPluginIds(await getSettings())]);
  return pluginWorkspaceState();
}

async function saveDevMode(enabled) {
  const settings = await getSettings();
  const nextEnabled = Boolean(enabled);
  if (!nextEnabled) for (const spec of settings.localPlugins) unloadSpecSitePlugin(spec.id);
  await persistSettings({ ...settings, devMode: nextEnabled });
  workspacePluginsSynced = false;
  await ensureWorkspacePlugins({ force: true });
  return pluginWorkspaceState();
}

async function addLocalPlugin(rawSpec) {
  const settings = await getSettings();
  if (settings.devMode !== true) throw new Error("先打开开发模式才能加载本地插件");
  const spec = { ...normalizePluginSpec(rawSpec), source: "local" };
  if (sitePluginById(spec.id)) throw new Error(`插件 id ${spec.id} 与仓库里的插件冲突，换个 id 再试`);
  const localPlugins = [...settings.localPlugins.filter(item => item.id !== spec.id), spec];
  await persistSettings({ ...settings, localPlugins });
  workspacePluginsSynced = false;
  await ensureWorkspacePlugins({ force: true });
  return pluginWorkspaceState();
}

async function removeLocalPlugin(id) {
  const pluginId = String(id || "").trim();
  const settings = await getSettings();
  if (!settings.localPlugins.some(spec => spec.id === pluginId)) throw new Error("本地插件不存在");
  unloadSpecSitePlugin(pluginId);
  await persistSettings({ ...settings, localPlugins: settings.localPlugins.filter(spec => spec.id !== pluginId) });
  return pluginWorkspaceState();
}












async function handle(message, sender) {
  switch (message.type) {
    case "GET_DASHBOARD": return dashboard();
    case "SAVE_COMPARISON_MODE": return saveComparisonMode(message.mode);
    case "GET_SETTINGS": return settingsForUi();
    case "SAVE_SETTINGS": return saveSettings(message.settings, message);
    case "TEST_MODEL_CONNECTION": return testModelAssistant(message.config || {});
    case "FETCH_MODEL_CATALOG": return fetchModelAssistantCatalog(message.config || {});
    case "GET_MODEL_ASSIST_STATE": return modelAssistState();
    case "RUN_MODEL_ASSIST": return runModelAssist(message);
    case "CLEAR_MODEL_ASSIST_CACHE": return clearModelAssistCache();
    case "APPLY_MODEL_ASSIST_OVERRIDES": return applyModelAssistOverrides(message.keys);
    case "SAVE_STATIONS": return saveStations(message.stations);
    case "ADD_SITE_PLUGINS": return addSitePlugins(message.ids);
    case "GET_PLUGIN_WORKSPACE": return pluginWorkspaceState();
    case "REFRESH_PLUGIN_REGISTRY": return refreshPluginRegistry(message);
    case "INSTALL_PLUGIN": return installPlugin(message.id);
    case "INSTALL_PLUGINS": return installPlugins(message.ids);
    case "UNINSTALL_PLUGIN": return uninstallPlugin(message.id);
    case "SAVE_DEV_MODE": return saveDevMode(message.enabled);
    case "ADD_LOCAL_PLUGIN": return addLocalPlugin(message.spec);
    case "REMOVE_LOCAL_PLUGIN": return removeLocalPlugin(message.id);
    case "ADAPT_STATION": return adaptStation(message);
    case "CHECKIN_STATUS":
      return checkinAll({ stationId: message.stationId, stationOrigin: message.stationOrigin, claim: false, autoOnly: false });
    case "CHECKIN_NOW":
      return checkinAll({ stationId: message.stationId, stationOrigin: message.stationOrigin, claim: true, autoOnly: false });
    case "SAVE_CHECKIN":
      return saveCheckinConfig(message);
    case "REFRESH_PREFLIGHT": return createRefreshPreflight();
    case "CANCEL_REFRESH_PREFLIGHT": return cancelRefreshPreflight();
    case "REFRESH_ALL": {
      if (refreshConfirmationInProgress) {
        const error = new Error(REFRESH_CONFIRMATION_REQUIRED_MESSAGE);
        error.code = REFRESH_CONFIRMATION_REQUIRED_CODE;
        throw error;
      }
      refreshConfirmationInProgress = true;
      try {
        await restoreRefreshPreflightState();
        const settings = await getSettings();
        const scope = refreshScope(await getPreparedStations(), settings.comparisonMode);
        assertRefreshConfirmation(activeRefreshPreflight, message, scope.stations, scope.comparisonMode);
        const invalidation = invalidateRefreshPreflight();
        if (!scope.stationCount) {
          await invalidation;
          const error = new Error(REFRESH_NO_STATIONS_MESSAGE);
          error.code = REFRESH_NO_STATIONS_CODE;
          throw error;
        }
        await invalidation;
        const result = await refreshAll({
          forceReferences: Boolean(message.forceReferences),
          preparedStations: scope.stations,
          refreshMetadata: { comparisonMode: scope.comparisonMode, comparisonLabel: scope.comparisonLabel, stationCount: scope.stationCount }
        });
        return { ...(await dashboard()), refreshSummary: result.summary };
      } finally {
        refreshConfirmationInProgress = false;
      }
    }
    case "REFRESH_STATION": {
      const stationId = String(message.stationId || "").trim();
      const station = (await getPreparedStations()).find(item => item.id === stationId);
      if (!station || station.enabled !== true) throw new Error("站点不存在或未启用");
      const result = await refreshAll({ stationId, sourceTabId: message.sourceTabId });
      return { ...(await dashboard()), refreshSummary: result.summary };
    }
    case "FETCH_REFERENCES": {
      await refreshOfficialReferences(true);
      return dashboard();
    }
    case "EXPORT_STATE": return exportState();
    case "IMPORT_STATE": {
      const invalidation = invalidateRefreshPreflight();
      const current = await getStations();
      const imported = await importState(message.state);
      const importedById = new Map(imported.stations.map(station => [station.id, station]));
      for (const station of imported.stations) await removeStationCredential(station.id);
      for (const previous of current) {
        const next = importedById.get(previous.id);
        if (!next || String(next.baseUrl || "") !== previous.baseUrl || String(next.auth?.type || "none") !== previous.auth?.type) await removeStationCredential(previous.id);
      }
      workspacePluginsSynced = false;
      await invalidation;
      return dashboard();
    }
    case "TEST_STATION": {
      const snapshot = await collect(message.station);
      return { ok: true, snapshot };
    }
    default: throw new Error(`未知操作：${message.type}`);
  }
}

// service worker 每次启动都重新注册仓库安装与本地开发的声明式插件。
ensureWorkspacePlugins();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "REFRESH_PROGRESS") return;
  handle(message, sender).then(data => sendResponse({ ok: true, data })).catch(error => sendResponse({ ok: false, error: error.message || String(error), ...(error.code ? { code: error.code } : {}) }));
  return true;
});

chrome.tabs?.onRemoved?.addListener(tabId => {
  const wasOwned = refreshPreflightCreatedTabIds.delete(tabId);
  refreshPreflightTabRevisions.delete(tabId);
  refreshPreflightStaleTabRevisions.delete(tabId);
  refreshPreflightTabClaims.delete(tabId);
  const reconcile = wasOwned
    ? persistRefreshPreflightState()
    : restoreRefreshPreflightState().then(() => {
      if (refreshPreflightCreatedTabIds.delete(tabId)) return persistRefreshPreflightState();
      return undefined;
    });
  return reconcile.catch(error => console.warn("[AI比价] 刷新预检状态恢复失败", error));
});

chrome.runtime.onInstalled.addListener(() => {
  scheduleCheckinAlarm();
  ensureWorkspacePlugins({ force: true });
});
chrome.runtime.onStartup.addListener(() => {
  scheduleCheckinAlarm();
  ensureWorkspacePlugins({ force: true });
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === CHECKIN_ALARM_NAME) return checkinAll({ claim: true, autoOnly: true }).catch(error => console.warn("[AI比价] 定时签到失败", error));
});
