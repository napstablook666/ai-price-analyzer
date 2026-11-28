import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import nodeTest from "node:test";
import { PAGE_RUNTIME_FETCH_TYPE } from "../src/core/bridge-protocol.js";
import { NORMALIZATION_VERSION } from "../src/core/normalizers.js";
import { flattenComparisonRows, getProxyPriceQuote } from "../src/core/pricing.js";
import { REFRESH_CONFIRMATION_REQUIRED_CODE, REFRESH_PREFLIGHT_TTL_MS, pageSessionStatusReason, refreshStationSignature, requiresPageSessionPreflight, sanitizePreflightUrl } from "../src/core/refresh-preflight.js";
import { normalizeSettings, usagePresetId, usagePresetUsage } from "../src/shared/schema.js";

import { loadedSitePluginIds, resetSitePluginLoader } from "../src/site-plugins/loader.js";
const test = (name, optionsOrFn, maybeFn) => {
  if (typeof optionsOrFn === "function") return nodeTest(name, { concurrency: false }, optionsOrFn);
  return nodeTest(name, { ...optionsOrFn, concurrency: false }, maybeFn);
};
let workerSequence = 0;
const clone = value => value === undefined ? undefined : structuredClone(value);

function memoryDatabase(seed = {}) {
  const stores = {
    kv: new Map(Object.entries(seed.values || {}).map(([key, value]) => [key, clone(value)])),
    stations: new Map((seed.stations || []).map(value => [value.id, clone(value)])),
    snapshots: new Map((seed.snapshots || []).map(value => [value.id, clone(value)]))
  };
  const indexKey = (index, value) => index === "stationId" ? value.stationId : index === "collectedAt" ? value.collectedAt : value.id;
  const request = operation => {
    const result = {};
    queueMicrotask(() => {
      try { result.result = clone(operation()); result.onsuccess?.(); }
      catch (error) { result.error = error; result.onerror?.(); }
    });
    return result;
  };
  const database = {
    close() {},
    transaction() {
      const transaction = {
        objectStore(name) {
          const map = stores[name];
          return {
            get(key) { return request(() => map.get(key)); },
            getAll(query) { return request(() => { seed.onGetAll?.(name, map); return [...map.values()].filter(value => name !== "snapshots" || !query || value.stationId === query); }); },
            put(value, key) { return request(() => { map.set(name === "kv" ? key : value.id, clone(value)); }); },
            add(value) { return request(() => { map.set(value.id, clone(value)); }); },
            delete(key) { return request(() => map.delete(key)); },
            clear() { return request(() => map.clear()); },
            index(indexName) {
              return {
                getAll(query) { return request(() => [...map.values()].filter(value => !query || indexKey(indexName, value) === query)); },
                openCursor(query = null, direction = "next") {
                  const isMatch = value => !query?.type || (query.type === "upper" ? value < query.value : value >= query.value);
                  const rows = [...map.values()].filter(value => isMatch(indexKey(indexName, value))).sort((left, right) => {
                    const a = indexKey(indexName, left), b = indexKey(indexName, right);
                    return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
                  });
                  if (direction === "prev") rows.reverse();
                  const result = {};
                  let position = 0;
                  const emit = () => queueMicrotask(() => {
                    const value = rows[position];
                    result.result = value ? {
                      key: indexKey(indexName, value), value: clone(value),
                      continue() { position += 1; emit(); },
                      delete() { map.delete(value.id); }
                    } : null;
                    result.onsuccess?.();
                  });
                  emit();
                  return result;
                }
              };
            }
          };
        }
      };
      setTimeout(() => transaction.oncomplete?.(), 0);
      return transaction;
    }
  };
  return {
    stores,
    indexedDB: { open() { const result = { result: database }; queueMicrotask(() => seed.openError ? (result.error = seed.openError, result.onerror?.()) : result.onsuccess?.()); return result; } }
  };
}

function chromeApi({ pageResponses = {}, pageResponseHandlers = {}, existingTabs = [], removeError = null, deferTabLoad = false } = {}) {
  let listener;
  let nextTabId = 100;
  const tabsById = new Map(existingTabs.map(tab => [tab.id, clone(tab)]));
  const created = [], removed = [], pageRequests = [], runtimeMessages = [], tabQueries = [];
  const sessionValues = {};
  let sessionSetError = null;
  const noOpEvent = { addListener() {}, removeListener() {} };
  const removedEvent = {
    listeners: new Set(),
    addListener(callback) { this.listeners.add(callback); },
    removeListener(callback) { this.listeners.delete(callback); },
    async emit(...args) { await Promise.all([...this.listeners].map(callback => callback(...args))); }
  };
  const updatedEvent = {
    listeners: new Set(),
    addListener(callback) { this.listeners.add(callback); },
    removeListener(callback) { this.listeners.delete(callback); },
    async emit(...args) { await Promise.all([...this.listeners].map(callback => callback(...args))); }
  };
  const alarmEvent = {
    listeners: new Set(),
    addListener(callback) { this.listeners.add(callback); },
    removeListener(callback) { this.listeners.delete(callback); },
    async emit(...args) { await Promise.all([...this.listeners].map(callback => callback(...args))); }
  };
  const api = {
    created, removed, pageRequests, runtimeMessages, tabQueries, pageResponses,
    removeUserTab(tabId) { tabsById.delete(tabId); return removedEvent.emit(tabId); },
    fireAlarm(name) { return alarmEvent.emit({ name }); },
    setSessionError(error) { sessionSetError = error; },
    addUserTab(tab) { tabsById.set(tab.id, clone(tab)); nextTabId = Math.max(nextTabId, Number(tab.id) + 1); },
    async completeTab(tabId) {
      const tab = tabsById.get(tabId);
      if (!tab) throw new Error("tab not found");
      tab.status = "complete";
      return updatedEvent.emit(tabId, { status: "complete" });
    },
    reboot() { removedEvent.listeners.clear(); return import(`../src/service-worker.js?preflight-test=${workerSequence++}`); },
    chrome: {
      runtime: {
        lastError: undefined,
        onMessage: { addListener(callback) { listener = callback; } },
        onInstalled: noOpEvent,
        onStartup: noOpEvent,
        getURL: path => `chrome-extension://test-extension/${path}`,
        sendMessage(message, callback) { runtimeMessages.push(clone(message)); callback?.(); }
      },
      alarms: { clear: async () => true, create() {}, onAlarm: alarmEvent },
      storage: {
        local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
        session: {
          async get(keys) {
            const requested = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(requested.filter(key => sessionValues[key] !== undefined).map(key => [key, clone(sessionValues[key])]));
          },
          async set(values) { if (sessionSetError) throw sessionSetError; Object.assign(sessionValues, clone(values)); },
          async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionValues[key]; }
        }
      },
      tabs: {
        onUpdated: updatedEvent,
        onRemoved: removedEvent,
        async query() {
          const tabs = [...tabsById.values()].map(clone);
          tabQueries.push(tabs);
          return tabs;
        },
        async create(options) {
          const tab = { id: nextTabId++, url: options.url, status: deferTabLoad ? "loading" : "complete" };
          tabsById.set(tab.id, tab); created.push(clone(tab)); return clone(tab);
        },
        async get(tabId) { const tab = tabsById.get(tabId); if (!tab) throw new Error("tab not found"); return clone(tab); },
        async remove(tabId) { if (removeError) throw removeError; removed.push(tabId); tabsById.delete(tabId); await removedEvent.emit(tabId); },
        sendMessage(tabId, message, callback) {
          const tab = tabsById.get(tabId);
          if (message.type === PAGE_RUNTIME_FETCH_TYPE) pageRequests.push(clone(message.request));
          const host = new URL(tab.url).hostname;
          const response = pageResponseHandlers[host]
            ? pageResponseHandlers[host](clone(message.request))
            : pageResponses[host] || { ok: true, status: 200, body: { data: [] } };
          Promise.resolve(response).then(value => callback({ ok: true, response: clone(value) }));
        }
      },
      scripting: { async executeScript({ world }) { return [{ result: world === "MAIN" ? { current: true } : { version: 999 } }]; } }
    }
  };
  return {
    ...api,
    send(type, payload = {}) {
      assert.equal(typeof listener, "function", "service worker listener was not installed");
      return new Promise(resolve => listener({ type, ...payload }, { id: "test-extension", url: "chrome-extension://test-extension/dashboard.html" }, resolve));
    }
  };
}
let workerLock = Promise.resolve();

