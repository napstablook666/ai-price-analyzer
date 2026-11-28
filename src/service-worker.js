import { collectStation, createPageFetch } from "./core/collectors.js";
import { DEFAULT_COOKIE_TTL_MS, applyPageRenewal, probeFieldNames, renewalFromProvider, renewStationAuth, tokenSavePatch } from "./core/renewal.js";
import { applyKeepaliveResult, authConfirmedFromRenewal, KEEPALIVE_ALARM_PREFIX, dueStationIds, keepaliveAlarmName, planKeepalive, planKeepaliveSweeps, resolveSweepStationIds } from "./core/auth-keepalive.js";
import { PAGE_WINDOW_AUTH_RENEWAL_TYPE } from "./core/bridge-protocol.js";
import { modelAliasesForStations, prepareStationInput, providerForStation } from "./core/provider-registry.js";
import { buildStationRequest, resolveStationCollection } from "./core/request-strategy.js";
import { REFRESH_CONFIRMATION_REQUIRED_CODE, REFRESH_CONFIRMATION_REQUIRED_MESSAGE, REFRESH_PREFLIGHT_TTL_MS, assertRefreshConfirmation, pageSessionStatusReason, refreshStationSignature, requiresPageSessionPreflight, sanitizePreflightUrl } from "./core/refresh-preflight.js";
import { inferStationAdapter } from "./core/adapters.js";
import { addProviderStationPresets } from "./core/station-presets.js";
import { loadSitePluginForStation, loadSitePlugins, pruneSitePlugins, syncSitePlugins, syncSpecSitePlugins, unloadSpecSitePlugin } from "./site-plugins/loader.js";
import { sitePluginById, sitePluginCatalogForStations, sitePluginForStation } from "./site-plugins/catalog.js";
import { activeCatalogForStations, activePluginIds, activeSitePluginForStation, installedPluginIds, setActivePluginIds } from "./site-plugins/activation.js";
import { PLUGIN_REGISTRY_SNAPSHOT } from "./site-plugins/registry-snapshot.js";
import { DEFAULT_PLUGIN_REGISTRY_URL, comparePluginVersions, installedPluginSpecs, normalizeLocalPlugins, normalizePluginSpec, normalizeRegistryPayload, normalizeRegistryState, pluginUpdateState, registryStateAfterRefresh } from "./core/declarative-plugin.js";
import { ensurePageBridge, findOrOpenPageTab } from "./core/page-tabs.js";
import { runWithConcurrency, withKeyedLock } from "./core/concurrency.js";
import { runRefreshAll } from "./core/refresh-scheduler.js";
import { fetchReferences, referencesNeedRefresh } from "./core/openrouter.js";
import { exchangeRateInfo } from "./core/exchange-rate.js";
import { buildComparisonRows, buildStationIndexes, filterComparisonsByMode, flattenComparisonRows, summarizeComparisons } from "./core/pricing.js";
import { normalizeProxyModelName } from "./core/matching.js";
import { NORMALIZATION_VERSION } from "./core/normalizers.js";
import { snapshotNeedsRefresh } from "./core/snapshot-policy.js";
import { normalizeSettings, normalizeStation, usagePresetId } from "./shared/schema.js";
import { getComparisonRevision, getLatestSnapshots, getSnapshots, getStations, getValue, putSnapshot, putStations, setValue } from "./shared/db.js";
import { buildSettingsExport, parseSettingsExport } from "./core/settings-transfer.js";
import { mergeStationSave } from "./core/station-save.js";
import { clearStationRenewal, getModelAssistantKey, getStationCredential, getStationRenewal, listStationRenewals, removeStationCredential, setStationCredential, setModelAssistantKey, setStationRenewal } from "./shared/credentials.js";
import { completeChat, fetchModelCatalog, testModelConnection } from "./core/model-api.js";
import { ASSIST_BATCH_SIZE, ASSIST_CONCURRENCY, ASSIST_RETRIES, ASSIST_RETRY_DELAY_MS, ASSIST_TIMEOUT_MS, applyAssistResults, assistFailureLabel, assistMaxTokens, buildAssistEntries, buildAssistPool, buildAssistPrompt, cacheKey, collapseAssistEntries, collectUnmatchedModels, llmMatchesFromCache, overrideFromAssist, parseAssistResponse, poolSummaryLabel, selectPendingEntries, spreadAssistResults, summarizeCache, summarizePool } from "./core/llm-matching.js";
import { MAGPIE_USAGE_WINDOWS, fetchMagpieUsage, mergeGatewayUsage, normalizeMagpieSyncInterval } from "./core/magpie-usage.js";
import { checkForUpdate, isNewerVersion } from "./core/update-check.js";

