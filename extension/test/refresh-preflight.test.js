import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PAGE_RUNTIME_FETCH_TYPE } from "../src/core/bridge-protocol.js";
import { NORMALIZATION_VERSION } from "../src/core/normalizers.js";
import { flattenComparisonRows, getProxyPriceQuote } from "../src/core/pricing.js";
import { REFRESH_CONFIRMATION_REQUIRED_CODE, REFRESH_PREFLIGHT_TTL_MS, classifyPageSessionResponse, refreshStationSignature, sanitizePreflightUrl } from "../src/core/refresh-preflight.js";

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
    indexedDB: { open() { const result = { result: database }; queueMicrotask(() => result.onsuccess?.()); return result; } }
  };
}

function chromeApi({ pageResponses = {}, existingTabs = [] } = {}) {
  let listener;
  let nextTabId = 100;
  const tabsById = new Map(existingTabs.map(tab => [tab.id, clone(tab)]));
  const created = [], removed = [], pageRequests = [], runtimeMessages = [];
  const sessionValues = {};
  const noOpEvent = { addListener() {}, removeListener() {} };
  const removedEvent = {
    listeners: new Set(),
    addListener(callback) { this.listeners.add(callback); },
    removeListener(callback) { this.listeners.delete(callback); },
    async emit(...args) { await Promise.all([...this.listeners].map(callback => callback(...args))); }
  };
  const api = {
    created, removed, pageRequests, runtimeMessages, pageResponses,
    removeUserTab(tabId) { tabsById.delete(tabId); return removedEvent.emit(tabId); },
    addUserTab(tab) { tabsById.set(tab.id, clone(tab)); nextTabId = Math.max(nextTabId, Number(tab.id) + 1); },
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
      alarms: { clear: async () => true, create() {}, onAlarm: noOpEvent },
      storage: {
        local: { get: async () => ({}), set: async () => {}, remove: async () => {} },
        session: {
          async get(keys) {
            const requested = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(requested.filter(key => sessionValues[key] !== undefined).map(key => [key, clone(sessionValues[key])]));
          },
          async set(values) { Object.assign(sessionValues, clone(values)); },
          async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete sessionValues[key]; }
        }
      },
      tabs: {
        onUpdated: noOpEvent,
        onRemoved: removedEvent,
        async query() { return [...tabsById.values()].map(clone); },
        async create(options) {
          const tab = { id: nextTabId++, url: options.url, status: "complete" };
          tabsById.set(tab.id, tab); created.push(clone(tab)); return clone(tab);
        },
        async get(tabId) { const tab = tabsById.get(tabId); if (!tab) throw new Error("tab not found"); return clone(tab); },
        async remove(tabId) { removed.push(tabId); tabsById.delete(tabId); await removedEvent.emit(tabId); },
        sendMessage(tabId, message, callback) {
          const tab = tabsById.get(tabId);
          if (message.type === PAGE_RUNTIME_FETCH_TYPE) pageRequests.push(clone(message.request));
          const host = new URL(tab.url).hostname;
          callback({ ok: true, response: clone(pageResponses[host] || { ok: true, status: 200, body: { data: [] } }) });
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

async function withWorker(seed, chromeOptions, callback) {
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
});

test("dashboard shows preflight results and reserves REFRESH_ALL for explicit confirmation", () => {
  const script = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
  const popup = readFileSync(new URL("../src/popup.js", import.meta.url), "utf8");
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
  assert.match(popup, /预检完成：\$\{summary\.join\("；"\)\}/);
  assert.match(popup, /callService\("REFRESH_ALL", \{ preflightToken: activeRefreshPreflight\.token, confirmed: true \}\)/);
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
    { id: "killai", name: "KillAI", baseUrl: "https://api.killai.cc/model-plaza?embedded=1", enabled: true, mode: "page", priceCurrency: "UNKNOWN", priceCurrencyVerified: false, rechargeRateVerified: false },
    { id: "fuck-everyone", name: "fuck-everyone", baseUrl: "https://fuck-everyone.com/model-plaza?embedded=1", enabled: true, mode: "direct", priceCurrency: "USD", priceCurrencyVerified: false, rechargeRateVerified: false }
  ];
  const protectedSnapshots = protectedStations.map(station => ({
    id: `${station.id}:legacy`, stationId: station.id, stationName: station.name, collectedAt: Date.now(),
    normalizationVersion: NORMALIZATION_VERSION, status: "success", source: "legacy-fixture",
    normalized: { sourceFormat: "generic", group_ratio: { default: 1 }, data: [{ model_name: `${station.id}-model`, input_price: 1, output_price: 2, price_currency: "CREDITS" }] }
  }));
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
  await withWorker({ stations: [station, ...protectedStations, rechargeUnverified], snapshots: [snapshot, ...protectedSnapshots, rechargeSnapshot], values: { references: { fetchedAt: Date.now(), models: [], exchangeRate: 8.2 } } }, {}, async (worker, stores) => {
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

    for (const id of ["killai", "fuck-everyone"]) {
      const protectedStation = dashboard.stations.find(value => value.id === id);
      const protectedOffer = offers.find(offer => offer.stationId === id);
      assert.equal(protectedStation.priceCurrency, "CREDITS");
      assert.equal(protectedStation.priceCurrencyVerified, false);
      assert.equal(protectedStation.rechargeRateVerified, false);
      assert.ok(protectedOffer.pricingUnavailableReasons.includes("currency_unverified"));
      assert.ok(protectedOffer.pricingUnavailableReasons.includes("recharge_unverified"));
      const quote = getProxyPriceQuote({ input_price: 1, output_price: 2, price_currency: protectedStation.priceCurrency }, 1, protectedStation.rechargeRate, protectedStation.basePricePerMillion, protectedStation.priceCurrencyVerified, protectedStation.rechargeRateVerified);
      assert.deepEqual(quote.pricingUnavailableReasons.sort(), ["currency_unverified", "recharge_unverified"]);
    }
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
      if (name !== "stations" || ++stationReads !== 3) return;
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