async function withWorker(seed, chromeOptions, callback) {
  const previousWorker = workerLock;
  let releaseWorker;
  workerLock = new Promise(resolve => { releaseWorker = resolve; });
  await previousWorker;
  const previousChrome = globalThis.chrome;
  const previousIndexedDB = globalThis.indexedDB;
  const previousKeyRange = globalThis.IDBKeyRange;
  const now = Date.now();
  const db = memoryDatabase({ ...seed, values: { references: { models: [], fetchedAt: now, exchangeRate: 7.3, exchangeRateFetchedAt: now }, ...seed.values } });
  const worker = chromeApi(chromeOptions);
  globalThis.chrome = worker.chrome;
  globalThis.indexedDB = db.indexedDB;
  globalThis.IDBKeyRange = {
    upperBound(value) { return { type: "upper", value }; },
    lowerBound(value) { return { type: "lower", value }; }
  };
  try {
    await import(`../src/service-worker.js?preflight-test=${workerSequence++}`);
    await callback(worker, db.stores);
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome; else globalThis.chrome = previousChrome;
    if (previousIndexedDB === undefined) delete globalThis.indexedDB; else globalThis.indexedDB = previousIndexedDB;
    if (previousKeyRange === undefined) delete globalThis.IDBKeyRange; else globalThis.IDBKeyRange = previousKeyRange;
    releaseWorker();
  }
}

function responseData(response) {
  assert.equal(response.ok, true, response.error || "worker request failed");
  return response.data;
}
function responseError(response, code) {
  assert.equal(response.ok, false);
  assert.equal(response.code, code);
}
// CI 上 CPU 排队时，500 次 setImmediate 可能在跨多个 await 的链路跑完前就耗尽。
// 改成墙钟截止（5 秒）：先按 setImmediate 让路，每 200 轮换一次 1ms 定时器继续等。
async function waitFor(predicate) {
  const deadline = Date.now() + 5000;
  let attempt = 0;
  while (Date.now() < deadline) {
    if (predicate()) return;
    attempt += 1;
    await new Promise(resolve => (attempt % 200 === 0 ? setTimeout(resolve, 1) : setImmediate(resolve)));
  }
  assert.fail("condition was not reached before timeout");
}

test("keeps magpie 30-day usage current through manual and scheduled syncs", async t => {
  const requests = [];
  const payloads = [
    { calls: 10, input: 1_000_123, cache_read: 2_000_023, cache_write: 100, output: 300_000 },
    { calls: 20, input: 4_000_321, cache_read: 5_000_099, cache_write: 200, output: 600_000 },
    { calls: 30, input: 7_000_654, cache_read: 8_000_033, cache_write: 300, output: 900_000 }
  ];
  t.mock.method(globalThis, "fetch", async url => {
    requests.push(String(url));
    const payload = payloads.shift();
    if (!payload) throw new TypeError("Failed to fetch");
    return { ok: true, json: async () => payload };
  });
  const settings = normalizeSettings();
  await withWorker({ values: { settings } }, {}, async (worker, stores) => {
    const first = responseData(await worker.send("SYNC_MAGPIE_USAGE"));
    const second = responseData(await worker.send("SYNC_MAGPIE_USAGE"));
    assert.equal(first.usage.input, 1_000_123);
    assert.equal(second.usage.input, 4_000_321);
    assert.equal(usagePresetId(second.usage, second.magpieSync), "recent30d");

    const persisted = stores.kv.get("settings");
    persisted.magpieSync.attemptedAt = 0;
    stores.kv.set("settings", persisted);
    await worker.fireAlarm("magpie-usage");
    const scheduled = stores.kv.get("settings");
    assert.equal(scheduled.usage.input, 7_000_654);
    assert.equal(scheduled.usage.requests, 30);
    assert.equal(usagePresetId(scheduled.usage, scheduled.magpieSync), "recent30d");
    assert.equal(scheduled.magpieSync.recent7d, undefined);

    const failed = responseData(await worker.send("SYNC_MAGPIE_USAGE"));
    assert.match(failed.lastSync.error, /连不上本机 magpie 网关/);
    assert.deepEqual(failed.usage, scheduled.usage);
    assert.deepEqual(failed.magpieSync.recent30d, scheduled.magpieSync.recent30d);
    assert.equal(usagePresetId(failed.usage, failed.magpieSync), "recent30d");
  });
  assert.equal(requests.length, 4);
  assert.ok(requests.every(url => url === "http://127.0.0.1:3425/v1/magpie/usage?period=30d"));
});

test("preserves custom and baseline usage when syncing magpie", async t => {
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({ calls: 50, input: 9_000_000, cache_read: 8_000_000, output: 700_000 }) }));
  for (const usage of [usagePresetUsage("baseline"), { ...usagePresetUsage("recent30d"), input: 1_234_567, cacheWrite1h: 100 }]) {
    const settings = normalizeSettings({ usage });
    await withWorker({ values: { settings } }, {}, async worker => {
      const synced = responseData(await worker.send("SYNC_MAGPIE_USAGE"));
      assert.deepEqual(synced.usage, settings.usage);
      assert.equal(synced.magpieSync.recent30d.usage.input, 9_000_000);
      assert.equal(usagePresetId(synced.usage, synced.magpieSync), usagePresetId(settings.usage));
    });
  }
});