const LEGACY_REFRESH_ALARM_NAME = "refresh-stations";
const UPDATE_ALARM_NAME = "update-check";
const MARKER_WATCH_ALARM_NAME = "update-marker-watch";
const MARKER_FILE_NAME = "update-marker.json";
const MARKER_WATCH_PERIOD_MINUTES = 1;
const UPDATE_STATE_KEY = "update-state";
const MAGPIE_USAGE_ALARM_NAME = "magpie-usage";
const REFERENCE_ALARM_NAME = "refresh-references";

const REFRESH_CONCURRENCY = 3;
const REFRESH_PREFLIGHT_SESSION_KEY = "ai-price-analyzer:refresh-preflight";
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

function readPayloadPath(value, path) {
  return String(path || "").split(".").filter(Boolean).reduce((current, key) => current && typeof current === "object" ? current[key] : undefined, value);
}

function cookieAuthRuleId(stationId) {
  let hash = 0;
  for (const character of String(stationId)) hash = (hash * 31 + character.codePointAt(0)) % 10000;
  return COOKIE_AUTH_RULE_BASE + hash;
}

// 换出来的 token 落凭据仓，不再放内存 Map：service worker 被回收后重启一次不再重新换，
// 少打一次接口，也少一次撞风控的机会。
async function cookieAuthAccessToken(station, cookieAuth) {
  const stored = await getStationCredential(station.id);
  const renewal = await getStationRenewal(station.id);
  if (stored.token && renewal.status === "ok" && Number(renewal.expiresAt) > Date.now()) return stored.token;
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
    const nextExpiresAt = Number.isFinite(expiresAt) && expiresAt > Date.now() ? expiresAt - 60000 : Date.now() + DEFAULT_COOKIE_TTL_MS;
    await setStationCredential(station.id, { token, username: stored.username, password: stored.password });
    await setStationRenewal(station.id, { expiresAt: nextExpiresAt, lastRenewedAt: Date.now(), renewFailures: 0, status: "ok" });
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
    await clearStationRenewal(station.id);
    return attempt();
  }
}

// 面板的登录态来自凭据仓，不再靠每轮开标签页现探：仓里有 ok 就是 ok，
// 保活失败会把它推成 unknown / needsLogin，面板跟着变。
function authStatusMissingField(renewal, renewalKind, saved) {
  if (renewalKind !== "session-probe") return null;
  // 探活头认哪个字段由 core 统一判（跟粘令牌存哪一格是同一个问题），别在 SW 里再抄一份正则。
  const fields = probeFieldNames(renewal);
  if (!fields.has("identity")) return null;
  const identity = String(saved?.identity || "").trim();
  return identity ? null : "identity";
}


