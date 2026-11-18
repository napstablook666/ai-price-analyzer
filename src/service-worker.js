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
import { DEFAULT_PLUGIN_REGISTRY_URL, comparePluginVersions, installedCheckinSpecs, installedPluginSpecs, normalizeLocalPlugins, normalizePluginSpec, normalizeRegistryPayload, normalizeRegistryState, pluginUpdateState, registryStateAfterRefresh } from "./core/declarative-plugin.js";
import { ensurePageBridge, findOrOpenPageTab } from "./core/page-tabs.js";
import { runWithConcurrency, withKeyedLock } from "./core/concurrency.js";
import { runRefreshAll } from "./core/refresh-scheduler.js";
import { dropFloatingModels, fetchReferences } from "./core/openrouter.js";
import { buildComparisonRows, buildStationIndexes, filterComparisonsByMode, flattenComparisonRows, summarizeComparisons } from "./core/pricing.js";
import { normalizeProxyModelName } from "./core/matching.js";
import { NORMALIZATION_VERSION } from "./core/normalizers.js";
import { snapshotNeedsRefresh } from "./core/snapshot-policy.js";
import { normalizeSettings, normalizeStation } from "./shared/schema.js";
import { getComparisonRevision, getLatestSnapshots, getSnapshots, getStations, getValue, putSnapshot, putStations, setValue } from "./shared/db.js";
import { buildSettingsExport, parseSettingsExport } from "./core/settings-transfer.js";
import { mergeStationSave } from "./core/station-save.js";
import { getModelAssistantKey, getStationCredential, removeStationCredential, setStationCredential, setModelAssistantKey } from "./shared/credentials.js";
import { completeChat, fetchModelCatalog, testModelConnection } from "./core/model-api.js";
import { ASSIST_BATCH_SIZE, ASSIST_CONCURRENCY, ASSIST_RETRIES, ASSIST_RETRY_DELAY_MS, ASSIST_TIMEOUT_MS, applyAssistResults, assistFailureLabel, assistMaxTokens, buildAssistEntries, buildAssistPool, buildAssistPrompt, cacheKey, collapseAssistEntries, collectUnmatchedModels, llmMatchesFromCache, overrideFromAssist, parseAssistResponse, poolSummaryLabel, selectPendingEntries, spreadAssistResults, summarizeCache, summarizePool } from "./core/llm-matching.js";
import { checkinPresetsFromSpecs, matchCheckinPreset, normalizeCheckinRecord, normalizeCheckinSession, performCheckin, readPageToken } from "./core/checkin.js";
import { MAGPIE_USAGE_WINDOWS, fetchMagpieUsage, normalizeMagpieSyncInterval } from "./core/magpie-usage.js";
import { checkForUpdate, isNewerVersion } from "./core/update-check.js";

const LEGACY_REFRESH_ALARM_NAME = "refresh-stations";
const CHECKIN_ALARM_NAME = "checkin-stations";
const CHECKIN_LOGIN_ALARM_NAME = "checkin-login";
const UPDATE_ALARM_NAME = "update-check";
const MARKER_WATCH_ALARM_NAME = "update-marker-watch";
const MARKER_FILE_NAME = "update-marker.json";
const MARKER_WATCH_PERIOD_MINUTES = 1;
const UPDATE_STATE_KEY = "update-state";
const MAGPIE_USAGE_ALARM_NAME = "magpie-usage";
const CHECKIN_LOGIN_WATCH_LIMIT = 12;
const CHECKIN_LOGIN_COOKIE_PREFIXES = ["__Host-", "__Secure-"];

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
  const credential = await getStationCredential(station.id);
  const auth = { ...(station.auth || {}) };
  for (const field of ["token", "username", "password"]) if (!auth[field]) auth[field] = credential[field] || "";
  return { ...station, auth };
}
// 只放在 HttpOnly cookie 里的登录态：借 DNR 补齐 refresh 接口要的 Origin 与 Cookie，
// 在 service worker 里换出 access token，省掉每轮刷新都开一个临时标签页。
const COOKIE_AUTH_RULE_BASE = 9300;
const COOKIE_AUTH_TOKENS = new Map();

function readPayloadPath(value, path) {
  return String(path || "").split(".").filter(Boolean).reduce((current, key) => current && typeof current === "object" ? current[key] : undefined, value);
}

function cookieAuthRuleId(stationId) {
  let hash = 0;
  for (const character of String(stationId)) hash = (hash * 31 + character.codePointAt(0)) % 10000;
  return COOKIE_AUTH_RULE_BASE + hash;
}

async function cookieAuthAccessToken(station, cookieAuth) {
  const cached = COOKIE_AUTH_TOKENS.get(station.id);
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const origin = new URL(station.baseUrl).origin;
  const refreshUrl = new URL(cookieAuth.refreshPath, origin).toString();
  const cookie = await chrome.cookies.get({ url: refreshUrl, name: cookieAuth.cookieName }).catch(() => null);
  if (!cookie?.value) throw new Error(cookieAuth.missingMessage);
  const ruleId = cookieAuthRuleId(station.id);
  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [ruleId],
      addRules: [{
        id: ruleId,
        priority: 1,
        action: {
          type: "modifyHeaders",
          requestHeaders: [
            { header: "origin", operation: "set", value: origin },
            { header: "cookie", operation: "set", value: `${cookieAuth.cookieName}=${cookie.value}` }
          ]
        },
        condition: { urlFilter: `||${new URL(origin).hostname}${cookieAuth.refreshPath}`, resourceTypes: ["xmlhttprequest"] }
      }]
    });
    const response = await fetch(refreshUrl, { method: "POST", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(cookieAuth.failureMessage);
    const payload = await response.json();
    const token = String(readPayloadPath(payload, cookieAuth.accessTokenPath) || "").trim();
    if (!token) throw new Error(cookieAuth.failureMessage);
    const expiresAt = Number(readPayloadPath(payload, cookieAuth.expiresAtPath)) * 1000;
    COOKIE_AUTH_TOKENS.set(station.id, { token, expiresAt: Number.isFinite(expiresAt) && expiresAt > Date.now() ? expiresAt - 60000 : Date.now() + 4 * 60 * 1000 });
    return token;
  } finally {
    chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] }).catch(() => {});
  }
}