test("automatic exchange rates reach actual comparisons and manual rates survive a forced refresh", async t => {
  const now = Date.now();
  const station = { id: "rate-relay", name: "Rate relay", category: "paid", enabled: true, baseUrl: "https://rate-relay.example", mode: "direct", priceCurrency: "USD", priceCurrencyVerified: true, rechargeCurrency: "CNY", rechargeRmb: 1, rechargeCredits: 1, rechargeRateVerified: true, basePricePerMillion: 1 };
  const snapshot = { id: "rate-snapshot", stationId: station.id, stationName: station.name, collectedAt: now, normalizationVersion: NORMALIZATION_VERSION, status: "success", normalized: { data: [{ model_name: "rate-model", input_price: 1, output_price: 2, price_currency: "USD" }], group_ratio: {} } };
  const references = { fetchedAt: now, models: [{ id: "test/rate-model", name: "rate-model", provider: "test", input: 1, output: 2, price_currency: "USD" }], exchangeRate: 6.69, exchangeRateSource: "ExchangeRate-API", exchangeRateDate: new Date(now).toISOString().slice(0, 10), exchangeRateFetchedAt: now };
  t.mock.method(globalThis, "fetch", async url => {
    if (String(url).startsWith("https://open.er-api.com/")) return { ok: true, json: async () => ({ result: "success", base_code: "USD", rates: { CNY: 6.68 }, time_last_update_unix: now / 1000 }) };
    if (String(url).includes("/images/models")) return { ok: true, json: async () => ({ data: [] }) };
    return { ok: true, json: async () => ({ data: [{ id: "test/rate-model", pricing: { prompt: "0.000001", completion: "0.000002" } }] }) };
  });
  await withWorker({ stations: [station], snapshots: [snapshot], values: { settings: { exchangeRate: 7.3 }, references } }, {}, async (worker, stores) => {
    const automatic = responseData(await worker.send("GET_DASHBOARD"));
    assert.equal(automatic.settings.exchangeRateMode, "auto");
    assert.equal(flattenComparisonRows(automatic.comparisons)[0].officialPrices.input, 6.69);
    responseData(await worker.send("SAVE_SETTINGS", { settings: { ...automatic.settings, exchangeRateMode: "manual", exchangeRate: 6.71849 } }));
    const manual = responseData(await worker.send("GET_DASHBOARD"));
    assert.equal(flattenComparisonRows(manual.comparisons)[0].officialPrices.input, 6.71849);
    const refreshed = responseData(await worker.send("FETCH_REFERENCES"));
    assert.equal(refreshed.references.exchangeRate, 6.68);
    assert.equal(refreshed.settings.exchangeRate, 6.71849);
    assert.equal(flattenComparisonRows(refreshed.comparisons)[0].officialPrices.input, 6.71849);
    assert.equal(stores.kv.get("settings").exchangeRateMode, "manual");
    assert.ok(worker.runtimeMessages.some(message => message.type === "REFERENCES_CHANGED"));
    responseData(await worker.send("SAVE_SETTINGS", { settings: { ...manual.settings, exchangeRateMode: "auto" } }));
    const restored = responseData(await worker.send("GET_DASHBOARD"));
    assert.equal(flattenComparisonRows(restored.comparisons)[0].officialPrices.input, 6.68);
  });
});

test("dashboard returns cached data immediately and background references do not block login checks", async t => {
  const now = Date.now();
  let finishPrimary;
  const pending = new Promise(resolve => { finishPrimary = resolve; });
  t.mock.method(globalThis, "fetch", async url => {
    if (String(url).startsWith("https://open.er-api.com/")) { await pending; return { ok: true, json: async () => ({ result: "success", base_code: "USD", rates: { CNY: 6.68 }, time_last_update_unix: now / 1000 }) }; }
    return { ok: true, json: async () => ({ data: [] }) };
  });
  await withWorker({ values: { references: { models: [], fetchedAt: now, exchangeRate: 6.69 } } }, {}, async (worker, stores) => {
    try {
      const dashboard = responseData(await worker.send("GET_DASHBOARD"));
      assert.equal(dashboard.references.exchangeRate, 6.69);
      responseData(await worker.send("REFRESH_PREFLIGHT"));
    } finally { finishPrimary(); }
    await waitFor(() => stores.kv.get("references")?.exchangeRate === 6.68);
    assert.equal(stores.kv.get("references").exchangeRateSource, "ExchangeRate-API");
    await waitFor(() => worker.runtimeMessages.some(message => message.type === "REFERENCES_REFRESHING" && message.active === false));
    assert.ok(worker.runtimeMessages.some(message => message.type === "REFERENCES_CHANGED"));
  });
});

test("adds selected local plugins in one idempotent batch without eager loading", async () => {
  resetSitePluginLoader();
  const installed = { centos: { version: "1.0.0", installedAt: 1 }, "windhub": { version: "1.0.0", installedAt: 1 } };
  await withWorker({ stations: [], values: { settings: { comparisonMode: "paid", exchangeRate: 7.2, pluginRegistry: { url: "", fetchedAt: 0, error: "", entries: [], installed } } } }, {}, async (worker, stores) => {
    responseData(await worker.send("GET_DASHBOARD"));
    assert.deepEqual(loadedSitePluginIds(), []);

    const ids = ["centos", "windhub", "centos"];
    const first = responseData(await worker.send("ADD_SITE_PLUGINS", { ids }));
    assert.deepEqual(first.added.slice().sort(), ["centos", "windhub"]);
    assert.equal(first.stations.length, 2);
    assert.equal(stores.stations.size, 2);
    assert.deepEqual(loadedSitePluginIds().slice().sort(), ["centos", "windhub"]);

    const second = responseData(await worker.send("ADD_SITE_PLUGINS", { ids }));
    assert.deepEqual(second.added, []);
    assert.deepEqual(second.alreadyAdded.slice().sort(), ["centos", "windhub"]);
    assert.equal(second.stations.length, 2);
    assert.equal(stores.stations.size, 2);

    const rejected = await worker.send("ADD_SITE_PLUGINS", { ids: ["not-a-plugin"] });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /请至少选择一个已安装插件里的站点/);
  });
});


test("preflight signatures and displayed URLs omit URL credentials and secret query parameters", () => {
  const safeUrl = sanitizePreflightUrl("https://user:password@relay.example/pricing?access_token=secret&region=cn#session");
  assert.equal(safeUrl, "https://relay.example/pricing?region=cn");
  const signature = refreshStationSignature([{ id: "relay", enabled: true, baseUrl: "https://relay.example/pricing?api_key=secret", mode: "page" }]);
  assert.equal(signature.includes("secret"), false);
  const changedSignature = refreshStationSignature([{ id: "relay", enabled: true, baseUrl: "https://relay.example/pricing?api_key=secret", mode: "page", priceCurrency: "CREDITS", priceCurrencyVerified: true, rechargeRate: 1.2, rechargeRateVerified: true }]);
  assert.notEqual(changedSignature, signature);
  assert.notEqual(refreshStationSignature([{ id: "relay", enabled: true, category: "paid", baseUrl: "https://relay.example/pricing" }], "paid"), refreshStationSignature([{ id: "relay", enabled: true, category: "paid", baseUrl: "https://relay.example/pricing" }], "public"));
});

test("dashboard shows preflight results and reserves REFRESH_ALL for explicit confirmation", () => {
  const script = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
  const startHandler = script.indexOf('$("#refresh-all").addEventListener');
  const confirmHandler = script.indexOf('$("#confirm-refresh-all").addEventListener');
  const cancelHandler = script.indexOf('$("#cancel-refresh-preflight").addEventListener');
  assert.ok(startHandler >= 0 && confirmHandler > startHandler && cancelHandler > confirmHandler);
  assert.equal(script.slice(startHandler, confirmHandler).includes('callService("REFRESH_ALL"'), false);
  assert.match(script.slice(confirmHandler, cancelHandler), /callService\("REFRESH_ALL", \{ preflightToken: preflight\.token, confirmed: true \}\)/);
  assert.match(script.slice(startHandler, confirmHandler), /callService\("REFRESH_PREFLIGHT"\)/);
  assert.match(html, /id="refresh-preflight-results"/);
  assert.match(html, /id="confirm-refresh-all"/);
  assert.match(html, /id="cancel-refresh-preflight"/);
});