async function authStatusForUi(stations) {
  const [storedRows, alarms] = await Promise.all([
    listStationRenewals(),
    chrome.alarms?.getAll ? chrome.alarms.getAll().catch(() => []) : Promise.resolve([])
  ]);
  const stored = new Map((storedRows || []).map(row => [row.stationId, row]));
  const alarmByName = new Map((Array.isArray(alarms) ? alarms : []).map(a => [String(a?.name || ""), a]));
  const rows = [];
  for (const station of stations) {
    const provider = providerForStation(station);
    const renewal = renewalFromProvider(provider);
    const pageAuth = Boolean(provider?.request?.pageAuth || provider?.request?.credentials === "include");
    if (!renewal && !pageAuth) continue;
    const saved = stored.get(station.id) || {};
    const renewalKind = renewal?.kind || (pageAuth ? "page" : "cookie");
    const alarm = alarmByName.get(keepaliveAlarmName(station.id));
    const nextCheckAt = Number(alarm?.scheduledTime) > 0 ? Math.floor(Number(alarm.scheduledTime)) : null;
    rows.push({
      stationId: station.id,
      stationName: station.name || station.id,
      baseUrl: String(station.baseUrl || ""),
      status: String(saved.status || "unknown"),
      // 续期能力以插件声明为准，声明不到就说明只能靠页面，面板上要能看出区别。
      renewalKind,
      missingField: authStatusMissingField(renewal, renewalKind, saved),
      expiresAt: Number(saved.expiresAt) > 0 ? Number(saved.expiresAt) : null,
      lastCheckedAt: Number(saved.lastCheckedAt) > 0 ? Number(saved.lastCheckedAt) : null,
      lastRenewedAt: Number(saved.lastRenewedAt) > 0 ? Number(saved.lastRenewedAt) : null,
      nextCheckAt,
      renewFailures: Number(saved.renewFailures) > 0 ? Math.floor(Number(saved.renewFailures)) : 0
    });
  }
  // 面板按站名排：仓里的顺序跟着采集写入走，不排会每轮跳。
  return rows.sort((left, right) => left.stationName.localeCompare(right.stationName, "zh-CN"));
}
// 长效令牌由用户自己粘：写进仓，expiresAt 置 null（不过期），保活排期会自动跳过这个站。
async function saveStationToken(stationId, token) {
  const id = String(stationId || "");
  const value = String(token || "").trim();
  if (!id) throw new Error("缺少站点 id");
  if (!value) throw new Error("令牌不能为空");
  const stored = await getStationCredential(id);
  const station = (await getPreparedStations()).find(row => row.id === id) || null;
  const renewal = station ? renewalFromProvider(providerForStation(station)) : null;
  const patch = tokenSavePatch(renewal, value);
  // 三处写入互不覆盖：给探活站填的是 uid，动的是 identity；给长效令牌站填的是会话令牌，动的是 token。
  await setStationCredential(id, {
    token: "token" in patch ? patch.token : stored.token,
    identity: "identity" in patch ? patch.identity : stored.identity,
    username: stored.username,
    password: stored.password
  });
  if (patch.status) {
    await setStationRenewal(id, { expiresAt: patch.expiresAt ?? null, refreshToken: "", lastRenewedAt: Date.now(), renewFailures: 0, status: patch.status });
  } else if (station && renewal) {
    // 粘令牌就是要当场验一次。仓里旧 token 的 expiresAt 还新鲜时 renewStationAuth 会走缓存
    // 短路、一个接口都不打，粘错了也不会有任何反馈。先把过期时间和状态清掉，让这次真的去打。
    await setStationRenewal(id, { expiresAt: null, status: "unknown" });
    // 状态由结果写仓：粘错了令牌不能靠 UI 直接标成已登录，那样面板说登录正常、采集全 401。
    // 缺字段的情况（探活站还没有 uid）由 renewStationAuth 自己跳过，不硬探。
    await renewStationAuth(station, renewal).catch(error => console.warn("[AI比价] 令牌写入后试续期失败", error));
  }
  await scheduleAuthKeepalive();
  return dashboard();
}

// Chrome 的 alarm 总数有上限，留出余量给更新检查那几个常驻 alarm。
const KEEPALIVE_ALARM_LIMIT = 480;
const KEEPALIVE_SWEEP_SIZE = 20;
// 批次名单跟着 alarm 走。用 local 而不是 session：alarm 本身跨浏览器重启还在，
// session 存储会被清掉，那时候名单就丢了。
const KEEPALIVE_SWEEP_ROSTER_KEY = "ai-price-analyzer:auth-keepalive-sweeps";

async function readKeepaliveRoster() {
  const stored = await chrome.storage?.local?.get(KEEPALIVE_SWEEP_ROSTER_KEY).catch(() => ({}));
  const roster = stored?.[KEEPALIVE_SWEEP_ROSTER_KEY];
  return roster && typeof roster === "object" ? roster : {};
}

async function saveKeepaliveRoster(roster) {
  await chrome.storage?.local?.set({ [KEEPALIVE_SWEEP_ROSTER_KEY]: roster }).catch(error => {
    console.warn("[AI比价] 保存保活批次名单失败", error);
  });
}