async function collectWithCookieAuth(station, collection, cookieAuth) {
  const attempt = async () => {
    const token = await cookieAuthAccessToken(station, cookieAuth);
    const authed = { ...station, auth: { ...station.auth, type: "bearer", token } };
    return collectStation(authed, { collection: { ...collection, station: authed } });
  };
  try {
    return await attempt();
  } catch (error) {
    if (String(error?.message || "") === cookieAuth.missingMessage) throw error;
    COOKIE_AUTH_TOKENS.delete(station.id);
    return attempt();
  }
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
  const cookieAuth = providerForStation(station)?.request?.cookieAuth;
  if (cookieAuth && station.mode !== "page") return collectWithCookieAuth(station, collection, cookieAuth);
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
  // 旧缓存里留着 ~vendor 浮动别名时不再按 24 小时有效期直接返回：重拉一次，供应商分组才会立即清干净。
  const legacy = dropFloatingModels(cache.models).length !== (Array.isArray(cache.models) ? cache.models.length : 0);
  if (!force && !legacy && cache.fetchedAt && Date.now() - cache.fetchedAt < 24 * 60 * 60 * 1000) return cache;
  const result = await fetchReferences({ cache });
  await setValue("references", result);
  return result;
}

// 站点被后台改过之后，开着页面得重拉一次；不广播的话页面内存还是旧快照。
// origin 是发起方自己的标记，发起方靠它认出自己的回声，不必重绘。
function notifyStationsChanged(origin = "") {
  chrome.runtime.sendMessage({ type: "STATIONS_CHANGED", origin: String(origin || "") }, () => void chrome.runtime.lastError);
}

function notifyRefreshProgress(progress) {
  chrome.runtime.sendMessage({ type: "REFRESH_PROGRESS", progress: { ...progress, refreshInProgress: !["complete", "error"].includes(progress.phase) || Boolean(refreshReferencesTask) } }, () => void chrome.runtime.lastError);
}