test("GET_DASHBOARD prepares legacy station data and scheduler collection uses the same verified shape", async () => {
  const stationId = "ordinary-legacy";
  const rows = Array.from({ length: 145 }, (_, index) => ({ model_name: `legacy-model-${index}`, input_price: 1 + index / 100, output_price: 2 + index / 100, price_currency: "CREDITS" }));
  const snapshot = {
    id: `${stationId}:legacy`, stationId, stationName: "Ordinary Relay", collectedAt: Date.now(),
    normalizationVersion: NORMALIZATION_VERSION, status: "success", source: "legacy-fixture",
    normalized: { sourceFormat: "generic", data: rows, group_ratio: { default: 1 } }
  };
  const station = {
    id: stationId, name: "Ordinary Relay", baseUrl: "https://legacy-relay.example/pricing", enabled: true, mode: "direct",
    rechargeRmb: 2, rechargeCurrency: "CNY", rechargeCredits: 1, priceCurrency: "USD", priceCurrencyVerified: false, rechargeRateVerified: false,
    adapter: { endpoint: "/api/pricing", method: "GET", rawJson: JSON.stringify({ data: rows, group_ratio: { default: 1 } }) }
  };
  const protectedStations = [
    { id: "killai", name: "KillAI", baseUrl: "https://api.killai.cc/model-plaza?embedded=1", enabled: true, mode: "page", priceCurrency: "UNKNOWN", priceCurrencyVerified: false, rechargeRateVerified: true },
    { id: "fuck-everyone", name: "fuck-everyone", baseUrl: "https://fuck-everyone.com/model-plaza?embedded=1", enabled: true, mode: "direct", priceCurrency: "USD", priceCurrencyVerified: false, rechargeRateVerified: true }
  ];
  const protectedSnapshots = protectedStations.map(station => ({
    id: `${station.id}:legacy`, stationId: station.id, stationName: station.name, collectedAt: Date.now(),
    normalizationVersion: NORMALIZATION_VERSION, status: "success", source: "legacy-fixture", rechargeRateVerified: false,
    normalized: { sourceFormat: "generic", group_ratio: { default: 1 }, data: [{ model_name: `${station.id}-model`, input_price: 1, output_price: 2, price_currency: "CREDITS" }] }
  }));
  const disabledRows = Array.from({ length: 125 }, (_, index) => ({ model_name: `disabled-killai-model-${index}`, input_price: 1 + index / 100, output_price: 2 + index / 100, price_currency: "CREDITS" }));
  const disabledProtected = {
    id: "disabled-killai", name: "Disabled KillAI", baseUrl: "https://api.killai.cc/model-plaza?embedded=1", enabled: false, mode: "page",
    priceCurrency: "UNKNOWN", priceCurrencyVerified: false, rechargeRateVerified: false
  };
  const disabledSnapshot = {
    id: `${disabledProtected.id}:legacy`, stationId: disabledProtected.id, stationName: disabledProtected.name, collectedAt: Date.now(),
    normalizationVersion: NORMALIZATION_VERSION, status: "success", source: "legacy-fixture", rechargeRateVerified: false,
    normalized: { sourceFormat: "generic", group_ratio: { default: 1 }, data: disabledRows }
  };
  const stringDisabledProtected = {
    ...disabledProtected, id: "disabled-string-killai", name: "Disabled String KillAI", enabled: "false"
  };
  const stringDisabledSnapshot = {
    ...disabledSnapshot,
    id: `${stringDisabledProtected.id}:legacy`, stationId: stringDisabledProtected.id, stationName: stringDisabledProtected.name,
    normalized: { ...disabledSnapshot.normalized, data: [{ model_name: "disabled-string-model", input_price: 1, output_price: 2, price_currency: "CREDITS" }] }
  };
  const rechargeUnverified = {
    id: "recharge-unverified", name: "Recharge Unverified", baseUrl: "https://recharge-unverified.example/pricing", enabled: true, mode: "direct",
    rechargeRmb: 2, rechargeCurrency: "CNY", rechargeCredits: 1, rechargeRateVerified: false, priceCurrency: "CREDITS", priceCurrencyVerified: false,
    adapter: { endpoint: "/api/pricing", method: "GET" }
  };
  const rechargeSnapshot = {
    id: `${rechargeUnverified.id}:legacy`, stationId: rechargeUnverified.id, stationName: rechargeUnverified.name, collectedAt: Date.now(),
    normalizationVersion: NORMALIZATION_VERSION, status: "success", source: "legacy-fixture",
    normalized: { sourceFormat: "generic", group_ratio: { default: 1 }, data: [{ model_name: "recharge-model", input_price: 1, output_price: 2, price_currency: "CREDITS" }] }
  };
  await withWorker({ stations: [station, ...protectedStations, disabledProtected, stringDisabledProtected, rechargeUnverified], snapshots: [snapshot, ...protectedSnapshots, disabledSnapshot, stringDisabledSnapshot, rechargeSnapshot], values: { references: { fetchedAt: Date.now(), exchangeRateFetchedAt: Date.now(), models: [], exchangeRate: 8.2 } } }, {}, async (worker, stores) => {
    const dashboard = responseData(await worker.send("GET_DASHBOARD"));
    const prepared = dashboard.stations.find(value => value.id === stationId);
    const offers = flattenComparisonRows(dashboard.comparisons);
    const ordinaryOffers = offers.filter(offer => offer.stationId === stationId);
    assert.equal(prepared.priceCurrency, "CREDITS");
    assert.equal(prepared.priceCurrencyVerified, true);
    assert.equal(prepared.rechargeRateVerified, true);
    assert.equal(ordinaryOffers.length, 145);
    assert.ok(ordinaryOffers.every(offer => !(offer.pricingUnavailableReasons || []).includes("currency_unverified")));
    assert.ok(ordinaryOffers.every(offer => !(offer.pricingUnavailableReasons || []).includes("recharge_unverified")));
    assert.equal(dashboard.summary.offerCount, 148);
    assert.equal(offers.length, 148);
    assert.equal(offers.filter(offer => offer.pricingUnavailableReasons.includes("recharge_unverified")).length, 0);

    for (const id of ["killai", "fuck-everyone"]) {
      const protectedStation = dashboard.stations.find(value => value.id === id);
      const protectedOffers = offers.filter(offer => offer.stationId === id);
      const protectedSnapshot = dashboard.snapshots.find(value => value.stationId === id);
      assert.equal(protectedStation.priceCurrency, { killai: "USD", "fuck-everyone": "CREDITS" }[id]);
      assert.equal(protectedStation.priceCurrencyVerified, true);
      assert.equal(protectedStation.rechargeRateVerified, true);
      assert.equal(protectedSnapshot.rechargeRateVerified, false);
      assert.equal(protectedOffers.length, 1);
      assert.ok(protectedOffers.every(offer => !offer.pricingUnavailableReasons.includes("currency_unverified")));
      assert.ok(protectedOffers.every(offer => !offer.pricingUnavailableReasons.includes("recharge_unverified")));
      const quote = getProxyPriceQuote({ input_price: 1, output_price: 2, price_currency: protectedStation.priceCurrency }, 1, protectedStation.rechargeRate, protectedStation.basePricePerMillion, protectedStation.priceCurrencyVerified, protectedStation.rechargeRateVerified);
      assert.deepEqual(quote.pricingUnavailableReasons, []);
    }
    const disabledStation = dashboard.stations.find(value => value.id === disabledProtected.id);
    assert.equal(disabledStation.enabled, false);
    assert.equal(disabledStation.rechargeRateVerified, false);
    assert.equal(stores.snapshots.has(disabledSnapshot.id), true);
    assert.equal(dashboard.snapshots.some(value => value.stationId === disabledProtected.id), false);
    assert.equal(offers.some(offer => offer.stationId === disabledProtected.id), false);
    assert.equal(dashboard.stations.find(value => value.id === stringDisabledProtected.id).enabled, "false");
    assert.equal(dashboard.snapshots.some(value => value.stationId === stringDisabledProtected.id), false);
    assert.equal(offers.some(offer => offer.stationId === stringDisabledProtected.id), false);
    const rechargeOffer = offers.find(offer => offer.stationId === rechargeUnverified.id);
    assert.equal(dashboard.stations.find(value => value.id === rechargeUnverified.id).priceCurrencyVerified, true);
    assert.equal(dashboard.stations.find(value => value.id === rechargeUnverified.id).rechargeRateVerified, true);
    assert.deepEqual(rechargeOffer.pricingUnavailableReasons, []);

    const refreshed = responseData(await worker.send("REFRESH_STATION", { stationId }));
    assert.equal(refreshed.refreshSummary.successCount, 1);
    const saved = [...stores.snapshots.values()].find(value => value.stationId === stationId && value.status === "success" && value.id !== snapshot.id);
    assert.equal(saved.priceCurrencyVerified, true);
    assert.equal(saved.rechargeRateVerified, true);
    assert.equal(saved.normalized.data.length, 145);
  });
});

