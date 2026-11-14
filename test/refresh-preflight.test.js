import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import nodeTest from "node:test";
import { PAGE_RUNTIME_FETCH_TYPE } from "../src/core/bridge-protocol.js";
import { NORMALIZATION_VERSION } from "../src/core/normalizers.js";
import { flattenComparisonRows, getProxyPriceQuote } from "../src/core/pricing.js";
import { REFRESH_CONFIRMATION_REQUIRED_CODE, REFRESH_PREFLIGHT_TTL_MS, classifyPageSessionResponse, refreshStationSignature, sanitizePreflightUrl } from "../src/core/refresh-preflight.js";

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
  const db = memoryDatabase(seed);
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
async function waitFor(predicate) {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail("condition was not reached before timeout");
}

test("adds selected local plugins in one idempotent batch without eager loading", async () => {
  resetSitePluginLoader();
  const installed = { centos: { version: "1.0.0", installedAt: 1 }, "linux-do-marketplace": { version: "1.0.0", installedAt: 1 } };
  await withWorker({ stations: [], values: { settings: { comparisonMode: "paid", exchangeRate: 7.2, pluginRegistry: { url: "", fetchedAt: 0, error: "", entries: [], installed } } } }, {}, async (worker, stores) => {
    responseData(await worker.send("GET_DASHBOARD"));
    assert.deepEqual(loadedSitePluginIds(), []);

    const ids = ["centos", "linux-do-marketplace", "centos"];
    const first = responseData(await worker.send("ADD_SITE_PLUGINS", { ids }));
    assert.deepEqual(first.added.slice().sort(), ["centos", "linux-do-marketplace"]);
    assert.equal(first.stations.length, 2);
    assert.equal(stores.stations.size, 2);
    assert.deepEqual(loadedSitePluginIds().slice().sort(), ["centos", "linux-do-marketplace"]);

    const second = responseData(await worker.send("ADD_SITE_PLUGINS", { ids }));
    assert.deepEqual(second.added, []);
    assert.deepEqual(second.alreadyAdded.slice().sort(), ["centos", "linux-do-marketplace"]);
    assert.equal(second.stations.length, 2);
    assert.equal(stores.stations.size, 2);

    const rejected = await worker.send("ADD_SITE_PLUGINS", { ids: ["not-a-plugin"] });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /请至少选择一个已安装插件里的站点/);
  });
});