function notifyReferencesRefresh(active) {
  chrome.runtime.sendMessage({ type: "REFERENCES_REFRESHING", active: Boolean(refreshAllTask || active) }, () => void chrome.runtime.lastError);
}
// 识别是一串串行 LLM 请求，界面靠这条消息画进度条，不要并到 REFRESH_PROGRESS 上。
function notifyAssistProgress(progress) {
  chrome.runtime.sendMessage({ type: "ASSIST_PROGRESS", progress }, () => void chrome.runtime.lastError);
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
  const selection = Array.isArray(options.stationIds) ? options.stationIds : options.stationId ? [options.stationId] : null;
  const stationKey = JSON.stringify(selection ? [...new Set(selection)].sort() : null);
  if (refreshAllTask) {
    const active = refreshAllTask;
    const sameRequest = active.stationKey === stationKey
      && active.sourceTabId === options.sourceTabId
      && active.forceReferences === Boolean(options.forceReferences);
    if (sameRequest) return active.promise;
    await active.promise.catch(() => {});
    return refreshAll(options);
  }
  const task = { ...options, stationKey, forceReferences: Boolean(options.forceReferences), promise: refreshAllInternal(options) };
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
  const normalizedSnapshots = snapshots.map(snapshot => ({
    ...snapshot,
  incomplete: snapshot.status === "partial" || Boolean(snapshot.normalized?.incomplete),
  unsupportedBillingModes: snapshot.normalized?.unsupportedBillingModes || snapshot.rawMeta?.unsupportedBillingModes || [],
  unpricedModels: snapshot.normalized?.unpricedModels || snapshot.rawMeta?.unpricedModels || []
  }));
  const effectiveReferences = { ...references, exchangeRate: savedSettings.exchangeRate || references.exchangeRate, openRouterRechargeRate: savedSettings.exchangeRate || references.openRouterRechargeRate || references.exchangeRate };
  const llmCache = await getValue("llmMatchCache", {});
  const llmMatches = llmMatchesFromCache(llmCache);
  const revision = getComparisonRevision();
  const cacheable = revisionAtStart === revision;
  const comparisonKey = JSON.stringify([revision, normalizedSnapshots.map(snapshot => snapshot.id), llmMatches]);
  let comparisonResult = cacheable && comparisonCache?.key === comparisonKey ? comparisonCache : null;
  if (!comparisonResult) {
    const comparisons = buildComparisonRows({
      stations: comparisonStations,
      snapshots: normalizedSnapshots,
      references: effectiveReferences,
      usage: savedSettings.usage,
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
    const record = checkinRecords[preset.id] || {};
    return {
      id: preset.id,
      name: preset.name,
      hosts: preset.matchHosts,
      linkedStationId: linked ? linked.id : null,
      autoEnabled: Boolean(linked?.checkin?.autoEnabled || record.autoEnabled),
      presetAutoEnabled: Boolean(record.autoEnabled),
      needsLogin: record.lastStatus === "needs-login",
      hasSession: Boolean(record.session),
      sessionCapturedAt: Number(record.session?.capturedAt) || 0,
      hasManualToken: Boolean(linked?.checkin?.token || record.token),
      loginPath: preset.loginPath || "",
      tokenHint: preset.tokenHint || ""
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
// 更新检测：只读 GitHub Releases，不上报任何本地数据。
function currentExtensionVersion() {
  try {
    return chrome.runtime.getManifest?.().version || "";
  } catch {
    return "";
  }
}

async function readUpdateResult() {
  const stored = await getValue(UPDATE_STATE_KEY, null);
  return stored && typeof stored === "object" ? stored : null;
}

async function updateStateForUi() {
  const settings = await getSettings();
  return {
    currentVersion: currentExtensionVersion(),
    autoCheck: settings.updateAutoCheck,
    intervalMinutes: settings.updateIntervalMinutes,
    channel: settings.updateChannel,
    lastCheck: await readUpdateResult()
  };
}

async function runUpdateCheck({ force = false } = {}) {
  const settings = await getSettings();
  const previous = await readUpdateResult();
  const nowMs = Date.now();
  // 配额用完到恢复时间之间不再打接口，免得上限越来越久。
  if (!force && Number(previous?.resetAt) > nowMs) {
    return { ...(await updateStateForUi()), lastCheck: previous, skipped: true };
  }
  const result = await checkForUpdate({
    currentVersion: currentExtensionVersion(),
    channel: settings.updateChannel,
    etag: previous?.etag || "",
    cachedRelease: previous?.release || null,
    now: () => nowMs
  });
  const stored = {
    ...result,
    release: result.latestVersion
      ? { version: result.latestVersion, tag: result.latestVersion, url: result.releaseUrl, notes: result.notes, publishedAt: result.publishedAt }
      : null
  };
  await setValue(UPDATE_STATE_KEY, stored);
  return { ...(await updateStateForUi()), lastCheck: stored };
}

async function scheduleUpdateAlarm() {
  await chrome.alarms.clear(UPDATE_ALARM_NAME);
  const settings = await getSettings();
  if (!settings.updateAutoCheck) return;
  chrome.alarms.create(UPDATE_ALARM_NAME, { periodInMinutes: settings.updateIntervalMinutes });
}

// update.bat 覆盖完目录会在扩展根写一个 marker，扩展没人替它重启。这里每分钟问一次，
// 读到比自己新的版本就写一条记录再自重启，用户不用回到 chrome://extensions 点刷新。
async function watchUpdateMarker() {
  let marker;
  try {
    const url = `${chrome.runtime.getURL(MARKER_FILE_NAME)}?t=${Date.now()}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return;
    marker = await response.json();
  } catch {
    return;
  }
  const version = typeof marker?.version === "string" ? marker.version.trim() : "";
  if (!version) return;
  const current = chrome.runtime.getManifest().version;
  if (!isNewerVersion(version, current)) return;
  await chrome.storage.local.set({ "self-update": { version, at: Date.now(), source: "bat" } });
  chrome.runtime.reload();
}

function scheduleMarkerWatchAlarm() {
  chrome.alarms.create(MARKER_WATCH_ALARM_NAME, { periodInMinutes: MARKER_WATCH_PERIOD_MINUTES });
}

async function saveUpdatePrefs(input = {}) {
  const current = await getSettings();
  const next = normalizeSettings({
    ...current,
    updateAutoCheck: input.autoCheck === undefined ? current.updateAutoCheck : input.autoCheck !== false,
    updateIntervalMinutes: input.intervalMinutes === undefined ? current.updateIntervalMinutes : input.intervalMinutes,
    updateChannel: input.channel === undefined ? current.updateChannel : input.channel
  });
  await setValue("settings", next);
  await scheduleUpdateAlarm();
  return updateStateForUi();
}

// magpie 用量同步：只读本机网关，把两个窗口的实测值写进 settings.magpieSync。
async function runMagpieUsageSync({ force = false } = {}) {
  const settings = await getSettings();
  const interval = normalizeMagpieSyncInterval(settings.magpieSyncIntervalMinutes);
  const previous = settings.magpieSync || null;
  const nowMs = Date.now();
  if (!force) {
    const lastAttempt = Number(previous?.attemptedAt) || 0;
    if (!interval) return { ...(await settingsForUi()), skipped: true };
    // 失败也按间隔退避，网关没开的时候不要每分钟重试。
    if (lastAttempt && nowMs - lastAttempt < interval * 60_000) return { ...(await settingsForUi()), skipped: true };
  }
  const next = { error: "", attemptedAt: nowMs };
  for (const window of MAGPIE_USAGE_WINDOWS) {
    try {
      const result = await fetchMagpieUsage({ baseUrl: settings.magpieBaseUrl, period: window.period, days: window.days });
      next[window.id] = { usage: result.usage, syncedAt: Date.now(), window: result.window };
    } catch (error) {
      // 单个窗口失败不影响另一个；已同步过的数字保留。
      if (previous?.[window.id]) next[window.id] = previous[window.id];
      next.error = error.message || String(error);
    }
  }
  await persistSettings({ ...settings, magpieSync: next });
  return { ...(await settingsForUi()), lastSync: next };
}

async function scheduleMagpieUsageAlarm() {
  await chrome.alarms.clear(MAGPIE_USAGE_ALARM_NAME);
  const settings = await getSettings();
  if (!settings.magpieSyncIntervalMinutes) return;
  chrome.alarms.create(MAGPIE_USAGE_ALARM_NAME, { periodInMinutes: settings.magpieSyncIntervalMinutes });
}

async function saveMagpieUsagePrefs(input = {}) {
  const current = await getSettings();
  const next = normalizeSettings({
    ...current,
    magpieBaseUrl: input.baseUrl === undefined ? current.magpieBaseUrl : input.baseUrl,
    magpieSyncIntervalMinutes: input.intervalMinutes === undefined ? current.magpieSyncIntervalMinutes : input.intervalMinutes
  });
  await setValue("settings", next);
  await scheduleMagpieUsageAlarm();
  return settingsForUi();
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
// 与预设对应的站点地址：有保存站点用站点，没有就用预设域名。
function checkinSiteOrigin(preset, station = null) {
  if (station?.baseUrl) {
    try { return new URL(station.baseUrl).origin; } catch {}
  }
  return `https://${preset.matchHosts[0]}`;
}

function wantsSessionCookie(preset, cookie) {
  if (preset.tokenCookieName) return cookie.name === preset.tokenCookieName;
  return CHECKIN_LOGIN_COOKIE_PREFIXES.some(prefix => cookie.name.startsWith(prefix));
}

// 抓一份登录态快照：页面里的 token + 站点会话 cookie。
async function captureCheckinSession(preset, station = null) {
  const origin = checkinSiteOrigin(preset, station);
  let cookies = [];
  try {
    const found = await chrome.cookies.getAll({ url: origin });
    cookies = found
      .filter(cookie => wantsSessionCookie(preset, cookie))
      .filter(cookie => !cookie.expirationDate || cookie.expirationDate * 1000 > Date.now());
  } catch {
    cookies = [];
  }
  let token = "";
  try {
    const fromPage = await readPageToken(origin, preset);
    token = typeof fromPage === "string" ? fromPage : "";
  } catch {
    token = "";
  }
  return normalizeCheckinSession({ token, cookies, origin, capturedAt: Date.now() });
}

async function saveCheckinSession(presetId, session) {
  const normalized = normalizeCheckinSession(session);
  if (!normalized) return null;
  await updateCheckinRecord(presetId, prev => ({ ...prev, session: normalized, needsLoginAt: 0 }));
  return normalized;
}

// 浏览器里的 cookie 被清掉时，把快照里的 cookie 写回去。
async function restoreCheckinCookies(cookies = []) {
  let restored = 0;
  for (const cookie of cookies) {
    const host = String(cookie.domain || "").replace(/^\./, "");
    if (!host) continue;
    try {
      await chrome.cookies.set({
        url: `${cookie.secure ? "https" : "http"}://${host}${cookie.path || "/"}`,
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain || undefined,
        path: cookie.path || "/",
        secure: Boolean(cookie.secure),
        httpOnly: Boolean(cookie.httpOnly),
        sameSite: cookie.sameSite || "lax",
        ...(Number(cookie.expirationDate) > 0 ? { expirationDate: Number(cookie.expirationDate) } : {})
      });
      restored += 1;
    } catch {
      // 单个 cookie 写不进去不影响其它 cookie
    }
  }
  return restored;
}

async function clearCheckinSession(stationId) {
  const id = String(stationId || "");
  if (!id) throw new Error("站点不存在");
  await updateCheckinRecord(id, prev => ({ ...prev, session: null, needsLoginAt: 0, lastStatus: prev.lastStatus === "needs-login" ? "idle" : prev.lastStatus, lastResult: prev.lastStatus === "needs-login" ? "" : prev.lastResult }));
  return { state: await getCheckinState() };
}

async function startCheckinLoginWatch(presetId, tabId = 0) {
  await setValue("checkinLoginWatch", { presetId, tabId, startedAt: Date.now(), attempts: 0 });
  await chrome.alarms.clear(CHECKIN_LOGIN_ALARM_NAME);
  chrome.alarms.create(CHECKIN_LOGIN_ALARM_NAME, { periodInMinutes: 0.5, delayInMinutes: 0.5 });
}

async function stopCheckinLoginWatch() {
  await chrome.alarms.clear(CHECKIN_LOGIN_ALARM_NAME);
  await setValue("checkinLoginWatch", null);
}

async function openCheckinLogin({ stationId } = {}) {
  const presets = await resolveCheckinPresets();
  const preset = presets.find(item => item.id === String(stationId || ""));
  if (!preset) throw new Error("站点不存在");
  const url = `${checkinSiteOrigin(preset)}${preset.loginPath || "/"}`;
  const tab = await chrome.tabs.create({ url });
  await startCheckinLoginWatch(preset.id, tab?.id || 0);
  return { url, state: await getCheckinState() };
}

function notifyCheckinUpdated(stationId) {
  chrome.runtime.sendMessage({ type: "CHECKIN_UPDATED", stationId }, () => void chrome.runtime.lastError);
}

// 打开登录页之后每 30 秒探一次，最多 12 次；确认登录成功就存快照并通知界面。
async function watchCheckinLogin() {
  const watch = await getValue("checkinLoginWatch", null);
  if (!watch?.presetId) { await chrome.alarms.clear(CHECKIN_LOGIN_ALARM_NAME); return; }
  const attempts = Number(watch.attempts) || 0;
  if (attempts >= CHECKIN_LOGIN_WATCH_LIMIT) { await stopCheckinLoginWatch(); return; }
  await setValue("checkinLoginWatch", { ...watch, attempts: attempts + 1 });
  const presets = await resolveCheckinPresets();
  const preset = presets.find(item => item.id === watch.presetId);
  if (!preset) { await stopCheckinLoginWatch(); return; }
  const stations = await getStations();
  const station = stations.find(item => item.enabled && matchCheckinPreset(item, presets)?.id === preset.id)
    || { id: preset.id, name: preset.name, baseUrl: `https://${preset.matchHosts[0]}`, enabled: true };
  const record = (await getCheckinState())[preset.id] || {};
  try {
    const result = await performCheckin({ station, claim: false, preset, token: record.token || "", session: record.session || null, restoreCookies: restoreCheckinCookies });
    await saveCheckinSession(preset.id, await captureCheckinSession(preset, station));
    await updateCheckinRecord(preset.id, prev => ({ ...prev, lastCheckedAt: Date.now(), lastStatus: "ok", lastResult: result.message || "已登录", needsLoginAt: 0 }));
    await stopCheckinLoginWatch();
    notifyCheckinUpdated(preset.id);
  } catch (error) {
    if (error?.code !== "CHECKIN_NEEDS_LOGIN") await stopCheckinLoginWatch();
  }
}

async function runCheckinForStation(station, { claim = true, autoOnly = false, presets = [] } = {}) {
  const preset = matchCheckinPreset(station, presets);
  if (!preset) return null;
  const record = (await getCheckinState())[preset.id] || {};
  if (autoOnly && !record.autoEnabled) return null;
  // 冷却期内（cooldownHours）不重复查询状态，减少无效请求
  if (record.lastClaimedAt && Date.now() - record.lastClaimedAt < preset.cooldownHours * 60 * 60 * 1000) return null;
  const manualToken = String(station.checkin?.token || record.token || "");
  try {
    const result = await performCheckin({ station, claim, preset, token: manualToken, session: record.session || null, restoreCookies: restoreCheckinCookies });
    // 签到成功后刷新快照（站点可能在响应里换了会话 cookie）；没快照时首查也存一份。
    if (claim || !record.session) await saveCheckinSession(preset.id, await captureCheckinSession(preset, station));
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
      needsLoginAt: 0,
      autoEnabled: record.autoEnabled
    }));
    return { stationId: preset.id, stationName: station.name, ...result };
  } catch (error) {
    const needsLogin = error?.code === "CHECKIN_NEEDS_LOGIN";
    await updateCheckinRecord(preset.id, prev => ({
      ...prev,
      lastCheckedAt: Date.now(),
      lastResult: needsLogin ? "未登录" : error.message || String(error),
      lastStatus: needsLogin ? "needs-login" : "error",
      needsLoginAt: needsLogin ? Date.now() : prev.needsLoginAt,
      autoEnabled: record.autoEnabled
    }));
    return { stationId: preset.id, stationName: station.name, ok: false, needsLogin, error: needsLogin ? "需要先登录站点" : error.message || String(error) };
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

async function saveCheckinConfig({ stationId, autoEnabled, token } = {}) {
  const hasToken = typeof token === "string";
  const manualToken = hasToken ? token.trim() : "";
  const stations = await getStations();
  const presets = await resolveCheckinPresets();
  const station = stations.find(item => item.id === String(stationId || ""));
  if (!station) {
    // 预设 id（未保存站点）：签到开关和手填令牌存到 checkinState，无需手动添加站点
    if (!presets.some(item => item.id === String(stationId || ""))) throw new Error("站点不存在");
    await updateCheckinRecord(String(stationId), prev => ({
      ...prev,
      ...(autoEnabled === undefined ? {} : { autoEnabled: Boolean(autoEnabled) }),
      ...(hasToken ? { token: manualToken, needsLoginAt: 0 } : {})
    }));
    return checkinAll({ stationId: String(stationId), claim: false, autoOnly: false });
  }
  const next = stations.map(item => item.id === station.id ? normalizeStation({
    ...item,
    checkin: {
      ...item.checkin,
      ...(autoEnabled === undefined ? {} : { autoEnabled: Boolean(autoEnabled) }),
      ...(hasToken ? { token: manualToken } : {})
    }
  }) : item);
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
    if (addedStations.length) notifyStationsChanged();
    return {
      stations: [...current, ...addedStations],
      added,
      alreadyAdded: requested.filter(id => !added.includes(id)),
      sitePlugins: activeCatalogForStations([...current, ...addedStations])
    };
  });
}

// 传进来的站点只做新增与覆盖，删除只认显式名单：页面快照过期时，缺席不能当成删除。
async function saveStations(input, removedIds = [], origin = "") {
  const invalidation = invalidateRefreshPreflight();
  await ensureWorkspacePlugins();
  await syncSitePlugins(input);
  const current = await getStations();
  const currentById = new Map(current.map(station => [station.id, station]));
  const removed = new Set((Array.isArray(removedIds) ? removedIds : []).map(id => String(id ?? "").trim()).filter(Boolean));
  for (const id of removed) await removeStationCredential(id);
  const upserts = [];
  for (const raw of input || []) {
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
    upserts.push({ ...station, auth: { type: submitted.type, token: "", username: "", password: "" } });
  }
  const stations = mergeStationSave(current, upserts, [...removed]);
  await putStations(stations);
  const pluginSettings = await getSettings();
  setActivePluginIds(installedPluginIds(pluginSettings));
  pruneSitePlugins(stations, [...installedPluginIds(pluginSettings)]);
  await invalidation;
  notifyStationsChanged(origin);
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

async function exportSettingsForFile() {
  return buildSettingsExport({ settings: await getSettings(), stations: await getStations() });
}

// 导入只认「用户填的东西」：插件来源这几项留在本机，横向覆盖会把已装插件清空。
async function importSettingsFromFile(payload) {
  const incoming = parseSettingsExport(payload);
  const current = await getSettings();
  await setValue("settings", normalizeSettings({
    ...incoming.settings,
    devMode: current.devMode,
    pluginInstallMigrated: current.pluginInstallMigrated,
    localPlugins: current.localPlugins,
    pluginRegistry: current.pluginRegistry
  }));
  await putStations(incoming.stations);
  notifyStationsChanged();
  await invalidateRefreshPreflight();
  return { settings: await settingsForUi(), stations: incoming.stations.length };
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
  // 已生效的判定不在 unmatched 里（它已经匹配成功），只靠 unmatched 拼列表会把它整片弄丢，
  // 于是「已接受」筛选永远空、转人工确认按钮永远 0 条。这里把缓存和未匹配合并成一张池。
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
      // 规则层给不出候选的写法模型也无从判断，结论直接记「不是」，界面注明原因。
      status: assigned ? (cached?.status || "pending") : "none",
      reason: assigned ? String(cached?.reason || "") : "no-candidates",
      failure: cached?.status === "failed" ? assistFailureLabel(cached) : "",
      targetId: cached?.targetId || "",
      attempts: Number(cached?.attempts) || 0,
      at: Number(cached?.at) || 0
    };
  });
  const [stations, settings] = await Promise.all([getStations(), getSettings()]);
  const { pool, orphans } = buildAssistPool({
    cache,
    rows,
    // 已生效的条目已经不在 unmatched 里，站点名只能从站点表补。
    stationNameById: new Map(stations.map(station => [station.id, station.name || station.baseUrl || station.id])),
    unmatchedKeys: new Set(unmatched.map(entry => entry.key)),
    // 人工指定要进池：它是最优先的结论，也是「改回 AI 判定」的对照。
    overrides: settings.modelMatchOverrides
  });
  const poolCounts = summarizePool(pool, orphans);
  return {
    configured: await getModelAssistantEnabled(),
    referencesFetchedAt,
    assigned: entries.length,
    noCandidates: unmatched.length - entries.length,
    summary: summarizeCache(cache),
    pool: poolCounts,
    poolLabel: poolSummaryLabel(poolCounts),
    rows: pool,
    orphans
  };
}

async function getModelAssistantEnabled() {
  const settings = await getSettings();
  const config = settings.modelAssistant || {};
  return Boolean(config.enabled && String(config.baseUrl || "").trim() && String(config.model || "").trim()) && Boolean(await getModelAssistantKey());
}

async function runModelAssist({ force = false, keys = [] } = {}) {
  if (modelAssistTask) throw new Error("模型识别正在运行，请等这一轮结束");
  modelAssistTask = (async () => {
    const settings = await getSettings();
    const config = settings.modelAssistant || {};
    if (!config.enabled) throw new Error("先到设置里启用模型识别");
    if (!String(config.baseUrl || "").trim() || !String(config.model || "").trim()) throw new Error("先填好模型服务地址与模型");
    const apiKey = await getModelAssistantKey();
    if (!apiKey) throw new Error("先填好模型服务密钥");

    const { cache, entries, referencesFetchedAt } = await assistContext();
    // 空队列分两种：比价表里根本没有未匹配的写法，或者有但每条都有结论了。界面要分开说。
    if (!entries.length) return { ...summarizeCache(cache), unmatched: 0, ranBatches: 0, pending: 0, reused: 0, invalidAnswers: 0, errors: 0 };

    // 单条重试只问指定的那几个写法，别把整队都重跑一遍。
    const only = new Set((Array.isArray(keys) ? keys : []).filter(Boolean));
    const scopedEntries = only.size ? entries.filter(entry => only.has(entry.key)) : entries;
    if (!scopedEntries.length) return { ...summarizeCache(cache), unmatched: entries.length, ranBatches: 0, pending: 0, reused: 0, invalidAnswers: 0, errors: 0 };

    // 指定重试时 force 只对这几条生效：别的条目照样按指纹复用。
    const { pending, reused } = selectPendingEntries({ cache, entries: scopedEntries, referencesFetchedAt, force });
    if (!pending.length) return { ...summarizeCache(cache), unmatched: entries.length, ranBatches: 0, pending: 0, reused: reused.length, invalidAnswers: 0, errors: 0 };

    const results = [];
    const notAsked = [];
    const fingerprintByKey = {};
    let ranBatches = 0;
    let errors = 0;
    // 同写法同候选的站点条目合并成一条问，答案再摊回各站点，省掉重复往返。
    const { primary, followers } = collapseAssistEntries(pending);
    for (const entry of pending) fingerprintByKey[entry.key] = entry.fingerprint;
    const batches = chunkList(primary, ASSIST_BATCH_SIZE);
    let completed = 0;
    let completedBatches = 0;
    let activeBatches = 0;
    const weightOf = entry => 1 + (followers.get(entry.key)?.length || 0);
    const tally = { accepted: 0, none: 0, invalid: 0 };
    const addToTally = list => {
      for (const item of list) {
        if (item.status === "accepted") tally.accepted += 1;
        else if (item.status === "none") tally.none += 1;
        else if (item.status === "invalid") tally.invalid += 1;
      }
    };
    // 界面只认这条消息画进度：每批开头报一次、收工报一次，中途不刷新缓存。
    const reportProgress = phase => notifyAssistProgress({
      phase,
      total: pending.length,
      completed,
      totalBatches: batches.length,
      completedBatches,
      activeBatches,
      concurrency: ASSIST_CONCURRENCY,
      accepted: tally.accepted,
      none: tally.none,
      invalid: tally.invalid,
      errors,
    });
    reportProgress("start");

    // 批次并行跑：串行要等 N 轮往返，并行只等一轮；中转站限流时靠 ASSIST_CONCURRENCY 收口。
    await runWithConcurrency(batches, ASSIST_CONCURRENCY, async batch => {
      activeBatches += 1;
      reportProgress("request");
      // 一次失败不代表结论：接口偶尔返回空正文、模型偶尔漏行，同一批最多问 3 次，只重问还没答的。
      const answered = new Map();
      let remaining = batch;
      let lastError = null;
      for (let attempt = 1; attempt <= ASSIST_RETRIES && remaining.length; attempt += 1) {
        if (attempt > 1) await new Promise(resolve => setTimeout(resolve, ASSIST_RETRY_DELAY_MS));
        try {
          const { content } = await completeChat({
            baseUrl: config.baseUrl,
            apiKey,
            model: config.model,
            temperature: config.temperature,
            maxTokens: assistMaxTokens(remaining.length),
            // 长推理任务给足时间：超时太短会把还在跑的批次整批记成失败。
            timeoutMs: ASSIST_TIMEOUT_MS,
            messages: [
              { role: "system", content: "你只输出「序号 => id 分数」的行，不要任何解释。" },
              { role: "user", content: buildAssistPrompt(remaining) }
            ]
          });
          const parsed = parseAssistResponse(content, { entries: remaining });
          for (const item of parsed.accepted) answered.set(item.key, item);
          remaining = remaining.filter(entry => !answered.has(entry.key));
          lastError = null;
        } catch (error) {
          console.debug("[AI比价] 模型识别批次失败", error);
          lastError = error;
        }
      }
      const resolved = [...answered.values()];
      if (remaining.length) {
        errors += 1;
        // 超时和接口报错分开记：前者该加时或缩批，后者该看密钥和地址；没有报错就是模型漏答。
        const reason = lastError ? (/超时/.test(String(lastError?.message || "")) ? "timeout" : "error") : "unanswered";
        const detail = lastError ? String(lastError.message || "").slice(0, 120) : "";
        notAsked.push(...spreadAssistResults(remaining, followers).map(item => ({ ...item, reason, error: detail })));
      }
      const spread = spreadAssistResults(resolved, followers);
      results.push(...spread);
      addToTally(spread);
      if (resolved.length) ranBatches += 1;
      activeBatches -= 1;
      completed += batch.reduce((sum, entry) => sum + weightOf(entry), 0);
      completedBatches += 1;
      reportProgress("batch");
    });

    const nextCache = applyAssistResults(cache, results, { fingerprintByKey, notAsked });
    await setValue("llmMatchCache", nextCache);
    // 缓存不进 comparisonRevision，这里手动让下一次 dashboard 重算。
    comparisonCache = null;
    const summary = {
      ...summarizeCache(nextCache),
      ranBatches,
      timeouts: Object.values(nextCache).filter(entry => entry?.status === "failed" && entry.reason === "timeout").length,
      pending: pending.length,
      reused: reused.length,
      merged: pending.length - primary.length,
      errors
    };
    reportProgress("complete");
    return summary;
  })().catch(error => {
    notifyAssistProgress({ phase: "error", message: error.message || "模型识别失败", total: 0, completed: 0, totalBatches: 0, completedBatches: 0 });
    throw error;
  });
  try {
    return await modelAssistTask;
  } finally {
    modelAssistTask = null;
  }
}
// 撤销已生效的判定：删掉缓存条目，那个写法下一轮就回到未匹配池重新待判。
// 不能靠清空整张缓存做这件事，那会把另外几十条已生效的结论一起废掉。
async function forgetModelAssistEntries(keys = []) {
  const cache = await getValue("llmMatchCache", {});
  const next = { ...cache };
  let removed = 0;
  for (const key of Array.isArray(keys) ? keys : []) {
    if (next[key]) {
      delete next[key];
      removed += 1;
    }
  }
  if (removed) {
    await setValue("llmMatchCache", next);
    comparisonCache = null;
  }
  return { removed, ...(await modelAssistState()) };
}

async function clearModelAssistCache() {
  await setValue("llmMatchCache", {});
  comparisonCache = null;
  return modelAssistState();
}

// 报价里已经消失、结论又不是人工接受的条目清出去：它们发不出请求，留着只占队列名额。
async function purgeModelAssistOrphans() {
  const { orphans } = await modelAssistState();
  return forgetModelAssistEntries(orphans.map(item => item.key));
}

// 忽略是人工出口：写法反复判成「不是」或者明确不想再问，存下来就不再进识别队列。
async function setModelAssistIgnored({ keys = [], ignored = true } = {}) {
  const cache = await getValue("llmMatchCache", {});
  const next = { ...cache };
  const at = Date.now();
  let changed = 0;
  for (const key of Array.isArray(keys) ? keys : []) {
    const entry = next[key] || {};
    const [stationId, modelName] = String(key).split("\u0000");
    if (ignored) {
      // 没问过模型也能忽略：规则层没候选的写法跑识别也不会问它，直接记结论。
      next[key] = {
        stationId: entry.stationId || stationId,
        modelName: entry.modelName || modelName,
        targetId: "",
        status: "ignored",
        confidence: 0,
        attempts: Number(entry.attempts) || 0,
        fingerprint: "",
        referencesFetchedAt: 0,
        at,
        nextRetryAt: 0,
        previous: entry.status ? { status: entry.status, targetId: entry.targetId || "", at: entry.at || 0 } : null
      };
      changed += 1;
    } else if (entry.status === "ignored") {
      // 取消忽略就是删掉这条，写法下一轮回到未匹配池重新排队。
      delete next[key];
      changed += 1;
    }
  }
  if (changed) {
    await setValue("llmMatchCache", next);
    comparisonCache = null;
  }
  return { changed, ...(await modelAssistState()) };
}

// 冷却到期前想立刻再问一次：清掉 nextRetryAt，条目回到可发送状态。
async function resetModelAssistCooldown(keys = []) {
  const cache = await getValue("llmMatchCache", {});
  const next = { ...cache };
  let reset = 0;
  for (const key of Array.isArray(keys) ? keys : []) {
    if (next[key] && Number(next[key].nextRetryAt)) {
      next[key] = { ...next[key], nextRetryAt: 0 };
      reset += 1;
    }
  }
  if (reset) {
    await setValue("llmMatchCache", next);
    comparisonCache = null;
  }
  return { reset, ...(await modelAssistState()) };
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

// 单条人工指定：把某条写法直接钉到某个官方模型，优先级最高，AI 再判也不会改。
// 传空 targetId 就是撤销人工指定，写法回到 AI 判定或未匹配池。
async function setModelAssistOverride({ key = "", stationId = "", modelName = "", targetId = "" } = {}) {
  const settings = await getSettings();
  const normalizedKey = key || cacheKey(stationId, modelName);
  if (!normalizedKey) throw new Error("缺少要指定的写法");
  const [keyStation, keyModel] = String(normalizedKey).split("\u0000");
  const cache = await getValue("llmMatchCache", {});
  const cached = cache[normalizedKey] || null;
  const rawName = String(cached?.modelName || keyModel || "").trim();
  const rawStation = String(cached?.stationId || keyStation || "").trim();
  if (!rawStation || !rawName) throw new Error("缺少要指定的写法");
  const overrideKeyOf = item => `${item.stationId}\u0000${normalizeProxyModelName(item.modelName)}`;
  const overrides = settings.modelMatchOverrides.filter(item => overrideKeyOf(item) !== normalizedKey);
  const target = String(targetId || "").trim();
  if (target) overrides.push({ stationId: rawStation, modelName: rawName, officialModelId: target });
  // 人工指定一旦存在，AI 那条判定就没有意义了：留着会在撤销人工指定后立刻复活旧结论。
  const nextCache = { ...cache };
  if (target) delete nextCache[normalizedKey];
  if (target || cached) {
    await persistSettings({ ...settings, modelMatchOverrides: overrides });
    if (target) await setValue("llmMatchCache", nextCache);
    comparisonCache = null;
  }
  return modelAssistState();
}

// 官方模型清单：人工指定时按关键词搜索用。只给 id、名称、供应商，不带价格。
async function modelAssistCatalog({ query = "", limit = 20 } = {}) {
  const [references, settings] = await Promise.all([getValue("references", {}), getSettings()]);
  const officialList = Array.isArray(references.models) ? references.models : [];
  const keyword = String(query || "").trim().toLowerCase();
  const overrideKeyOf = item => `${item.stationId}\u0000${normalizeProxyModelName(item.modelName)}`;
  const takenBy = new Map(settings.modelMatchOverrides.map(item => [String(item.officialModelId || ""), overrideKeyOf(item)]));
  const entries = officialList.map(model => {
    const id = String(model.id || model.name || "").trim();
    return {
      id,
      name: String(model.name || model.id || "").trim(),
      displayName: String(model.display_name || model.name || model.id || "").trim(),
      provider: String(model.provider || (id.includes("/") ? id.split("/")[0] : "") || "").trim()
    };
  }).filter(item => item.id);
  // 关键词按空格拆开逐个匹配：`claude sonnet` 也能命中 `anthropic/claude-sonnet-4.5`。
  const tokens = keyword.replace(/[-_./:]+/g, " ").split(/\s+/).filter(Boolean);
  const matched = tokens.length
    ? entries.filter(item => {
      const haystack = [item.id, item.name, item.displayName].join(" ").toLowerCase().replace(/[-_./:]+/g, " ");
      return tokens.every(token => haystack.includes(token));
    })
    : entries;
  const size = Math.max(1, Math.min(200, Math.trunc(Number(limit)) || 20));
  return {
    total: entries.length,
    query: keyword,
    models: matched.slice(0, size).map(item => ({ ...item, usedBy: takenBy.get(item.id) || "" }))
  };
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
      const update = pluginUpdateState({ record, entry, codeBundled: Boolean(descriptor), bundledVersion: bundledPluginVersion() });
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
        installed: update.installed,
        installedVersion: update.installedVersion,
        updateAvailable: update.updateAvailable,
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
      next = registryStateAfterRefresh(current, { url, entries });
    } catch (error) {
      // 拉取失败保留上次成功的缓存，只记错误。
      next = { ...current, url, error: error.message || String(error) };
    }
    await persistSettings({ ...settings, pluginRegistry: next });
    return pluginWorkspaceState();
  });
}