async function keepaliveEntries() {
  const stations = await getPreparedStations();
  const stored = new Map((await listStationRenewals()).map(row => [row.stationId, row]));
  const entries = [];
  for (const station of stations) {
    const renewal = renewalFromProvider(providerForStation(station));
    if (!renewal) continue;
    const saved = stored.get(station.id) || {};
    entries.push({
      stationId: station.id,
      expiresAt: Number(saved.expiresAt) > 0 ? Number(saved.expiresAt) : null,
      renewFailures: Number(saved.renewFailures) > 0 ? Number(saved.renewFailures) : 0,
      // 排期用这两个时间区分快档和慢档，启动去重也用它们判断「刚查过没有」。
      lastCheckedAt: Number(saved.lastCheckedAt) > 0 ? Number(saved.lastCheckedAt) : null,
      lastRenewedAt: Number(saved.lastRenewedAt) > 0 ? Number(saved.lastRenewedAt) : null,
      status: String(saved.status || "unknown"),
      renewalKind: renewal.kind,
      renewal,
      station
    });
  }
  return entries;
}

// 排期按凭据仓的过期时间算，不按采集轮次算：100 个登录站每天 100 次，摊在一天里，
// 而不是每次采集集中开 100 个标签页。超过 alarm 上限的站按批合并，不丢排期。
async function scheduleAuthKeepalive() {
  const existing = await chrome.alarms.getAll().catch(() => []);
  for (const alarm of existing) if (alarm.name.startsWith(KEEPALIVE_ALARM_PREFIX)) await chrome.alarms.clear(alarm.name);

  const entries = await keepaliveEntries().catch(error => {
    console.warn("[AI比价] 读取保活排期失败", error);
    return [];
  });
  const plans = planKeepalive(entries);

  const direct = plans.slice(0, KEEPALIVE_ALARM_LIMIT);
  for (const plan of direct) chrome.alarms.create(keepaliveAlarmName(plan.stationId), { when: plan.when });

  // 批号本身不记名单：排期随时重算，靠批号回切会错位，把不该醒的站叫醒、
  // 把该醒的站推到尾巴丢掉。所以把当时那一批的站点 id 跟 alarm 一起存下来。
  const sweeps = planKeepaliveSweeps(plans, { alarmLimit: KEEPALIVE_ALARM_LIMIT, sweepSize: KEEPALIVE_SWEEP_SIZE });
  const roster = {};
  for (const sweep of sweeps) {
    roster[sweep.name] = sweep.stationIds;
    chrome.alarms.create(sweep.name, { when: sweep.when });
  }
  await saveKeepaliveRoster(roster);

  return { planned: plans.length, scheduled: direct.length + sweeps.reduce((sum, sweep) => sum + sweep.stationIds.length, 0) };
}

// 直连站的 alarm 名字就是站点 id；批次的名单跟 alarm 一起存过，直接照名字取。
// 拿不报名单（浏览器重装、session 存储被清）就退回按当前排期重算一遍。
async function runAuthKeepaliveFromAlarm(alarmName) {
  const name = String(alarmName || "");
  const suffix = name.slice(KEEPALIVE_ALARM_PREFIX.length);
  if (!suffix.startsWith("sweep:")) return runAuthKeepalive([suffix]);
  const roster = await readKeepaliveRoster();
  const plans = roster[name] ? [] : planKeepalive(await keepaliveEntries());
  return runAuthKeepalive(resolveSweepStationIds(roster, name, plans, {
    alarmLimit: KEEPALIVE_ALARM_LIMIT,
    sweepSize: KEEPALIVE_SWEEP_SIZE
  }));
}

// 同一个站的续期同一时刻只能跑一条。alarm、开机扫描、面板「立即检查」三条路都会叫醒
// 同一个站；refresh-token 站并发续期会拿同一把 refresh 令牌换两次，第二次 401，
// 站点被打成 needsLogin，仓里还可能留下输掉那一轮的值。后到的等前一条落地。
const renewInFlight = new Map();