test("GET_DASHBOARD compares false and missing recharge verification at 1:1", async () => {
  const confirmedStation = { id: "killai-confirmed", name: "KillAI confirmed", baseUrl: "https://api.killai.cc/model-plaza?embedded=1", enabled: true, mode: "page", rechargeRmb: 1.2, rechargeCredits: 1, rechargeRateVerified: true };
  const stations = [
    { id: "killai-unverified", name: "KillAI", baseUrl: "https://api.killai.cc/model-plaza?embedded=1", enabled: true, mode: "page", rechargeRmb: 7.3, rechargeCredits: 1, rechargeRateVerified: false },
    { id: "fuck-everyone-unverified", name: "fuck-everyone", baseUrl: "https://fuck-everyone.com/model-plaza?embedded=1", enabled: true, mode: "direct", rechargeRmb: 8.4, rechargeCredits: 1 },
    confirmedStation
  ];
  const snapshots = stations.map(station => ({
    id: `${station.id}:legacy`, stationId: station.id, stationName: station.name, collectedAt: Date.now(),
    normalizationVersion: NORMALIZATION_VERSION, status: "success", source: "legacy-fixture",
    ...(station.id === confirmedStation.id ? {} : { rechargeRateVerified: true }),
    normalized: { sourceFormat: "generic", group_ratio: { default: 1 }, data: [{ model_name: `${station.id}-model`, input_price: 1, output_price: 2, price_currency: "CREDITS" }] }
  }));

  await withWorker({ stations, snapshots, values: { references: { fetchedAt: Date.now(), exchangeRateFetchedAt: Date.now(), models: [], exchangeRate: 8.2 } } }, {}, async worker => {
    const dashboard = responseData(await worker.send("GET_DASHBOARD"));
    const offers = flattenComparisonRows(dashboard.comparisons);
    assert.equal(offers.length, 3);
    for (const station of stations.slice(0, 2)) {
      assert.equal(dashboard.stations.find(value => value.id === station.id).rechargeRateVerified, false);
      const offer = offers.find(value => value.stationId === station.id);
      assert.equal(offer.pricingUnavailable, false);
      assert.equal(offer.costPrices.input, 1);
      assert.ok(!offer.pricingUnavailableReasons.includes("recharge_unverified"));
    }
    const preparedConfirmed = dashboard.stations.find(value => value.id === confirmedStation.id);
    const confirmedSnapshot = dashboard.snapshots.find(value => value.stationId === confirmedStation.id);
    const confirmedOffer = offers.find(value => value.stationId === confirmedStation.id);
    assert.equal(preparedConfirmed.rechargeRateVerified, true);
    assert.equal("rechargeRateVerified" in confirmedSnapshot, false);
    assert.equal(confirmedOffer.costPrices.input, 1.2);
    assert.ok(!confirmedOffer.pricingUnavailableReasons.includes("recharge_unverified"));
    assert.ok(offers.every(offer => !offer.pricingUnavailableReasons.includes("recharge_unverified")));
  });
});

test("preflight reads saved login state without opening pages, probing sites, or changing snapshots", async () => {
  const stations = [
    { id: "fastai", name: "FastAI", baseUrl: "https://www.fastaitoken.com/available-channels", enabled: true, mode: "page" },
    { id: "hepingan", name: "KillAI", baseUrl: "https://api.hepingan.top/available-channels", enabled: true, mode: "page" },
    { id: "aiapi", name: "AIAPI", baseUrl: "https://cn.aiapi.bot/dashboard/model-prices", enabled: true, mode: "page" },
    { id: "cun", name: "CUN", baseUrl: "https://cun.ai/pricing", enabled: true, mode: "page" },
    { id: "custom-page", name: "Custom page", baseUrl: "https://custom-page.example/pricing", enabled: true, mode: "page" },
    { id: "disabled-fastai", name: "Disabled FastAI", baseUrl: "https://www.fastaitoken.com/available-channels", enabled: false, mode: "page" },
    { id: "dddai", name: "DddAI", baseUrl: "https://dddai.dev/pricing", enabled: true, mode: "direct" }
  ];
  const beforeSnapshots = [{ id: "preserve", stationId: "fastai", collectedAt: 1, normalized: { data: [] } }];
  await withWorker({ stations, snapshots: beforeSnapshots }, {
    existingTabs: [{ id: 7, url: "https://cun.ai/pricing", status: "complete" }]
  }, async (worker, stores) => {
    const credentials = {
      fastai: { status: "ok", expiresAt: Date.now() + 3600000 },
      hepingan: { status: "needsLogin", expiresAt: Date.now() + 3600000 },
      aiapi: { status: "ok", expiresAt: Date.now() - 1000 },
      cun: { status: "ok", expiresAt: null }
    };
    await worker.chrome.storage.session.set({ "ai-price-analyzer:tokens": credentials });
    const preflight = responseData(await worker.send("REFRESH_PREFLIGHT"));
    const byId = new Map(preflight.results.map(result => [result.stationId, result]));
    assert.equal(byId.get("fastai").status, "ready");
    assert.match(byId.get("fastai").reason, /已保存/);
    assert.equal(byId.get("hepingan").status, "needsLogin");
    assert.match(byId.get("hepingan").reason, /上次检查/);
    assert.equal(byId.get("aiapi").status, "uncertain");
    assert.equal(byId.get("cun").status, "uncertain");
    assert.equal(byId.get("custom-page").status, "noLoginRequired");
    assert.equal(byId.has("disabled-fastai"), false);
    assert.equal(byId.get("dddai").status, "noLoginRequired");
    assert.equal(byId.get("hepingan").tabId, null);
    assert.equal(byId.get("hepingan").tabUrl, stations[1].baseUrl);
    assert.deepEqual(worker.created, []);
    assert.deepEqual(worker.removed, []);
    assert.deepEqual(worker.pageRequests, []);
    assert.deepEqual(await worker.chrome.storage.session.get("ai-price-analyzer:tokens"), { "ai-price-analyzer:tokens": credentials });
    assert.deepEqual([...stores.snapshots.values()], beforeSnapshots);
    assert.equal(worker.runtimeMessages.some(message => message.type === "REFRESH_PROGRESS"), false);

    responseError(await worker.send("REFRESH_ALL"), REFRESH_CONFIRMATION_REQUIRED_CODE);
    await worker.send("CANCEL_REFRESH_PREFLIGHT");
    responseError(await worker.send("REFRESH_ALL", { preflightToken: preflight.token, confirmed: true }), REFRESH_CONFIRMATION_REQUIRED_CODE);
    assert.deepEqual([...stores.snapshots.values()], beforeSnapshots);
  });
});