async function installPlugin(id) {
  const { workspace, results, stationsAdded } = await installPlugins([id]);
  const failure = results.find(item => !item.ok && !item.skipped);
  if (failure) throw new Error(failure.error);
  return { ...workspace, lastInstall: { stationsAdded: stationsAdded || 0 } };
}

// 批量安装：一次加锁、一次落库、一次重算工作区，返回逐项结果，界面据此提示跳过与失败。
export async function installPlugins(ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(id => String(id || "").trim()).filter(Boolean))];
  if (!wanted.length) throw new Error("没有选中要安装的插件");
  return withKeyedLock("plugin-install", async () => {
    const settings = await getSettings();
    // 仓库视图按内置快照兜底展示，安装也应认快照里的条目，否则首次装内置插件会被「先刷新插件仓库」挡住。
    const registry = seededRegistry(settings.pluginRegistry);
    const stored = normalizeRegistryState(settings.pluginRegistry);
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
    let stationsAdded = 0;
    if (results.some(item => item.ok)) {
      await persistSettings({ ...settings, pluginRegistry: { ...stored, installed } });
      workspacePluginsSynced = false;
      await ensureWorkspacePlugins({ force: true });
      // 装完即加站：插件自带的 addable 站点直接进工作区；签到与按地址添加的插件不产生站点。
      const autoIds = results.filter(item => item.ok).map(item => item.id)
        .filter(id => sitePluginById(id)?.addable && [...activePluginIds()].includes(id));
      if (autoIds.length) {
        const addResult = await addSitePlugins(autoIds);
        const counts = new Map();
        for (const pluginId of addResult.added || []) counts.set(pluginId, (counts.get(pluginId) || 0) + 1);
        for (const item of results) if (item.ok) item.stations = counts.get(item.id) || 0;
        stationsAdded = (addResult.added || []).length;
      }
    }
    const workspace = await pluginWorkspaceState();
    return {
      workspace,
      stationsAdded,
      results,
      installed: results.filter(item => item.ok).map(item => item.id),
      skipped: results.filter(item => item.skipped).map(item => item.id),
      failed: results.filter(item => !item.ok && !item.skipped).map(({ id, error }) => ({ id, error }))
    };
  });
}