async function renewStationOnce(entry) {
  const stationId = entry.stationId;
  try {
    await renewStationAuth(entry.station, entry.renewal);
  } catch (error) {
    // 续期执行器自己会把结果写仓；抛出来说明连写仓都没走到，这里补一次失败计数。
    console.warn("[AI比价] 续期失败", stationId, error);
    await setStationRenewal(stationId, applyKeepaliveResult(await getStationRenewal(stationId), false));
  } finally {
    // 成不成功都要记一笔：排期靠它区分「没查过（快档）」和「查过但拿不到过期时间（慢档）」。
    await setStationRenewal(stationId, { lastCheckedAt: Date.now() });
  }
}

async function runAuthKeepalive(stationIds) {
  if (!stationIds.length) return;
  const entries = await keepaliveEntries();
  const byId = new Map(entries.map(entry => [entry.stationId, entry]));
  for (const stationId of stationIds) {
    const entry = byId.get(stationId);
    // 站被删了或不再声明可无头续期：顺手把这个站的 alarm 收掉。
    if (!entry) {
      await chrome.alarms.clear(keepaliveAlarmName(stationId));
      continue;
    }
    const running = renewInFlight.get(stationId);
    if (running) {
      await running.catch(() => {});
      continue;
    }
    const task = renewStationOnce(entry);
    renewInFlight.set(stationId, task);
    try {
      await task;
    } finally {
      renewInFlight.delete(stationId);
    }
  }
  await scheduleAuthKeepalive();
}

// 浏览器不常开的时候，alarm 可能整轮都没轮到，排到 23 小时的站更是永远轮不到：
// 开机、装好、面板打开都算「该检查了」。这条路径和 alarm 走同一个执行器，
// 靠 lastCheckedAt 去重，不会把同一批站连着续两遍。
const DUE_KEEPALIVE_INTERVAL_MS = 5 * 60 * 1000;
let lastDueKeepaliveAt = 0;
let dueKeepaliveTask = null;

function runDueKeepalive() {
  if (dueKeepaliveTask) return dueKeepaliveTask;
  lastDueKeepaliveAt = Date.now();
  dueKeepaliveTask = (async () => {
    try {
      const due = dueStationIds(await keepaliveEntries());
      if (due.length) await runAuthKeepalive(due);
    } catch (error) {
      console.warn("[AI比价] 启动续期失败", error);
    } finally {
      dueKeepaliveTask = null;
    }
  })();
  return dueKeepaliveTask;
}

// 面板每次轮询都会读数据，这里只做「距上次不到 5 分钟就不再扫」的节流，不挡首屏。
function kickDueKeepalive() {
  if (Date.now() - lastDueKeepaliveAt < DUE_KEEPALIVE_INTERVAL_MS) return;
  void runDueKeepalive();
}

// 拿不到页面标签页的原因不止「没登录」：同一站点多开了几个页面同样会走到这里，
// 再报「请先登录」只会把人引到错误的方向，得说清是哪一种。
function pageTabFailureMessage(station, reason) {
  const name = station.name || station.id || "目标站点";
  if (reason === "ambiguous") return `${name} 开着多个标签页，但都不在采集页面上，请只保留一个后重试`;
  return "请先在当前 Chrome 配置文件登录目标站点一次后重试";
}