test("repeated preflight for 102 page stations never creates or reloads a tab", async () => {
  const stations = Array.from({ length: 102 }, (_, index) => ({
    id: `page-${index}`, name: `Page ${index}`, pluginId: "hepingan",
    baseUrl: "https://api.hepingan.top/available-channels", enabled: true, mode: "page"
  }));
  await withWorker({ stations }, {}, async worker => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const preflight = responseData(await worker.send("REFRESH_PREFLIGHT"));
      assert.equal(preflight.results.length, 102);
      assert.ok(preflight.results.every(result => result.status === "uncertain" && result.tabId === null));
      assert.deepEqual(worker.created, []);
      assert.deepEqual(worker.tabQueries, []);
      assert.deepEqual(worker.pageRequests, []);
      assert.deepEqual(worker.removed, []);
    }
  });
});

test("preflight persistence failures are returned and a later retry can succeed without loading sites", async () => {
  const station = { id: "hepingan", baseUrl: "https://api.hepingan.top/available-channels", enabled: true, mode: "page" };
  await withWorker({ stations: [station] }, {}, async worker => {
    worker.setSessionError(new Error("persist failed"));
    const failed = await worker.send("REFRESH_PREFLIGHT");
    assert.equal(failed.ok, false);
    assert.match(failed.error, /persist failed/);
    worker.setSessionError(null);
    assert.equal(responseData(await worker.send("REFRESH_PREFLIGHT")).results[0].status, "uncertain");
    assert.deepEqual(worker.created, []);
    assert.deepEqual(worker.removed, []);
  });
});

test("REFRESH_ALL requires live explicit confirmation, rejects expired or cancelled state, and consumes confirmation once", async () => {
  const station = {
    id: "manual-relay", name: "Manual Relay", baseUrl: "https://manual-relay.example/pricing", enabled: true, mode: "direct",
    rechargeRmb: 1, rechargeCurrency: "CNY", rechargeCredits: 1,
    adapter: { endpoint: "/api/pricing", method: "GET", rawJson: JSON.stringify({ data: [{ model_name: "manual-model", input_price: 1, output_price: 2 }], group_ratio: { default: 1 } }) }
  };
  await withWorker({ stations: [station], values: { references: { fetchedAt: Date.now(), exchangeRateFetchedAt: Date.now(), models: [], exchangeRate: 8.2 } } }, {}, async (worker, stores) => {
    const first = responseData(await worker.send("REFRESH_PREFLIGHT"));
    assert.equal(first.results[0].status, "noLoginRequired");
    assert.equal(worker.created.length, 0);
    responseError(await worker.send("REFRESH_ALL", { preflightToken: first.token, confirmed: false }), REFRESH_CONFIRMATION_REQUIRED_CODE);
    assert.equal(stores.snapshots.size, 0);

    const cancelled = responseData(await worker.send("REFRESH_PREFLIGHT"));
    await worker.send("CANCEL_REFRESH_PREFLIGHT");
    responseError(await worker.send("REFRESH_ALL", { preflightToken: cancelled.token, confirmed: true }), REFRESH_CONFIRMATION_REQUIRED_CODE);
    assert.equal(stores.snapshots.size, 0);

    const expired = responseData(await worker.send("REFRESH_PREFLIGHT"));
    const originalNow = Date.now;
    Date.now = () => expired.expiresAt + REFRESH_PREFLIGHT_TTL_MS;
    try { responseError(await worker.send("REFRESH_ALL", { preflightToken: expired.token, confirmed: true }), REFRESH_CONFIRMATION_REQUIRED_CODE); }
    finally { Date.now = originalNow; }
    assert.equal(stores.snapshots.size, 0);

    const confirmed = responseData(await worker.send("REFRESH_PREFLIGHT"));
    await worker.reboot();
    const refreshed = responseData(await worker.send("REFRESH_ALL", { preflightToken: confirmed.token, confirmed: true }));
    assert.equal(refreshed.refreshSummary.successCount, 1);
    assert.equal(stores.snapshots.size, 1);
    responseError(await worker.send("REFRESH_ALL", { preflightToken: confirmed.token, confirmed: true }), REFRESH_CONFIRMATION_REQUIRED_CODE);
    assert.equal(stores.snapshots.size, 1);
    assert.equal(responseData(await worker.send("GET_DASHBOARD")).refreshPreflight, null);
  });
});

test("stale async preflight cannot republish after a comparison-mode or station change", async () => {
  for (const change of ["mode", "station"]) {
    const station = { id: "race-page", name: "Race page", category: "paid", baseUrl: "https://api.hepingan.top/available-channels", enabled: true, mode: "page" };
    await withWorker({ stations: [station], values: { settings: { comparisonMode: "paid" } } }, {}, async worker => {
      let releaseRead;
      let reading = false;
      const credentials = new Promise(resolve => { releaseRead = resolve; });
      const get = worker.chrome.storage.local.get;
      worker.chrome.storage.local.get = key => {
        if (key === "ai-price-analyzer:tokens" && !reading) {
          reading = true;
          return credentials;
        }
        return get(key);
      };
      const staleRequest = worker.send("REFRESH_PREFLIGHT");
      await waitFor(() => reading);
      if (change === "mode") {
        await worker.send("SAVE_COMPARISON_MODE", { mode: "public" });
        await worker.send("SAVE_COMPARISON_MODE", { mode: "paid" });
      } else {
        await worker.send("SAVE_STATIONS", { stations: [{ ...station, name: "Updated station" }] });
      }
      releaseRead({});
      responseError(await staleRequest, REFRESH_CONFIRMATION_REQUIRED_CODE);
      assert.deepEqual(worker.created, []);
      assert.deepEqual(worker.removed, []);
      assert.equal(responseData(await worker.send("GET_DASHBOARD")).refreshPreflight, null);
    });
  }
});