// 单条移除：uninstallPlugins 返回的就是工作区状态（带 removed），直接原样交给界面重绘。
export async function uninstallPlugin(id) {
  const pluginId = String(id || "").trim();
  if (!pluginId) throw new Error("插件不存在");
  return uninstallPlugins([pluginId]);
}

// 批量移除：一次加锁、一次落库，把仓库安装记录与本地插件一起清掉，并删掉挂在它们下面的站点。
export async function uninstallPlugins(ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : []).map(id => String(id || "").trim()).filter(Boolean))];
  if (!wanted.length) throw new Error("没有选中要移除的插件");
  return withKeyedLock("plugin-install", async () => {
    const settings = await getSettings();
    const registry = normalizeRegistryState(settings.pluginRegistry);
    const installed = { ...registry.installed };
    for (const id of wanted) delete installed[id];
    const localPlugins = settings.localPlugins.filter(spec => !wanted.includes(spec.id));
    for (const id of wanted) unloadSpecSitePlugin(id);
    const stations = await getStations();
    const kept = stations.filter(station => !wanted.includes(sitePluginForStation(station)?.id));
    for (const station of stations) {
      if (!kept.includes(station)) await removeStationCredential(station.id);
    }
    if (kept.length !== stations.length) {
      await putStations(kept);
      notifyStationsChanged();
    }
    await persistSettings({ ...settings, pluginRegistry: { ...registry, installed }, localPlugins });
    workspacePluginsSynced = false;
    await ensureWorkspacePlugins({ force: true });
    pruneSitePlugins(kept, [...installedPluginIds(await getSettings())]);
    return { ...(await pluginWorkspaceState()), removed: wanted };
  });
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
    case "GET_UPDATE_STATE": return updateStateForUi();
    case "CHECK_UPDATE": return runUpdateCheck({ force: true });
    case "SAVE_UPDATE_PREFS": return saveUpdatePrefs(message);
    case "SAVE_SETTINGS": return saveSettings(message.settings, message);
    case "EXPORT_SETTINGS": return exportSettingsForFile();
    case "IMPORT_SETTINGS": return importSettingsFromFile(message.payload);
    case "SAVE_MAGPIE_PREFS": return saveMagpieUsagePrefs(message);
    case "SYNC_MAGPIE_USAGE": return runMagpieUsageSync({ force: true });
    case "TEST_MODEL_CONNECTION": return testModelAssistant(message.config || {});
    case "FETCH_MODEL_CATALOG": return fetchModelAssistantCatalog(message.config || {});
    case "GET_MODEL_ASSIST_STATE": return modelAssistState();
    case "RUN_MODEL_ASSIST": return runModelAssist(message);
    case "CLEAR_MODEL_ASSIST_CACHE": return clearModelAssistCache();
    case "PURGE_MODEL_ASSIST_ORPHANS": return purgeModelAssistOrphans();
    case "SET_MODEL_ASSIST_IGNORED": return setModelAssistIgnored(message);
    case "RESET_MODEL_ASSIST_COOLDOWN": return resetModelAssistCooldown(message.keys);
    case "FORGET_MODEL_ASSIST_ENTRIES": return forgetModelAssistEntries(message.keys);
    case "APPLY_MODEL_ASSIST_OVERRIDES": return applyModelAssistOverrides(message.keys);
    case "SET_MODEL_ASSIST_OVERRIDE": return setModelAssistOverride(message);
    case "GET_MODEL_ASSIST_CATALOG": return modelAssistCatalog(message);
    case "SAVE_STATIONS": return saveStations(message.stations, message.removedIds, message.origin);
    case "GET_STATIONS": return getPreparedStations();
    case "ADD_SITE_PLUGINS": return addSitePlugins(message.ids);
    case "GET_PLUGIN_WORKSPACE": return pluginWorkspaceState();
    case "REFRESH_PLUGIN_REGISTRY": return refreshPluginRegistry(message);
    case "INSTALL_PLUGIN": return installPlugin(message.id);
    case "INSTALL_PLUGINS": return installPlugins(message.ids);
    case "UNINSTALL_PLUGIN": return uninstallPlugin(message.id);