export async function withPageFetch(station, preferredTabId, task) {
  // 页面加载共享一个槽位，覆盖开页、请求和清理；直接 API 请求不占这个槽位。
  return withKeyedLock("page-collection", async () => {
    const opened = await findOrOpenPageTab(chrome.tabs, station, preferredTabId);
    const { tab, temporary } = opened;
    if (!tab?.id) throw new Error(pageTabFailureMessage(station, opened.reason));
    try {
      await ensurePageBridge(chrome.scripting, tab.id, { tabs: chrome.tabs });
      const bridgeFetch = createPageFetch((message, callback) => chrome.tabs.sendMessage(tab.id, message, callback));
      let bridgeRetryUsed = false;
      const recoverBridge = async () => {
        if (bridgeRetryUsed) return;
        bridgeRetryUsed = true;
        await ensurePageBridge(chrome.scripting, tab.id, { forceContent: true, tabs: chrome.tabs });
      };
      const pageFetch = request => {
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
  if (!force && !referencesNeedRefresh(cache)) return cache;
  const result = await fetchReferences({ cache });
  await setValue("references", result);
  chrome.runtime.sendMessage({ type: "REFERENCES_CHANGED" }, () => void chrome.runtime.lastError);
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

async function restoreRefreshPreflightState() {
  const session = chrome.storage?.session;
  if (!session) return;
  const restoreRevision = refreshPreflightRevision;
  const stored = await queueRefreshPreflightPersistence(() => session.get([REFRESH_PREFLIGHT_SESSION_KEY]));
  if (restoreRevision !== refreshPreflightRevision) return;
  if (!activeRefreshPreflight && stored[REFRESH_PREFLIGHT_SESSION_KEY]) activeRefreshPreflight = stored[REFRESH_PREFLIGHT_SESSION_KEY];
}

async function persistRefreshPreflightState(expectedRevision = refreshPreflightRevision) {
  const session = chrome.storage?.session;
  if (!session) return;
  return queueRefreshPreflightPersistence(() => {
    if (expectedRevision !== refreshPreflightRevision) return undefined;
    return session.set({ [REFRESH_PREFLIGHT_SESSION_KEY]: activeRefreshPreflight });
  });
}

function invalidateRefreshPreflight() {
  refreshPreflightRevision += 1;
  activeRefreshPreflight = null;
  const session = chrome.storage?.session;
  if (!session) return Promise.resolve();
  return queueRefreshPreflightPersistence(() => session.set({ [REFRESH_PREFLIGHT_SESSION_KEY]: null }));
}

// 预检只读凭据仓，未知状态留到用户确认后的采集再检查，避免为同一站点加载两遍网页。
function preflightStationAuth(station, provider, saved) {
  const confirmed = authConfirmedFromRenewal(saved, renewalFromProvider(provider)?.kind);
  const status = confirmed ? "ready" : saved?.status === "needsLogin" ? "needsLogin" : "uncertain";
  const reason = confirmed ? "已保存的登录凭据仍在有效期内"
    : status === "needsLogin" ? "上次检查需要重新登录，可打开站点登录后再刷新"
      : "尚无法确认登录状态，确认刷新后再检查；预检不会加载站点页面";
  return {
    stationId: station.id,
    stationName: station.name,
    status,
    reason,
    tabId: null,
    tabUrl: sanitizePreflightUrl(station.baseUrl)
  };
}

async function createRefreshPreflight() {
  await restoreRefreshPreflightState();
  if (refreshAllTask || (refreshReferencesTask && refreshReferencesForced)) throw new Error("当前正在刷新，请稍后再执行登录预检");
  // 预检要和采集用同一套插件状态。service worker 睡醒后注册表是空的，
  // providerForStation 拿不到插件，站点就会被判成「无需登录」一路放过。
  await ensureWorkspacePlugins();
  const invalidation = invalidateRefreshPreflight();
  const requestRevision = refreshPreflightRevision;
  await invalidation;
  const settings = await getSettings();
  const scope = refreshScope(await getPreparedStations(), settings.comparisonMode);
  const { stations } = scope;
  const requestMode = scope.comparisonMode;
  const requestSignature = refreshStationSignature(stations, requestMode);
  // 并行读取本地登录状态，不为预检访问站点或加载页面。
  const savedRenewals = new Map((await listStationRenewals()).map(row => [row.stationId, row]));
  const results = new Array(stations.length);
  const outcomes = await runWithConcurrency(stations, REFRESH_CONCURRENCY, async (station) => {
    await loadSitePluginForStation(station);
    const provider = providerForStation(station);
    if (!requiresPageSessionPreflight(station, provider)) {
      return { stationId: station.id, stationName: station.name, status: "noLoginRequired", reason: "无需页面登录预检" };
    }
    return preflightStationAuth(station, provider, savedRenewals.get(station.id));
  });
  outcomes.forEach((outcome, index) => {
    results[index] = outcome.status === "fulfilled"
      ? outcome.value
      : {
        stationId: stations[index].id,
        stationName: stations[index].name,
        status: "uncertain",
        reason: pageSessionStatusReason("uncertain", outcome.reason?.message),
        tabId: null,
        tabUrl: ""
      };
  });
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
    if (refreshAllTask === task) {
      refreshAllTask = null;
      notifyReferencesRefresh(Boolean(refreshReferencesTask));
    }
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
  if (referencesNeedRefresh(references)) {
    void refreshOfficialReferences().catch(error => console.warn("[AI比价] 刷新参考数据失败", error));
  }
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
  const rate = exchangeRateInfo(savedSettings, references).rate;
  const effectiveReferences = { ...references, exchangeRate: rate, openRouterRechargeRate: rate };
  const llmCache = await getValue("llmMatchCache", {});
  const llmMatches = llmMatchesFromCache(llmCache);
  const revision = getComparisonRevision();
  const cacheable = revisionAtStart === revision;
  const comparisonKey = JSON.stringify([revision, rate, normalizedSnapshots.map(snapshot => snapshot.id), llmMatches]);
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
  const refreshPreflight = activeRefreshPreflight?.stationSignature === refreshStationSignature(refresh.stations, refresh.comparisonMode)
    && activeRefreshPreflight.comparisonMode === refresh.comparisonMode
    ? { token: activeRefreshPreflight.token, expiresAt: activeRefreshPreflight.expiresAt, comparisonMode: activeRefreshPreflight.comparisonMode, comparisonLabel: activeRefreshPreflight.comparisonLabel, stationCount: activeRefreshPreflight.stationCount, results: activeRefreshPreflight.results }
    : null;
  const visibleSnapshots = normalizedSnapshots.filter(snapshot => stationsById.get(snapshot.stationId)?.category === savedSettings.comparisonMode);
  const stationErrors = visibleSnapshots
    .filter(snapshot => snapshot.status === "error" && stationsById.has(snapshot.stationId))
    .map(snapshot => ({ stationId: snapshot.stationId, stationName: snapshot.stationName || stationsById.get(snapshot.stationId)?.name || snapshot.stationId, category: stationsById.get(snapshot.stationId)?.category || "paid", error: snapshot.error || "采集失败", collectedAt: snapshot.collectedAt }));
  const selectedComparisons = filterComparisonsByMode(comparisonResult.comparisons, savedSettings.comparisonMode);
  const authStatus = await authStatusForUi(comparisonStations);
  // 面板打开就是一次「该检查了」的信号：不 await，别拖慢首屏。
  kickDueKeepalive();
  return { stations, sitePlugins: sitePluginCatalogForStations(stations, { bundledVersion: bundledPluginVersion() }), snapshots: visibleSnapshots, stationErrors, references, settings: savedSettings, comparisons: selectedComparisons, summary: summarizeComparisons(selectedComparisons), stationIndexes: buildStationIndexes(selectedComparisons), refreshInProgress: Boolean(refreshAllTask || refreshReferencesTask), refreshScope: { comparisonMode: refresh.comparisonMode, comparisonLabel: refresh.comparisonLabel, stationCount: refresh.stationCount }, refreshPreflight, authStatus };
}

// 采集定时器已下线，这里只清升级残留，避免旧 alarm 继续触发。
async function clearLegacyAlarms() {
  for (const name of [LEGACY_REFRESH_ALARM_NAME, "checkin-stations", "checkin-login"]) await chrome.alarms.clear(name);
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

// magpie 用量同步：只读本机网关，更新 30 天快照和正在使用它的估算用量。
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
  const useMagpie = usagePresetId(settings.usage, previous) === "recent30d";
  const next = { error: "", attemptedAt: nowMs };
  for (const window of MAGPIE_USAGE_WINDOWS) {
    try {
      const result = await fetchMagpieUsage({ baseUrl: settings.magpieBaseUrl, period: window.period, days: window.days });
      next[window.id] = { usage: result.usage, syncedAt: Date.now(), window: result.window };
    } catch (error) {
      // 同步失败保留上次有效数字。
      if (previous?.[window.id]) next[window.id] = previous[window.id];
      next.error = error.message || String(error);
    }
  }
  const usage = useMagpie && next.recent30d?.usage ? mergeGatewayUsage(settings.usage, next.recent30d.usage) : settings.usage;
  await persistSettings({ ...settings, usage, magpieSync: next });
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

async function addSitePlugins(ids) {
  await ensureWorkspacePlugins();
  const requested = [...new Set((Array.isArray(ids) ? ids : []).map(id => String(id || "").trim()))]
    .filter(id => sitePluginById(id)?.addable && [...activePluginIds()].includes(id));
  if (!requested.length) throw new Error("请至少选择一个已安装插件里的站点");
  return withKeyedLock("site-plugins:add", async () => {
    const providers = await loadSitePlugins(requested);
    const current = await getStations();
    const settings = await getSettings();
    const references = await getValue("references", {});
    const next = addProviderStationPresets(current, providers, { exchangeRate: exchangeRateInfo(settings, references).rate });
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
  // 增删站会改变谁需要保活：不重排的话新加的站要等下次启动才有 alarm，
  // 删掉的站还留着一条指向空站点的 alarm。
  await scheduleAuthKeepalive();
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
      // 装完即加站：插件自带的 addable 站点直接进工作区；按地址添加的插件不产生站点。
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
    case "SAVE_STATION_TOKEN": return saveStationToken(message.stationId, message.token);
    case "REFRESH_PREFLIGHT": return createRefreshPreflight();
    case "CANCEL_REFRESH_PREFLIGHT": return cancelRefreshPreflight();
    // 「立即检查」只续一个站：走跟 alarm 同一个执行器，排期随后自己会重算。
    // 没有续期能力的站（插件只声明了页面续期）在 keepaliveEntries 里会被过滤掉，
    // 那样这里会「成功但什么都没做」，所以先判能力再打。
    case "AUTH_RENEW_NOW": {
      const id = String(message.stationId || "").trim();
      if (!id) throw new Error("缺少站点 id");
      const station = (await getPreparedStations()).find(row => row.id === id) || null;
      if (!station) throw new Error("站点不存在，先刷新插件列表");
      if (!renewalFromProvider(providerForStation(station))) throw new Error("这个站没有可用的续期方式，请打开登录页手动登录一次");
      await runAuthKeepalive([id]);
      return dashboard();
    }
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
  if (message?.type === PAGE_WINDOW_AUTH_RENEWAL_TYPE) {
    applyPageRenewal(message.renewal).catch(error => console.warn("[AI比价] 页面续期结果落仓失败", error));
    return;
  }
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


chrome.runtime.onInstalled.addListener(() => {
  clearLegacyAlarms();
  chrome.alarms.create(REFERENCE_ALARM_NAME, { periodInMinutes: 60 });
  scheduleUpdateAlarm();
  scheduleMarkerWatchAlarm();
  scheduleMagpieUsageAlarm();
  ensureWorkspacePlugins({ force: true }).then(() => scheduleAuthKeepalive()).then(() => runDueKeepalive()).catch(error => console.warn("[AI比价] 建保活排期失败", error));
});
chrome.runtime.onStartup.addListener(() => {
  clearLegacyAlarms();
  chrome.alarms.create(REFERENCE_ALARM_NAME, { periodInMinutes: 60 });
  scheduleUpdateAlarm();
  scheduleMarkerWatchAlarm();
  scheduleMagpieUsageAlarm();
  ensureWorkspacePlugins({ force: true }).then(() => scheduleAuthKeepalive()).then(() => runDueKeepalive()).catch(error => console.warn("[AI比价] 建保活排期失败", error));
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === REFERENCE_ALARM_NAME) return refreshOfficialReferences().catch(error => console.warn("[AI比价] 刷新参考数据失败", error));
  if (alarm.name === UPDATE_ALARM_NAME) return runUpdateCheck().catch(error => console.warn("[AI比价] 检查更新失败", error));
  if (alarm.name === MARKER_WATCH_ALARM_NAME) return watchUpdateMarker().catch(error => console.warn("[AI比价] 检查更新标记失败", error));
  if (alarm.name === MAGPIE_USAGE_ALARM_NAME) return runMagpieUsageSync().catch(error => console.warn("[AI比价] 同步 magpie 用量失败", error));
  if (alarm.name.startsWith(KEEPALIVE_ALARM_PREFIX)) {
    return runAuthKeepaliveFromAlarm(alarm.name).catch(error => console.warn("[AI比价] 保活续期失败", error));
  }
});