test("station configuration changes invalidate old confirmation and require a new preflight", async () => {
  const station = {
    id: "config-relay", name: "Config relay", category: "paid", baseUrl: "https://config-relay.example/pricing", enabled: true, mode: "direct",
    adapter: { endpoint: "/api/pricing", method: "GET", rawJson: JSON.stringify({ data: [{ model_name: "before", input_price: 1, output_price: 2 }], group_ratio: { default: 1 } }) }
  };
  await withWorker({ stations: [station], values: { references: { fetchedAt: Date.now(), exchangeRateFetchedAt: Date.now(), models: [], exchangeRate: 8.2 } } }, {}, async (worker, stores) => {
    const first = responseData(await worker.send("REFRESH_PREFLIGHT"));
    await worker.send("SAVE_STATIONS", { stations: [{ ...station, adapter: { ...station.adapter, rawJson: JSON.stringify({ data: [{ model_name: "after", input_price: 3, output_price: 4 }], group_ratio: { default: 1 } }) } }] });
    responseError(await worker.send("REFRESH_ALL", { preflightToken: first.token, confirmed: true }), REFRESH_CONFIRMATION_REQUIRED_CODE);
    const second = responseData(await worker.send("REFRESH_PREFLIGHT"));
    assert.notEqual(second.token, first.token);
    const refreshed = responseData(await worker.send("REFRESH_ALL", { preflightToken: second.token, confirmed: true }));
    assert.equal(refreshed.refreshSummary.successCount, 1);
    assert.equal([...stores.snapshots.values()].find(snapshot => snapshot.stationId === station.id).normalized.data[0].model_name, "after");
  });
});

test("REFRESH_ALL uses the persisted comparison group for preflight, collection, progress, and snapshots", async () => {
  const station = (id, category, modelName) => ({
    id, name: id, category, baseUrl: `https://${id}.example/pricing`, enabled: true, mode: "direct",
    adapter: { endpoint: "/api/pricing", method: "GET", rawJson: JSON.stringify({ data: [{ model_name: modelName, input_price: 1, output_price: 2 }], group_ratio: { default: 1 } }) }
  });
  const paid = station("paid-relay", "paid", "paid-model");
  const publicStation = station("public-relay", "public", "public-model");
  const disabledPublic = { ...station("disabled-public", "public", "disabled-model"), enabled: false };
  const stringDisabledPublic = { ...station("disabled-string-public", "public", "string-disabled-model"), enabled: "false" };
  await withWorker({
    stations: [paid, publicStation, disabledPublic, stringDisabledPublic],
    values: { settings: { comparisonMode: "public" }, references: { fetchedAt: Date.now(), exchangeRateFetchedAt: Date.now(), models: [], exchangeRate: 8.2 } }
  }, {}, async (worker, stores) => {
    const preflight = responseData(await worker.send("REFRESH_PREFLIGHT"));
    assert.equal(preflight.comparisonMode, "public");
    assert.equal(preflight.comparisonLabel, "公益站");
    assert.equal(preflight.stationCount, 1);
    assert.deepEqual(preflight.results.map(result => result.stationId), ["public-relay"]);

    const refreshed = responseData(await worker.send("REFRESH_ALL", { preflightToken: preflight.token, confirmed: true }));
    assert.deepEqual(refreshed.refreshSummary, {
      total: 1, successCount: 1, partialCount: 0, errorCount: 0, totalModels: 1,
      comparisonMode: "public", comparisonLabel: "公益站", stationCount: 1,
      durationMs: refreshed.refreshSummary.durationMs
    });
    assert.deepEqual([...stores.snapshots.values()].map(snapshot => snapshot.stationId), ["public-relay"]);
    assert.equal([...stores.snapshots.values()].some(snapshot => snapshot.stationId === stringDisabledPublic.id), false);
    assert.equal(refreshed.snapshots.some(snapshot => snapshot.stationId === stringDisabledPublic.id), false);
    assert.equal(refreshed.stationErrors.some(error => error.stationId === stringDisabledPublic.id), false);
    const progress = worker.runtimeMessages.filter(message => message.type === "REFRESH_PROGRESS").map(message => message.progress);
    assert.ok(progress.length > 0);
    assert.ok(progress.every(message => message.comparisonMode === "public" && message.comparisonLabel === "公益站" && message.total === 1));
  });
});

test("comparison mode changes invalidate a preflight token and empty groups never refresh", async () => {
  const station = {
    id: "paid-only", name: "Paid only", category: "paid", baseUrl: "https://paid-only.example/pricing", enabled: true, mode: "direct",
    adapter: { endpoint: "/api/pricing", method: "GET", rawJson: JSON.stringify({ data: [{ model_name: "paid-model", input_price: 1, output_price: 2 }], group_ratio: { default: 1 } }) }
  };
  await withWorker({ stations: [station], values: { settings: { comparisonMode: "paid" }, references: { fetchedAt: Date.now(), exchangeRateFetchedAt: Date.now(), models: [], exchangeRate: 8.2 } } }, {}, async (worker, stores) => {
    const preflight = responseData(await worker.send("REFRESH_PREFLIGHT"));
    assert.equal(preflight.comparisonMode, "paid");
    const switched = responseData(await worker.send("SAVE_COMPARISON_MODE", { mode: "public" }));
    assert.equal(switched.settings.comparisonMode, "public");
    responseError(await worker.send("REFRESH_ALL", { preflightToken: preflight.token, confirmed: true }), REFRESH_CONFIRMATION_REQUIRED_CODE);
    assert.equal([...stores.snapshots.values()].some(snapshot => snapshot.stationId === station.id), false);
    await worker.send("SAVE_STATIONS", { stations: switched.stations.map(value => ({ ...value, enabled: false })) });

    const empty = responseData(await worker.send("REFRESH_PREFLIGHT"));
    assert.equal(empty.comparisonMode, "public");
    assert.equal(empty.stationCount, 0);
    assert.deepEqual(empty.results, []);
    const emptyRefresh = await worker.send("REFRESH_ALL", { preflightToken: empty.token, confirmed: true });
    assert.equal(emptyRefresh.ok, false);
    assert.equal(emptyRefresh.code, "REFRESH_NO_STATIONS");
    assert.equal([...stores.snapshots.values()].some(snapshot => snapshot.stationId === station.id), false);
    assert.equal(worker.runtimeMessages.some(message => message.type === "REFRESH_PROGRESS"), false);
  });
});

test("single and multiple station refresh remain independent from comparison mode", async () => {
  const stations = [
    { id: "paid-one", name: "Paid one", category: "paid", baseUrl: "https://paid-one.example/pricing", enabled: true, mode: "direct", adapter: { endpoint: "/api/pricing", method: "GET", rawJson: JSON.stringify({ data: [{ model_name: "paid", input_price: 1, output_price: 2 }], group_ratio: { default: 1 } }) } },
    { id: "public-one", name: "Public one", category: "public", baseUrl: "https://public-one.example/pricing", enabled: true, mode: "direct", adapter: { endpoint: "/api/pricing", method: "GET", rawJson: JSON.stringify({ data: [{ model_name: "public", input_price: 1, output_price: 2 }], group_ratio: { default: 1 } }) } }
  ];
  await withWorker({ stations, values: { settings: { comparisonMode: "public" }, references: { fetchedAt: Date.now(), exchangeRateFetchedAt: Date.now(), models: [], exchangeRate: 8.2 } } }, {}, async (worker, stores) => {
    const result = responseData(await worker.send("REFRESH_STATION", { stationId: "paid-one" }));
    assert.equal(result.refreshSummary.successCount, 1);
    assert.deepEqual([...stores.snapshots.values()].map(snapshot => snapshot.stationId), ["paid-one"]);

    stores.snapshots.clear();
    const multiple = responseData(await worker.send("REFRESH_STATION", { stationIds: ["public-one", "paid-one", "public-one"] }));
    assert.equal(multiple.refreshSummary.total, 2);
    assert.equal(multiple.refreshSummary.successCount, 2);
    assert.deepEqual([...stores.snapshots.values()].map(snapshot => snapshot.stationId).sort(), ["paid-one", "public-one"]);
  });
});