case "UNINSTALL_PLUGINS": return uninstallPlugins(message.ids);
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
    case "OPEN_CHECKIN_LOGIN":
      return openCheckinLogin(message);
    case "CLEAR_CHECKIN_SESSION":
      return clearCheckinSession(message.stationId);
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
      const requestedIds = Array.isArray(message.stationIds) ? message.stationIds : [message.stationId];
      const stationIds = [...new Set(requestedIds.map(id => String(id || "").trim()).filter(Boolean))];
      if (!stationIds.length) throw new Error("请选择至少一个站点");
      const enabledIds = new Set((await getPreparedStations()).filter(item => item.enabled === true).map(item => item.id));
      if (stationIds.some(id => !enabledIds.has(id))) throw new Error("站点不存在或未启用");
      const result = await refreshAll({ stationIds, sourceTabId: message.sourceTabId });
      return { ...(await dashboard()), refreshSummary: result.summary };
    }
    case "FETCH_REFERENCES": {
      await refreshOfficialReferences(true);
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

const DASHBOARD_PAGE = "dashboard.html";

// 工具栏图标直接开扩展页面，不再有 popup；页面已经开着就切过去。
async function openDashboardTab() {
  const target = chrome.runtime.getURL(DASHBOARD_PAGE);
  const tabs = await chrome.tabs.query({}).catch(() => []);
  const existing = tabs.find(tab => typeof tab.url === "string" && tab.url.startsWith(target));
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true }).catch(() => {});
    if (existing.windowId !== undefined) await chrome.windows?.update?.(existing.windowId, { focused: true }).catch(() => {});
    return;
  }
  await chrome.tabs.create({ url: target });
}