test("classifies redirected login pages and login-specific errors even when the endpoint returns HTTP 200", () => {
  assert.equal(classifyPageSessionResponse({ ok: true, status: 200, body: '<html><form action="/auth/login"><input type="password"></form></html>' }), "needsLogin");
  assert.equal(classifyPageSessionResponse({ ok: true, status: 200, body: '<html><input name="password" type="password"></html>' }), "needsLogin");
  assert.equal(classifyPageSessionResponse({ ok: true, status: 200, body: { redirect_url: "https://relay.example/login" } }), "needsLogin");
  assert.equal(classifyPageSessionResponse({ ok: true, status: 200, body: { data: [{ model_name: "normal-model" }] } }), "ready");
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
  await withWorker({ stations: [station, ...protectedStations, disabledProtected, stringDisabledProtected, rechargeUnverified], snapshots: [snapshot, ...protectedSnapshots, disabledSnapshot, stringDisabledSnapshot, rechargeSnapshot], values: { references: { fetchedAt: Date.now(), models: [], exchangeRate: 8.2 } } }, {}, async (worker, stores) => {
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

  await withWorker({ stations, snapshots, values: { references: { fetchedAt: Date.now(), models: [], exchangeRate: 8.2 } } }, {}, async worker => {
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

test("Linux.do preflight uses the safe GET probe and never sends GraphQL or extension credentials", async () => {
  const stations = [{ id: "linux-do", name: "Linux.do Marketplace", baseUrl: "https://hub.linux.do/marketplace", enabled: true, mode: "page", category: "public", auth: { type: "bearer", token: "extension-secret-must-not-cross" }, adapter: { kind: "linux-do-marketplace", endpoint: "/admin/graphql", method: "POST", responseFormat: "linux-do-marketplace" } }];
  await withWorker({ stations, values: { settings: { comparisonMode: "public" } } }, { pageResponses: { "hub.linux.do": { ok: true, status: 200, body: { ok: true } } } }, async worker => {
    const preflight = responseData(await worker.send("REFRESH_PREFLIGHT"));
    assert.equal(preflight.results[0].status, "ready");
    assert.equal(worker.pageRequests.length, 1);
    const request = worker.pageRequests[0];
    assert.equal(request.method, "GET");
    assert.equal(request.url, "https://hub.linux.do/admin/system/price-version");
    assert.equal(request.body, undefined);
    assert.equal(request.pageAuth.storageKey, "axonhub_access_token");
    assert.equal(request.pageAuth.header, "Authorization");
    assert.equal(JSON.stringify(request).includes("extension-secret-must-not-cross"), false);
    assert.equal(JSON.stringify(request).includes("/admin/graphql"), false);
  });
});

test("preflight classifies sessions, bypasses direct APIs, preserves user tabs, and does not collect or write snapshots", async () => {
  const stations = [
    { id: "fastai", name: "FastAI", baseUrl: "https://www.fastaitoken.com/available-channels", enabled: true, mode: "page" },
    { id: "killai", name: "KillAI", baseUrl: "https://api.killai.cc/model-plaza?embedded=1", enabled: true, mode: "page" },
    { id: "aiapi", name: "AIAPI", baseUrl: "https://cn.aiapi.bot/dashboard/model-prices", enabled: true, mode: "page" },
    { id: "cun", name: "CUN", baseUrl: "https://cun.ai/pricing", enabled: true, mode: "page" },
    { id: "custom-page", name: "Custom page", baseUrl: "https://custom-page.example/pricing", enabled: true, mode: "page" },
    { id: "disabled-fastai", name: "Disabled FastAI", baseUrl: "https://www.fastaitoken.com/available-channels", enabled: false, mode: "page" },
    { id: "dddai", name: "DddAI", baseUrl: "https://dddai.dev/pricing", enabled: true, mode: "direct" }
  ];
  const beforeSnapshots = [{ id: "preserve", stationId: "fastai", collectedAt: 1, normalized: { data: [] } }];
  await withWorker({ stations, snapshots: beforeSnapshots }, {
    existingTabs: [{ id: 7, url: "https://cun.ai/pricing", status: "complete" }],
    pageResponses: {
      "www.fastaitoken.com": { ok: true, status: 200, body: { data: [{ model_name: "probe-only" }] } },
      "api.killai.cc": { ok: false, status: 401, body: { message: "Unauthorized" } },
      "cn.aiapi.bot": { ok: false, status: 503, body: { message: "gateway unavailable" } },
      "cun.ai": { ok: true, status: 200, body: { data: [] } }
    }
  }, async (worker, stores) => {
    const preflight = responseData(await worker.send("REFRESH_PREFLIGHT"));
    const byId = new Map(preflight.results.map(result => [result.stationId, result]));
    assert.equal(byId.get("fastai").status, "ready");
    assert.equal(byId.get("killai").status, "needsLogin");
    assert.equal(byId.get("aiapi").status, "uncertain");
    assert.equal(byId.get("cun").status, "ready");
    assert.equal(byId.get("cun").tabId, 7);
    assert.equal(byId.get("custom-page").status, "noLoginRequired");
    assert.equal(byId.has("disabled-fastai"), false);
    assert.equal(byId.get("dddai").status, "noLoginRequired");
    assert.deepEqual(worker.removed, [worker.created[0].id]);
    assert.equal(worker.created.length, 3);
    assert.equal(worker.pageRequests.length, 4);
    assert.ok(worker.pageRequests.every(request => request.method === "GET" && request.body === undefined));
    assert.equal(worker.pageRequests.find(request => request.url.includes("killai.cc")).pageAuth.refresh, undefined);
    assert.equal(worker.created.some(tab => tab.url.includes("dddai.dev") || tab.url.includes("cun.ai")), false);
    assert.equal(worker.removed.includes(7), false);
    assert.equal(byId.get("killai").tabId, worker.created[1].id);
    assert.equal(byId.get("aiapi").tabId, worker.created[2].id);
    assert.deepEqual([...stores.snapshots.values()], beforeSnapshots);
    assert.equal(worker.runtimeMessages.some(message => message.type === "REFRESH_PROGRESS"), false);

    responseError(await worker.send("REFRESH_ALL"), REFRESH_CONFIRMATION_REQUIRED_CODE);
    assert.deepEqual([...stores.snapshots.values()], beforeSnapshots);
    await worker.send("CANCEL_REFRESH_PREFLIGHT");
    responseError(await worker.send("REFRESH_ALL", { preflightToken: preflight.token, confirmed: true }), REFRESH_CONFIRMATION_REQUIRED_CODE);
    assert.deepEqual([...stores.snapshots.values()], beforeSnapshots);
  });
});


test("warns failed temporary preflight cleanup and preserves the fallback tab ID", async () => {
  const previousWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    await withWorker({ stations: [{ id: "fastai", name: "FastAI", baseUrl: "https://www.fastaitoken.com/available-channels", enabled: true, mode: "page" }] }, {
      pageResponses: { "www.fastaitoken.com": { ok: true, status: 200, body: { data: [{ model_name: "ready" }] } } },
      removeError: new Error("cleanup failed")
    }, async worker => {
      const preflight = responseData(await worker.send("REFRESH_PREFLIGHT"));
      assert.equal(preflight.results[0].status, "ready");
      assert.equal(preflight.results[0].tabId, worker.created[0].id);
      assert.deepEqual(worker.removed, []);
    });
  } finally {
    console.warn = previousWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /刷新预检临时标签页清理失败/);
});

test("warns refresh preflight state reconciliation failures after tab removal", async () => {
  const previousWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    await withWorker({ stations: [{ id: "fastai", name: "FastAI", baseUrl: "https://www.fastaitoken.com/available-channels", enabled: true, mode: "page" }] }, {
      pageResponses: { "www.fastaitoken.com": { ok: true, status: 200, body: { data: [{ model_name: "ready" }] } } },
      removeError: new Error("cleanup failed")
    }, async worker => {
      const preflight = responseData(await worker.send("REFRESH_PREFLIGHT"));
      warnings.length = 0;
      worker.setSessionError(new Error("persist failed"));
      await worker.removeUserTab(preflight.results[0].tabId);
    });
  } finally {
    console.warn = previousWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /刷新预检状态恢复失败/);
});

test("warns scheduled check-in failures without escaping the alarm event", async () => {
  const previousWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    await withWorker({ openError: new Error("station read failed") }, {}, async worker => {
      await worker.fireAlarm("checkin-stations");
      await new Promise(resolve => setImmediate(resolve));
    });
  } finally {
    console.warn = previousWarn;
  }
  assert.equal(warnings.length, 1);
  assert.match(String(warnings[0][0]), /定时签到失败/);
});
test("stale preflight cleans a temporary tab invalidated before loading completes", { concurrency: false }, async () => {
  const station = { id: "early-race-page", name: "Early race page", category: "paid", baseUrl: "https://api.killai.cc/model-plaza?embedded=1", enabled: true, mode: "page" };
  await withWorker({ stations: [station], values: { settings: { comparisonMode: "paid" } } }, {
    deferTabLoad: true,
    pageResponses: { "api.killai.cc": { ok: true, status: 200, body: { data: [{ model_name: "ready" }] } } }
  }, async worker => {
    const staleRequest = worker.send("REFRESH_PREFLIGHT");
    await waitFor(() => worker.created.length === 1);
    const tabId = worker.created[0].id;
    await worker.send("SAVE_STATIONS", { stations: [{ ...station, name: "Early race page updated" }] });
    await worker.completeTab(tabId);
    responseError(await staleRequest, REFRESH_CONFIRMATION_REQUIRED_CODE);
    assert.deepEqual(worker.removed, [tabId]);
  });
});

test("stale preflight temporary tabs are cleaned for ready, needsLogin, and uncertain", { concurrency: false }, async () => {
  const scenarios = [
    { name: "ready", host: "api.hepingan.top", baseUrl: "https://api.hepingan.top/available-channels", response: { ok: true, status: 200, body: { data: [{ model_name: "ready" }] } } },
    { name: "needsLogin", host: "www.nexavlinks.com", baseUrl: "https://www.nexavlinks.com/modelsmarket", response: { ok: false, status: 401, body: { message: "Unauthorized" } } },
    { name: "uncertain", host: "all-in-one.icu", baseUrl: "https://all-in-one.icu/#/tenant/models", response: { ok: false, status: 503, body: { message: "gateway unavailable" } } }
  ];
  for (const scenario of scenarios) {
    let releaseProbe;
    const probe = new Promise(resolve => { releaseProbe = resolve; });
    const station = { id: `cleanup-${scenario.name}`, name: scenario.name, category: "paid", baseUrl: scenario.baseUrl, enabled: true, mode: "page" };
    await withWorker({ stations: [station], values: { settings: { comparisonMode: "paid" } } }, {
      pageResponseHandlers: { [scenario.host]: () => probe }
    }, async worker => {
      const staleRequest = worker.send("REFRESH_PREFLIGHT");
      await waitFor(() => worker.created.length === 1);
      const tabId = worker.created[0].id;
      await worker.send("SAVE_STATIONS", { stations: [{ ...station, name: `${scenario.name} updated` }] });
      releaseProbe(scenario.response);
      responseError(await staleRequest, REFRESH_CONFIRMATION_REQUIRED_CODE);
      assert.deepEqual(worker.removed, [tabId]);
    });
  }
});

test("stale preflight does not close a reused temporary tab", { concurrency: false }, async () => {
  let requestCount = 0;
  let releaseProbe;
  const probe = new Promise(resolve => { releaseProbe = resolve; });
  const station = { id: "reuse-page", name: "Reused temporary tab", category: "paid", baseUrl: "https://api.killai.cc/model-plaza?embedded=1", enabled: true, mode: "page" };
  await withWorker({ stations: [station], values: { settings: { comparisonMode: "paid" } } }, {
    pageResponseHandlers: {
      "api.killai.cc": () => {
        requestCount += 1;
        return requestCount === 1 ? probe : { ok: true, status: 200, body: { data: [{ model_name: "new-preflight" }] } };
      }
    }
  }, async worker => {
    const staleRequest = worker.send("REFRESH_PREFLIGHT");
    await waitFor(() => worker.created.length === 1);
    const tabId = worker.created[0].id;
    await worker.send("SAVE_STATIONS", { stations: [{ ...station, name: "Reused temporary tab updated" }] });
    const currentRequest = worker.send("REFRESH_PREFLIGHT");
    await waitFor(() => worker.tabQueries.length >= 2);
    releaseProbe({ ok: true, status: 200, body: { data: [{ model_name: "ready" }] } });
    await waitFor(() => worker.pageRequests.length >= 2);
    const currentPreflight = responseData(await currentRequest);
    assert.equal(currentPreflight.results[0].status, "ready");
    assert.equal(currentPreflight.results[0].tabId, tabId);
    assert.deepEqual(worker.removed, []);
    responseError(await staleRequest, REFRESH_CONFIRMATION_REQUIRED_CODE);
    assert.deepEqual(worker.removed, []);
  });
});

test("REFRESH_ALL requires live explicit confirmation, rejects expired or cancelled state, and consumes confirmation once", async () => {
  const station = {
    id: "manual-relay", name: "Manual Relay", baseUrl: "https://manual-relay.example/pricing", enabled: true, mode: "direct",
    rechargeRmb: 1, rechargeCurrency: "CNY", rechargeCredits: 1,
    adapter: { endpoint: "/api/pricing", method: "GET", rawJson: JSON.stringify({ data: [{ model_name: "manual-model", input_price: 1, output_price: 2 }], group_ratio: { default: 1 } }) }
  };
  await withWorker({ stations: [station], values: { references: { fetchedAt: Date.now(), models: [], exchangeRate: 8.2 } } }, {}, async (worker, stores) => {
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

test("stale async preflight cannot republish after a comparison-mode change", async () => {
  let releaseProbe;
  const probe = new Promise(resolve => { releaseProbe = resolve; });
  const station = { id: "race-page", name: "Race page", category: "paid", baseUrl: "https://api.killai.cc/model-plaza?embedded=1", enabled: true, mode: "page" };
  await withWorker({ stations: [station], values: { settings: { comparisonMode: "paid" } } }, {
    pageResponseHandlers: { "api.killai.cc": () => probe }
  }, async worker => {
    const staleRequest = worker.send("REFRESH_PREFLIGHT");
    await waitFor(() => worker.pageRequests.length === 1);
    await worker.send("SAVE_COMPARISON_MODE", { mode: "public" });
    await worker.send("SAVE_COMPARISON_MODE", { mode: "paid" });
    releaseProbe({ ok: true, status: 200, body: { data: [{ model_name: "ready-after-mode-change" }] } });
    responseError(await staleRequest, REFRESH_CONFIRMATION_REQUIRED_CODE);
    assert.deepEqual(worker.removed, [worker.created[0].id]);
    assert.equal(responseData(await worker.send("GET_DASHBOARD")).refreshPreflight, null);
  });
});

test("station configuration changes invalidate old confirmation and require a new preflight", async () => {
  const station = {
    id: "config-relay", name: "Config relay", category: "paid", baseUrl: "https://config-relay.example/pricing", enabled: true, mode: "direct",
    adapter: { endpoint: "/api/pricing", method: "GET", rawJson: JSON.stringify({ data: [{ model_name: "before", input_price: 1, output_price: 2 }], group_ratio: { default: 1 } }) }
  };
  await withWorker({ stations: [station], values: { references: { fetchedAt: Date.now(), models: [], exchangeRate: 8.2 } } }, {}, async (worker, stores) => {
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
    values: { settings: { comparisonMode: "public" }, references: { fetchedAt: Date.now(), models: [], exchangeRate: 8.2 } }
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
  await withWorker({ stations: [station], values: { settings: { comparisonMode: "paid" }, references: { fetchedAt: Date.now(), models: [], exchangeRate: 8.2 } } }, {}, async (worker, stores) => {
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

test("single-station refresh remains independent from comparison mode", async () => {
  const stations = [
    { id: "paid-one", name: "Paid one", category: "paid", baseUrl: "https://paid-one.example/pricing", enabled: true, mode: "direct", adapter: { endpoint: "/api/pricing", method: "GET", rawJson: JSON.stringify({ data: [{ model_name: "paid", input_price: 1, output_price: 2 }], group_ratio: { default: 1 } }) } },
    { id: "public-one", name: "Public one", category: "public", baseUrl: "https://public-one.example/pricing", enabled: true, mode: "direct", adapter: { endpoint: "/api/pricing", method: "GET", rawJson: JSON.stringify({ data: [{ model_name: "public", input_price: 1, output_price: 2 }], group_ratio: { default: 1 } }) } }
  ];
  await withWorker({ stations, values: { settings: { comparisonMode: "public" }, references: { fetchedAt: Date.now(), models: [], exchangeRate: 8.2 } } }, {}, async (worker, stores) => {
    const result = responseData(await worker.send("REFRESH_STATION", { stationId: "paid-one" }));
    assert.equal(result.refreshSummary.successCount, 1);
    assert.deepEqual([...stores.snapshots.values()].map(snapshot => snapshot.stationId), ["paid-one"]);
  });
});

test("concurrent REFRESH_ALL requests cannot consume one confirmation twice", async () => {
  const station = {
    id: "single-use", name: "Single Use", baseUrl: "https://single-use.example/pricing", enabled: true, mode: "direct",
    rechargeRmb: 1, rechargeCurrency: "CNY", rechargeCredits: 1,
    adapter: { endpoint: "/api/pricing", method: "GET", rawJson: JSON.stringify({ data: [{ model_name: "single-use-model", input_price: 1, output_price: 2 }], group_ratio: { default: 1 } }) }
  };
  await withWorker({ stations: [station], values: { references: { fetchedAt: Date.now(), models: [], exchangeRate: 8.2 } } }, {}, async (worker, stores) => {
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

test("tab removal clears preflight ownership before a same-id user tab is reused", async () => {
  const station = { id: "killai", name: "KillAI", baseUrl: "https://api.killai.cc/model-plaza?embedded=1", enabled: true, mode: "page" };
  await withWorker({ stations: [station] }, { pageResponses: { "api.killai.cc": { ok: false, status: 401, body: { message: "Unauthorized" } } } }, async worker => {
    const first = responseData(await worker.send("REFRESH_PREFLIGHT"));
    const tabId = first.results[0].tabId;
    assert.ok(Number.isInteger(tabId));
    worker.removeUserTab(tabId);
    worker.addUserTab({ id: tabId, url: station.baseUrl, status: "complete" });
    worker.pageResponses["api.killai.cc"] = { ok: true, status: 200, body: { data: [{ model_name: "logged-in" }] } };

    const second = responseData(await worker.send("REFRESH_PREFLIGHT"));
    assert.equal(second.results[0].status, "ready");
    assert.equal(second.results[0].tabId, tabId);
    assert.deepEqual(worker.removed, []);
  });
});

test("restored tab ownership is cleared when a tab closes while the worker is cold", async () => {
  const station = { id: "killai", name: "KillAI", baseUrl: "https://api.killai.cc/model-plaza?embedded=1", enabled: true, mode: "page" };
  await withWorker({ stations: [station] }, { pageResponses: { "api.killai.cc": { ok: false, status: 401, body: { message: "Unauthorized" } } } }, async worker => {
    const first = responseData(await worker.send("REFRESH_PREFLIGHT"));
    const tabId = first.results[0].tabId;
    await worker.reboot();
    await worker.removeUserTab(tabId);
    worker.addUserTab({ id: tabId, url: station.baseUrl, status: "complete" });
    worker.pageResponses["api.killai.cc"] = { ok: true, status: 200, body: { data: [{ model_name: "logged-in" }] } };

    const second = responseData(await worker.send("REFRESH_PREFLIGHT"));
    assert.equal(second.results[0].status, "ready");
    assert.equal(second.results[0].tabId, tabId);
    assert.deepEqual(worker.removed, []);
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
    values: { references: { fetchedAt: Date.now(), models: [], exchangeRate: 8.2 } }
  }, {}, async (worker, stores) => {
    const preflight = responseData(await worker.send("REFRESH_PREFLIGHT"));
    const refreshed = responseData(await worker.send("REFRESH_ALL", { preflightToken: preflight.token, confirmed: true }));
    assert.equal(refreshed.refreshSummary.successCount, 1);
    const saved = [...stores.snapshots.values()].find(value => value.stationId === station.id);
    assert.equal(saved.normalized.data[0].model_name, "confirmed-model");
  });
});

test("restores preflight confirmation and temporary tab ownership after a service-worker restart", async () => {
  const stations = [{ id: "killai", name: "KillAI", baseUrl: "https://api.killai.cc/model-plaza?embedded=1", enabled: true, mode: "page" }];
  await withWorker({ stations }, { pageResponses: { "api.killai.cc": { ok: false, status: 401, body: { message: "Unauthorized" } } } }, async worker => {
    responseData(await worker.send("GET_DASHBOARD"));
    const first = responseData(await worker.send("REFRESH_PREFLIGHT"));
    const killAiTab = first.results.find(result => result.stationId === "killai").tabId;
    assert.ok(Number.isInteger(killAiTab));

    await worker.reboot();
    const dashboard = responseData(await worker.send("GET_DASHBOARD"));
    assert.equal(dashboard.refreshPreflight.token, first.token);

    worker.pageResponses["api.killai.cc"] = { ok: true, status: 200, body: { data: [{ model_name: "logged-in" }] } };
    const second = responseData(await worker.send("REFRESH_PREFLIGHT"));
    assert.equal(second.results.find(result => result.stationId === "killai").status, "ready");
    assert.ok(worker.removed.includes(killAiTab));
  });
});