test("concurrent REFRESH_ALL requests cannot consume one confirmation twice", async () => {
  const station = {
    id: "single-use", name: "Single Use", baseUrl: "https://single-use.example/pricing", enabled: true, mode: "direct",
    rechargeRmb: 1, rechargeCurrency: "CNY", rechargeCredits: 1,
    adapter: { endpoint: "/api/pricing", method: "GET", rawJson: JSON.stringify({ data: [{ model_name: "single-use-model", input_price: 1, output_price: 2 }], group_ratio: { default: 1 } }) }
  };
  await withWorker({ stations: [station], values: { references: { fetchedAt: Date.now(), exchangeRateFetchedAt: Date.now(), models: [], exchangeRate: 8.2 } } }, {}, async (worker, stores) => {
    const preflight = responseData(await worker.send("REFRESH_PREFLIGHT"));
    const responses = await Promise.all([
      worker.send("REFRESH_ALL", { preflightToken: preflight.token, confirmed: true }),
      worker.send("REFRESH_ALL", { preflightToken: preflight.token, confirmed: true })
    ]);
    assert.equal(responses.filter(response => response.ok).length, 1);
    responseError(responses.find(response => !response.ok), REFRESH_CONFIRMATION_REQUIRED_CODE);
    assert.equal(stores.snapshots.size, 1);
  });
});

test("preflight never takes ownership of user tabs, including after a worker restart", async () => {
  const station = { id: "hepingan", name: "KillAI", baseUrl: "https://api.hepingan.top/available-channels", enabled: true, mode: "page" };
  await withWorker({ stations: [station] }, { existingTabs: [{ id: 7, url: station.baseUrl, status: "complete" }] }, async worker => {
    const first = responseData(await worker.send("REFRESH_PREFLIGHT"));
    assert.equal(first.results[0].tabId, null);
    await worker.reboot();
    await worker.removeUserTab(7);
    worker.addUserTab({ id: 7, url: station.baseUrl, status: "complete" });
    const second = responseData(await worker.send("REFRESH_PREFLIGHT"));
    assert.equal(second.results[0].tabId, null);
    assert.deepEqual(worker.created, []);
    assert.deepEqual(worker.removed, []);
    assert.deepEqual(worker.tabQueries, []);
  });
});

test("REFRESH_ALL collects from the prepared station state validated at confirmation", async () => {
  const station = {
    id: "manual-relay", name: "Manual Relay", baseUrl: "https://manual-relay.example/pricing", enabled: true, mode: "direct",
    rechargeRmb: 1, rechargeCurrency: "CNY", rechargeCredits: 1,
    adapter: { endpoint: "/api/pricing", method: "GET", rawJson: JSON.stringify({ data: [{ model_name: "confirmed-model", input_price: 1, output_price: 2 }], group_ratio: { default: 1 } }) }
  };
  let stationReads = 0;
  await withWorker({
    stations: [station],
    onGetAll(name, map) {
      if (name !== "stations" || ++stationReads !== 4) return;
      map.set(station.id, { ...station, adapter: { ...station.adapter, rawJson: JSON.stringify({ data: [{ model_name: "changed-after-confirmation", input_price: 9, output_price: 9 }], group_ratio: { default: 1 } }) } });
    },
    values: { references: { fetchedAt: Date.now(), exchangeRateFetchedAt: Date.now(), models: [], exchangeRate: 8.2 } }
  }, {}, async (worker, stores) => {
    const preflight = responseData(await worker.send("REFRESH_PREFLIGHT"));
    const refreshed = responseData(await worker.send("REFRESH_ALL", { preflightToken: preflight.token, confirmed: true }));
    assert.equal(refreshed.refreshSummary.successCount, 1);
    const saved = [...stores.snapshots.values()].find(value => value.stationId === station.id);
    assert.equal(saved.normalized.data[0].model_name, "confirmed-model");
  });
});

test("restores preflight confirmation after a service-worker restart and reads updated credentials", async () => {
  const stations = [{ id: "hepingan", name: "KillAI", baseUrl: "https://api.hepingan.top/available-channels", enabled: true, mode: "page" }];
  await withWorker({ stations }, {}, async worker => {
    const first = responseData(await worker.send("REFRESH_PREFLIGHT"));
    assert.equal(first.results[0].status, "uncertain");
    await worker.reboot();
    const dashboard = responseData(await worker.send("GET_DASHBOARD"));
    assert.equal(dashboard.refreshPreflight.token, first.token);
    await worker.chrome.storage.session.set({ "ai-price-analyzer:tokens": { hepingan: { status: "ok", expiresAt: Date.now() + 3600000 } } });
    const second = responseData(await worker.send("REFRESH_PREFLIGHT"));
    assert.equal(second.results[0].status, "ready");
    assert.deepEqual(worker.created, []);
    assert.deepEqual(worker.pageRequests, []);
    assert.deepEqual(worker.removed, []);
  });
});

test("页面站点插件没加载上时也要预检，不能判成无需登录", () => {
  const station = { id: "hepingan", enabled: true, mode: "page", pluginId: "hepingan" };
  assert.equal(requiresPageSessionPreflight(station, null), true);
  // 手动加的页面站点没有插件，本来就没有登录态可查，不用预检。
  assert.equal(requiresPageSessionPreflight({ ...station, pluginId: "" }, null), false);
  assert.equal(requiresPageSessionPreflight({ ...station, mode: "direct" }, null), false);
  assert.equal(requiresPageSessionPreflight({ ...station, enabled: false }, null), false);
  assert.equal(requiresPageSessionPreflight(station, { request: { pageAuth: {} } }), true);
  assert.equal(requiresPageSessionPreflight(station, { request: { credentials: "include" } }), true);
  assert.equal(requiresPageSessionPreflight(station, { request: {} }), false);
});

test("预检失败把现场写进 reason，不再只有一句通用文案", () => {
  const detail = "未找到 hepingan.top 登录凭据，请先在当前 Chrome 配置文件登录后重试";
  assert.equal(pageSessionStatusReason("needsLogin"), "未找到有效登录会话，请在打开的页面手动登录");
  assert.match(pageSessionStatusReason("needsLogin", detail), /未找到 hepingan\.top 登录凭据/);
  assert.match(pageSessionStatusReason("uncertain", "页面请求超时"), /页面请求超时/);
  assert.equal(pageSessionStatusReason("ready", "   "), "页面会话检查通过");
  // 长错误只留前 120 字，面板不该被一整段堆栈撑爆。
  assert.ok(pageSessionStatusReason("uncertain", "x".repeat(400)).length < 200);
});