chrome.action?.onClicked?.addListener(() => {
  openDashboardTab().catch(error => console.warn("[AI比价] 打开扩展页面失败", error));
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
  scheduleUpdateAlarm();
  scheduleMarkerWatchAlarm();
  scheduleMagpieUsageAlarm();
  ensureWorkspacePlugins({ force: true });
});
chrome.runtime.onStartup.addListener(() => {
  scheduleCheckinAlarm();
  scheduleUpdateAlarm();
  scheduleMarkerWatchAlarm();
  scheduleMagpieUsageAlarm();
  ensureWorkspacePlugins({ force: true });
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === CHECKIN_ALARM_NAME) return checkinAll({ claim: true, autoOnly: true }).catch(error => console.warn("[AI比价] 定时签到失败", error));
  if (alarm.name === CHECKIN_LOGIN_ALARM_NAME) return watchCheckinLogin().catch(error => console.warn("[AI比价] 签到登录探测失败", error));
  if (alarm.name === UPDATE_ALARM_NAME) return runUpdateCheck().catch(error => console.warn("[AI比价] 检查更新失败", error));
  if (alarm.name === MARKER_WATCH_ALARM_NAME) return watchUpdateMarker().catch(error => console.warn("[AI比价] 检查更新标记失败", error));
  if (alarm.name === MAGPIE_USAGE_ALARM_NAME) return runMagpieUsageSync().catch(error => console.warn("[AI比价] 同步 magpie 用量失败", error));
});
