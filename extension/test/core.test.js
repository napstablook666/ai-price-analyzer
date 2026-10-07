import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { icon } from "../src/shared/ui.js";
import assert from "node:assert/strict";
import { parseOpenRouterData, parseOfficialExchangeRate } from "../src/core/openrouter.js";
import { collectStation, prepareStationInput } from "../src/core/collectors.js";
import { addRecommendationScores, buildComparisonRows, getProxyPrices, getTierShares, workloadCost } from "../src/core/pricing.js";
import { createDashboardIndex, matchesModelQueries, paginateRows } from "../src/dashboard-index.js";
import { buildModelMatchIndex, getJevModelCandidates, matchModel, matchModelWithOverrides, matchOne, suggestModelCandidates } from "../src/core/matching.js";
import { normalizePricingPayload } from "../src/core/collectors.js";
import { convertRechargeAmount, DEFAULT_DAILY_USAGE, currentSiteOrigin, isSecureRemoteUrl, normalizeSettings, normalizeStation, TOKENS_PER_MILLION, USAGE_PRESETS, usagePresetId } from "../src/shared/schema.js";
import { NORMALIZATION_VERSION } from "../src/core/normalizers.js";
import { snapshotNeedsRefresh } from "../src/core/snapshot-policy.js";
import { ensurePageBridge, findOrOpenPageTab, selectPageTab } from "../src/core/page-tabs.js";
import { inferStationAdapter, parseAdapterSuggestion } from "../src/core/adapters.js";
import { addStationIfNeeded, getComparisonRevision, getLatestSnapshots, getSnapshots, putSnapshot, putStations, redactStation } from "../src/shared/db.js";
import { getProviderApiKey, hasProviderApiKey, selectProviderApiKey, setProviderApiKey } from "../src/shared/credentials.js";
import { buildJevComparisonTask, buildJevModelMatchTask, getJevModelBatchTargets, isExtensionPageSender, resolveJevTaskConfig } from "../src/core/jev-tasks.js";
import { fetchModelCatalog, parseModelCatalog, requestJevChoices, testModelConnection } from "../src/core/model-api.js";
import { addAiApiStationPreset, addCheapRouterStationPreset, addFastAiStationPreset, addNexaStationPreset } from "../src/core/station-presets.js";

const pqhFixture = {
  pricing_version: 1,
  group_ratio: { "余额": 1.2 },
  data: [{ model_name: "gpt-4o", model_ratio: 2, completion_ratio: 3, enable_groups: ["余额"] }]
};
const aiApiFixture = {
  ok: true,
  data: {
    version: 2,
    source: "cnaiapi",
    provider: "AIAPI",
    groups: [{
      id: "starter",
      code: "starter",
      name: "Starter 0.25x",
      billingMultiplier: 0.25,
      pricedModelCount: 1,
      availableModelCount: 1,
      models: [{
        id: "gpt-5.6-luna",
        displayName: "GPT-5.6 Luna",
        available: true,
        base: { inputPer1M: 1, outputPer1M: 6, cacheReadPer1M: 0.1, cacheCreatePer1M: 0.4 },
        effective: { inputPer1M: 0.25, outputPer1M: 1.5, cacheReadPer1M: 0.025, cacheCreatePer1M: 0.1 }
      }]
    }],
    models: []
  }
};

const response = body => ({
  ok: true,
  status: 200,
  headers: { get: () => "application/json" },
  json: async () => body
});
test("adds the missing AIAPI station once for an existing registry", () => {
  const current = [{ id: "one", baseUrl: "https://soleapi.com" }];
  const stations = addAiApiStationPreset(current);
  assert.equal(stations.length, 2);
  assert.equal(stations[1].baseUrl, "https://cn.aiapi.bot/dashboard/model-prices");
  assert.equal(stations[1].mode, "page");
  assert.equal(stations[1].adapter.kind, "aiapi-model-catalog");
  assert.equal(addAiApiStationPreset(stations), stations);
  assert.equal(addAiApiStationPreset([]).length, 0);
});

test("collects AIAPI prices through its logged-in model page", async () => {
  const station = {
    id: "station-aiapi",
    name: "AIAPI",
    baseUrl: "https://cn.aiapi.bot/dashboard/model-prices",
    auth: { type: "bearer", token: "must-not-be-sent" },
    adapter: { endpoint: "/wrong", method: "POST", responseFormat: "pqh" }
  };
  const adapter = inferStationAdapter(station);
  assert.equal(adapter.mode, "page");
  assert.equal(adapter.endpoint, "/api/me/model-catalog");
  assert.equal(adapter.method, "GET");
  assert.equal(adapter.authType, "none");
  const prepared = prepareStationInput({ ...station, adapter });
  assert.equal(prepared.baseUrl, "https://cn.aiapi.bot/dashboard/model-prices");
  assert.equal(prepared.auth.type, "none");
  assert.equal(prepared.adapter.kind, "aiapi-model-catalog");
  const requests = [];
  const pageFetch = async request => {
    requests.push(request);
    return request.capture
      ? { ok: true, status: 404, body: { data: [] } }
      : { ok: true, status: 200, body: aiApiFixture };
  };
  pageFetch.supportsCapture = true;
  const snapshot = await collectStation({ ...station, adapter }, { pageFetch });
  assert.equal(requests[1].url, "https://cn.aiapi.bot/api/me/model-catalog");
  assert.equal(requests[1].headers.Authorization, undefined);
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.sourceFormat, "aiapi-model-catalog");
  const model = snapshot.normalized.data[0];
  assert.equal(model.model_name, "gpt-5.6-luna");
  assert.equal(model.proxy_group_name, "Starter 0.25x");
  assert.equal(snapshot.normalized.group_ratio[model.proxy_group_name], 0.25);
  assert.deepEqual(getProxyPrices(model, snapshot.normalized.group_ratio[model.proxy_group_name]), {
    input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0.1, request: null, imageOutput: null, imagePrice: null
  });
});

test("captures the AIAPI model catalog from page requests", async () => {
  const origin = "https://cn.aiapi.bot";
  const listeners = new Map();
  const posted = [];
  const document = { body: { innerText: "" }, querySelectorAll: () => [] };
  const pageWindow = {
    location: { hostname: "cn.aiapi.bot", origin, href: `${origin}/dashboard/model-prices` },
    history: { pushState() {}, replaceState() {} },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener() {},
    postMessage(message) { posted.push(message); },
    fetch: async () => ({ headers: { get: () => null }, clone: () => ({ json: async () => aiApiFixture }) })
  };
  function MockXHR() {}
  MockXHR.prototype.open = function() {};
  MockXHR.prototype.send = function() {};
  runInNewContext(readFileSync(new URL("../src/page-bridge.js", import.meta.url), "utf8"), {
    window: pageWindow, document, history: pageWindow.history, fetch: pageWindow.fetch, XMLHttpRequest: MockXHR,
    URL, Date, Math, JSON, Object, String, Number, Array, Set, RegExp, Error, Promise
  });
  await pageWindow.fetch(`${origin}/api/me/model-catalog`);
  await new Promise(resolve => setImmediate(resolve));
  await listeners.get("message")({
    source: pageWindow,
    origin,
    data: { type: "AI_RELAY_PAGE_CAPTURE_REQUEST", id: "aiapi-capture" }
  });
  assert.equal(posted.at(-1).response.ok, true);
  assert.equal(posted.at(-1).response.body.data.groups[0].models[0].effective.inputPer1M, 0.25);
});

test("opens a temporary AIAPI model-price page when no site tab is available", async () => {
  const opened = [];
  const tabs = {
    query: async () => [],
    create: async options => {
      opened.push(options);
      return { id: 44, url: options.url, status: "complete" };
    },
    get: async tabId => ({ id: tabId, url: "https://cn.aiapi.bot/dashboard/model-prices", status: "complete" }),
    onUpdated: { addListener() {}, removeListener() {} },
    onRemoved: { addListener() {}, removeListener() {} }
  };
  const result = await findOrOpenPageTab(tabs, { baseUrl: "https://cn.aiapi.bot/dashboard/model-prices", mode: "page" });
  assert.equal(result.temporary, true);
  assert.equal(result.tab.id, 44);
  assert.deepEqual(opened, [{ url: "https://cn.aiapi.bot/dashboard/model-prices", active: false }]);
});


async function withSnapshotDb(initialSnapshots, callback) {
  const previousIndexedDb = globalThis.indexedDB;
  const previousKeyRange = globalThis.IDBKeyRange;
  const snapshots = structuredClone(initialSnapshots);
  const compareKeys = (left, right) => {
    if (typeof left !== typeof right) return typeof left === "number" ? -1 : 1;
    return typeof left === "number" ? left - right : String(left).localeCompare(String(right));
  };
  const database = {
    close() {},
    transaction() {
      const transaction = {
        objectStore() {
          return {
            getAll() {
              const request = {};
              queueMicrotask(() => { request.result = [...snapshots].sort((a, b) => a.id.localeCompare(b.id)); request.onsuccess?.(); });
              return request;
            },
            put(value) {
              const request = {};
              queueMicrotask(() => {
                const index = snapshots.findIndex(snapshot => snapshot.id === value.id);
                if (index < 0) snapshots.push(structuredClone(value));
                else snapshots[index] = structuredClone(value);
                request.onsuccess?.();
              });
              return request;
            },
            index(name) {
              return {
                getAll(query) {
                  const request = {};
                  queueMicrotask(() => {
                    request.result = snapshots.filter(snapshot => name !== "stationId" || snapshot.stationId === query);
                    request.onsuccess?.();
                  });
                  return request;
                },
                openCursor(query = null, direction = "next") {
                  const request = {};
                  let rows = snapshots.filter(snapshot => {
                    if (query?.type === "upper") return typeof snapshot.collectedAt === "number" && snapshot.collectedAt < query.value;
                    if (query?.type === "lower") return typeof snapshot.collectedAt === "string";
                    return true;
                  }).sort((a, b) => compareKeys(a.collectedAt, b.collectedAt) || a.id.localeCompare(b.id));
                  if (direction === "prev") rows.reverse();
                  let position = 0;
                  const emit = () => queueMicrotask(() => {
                    const snapshot = rows[position];
                    request.result = snapshot ? {
                      key: snapshot.collectedAt,
                      value: structuredClone(snapshot),
                      continue() { position++; emit(); },
                      delete() { const index = snapshots.findIndex(item => item.id === snapshot.id); if (index >= 0) snapshots.splice(index, 1); }
                    } : null;
                    request.onsuccess?.();
                  });
                  emit();
                  return request;
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
  globalThis.indexedDB = { open() { const request = { result: database }; queueMicrotask(() => request.onsuccess?.()); return request; } };
  globalThis.IDBKeyRange = {
    upperBound(value) { return { type: "upper", value }; },
    lowerBound(value) { return { type: "lower", value }; }
  };
  try { return await callback(snapshots); }
  finally {
    if (previousIndexedDb === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previousIndexedDb;
    if (previousKeyRange === undefined) delete globalThis.IDBKeyRange;
    else globalThis.IDBKeyRange = previousKeyRange;
  }
}
test("parses OpenRouter token and image prices", () => {
  const [model] = parseOpenRouterData({ data: [{
    id: "openai/gpt-4o",
    name: "GPT-4o",
    pricing: { prompt: "0.000005", completion: "0.000015", request: "0.000002", image_output: "0.00008", image: "0.01" },
    architecture: { output_modalities: ["text", "image"] }
  }] });
  assert.equal(model.input, 5);
  assert.equal(model.output, 15);
  assert.equal(model.request, 0.000002);
  assert.equal(model.imageOutput, 80);
  assert.equal(model.imagePrice, 0.01);
  assert.ok(model.aliases.includes("gpt-4o"));
});

test("parses China Bank HTML exchange rate", () => {
  const html = "<table><tr><td>美元</td><td>718.12</td><td>716.33</td><td>720.88</td><td>720.88</td><td>719.03</td></tr></table>";
  assert.equal(parseOfficialExchangeRate(html), 7.1903);
});

test("calculates token workload per million, not per token", () => {
  assert.equal(workloadCost({ input: 0.5, output: 1 }, { input: 1_000_000, output: 200_000 }), 0.7);
  assert.equal(workloadCost({ imageOutput: 0.1, imagePrice: 0.02 }, { imageTokens: 1_000_000, images: 2 }), 0.14);
});

test("uses the legacy userscript workload as the default daily usage", () => {
  const settings = normalizeSettings();
  assert.deepEqual(settings.usage, DEFAULT_DAILY_USAGE);
  assert.equal(settings.usage.input, 66.5 * TOKENS_PER_MILLION);
  assert.equal(settings.usage.cacheRead, 550.7 * TOKENS_PER_MILLION);
  assert.equal(settings.usage.output, 5.5 * TOKENS_PER_MILLION);
  assert.equal(USAGE_PRESETS.find(preset => preset.id === "legacy").usage.requests, 7900);
});

test("matches the baseline usage preset regardless of peak share", () => {
  const usage = { requests: 0, input: TOKENS_PER_MILLION, cacheRead: 0, output: 200_000, cacheWrite: 0, imageTokens: 0, images: 0, peakShare: 0.3 };
  assert.equal(usagePresetId(usage), "baseline");
  assert.equal(usagePresetId({ ...DEFAULT_DAILY_USAGE }), "legacy");
  assert.equal(usagePresetId({ ...DEFAULT_DAILY_USAGE, peakShare: 0.5 }), "custom");
  assert.equal(usagePresetId({ ...usage, input: 900_000 }), "custom");
});

test("normalizes the official exchange-rate override", () => {
  assert.equal(normalizeSettings({ exchangeRate: 7.25 }).exchangeRate, 7.25);
  assert.equal(normalizeSettings({ exchangeRate: 0 }).exchangeRate, 7.3);
});

test("converts recharge amounts between CNY and USD using the configured rate", () => {
  assert.equal(convertRechargeAmount(10, "USD", "CNY", 7.2), 72);
  assert.equal(convertRechargeAmount(72, "CNY", "USD", 7.2), 10);
  assert.equal(convertRechargeAmount(72, "CNY", "CNY", 7.2), 72);
  assert.equal(convertRechargeAmount(-1, "USD", "CNY", 7.2), null);
  assert.equal(convertRechargeAmount(10, "USD", "CNY"), 73);
});

test("normalizes user-confirmed model match overrides", () => {
  const settings = normalizeSettings({ modelMatchOverrides: [
    { stationId: "station-a", modelName: " relay-model ", officialModelId: "openai/gpt-4o" },
    { stationId: "station-a", modelName: "relay-model", officialModelId: "anthropic/claude-sonnet" },
    { stationId: "", modelName: "relay-model", officialModelId: "openai/gpt-4o" },
    { stationId: "station-b", modelName: "relay-model", officialModelId: "" }
  ] });
  assert.deepEqual(settings.modelMatchOverrides, [{ stationId: "station-a", modelName: "relay-model", officialModelId: "anthropic/claude-sonnet" }]);
  const versioned = normalizeSettings({ modelMatchOverrides: [
    { stationId: "station-a", modelName: "relay-model-expires-on-2026-12-31", officialModelId: "old" },
    { stationId: "station-a", modelName: "relay-model", officialModelId: "new" }
  ] });
  assert.deepEqual(versioned.modelMatchOverrides, [{ stationId: "station-a", modelName: "relay-model", officialModelId: "new" }]);
});

test("applies recharge ratio only to foreign-currency prices", () => {
  assert.equal(getProxyPrices({ input_price: 2, output_price: 3, price_currency: "USD" }, 1, 1.2).input, 2.4);
  assert.equal(getProxyPrices({ input_price: 2, output_price: 3, price_currency: "CNY" }, 1, 1.2).input, 2);
  assert.equal(getProxyPrices({ input_price: 2, output_price: 3, price_currency: "CREDITS" }, 1, 1.2).input, 2.4);
});

test("derives and preserves the station recharge ratio inputs", () => {
  const station = normalizeStation({ baseUrl: "https://relay.example", rechargeRmb: 12, rechargeCredits: 10 });
  assert.equal(station.rechargeRate, 1.2);
  assert.equal(station.rechargeRmb, 12);
  assert.equal(station.rechargeCredits, 10);
  const defaultStation = normalizeStation({ baseUrl: "https://relay.example" });
  assert.equal(defaultStation.rechargeRmb, 1);
  assert.equal(defaultStation.rechargeCredits, 1);
  assert.equal(defaultStation.rechargeRate, 1);
  assert.equal(normalizeStation({ baseUrl: "https://relay.example", rechargeCurrency: "USD" }).rechargeCurrency, "USD");
  assert.equal(defaultStation.rechargeCurrency, "CNY");
});

test("uses manually configured pricing JSON without a network request", async () => {
  const snapshot = await collectStation({
    id: "station-manual",
    name: "Manual",
    baseUrl: "https://relay.example",
    adapter: { rawJson: JSON.stringify({ data: [{ model_name: "manual-model", input_price: 2, output_price: 8, price_currency: "USD" }] }) }
  }, { fetchImpl: async () => { throw new Error("network should not be used"); } });
  assert.equal(snapshot.rawMeta.url, "manual://station-config");
  assert.equal(snapshot.normalized.data[0].model_name, "manual-model");
});
test("does not turn an unpriced model catalog into a paid offer", () => {
  const normalized = normalizePricingPayload({ models: [{ id: "catalog-only", name: "Catalog only" }] });
  assert.equal(normalized.data[0].catalogOnly, true);
  assert.equal(normalized.data[0].input_price, null);
});
test("normalizes generic input and output price fields", () => {
  const normalized = normalizePricingPayload({ data: [{ name: "generic-model", input: 2, output: 8, currency: "USD" }] });
  assert.equal(normalized.data[0].model_name, "generic-model");
  assert.equal(normalized.data[0].input_price, 2);
  assert.equal(normalized.data[0].output_price, 8);
});



test("weights peak and off-peak pricing into one daily offer", () => {
  assert.deepEqual(getTierShares([{ tier_name: "peak" }, { tier_name: "offpeak" }], 0.25), [0.25, 0.75]);
  const [comparison] = buildComparisonRows({
    stations: [{ id: "station-tier", name: "Tier station", rechargeRate: 1, basePricePerMillion: 2 }],
    snapshots: [{ stationId: "station-tier", collectedAt: 1, status: "success", normalized: { group_ratio: { Default: 1 }, data: [
      { model_name: "tiered-model", model_display_name: "Tiered", tier_name: "peak", proxy_group_name: "Default", enable_groups: ["Default"], input_price: 10, output_price: 10, price_currency: "USD" },
      { model_name: "tiered-model", model_display_name: "Tiered", tier_name: "offpeak", proxy_group_name: "Default", enable_groups: ["Default"], input_price: 2, output_price: 2, price_currency: "USD" }
    ] } }],
    references: { exchangeRate: 1, models: [{ name: "tiered-model", provider: "official", input: 1, output: 1 }] },
    usage: { input: TOKENS_PER_MILLION, cacheRead: 0, cacheWrite: 0, output: 0, requests: 0, peakShare: 0.25 },
    rules: [{ id: "exact", name: "精确名称", enabled: true }]
  });
  assert.equal(comparison.offers[0].dailyCost, 4);
  assert.match(comparison.offers[0].tierName, /25%/);
  assert.match(comparison.offers[0].tierName, /75%/);
});

test("uses the page capture fallback before configured page endpoints", async () => {
  let request;
  const pageFetch = async value => { request = value; return response(pqhFixture); };
  pageFetch.supportsCapture = true;
  const snapshot = await collectStation({ id: "station-capture", name: "Captured", baseUrl: "https://relay.example", mode: "page" }, { pageFetch });
  assert.deepEqual(request, { capture: true });
  assert.equal(snapshot.status, "success");
});

test("reads the response body returned by the page bridge", async () => {
  const requests = [];
  const pageFetch = async request => {
    requests.push(request);
    return request.capture ? { ok: true, status: 404, body: { data: [] } } : { ok: true, status: 200, body: pqhFixture };
  };
  pageFetch.supportsCapture = true;
  const snapshot = await collectStation({ id: "station-page-endpoint", name: "Page endpoint", baseUrl: "https://relay.example", mode: "page", adapter: { endpoint: "/pricing", method: "GET", responseFormat: "auto" } }, { pageFetch });
  assert.equal(requests.length, 2);
  assert.equal(snapshot.normalized.data[0].model_name, "gpt-4o");
});

test("collects CodeGo pricing catalog from its pricing page URL", async () => {
  const station = { id: "station-codego", name: "CodeGo", baseUrl: "https://codegoai.com/pricing" };
  const adapter = inferStationAdapter(station);
  let requestUrl;
  const snapshot = await collectStation({ ...station, adapter }, {
    fetchImpl: async url => {
      requestUrl = url;
      return response({
        success: true,
        pricing_version: "1",
        auto_groups: [],
        group_ratio: { default: 0.5 },
        usable_group: { default: "Default" },
        data: [{ model_name: "gpt-6-sol", model_ratio: 9, completion_ratio: 9, enable_groups: ["default"] }],
        available_models: ["gpt-6-sol", "gemini-3.6-flash", "image-per-request"],
        priced_model_details: [
          { model_name: "GPT-6-SOL", model_ratio: 1.5, completion_ratio: 5, cache_ratio: 0.1, create_cache_ratio: 1.25, enable_groups: [] },
          { model_name: "gemini-3.6-flash", model_ratio: 0.375, completion_ratio: 5, cache_ratio: 0.2, billing_mode: "tiered_expr", billing_expr: 'len <= 200000 ? tier("standard", p * 0.75 + c * 3.75 + cr * 0.075) : tier("long_context", p * 1.5 + c * 7.5 + cr * 0.15)', enable_groups: [] },
          { model_name: "image-per-request", model_ratio: 0, completion_ratio: 1, quota_type: 1, model_price: 0.04, enable_groups: [] },
          { model_name: "not-available", model_ratio: 1, completion_ratio: 1, enable_groups: [] }
        ]
      });
    }
  });
  const sol = snapshot.normalized.data.find(model => model.model_name === "GPT-6-SOL");
  const gemini = snapshot.normalized.data.find(model => model.model_name === "gemini-3.6-flash" && model.tier_name === "standard");
  const requestModel = snapshot.normalized.data.find(model => model.model_name === "image-per-request");
  assert.equal(adapter.endpoint, "/api/pricing");
  assert.equal(requestUrl, "https://codegoai.com/api/pricing");
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.sourceFormat, "new-api-pricing");
  assert.equal(snapshot.normalized.data.length, 4);
  assert.equal(sol.input_price, 3);
  assert.equal(sol.output_price, 15);
  assert.ok(Math.abs(sol.cache_read_price - 0.3) < 1e-9);
  assert.equal(sol.cache_write_price, 3.75);
  assert.deepEqual(sol.enable_groups, ["default"]);
  assert.equal(sol.group_ratio, 1);
  assert.equal(gemini.input_price, 0.75);
  assert.equal(gemini.output_price, 3.75);
  assert.ok(Math.abs(gemini.cache_read_price - 0.075) < 1e-9);
  assert.equal(gemini.group_ratio, 1);
  assert.deepEqual(gemini.enable_groups, []);
  assert.equal(requestModel.input_price, null);
  assert.equal(requestModel.output_price, null);
  assert.equal(requestModel.cache_read_price, null);
  assert.equal(requestModel.request_price, 0.04);
});


test("collects SoleAPI prices from its public API", async () => {
  const station = { id: "station-soleapi", name: "SoleAPI", baseUrl: "https://soleapi.com/zh/models", auth: { type: "bearer", token: "must-not-be-sent" }, adapter: { endpoint: "/api/zh/models", method: "POST" } };
  const adapter = inferStationAdapter(station, { enabled: true, endpoint: "/api/pricing", responseFormat: "pqh" });
  assert.equal(adapter.mode, "direct");
  assert.equal(adapter.endpoint, "/api/public/models");
  assert.equal(adapter.method, "GET");
  assert.equal(adapter.responseFormat, "auto");
  const requests = [];
  const snapshot = await collectStation({ ...station, mode: adapter.mode, adapter }, {
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return response({ data: { list: [
        {
          canonicalName: "MiniMax-M3",
          displayName: "MiniMax M3",
          priceCurrency: "cny",
          channels: [{ name: "MiniMax Official", multiplier: 0.6 }],
          charges: {
            prompt: { unit: "per_M_tokens", price: "4.2" },
            completion: { unit: "per_M_tokens", price: "16.8" },
            cache_read: { unit: "per_M_tokens", price: "0.84" },
            cache_write_5m: { unit: "per_M_tokens", price: "18.75" },
            cache_write_1h: { unit: "per_M_tokens", price: "20" }
          }
        },
        {
          canonicalName: "image-model",
          displayName: "Image Model",
          priceCurrency: "usd",
          channels: [{ name: "Official Grok", multiplier: 0.4 }],
          charges: {
            request: { unit: "per_k_calls", price: "10" },
            image_output: { unit: "per_image", price: "1" }
          }
        }
      ] } });
    }
  });
  const model = snapshot.normalized.data.find(item => item.model_name === "MiniMax-M3");
  const imageModel = snapshot.normalized.data.find(item => item.model_name === "image-model");
  assert.deepEqual(requests.map(request => request.url), ["https://soleapi.com/api/public/models"]);
  assert.equal(requests[0].init.headers.Authorization, undefined);
  assert.equal(requests[0].init.credentials, "omit");
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.sourceFormat, "soleapi-public-api");
  assert.equal(model.model_display_name, "MiniMax M3");
  assert.equal(model.input_price, 2.52);
  assert.equal(model.output_price, 10.08);
  assert.equal(model.cache_read_price, 0.504);
  assert.equal(model.cache_write_price, 11.25);
  assert.equal(model.cache_write_1h_price, 12);
  assert.equal(model.price_currency, "CNY");
  assert.equal(model.proxy_group_name, "MiniMax Official");
  assert.equal(getProxyPrices(model, 1, 1.2).input, 2.52);
  assert.equal(imageModel.request_price, 0.004);
  assert.equal(imageModel.image_price, 0.4);
  assert.equal(getProxyPrices(imageModel, 1, 1.2).request, 0.0048);
});

test("forces known public pricing sites to credential-free direct API collection", async () => {
  for (const [name, baseUrl] of [
    ["NoMiss", "https://nomissapi.com/v1/models"],
    ["Yorhamc", "https://yorhamc.com/pricing"],
    ["T蜜", "https://token123.cfd"]
  ]) {
    const station = {
      id: name, name, baseUrl, mode: "page",
      auth: { type: "bearer", token: "must-not-be-sent" },
      adapter: { endpoint: "/wrong", method: "POST", responseFormat: "pqh" }
    };
    const adapter = inferStationAdapter(station);
    assert.equal(adapter.mode, "direct", name);
    assert.equal(adapter.endpoint, "/api/pricing", name);
    assert.equal(adapter.method, "GET", name);
    assert.equal(adapter.responseFormat, "auto", name);
    let request;
    const snapshot = await collectStation({ ...station, ...adapter }, {
      fetchImpl: async (url, init) => {
        request = { url, init };
        return response({ data: [{ model_name: "gpt-4o", input_price: 1, output_price: 2, price_currency: "CNY" }] });
      }
    });
    assert.equal(request.url, `${new URL(baseUrl).origin}/api/pricing`, name);
    assert.equal(request.init.headers.Authorization, undefined, name);
    assert.equal(request.init.credentials, "omit", name);
    assert.equal(snapshot.status, "success", name);
  }
});

test("adds the missing FastAIToken station once for an existing registry", () => {
  const current = [{ id: "one", baseUrl: "https://soleapi.com" }];
  const stations = addFastAiStationPreset(current);
  assert.equal(stations.length, 2);
  assert.equal(stations[0], current[0]);
  assert.equal(stations[1].baseUrl, "https://www.fastaitoken.com/available-channels");
  assert.equal(stations[1].enabled, true);
  assert.equal(addFastAiStationPreset(stations), stations);
  const collision = addFastAiStationPreset([{ id: "fastaitoken", baseUrl: "https://other.example" }]);
  assert.equal(collision[1].id, "fastaitoken-2");
  assert.equal(addFastAiStationPreset([]).length, 0);
});

test("adds the missing NexaVlinks station once for an existing registry", () => {
  const current = [{ id: "one", baseUrl: "https://soleapi.com" }];
  const stations = addNexaStationPreset(current);
  assert.equal(stations.length, 2);
  assert.equal(stations[0], current[0]);
  assert.equal(stations[1].baseUrl, "https://www.nexavlinks.com/modelsmarket");
  assert.equal(stations[1].mode, "page");
  assert.equal(stations[1].adapter.endpoint, "/api/v1/channels/catalog?available_only=true&timezone=Asia%2FShanghai");
  assert.equal(addNexaStationPreset(stations), stations);
  assert.equal(addNexaStationPreset([]).length, 0);
  const collision = addNexaStationPreset([{ id: "nexavlinks", baseUrl: "https://other.example" }]);
  assert.equal(collision[1].id, "nexavlinks-2");
});

test("adds the missing CheapRouter station once for an existing registry", () => {
  const current = [{ id: "one", baseUrl: "https://soleapi.com" }];
  const stations = addCheapRouterStationPreset(current);
  assert.equal(stations.length, 2);
  assert.equal(stations[1].id, "cheaprouter");
  assert.equal(stations[1].baseUrl, "https://cheaprouter.cc/models");
  assert.equal(stations[1].mode, "page");
  assert.equal(stations[1].adapter.kind, "cheaprouter");
  assert.equal(stations[1].adapter.endpoint, "/api/v1/pricing/public?timezone=Asia%2FShanghai");
  assert.equal(addCheapRouterStationPreset(stations), stations);
  assert.equal(addCheapRouterStationPreset([]).length, 0);
});

test("adds a missing station preset in one transaction without rewriting saved stations", async () => {
  const previousIndexedDb = globalThis.indexedDB;
  const records = [{ id: "existing", baseUrl: "https://relay.example", auth: { type: "bearer", token: "keep-me" } }];
  const database = {
    close() {},
    transaction() {
      const transaction = { objectStore: () => ({
        getAll() {
          const request = {};
          queueMicrotask(() => { request.result = structuredClone(records); request.onsuccess?.(); });
          return request;
        },
        add(value) {
          const request = {};
          queueMicrotask(() => { records.push(structuredClone(value)); request.onsuccess?.(); });
          return request;
        }
      }) };
      setTimeout(() => transaction.oncomplete?.(), 0);
      return transaction;
    }
  };
  globalThis.indexedDB = { open() {
    const request = { result: database };
    queueMicrotask(() => request.onsuccess?.());
    return request;
  } };
  try {
    const addPreset = stations => {
      const next = addFastAiStationPreset(stations);
      return next === stations ? null : next.at(-1);
    };
    assert.equal(await addStationIfNeeded(addPreset), true);
    assert.equal(records.length, 2);
    assert.deepEqual(records[0], { id: "existing", baseUrl: "https://relay.example", auth: { type: "bearer", token: "keep-me" } });
    assert.equal(await addStationIfNeeded(addPreset), false);
    assert.equal(records.length, 2);
  } finally {
    if (previousIndexedDb === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previousIndexedDb;
  }
});

test("collects FastAIToken channel prices through the logged-in page", async () => {
  const station = {
    id: "station-fastai",
    name: "FastAIToken",
    baseUrl: "https://www.fastaitoken.com/available-channels",
    mode: "direct",
    adapter: { endpoint: "/api/ai/pricing", method: "GET", responseFormat: "pqh" }
  };
  const adapter = inferStationAdapter(station);
  assert.equal(prepareStationInput({ baseUrl: "https://fastaitoken.com" }).baseUrl, "https://www.fastaitoken.com/available-channels");
  assert.equal(adapter.mode, "page");
  assert.equal(adapter.endpoint, "/api/v1/channels/available");
  assert.equal(adapter.method, "GET");
  const requests = [];
  const pageFetch = async request => {
    if (request.capture) return { ok: false, status: 404, body: { data: [] } };
    requests.push(request);
    return {
      ok: true,
      status: 200,
      body: { data: [{ name: "FastAI", platforms: [{
        platform: "OpenAI",
        groups: [{ id: 1, name: "default", rate_multiplier: 2, image_rate_independent: true, image_rate_multiplier: 0.4 }],
        supported_models: [{
          model_id: "gpt-4.1",
          name: "GPT-4.1",
          pricing: { input_price: 0.000001, output_price: 0.000004, currency: "USD" },
          group_pricing: { "1": {
            input_price: 0.000003,
            output_price: 0.000009,
            cache_read_price: 0.0000005,
            cache_write_price: 0.0000002,
            cache_write_1h_price: 0.000001,
            intervals: [
              { min_tokens: 0, max_tokens: 128000, input_price: 0.000004, output_price: 0.00001 },
              { min_tokens: 128000, input_price: 0.000008, output_price: 0.00002, cache_read_multiplier: 2, cache_write_multiplier: 2 }
            ]
          } }
        }, {
          model_id: "dall-e-3",
          pricing: { billing_mode: "image", per_request_price: 0.02, currency: "USD" }
        }]
      }] }] }
    };
  };
  pageFetch.supportsCapture = true;
  const snapshot = await collectStation(station, { pageFetch });
  const models = snapshot.normalized.data;
  const shortContext = models.find(item => item.tier_name === "<=128K");
  const longContext = models.find(item => item.tier_name === ">128K");
  const imageModel = models.find(item => item.model_name === "dall-e-3");
  assert.equal(requests[0].url, "https://www.fastaitoken.com/api/v1/channels/available");
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.sourceFormat, "fastaitoken");
  assert.equal(models.length, 3);
  assert.equal(shortContext.model_name, "gpt-4.1");
  assert.equal(shortContext.input_price, 8);
  assert.equal(shortContext.output_price, 20);
  assert.equal(shortContext.cache_read_price, 1);
  assert.ok(Math.abs(shortContext.cache_write_price - 0.4) < 1e-9);
  assert.equal(shortContext.cache_write_1h_price, 2);
  assert.equal(longContext.input_price, 16);
  assert.equal(longContext.output_price, 40);
  assert.equal(longContext.cache_read_price, 2);
  assert.ok(Math.abs(longContext.cache_write_price - 0.8) < 1e-9);
  assert.equal(longContext.cache_write_1h_price, 4);
  assert.equal(longContext.group_ratio, 1);
  assert.ok(Math.abs(imageModel.request_price - 0.008) < 1e-9);
  assert.equal(getProxyPrices(shortContext, 1, 1.2).input, 9.6);
  const capturedPageFetch = async request => {
    assert.equal(request.capture, true);
    return { ok: true, status: 200, body: { data: [{ name: "FastAI", platforms: [{
      platform: "OpenAI",
      groups: [{ id: 1, name: "default", rate_multiplier: 2 }],
      supported_models: [{ model_id: "gpt-4.1", group_pricing: { "1": { input_price: 0.000001, output_price: 0.000002 } } }]
    }] }] } };
  };
  capturedPageFetch.supportsCapture = true;
  const capturedSnapshot = await collectStation(station, { pageFetch: capturedPageFetch });
  assert.equal(capturedSnapshot.normalized.data[0].input_price, 2);
});
test("collects CheapRouter prices from the authenticated model page", async () => {
  const station = { id: "station-cheaprouter", name: "CheapRouter", baseUrl: "https://cheaprouter.cc/models" };
  const adapter = inferStationAdapter(station);
  assert.equal(adapter.mode, "page");
  assert.equal(adapter.endpoint, "/api/v1/pricing/public?timezone=Asia%2FShanghai");
  assert.equal(adapter.method, "GET");
  const prepared = prepareStationInput({ baseUrl: "https://cheaprouter.cc/models?tab=all" });
  assert.equal(prepared.baseUrl, "https://cheaprouter.cc/models");
  assert.equal(prepared.mode, "page");
  assert.equal(prepared.adapter.kind, "cheaprouter");
  const requests = [];
  const pageFetch = async request => {
    if (request.capture) return { ok: false, status: 404, body: { data: [] } };
    requests.push(request);
    return response({
      code: 0,
      data: {
        items: [{
          model: "gpt-4o",
          display_name: "gpt-4o",
          group: { name: "GPT满血稳定分组" },
          effective_pricing_usd: {
            input_per_mtok_usd: 0.18,
            output_per_mtok_usd: 1.08,
            cache_read_per_mtok_usd: 0.018,
            cache_write_per_mtok_usd: 0.225,
            per_request_usd: null,
            per_image_usd: null
          }
        }]
      }
    });
  };
  pageFetch.supportsCapture = true;
  const snapshot = await collectStation({ ...station, mode: "page", adapter }, { pageFetch });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://cheaprouter.cc/api/v1/pricing/public?timezone=Asia%2FShanghai");
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.data[0].model_name, "gpt-4o");
  assert.equal(snapshot.normalized.data[0].input_price, 0.18);
  assert.equal(snapshot.normalized.data[0].output_price, 1.08);
  assert.equal(snapshot.normalized.data[0].price_currency, "USD");
});

test("collects NexaVlinks token and request prices through the logged-in page", async () => {
  const station = { id: "station-nexa", name: "NexaVlinks", baseUrl: "https://www.nexavlinks.com/modelsmarket" };
  const adapter = inferStationAdapter(station);
  assert.equal(adapter.mode, "page");
  assert.equal(adapter.authType, "none");
  assert.equal(adapter.endpoint, "/api/v1/channels/catalog?available_only=true&timezone=Asia%2FShanghai");
  assert.equal(adapter.method, "GET");
  const prepared = prepareStationInput({ baseUrl: "https://nexavlinks.com" });
  assert.equal(prepared.baseUrl, "https://nexavlinks.com/modelsmarket");
  assert.equal(prepared.mode, "page");
  const requests = [];
  const pageFetch = async request => {
    if (request.capture) return { ok: false, status: 404, body: { data: [] } };
    requests.push(request);
    return response({ code: 0, data: [{ name: "Standard", platforms: [{
      platform: "openai",
      groups: [{ id: 19, name: "Stable", rate_multiplier: 0.3 }],
      supported_models: [
        { name: "gpt-5.4", platform: "openai", pricing: { billing_mode: "token", input_price: 0.0000025, output_price: 0.000015 } },
        { name: "image-request", platform: "openai", mode: "image_generation", pricing: { billing_mode: "per_request", per_request_price: 0.07 } }
      ]
    }] }] });
  };
  pageFetch.supportsCapture = true;
  const snapshot = await collectStation({ ...station, adapter }, { pageFetch });
  assert.equal(requests[0].url, "https://www.nexavlinks.com/api/v1/channels/catalog?available_only=true&timezone=Asia%2FShanghai");
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.sourceFormat, "fastaitoken");
  assert.equal(snapshot.normalized.data.length, 2);
  const tokenModel = snapshot.normalized.data.find(model => model.model_name === "gpt-5.4");
  const imageModel = snapshot.normalized.data.find(model => model.model_name === "image-request");
  assert.equal(tokenModel.input_price, 0.75);
  assert.equal(tokenModel.output_price, 4.5);
  assert.equal(imageModel.request_price, 0.021);
});

test("auto format uses the existing PQH strategy", () => {
  const normalized = normalizePricingPayload(pqhFixture, "auto", { basePricePerMillion: 0.55 });
  assert.equal(normalized.sourceFormat, "pqh");
  assert.equal(normalized.data[0].input_price, 1.32);
  assert.equal(normalized.data[0].output_price, 3.96);
});
test("honors a zero configured base price", () => {
  const normalized = normalizePricingPayload(pqhFixture, "auto", { basePricePerMillion: 0 });
  assert.equal(normalized.data[0].input_price, 0);
  assert.equal(normalized.data[0].output_price, 0);
});


test("collects a direct station and normalizes its payload", async () => {
  const snapshot = await collectStation({ id: "station-a", name: "A", baseUrl: "https://relay.example", adapter: { endpoint: "/pricing", method: "GET", responseFormat: "auto" } }, {
    fetchImpl: async () => response(pqhFixture)
  });
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.data[0].model_name, "gpt-4o");
  assert.equal(snapshot.normalizationVersion, NORMALIZATION_VERSION);
});

test("probes a public model-list URL without credentials", async () => {
  let request;
  const snapshot = await collectStation({ id: "station-models", name: "Models", baseUrl: "https://relay.example/v1/models", adapter: { endpoint: "/v1/models", method: "GET", responseFormat: "auto" } }, {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response({ data: [{ id: "gpt-4o", name: "GPT-4o" }] });
    }
  });
  assert.equal(request.url, "https://relay.example/v1/models");
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(snapshot.normalized.data[0].model_name, "gpt-4o");
});

test("collects New API pricing from a pricing page URL", async () => {
  const requests = [];
  const snapshot = await collectStation({
    id: "station-new-api",
    name: "New API",
    baseUrl: "https://relay.example",
    adapter: { endpoint: "/api/ai/pricing", method: "GET", responseFormat: "auto" }
  }, {
    fetchImpl: async url => {
      requests.push(url);
      return url.endsWith("/api/pricing")
        ? response({
          success: true,
          pricing_version: "1",
          auto_groups: ["default", "Gemini"],
          group_ratio: { default: 0.18, Gemini: 0.15 },
          usable_group: ["default"],
          data: [
            { model_name: "gemini-3.6-flash-tiered", model_ratio: 37.5, completion_ratio: 4, cache_ratio: 0.2, enable_groups: ["Gemini"], billing_mode: "tiered_expr", billing_expr: 'len <= 200000 ? tier("standard", p * 0.75 + c * 3.75 + cr * 0.075) : tier("long_context", p * 1.5 + c * 7.5 + cr * 0.15)' },
            { model_name: "doubao-seed-2-1-pro", model_ratio: 3, completion_ratio: 5, cache_ratio: 0.2, enable_groups: ["default"] }
          ]
        })
        : { ok: false, status: 404, headers: { get: () => "text/html" }, text: async () => "<html></html>" };
    }
  });
  assert.deepEqual(requests.slice(0, 2), ["https://relay.example/api/ai/pricing", "https://relay.example/api/pricing"]);
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.rawMeta.url, "https://relay.example/api/pricing");
  assert.equal(snapshot.normalized.sourceFormat, "new-api-pricing");
  const tiered = snapshot.normalized.data.find(model => model.model_name === "gemini-3.6-flash-tiered" && model.tier_name === "standard");
  const flat = snapshot.normalized.data.find(model => model.model_name === "doubao-seed-2-1-pro");
  assert.ok(Math.abs(tiered.input_price - 0.1125) < 1e-12);
  assert.ok(Math.abs(tiered.output_price - 0.5625) < 1e-12);
  assert.ok(Math.abs(tiered.cache_read_price - 0.01125) < 1e-12);
  assert.equal(tiered.group_ratio, 0.15);
  assert.equal(flat.input_price, 1.08);
  assert.ok(Math.abs(flat.output_price - 5.4) < 1e-12);
});

test("normalizes Jiji model-market tRPC payloads", () => {
  const payload = [{ result: { data: { json: { providers: [{ name: "Anthropic", models: [{ model_id: "claude-fable-5", price_currency: "USD", input_price: "10", output_price: "50", group_prices: [{ group_name: "Claude Code Max", input_price: "15", output_price: "75", cache_read_price: "1.5", multiplier: "1.5" }] }] }] } } } }];
  const normalized = normalizePricingPayload(payload);
  const [model] = normalized.data;
  assert.equal(normalized.sourceFormat, "jiji");
  assert.equal(model.model_name, "claude-fable-5");
  assert.equal(model.input_price, 15);
  assert.equal(model.output_price, 75);
  assert.equal(model.cache_read_price, 1.5);
  assert.equal(model.group_ratio, 1.5);
});

test("refreshes snapshots created before normalization changes", () => {
  const station = { baseUrl: "https://www.jiji.cc/extension/models", adapter: { kind: "jiji" } };
  assert.equal(snapshotNeedsRefresh(station, { normalizationVersion: NORMALIZATION_VERSION - 1 }), true);
  assert.equal(snapshotNeedsRefresh(station, { normalizationVersion: NORMALIZATION_VERSION }), false);
  assert.equal(snapshotNeedsRefresh({ baseUrl: "https://relay.example" }, { normalizationVersion: NORMALIZATION_VERSION - 1 }), true);
  assert.equal(snapshotNeedsRefresh({ baseUrl: "https://relay.example" }, { normalizationVersion: NORMALIZATION_VERSION }), false);
});

test("keeps Jiji model-plaza prices in CNY per-million units", () => {
  const normalized = normalizePricingPayload({ code: 0, data: { groups: [{ name: "Claude Code Max", rate_multiplier: 1.5, models: [{ name: "claude-fable-5", pricing: { input_price: "10", output_price: "50", cache_read_price: "1" } }] }] } });
  const [model] = normalized.data;
  assert.equal(normalized.sourceFormat, "jiji");
  assert.equal(model.input_price, 15);
  assert.equal(model.output_price, 75);
  assert.equal(model.cache_read_price, 1.5);
  assert.equal(model.price_currency, "CNY");
});

test("reads native fetch JSON bodies before normalizing", async () => {
  const payload = [{ result: { data: { json: { providers: [{ name: "OpenAI", models: [{ model_id: "gpt-6-luna", input_price: "0.1", output_price: "0.5", group_prices: [{ group_name: "Codex Luna", input_price: "0.02", output_price: "0.1", multiplier: "0.2" }] }] }] } } } }];
  const snapshot = await collectStation({ id: "station-jiji-native", name: "Jiji", baseUrl: "https://www.jiji.cc/extension/models?token=test-token", adapter: { endpoint: "/api/ai/pricing" } }, {
    fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.data[0].model_name, "gpt-6-luna");
});

test("adapts Jiji model page URLs to the authenticated model-market API", async () => {
  const jijiRootAdapter = inferStationAdapter({ baseUrl: "https://jiji.cc" });
  assert.equal(jijiRootAdapter.mode, "direct");
  assert.equal(jijiRootAdapter.endpoint, "/extension/api/trpc/extension.modelMarket");
  let request;
  const snapshot = await collectStation({ id: "station-jiji", name: "Jiji", baseUrl: "https://www.jiji.cc/extension/models?user_id=1&token=test-token", mode: "page", adapter: { endpoint: "/api/ai/pricing" } }, {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response([{ result: { data: { json: { providers: [{ name: "OpenAI", models: [{ model_id: "gpt-4o", input_price: "0.000005", output_price: "0.000015", group_prices: [{ name: "余额", multiplier: 1 }] }] }] } } } }]);
    }
  });
  const url = new URL(request.url);
  assert.equal(url.pathname, "/extension/api/trpc/extension.modelMarket");
  assert.equal(url.searchParams.get("batch"), "1");
  assert.equal(request.init.credentials, "omit");
  assert.equal(request.init.headers.Authorization, "Bearer test-token");
  assert.equal(request.init.headers["x-trpc-source"], "browser-client");
  assert.equal(snapshot.normalized.data[0].model_name, "gpt-4o");
});

test("suggests official candidates for unmatched proxy names and scopes confirmed mappings", () => {
  const official = [
    { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet", provider: "anthropic" },
    { id: "anthropic/claude-3.7-haiku", name: "Claude 3.7 Haiku", provider: "anthropic" },
    { id: "openai/gpt-4o", name: "GPT-4o", provider: "openai" }
  ];
  const suggestions = suggestModelCandidates("claude-3.7-sonnet-custom", official);
  assert.equal(suggestions[0].id, "anthropic/claude-3.7-sonnet");
  assert.ok(suggestions.length <= 40);

  const fuzzyOfficial = [{ id: "alpha", name: "alpha" }];
  const fuzzyCandidates = getJevModelCandidates("xalpha", fuzzyOfficial, [{ id: "fuzzy", enabled: true }]);
  assert.equal(fuzzyCandidates.directMatches[0].ruleId, "fuzzy");
  assert.deepEqual(fuzzyCandidates.candidates, fuzzyOfficial);

  const override = [{ stationId: "station-a", modelName: "relay-sonnet", officialModelId: "anthropic/claude-3.7-sonnet" }];
  assert.equal(matchModelWithOverrides("relay-sonnet", official, { stationId: "station-a", overrides: override })[0].ruleId, "manual");
  assert.equal(matchModelWithOverrides("relay-sonnet-expires-on-2026-12-31", official, { stationId: "station-a", overrides: override })[0].ruleId, "manual");
  assert.deepEqual(matchModelWithOverrides("relay-sonnet", official, { stationId: "station-b", overrides: override }), []);
});

test("indexed model matcher preserves rule priority, suffixes, versions, fuzzy matches, and override scope", () => {
  const official = [
    { id: "openai/gpt-4o", name: "openai/gpt-4o", aliases: ["gpt-4o"] },
    { id: "duplicate-gpt-4o", name: "gpt-4o" },
    { id: "anthropic/claude-3.7-sonnet", name: "anthropic/claude-3.7-sonnet", aliases: ["claude-3.7-sonnet"] },
    { id: "google/gemini-2.0-flash", name: "google/gemini-2.0-flash", aliases: ["gemini-2.0-flash"] }
  ];
  const overrides = [{ stationId: "station-a", modelName: "relay-sonnet", officialModelId: "anthropic/claude-3.7-sonnet" }];
  const index = buildModelMatchIndex(official, overrides);
  const rules = [
    { id: "exact", enabled: true },
    { id: "suffix", enabled: true },
    { id: "ignore_version", enabled: true },
    { id: "fuzzy", enabled: true }
  ];
  const cases = [
    ["gpt-4o", [["openai/gpt-4o", "exact"], ["duplicate-gpt-4o", "exact"]]],
    ["custom-claude-3.7-sonnet", [["anthropic/claude-3.7-sonnet", "suffix"]]],
    ["gemini-2.0-flash-20260220", [["google/gemini-2.0-flash", "ignore_version"]]],
    ["xclaude-3.7-sonnetx", [["anthropic/claude-3.7-sonnet", "fuzzy"]]]
  ];
  for (const [name, expected] of cases) {
    assert.deepEqual(matchModel(name, official, rules, index).map(({ match, ruleId }) => [match.id, ruleId]), expected);
  }
  assert.equal(matchModelWithOverrides("relay-sonnet", official, { stationId: "station-a", overrides, index })[0].ruleId, "manual");
  assert.deepEqual(matchModelWithOverrides("relay-sonnet", official, { stationId: "station-b", overrides, index }), []);
});

test("pagination keeps every quote reachable while bounding each page", () => {
  const rows = Array.from({ length: 205 }, (_, index) => index);
  const pages = [0, 1, 2].map(page => paginateRows(rows, page, 100));
  assert.deepEqual(pages.map(page => page.rows.length), [100, 100, 5]);
  assert.deepEqual(pages.flatMap(page => page.rows), rows);
  assert.equal(paginateRows(rows, 99, 100).page, 2);
  assert.deepEqual(paginateRows([], 0, 100), { page: 0, pageCount: 0, rows: [] });
});

test("reads the newest usable snapshot per station and keeps station reads indexed", async () => {
  const snapshot = (id, stationId, collectedAt) => ({ id, stationId, collectedAt, status: "success", normalized: { data: [] } });
  const records = [
    snapshot("orphan", "other", 50),
    snapshot("a-invalid", "a", 40),
    snapshot("b-z", "b", 35),
    snapshot("b-a", "b", 35),
    snapshot("a-z", "a", 30),
    snapshot("a-a", "a", 30),
    snapshot("a-old", "a", 10)
  ];
  await withSnapshotDb(records, async () => {
    const latest = await getLatestSnapshots(["a", "b"], item => item.id !== "a-invalid");
    assert.deepEqual(latest.map(item => item.id), ["b-a", "a-a"]);
    assert.deepEqual((await getSnapshots({ stationId: "a", limit: 1 })).map(item => item.id), ["a-invalid"]);
  });
});
test("brackets station saves with comparison invalidation", async () => {
  const revision = getComparisonRevision();
  await withSnapshotDb([], async () => {
    await putStations([{ id: "station-a", name: "A" }]);
    assert.equal(getComparisonRevision(), revision + 2);
  });
});

test("prunes old numeric and imported string timestamps without dropping fresh snapshots", async () => {
  const now = Date.now();
  const revision = getComparisonRevision();
  const snapshot = (id, collectedAt) => ({ id, stationId: "station-a", collectedAt, normalized: { data: [] } });
  const records = [
    snapshot("expired", now - 31 * 24 * 60 * 60 * 1000),
    snapshot("expired-string", String(now - 31 * 24 * 60 * 60 * 1000)),
    snapshot("fresh-string", String(now - 2 * 24 * 60 * 60 * 1000)),
    snapshot("fresh", now - 2 * 24 * 60 * 60 * 1000)
  ];
  await withSnapshotDb(records, async snapshots => {
    await putSnapshot(snapshot("saved", now));
    assert.equal(getComparisonRevision(), revision + 1);
    assert.deepEqual(new Set(snapshots.map(item => item.id)), new Set(["fresh-string", "fresh", "saved"]));
  });
});

test("applies only confirmed model overrides to comparison rows", () => {
  const official = [{ name: "openai/gpt-4o", provider: "openai", input: 5, output: 15 }];
  const [comparison] = buildComparisonRows({
    stations: [{ id: "station-a", name: "A", rechargeRate: 1, basePricePerMillion: 2 }],
    snapshots: [{ stationId: "station-a", collectedAt: 1, status: "success", normalized: { sourceFormat: "pqh", group_ratio: {}, data: [
      { model_name: "relay-model", model_display_name: "Relay model", input_price: 1, output_price: 2, price_currency: "CNY", evidence: "exact" }
    ] } }],
    references: { models: official, exchangeRate: 1 },
    modelMatchOverrides: [{ stationId: "station-a", modelName: "relay-model", officialModelId: "openai/gpt-4o" }],
    usage: { input: 1_000_000, output: 200_000 }
  });
  assert.equal(comparison.official.name, "openai/gpt-4o");
  assert.equal(comparison.offers[0].matchRuleId, "manual");
  assert.equal(comparison.offers[0].matchCandidateCount, 1);
});

test("forwards POST adapter bodies", async () => {
  let request;
  await collectStation({
    id: "station-post",
    name: "POST station",
    baseUrl: "https://relay.example",
    adapter: { endpoint: "/pricing", method: "post", body: '{"model":"gpt-4o"}', responseFormat: "auto" }
  }, {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response(pqhFixture);
    }
  });
  assert.equal(request.url, "https://relay.example/pricing");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.body, '{"model":"gpt-4o"}');
  assert.equal(request.init.headers["Content-Type"], "application/json");
});


test("keeps extension credentials out of the page bridge", async () => {
  let request;
  await collectStation({
    id: "station-page",
    name: "Page station",
    baseUrl: "https://relay.example",
    mode: "page",
    auth: { type: "bearer", token: "secret" },
    adapter: { endpoint: "/pricing", method: "GET", responseFormat: "auto" }
  }, {
    pageFetch: async value => {
      request = value;
      return response(pqhFixture);
    }
  });
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(request.headers["X-API-Key"], undefined);
});
test("uses FastAIToken page auth only for its channel API without returning the token", async () => {
  const listeners = new Map();
  const posted = [];
  const token = "page-session-token";
  let request;
  const payload = { data: [{ name: "channel", platforms: [{ platform: "OpenAI", groups: [], supported_models: [] }] }] };
  const origin = "https://www.fastaitoken.com";
  const pageWindow = {
    location: { href: `${origin}/available-channels`, origin },
    history: { pushState() {}, replaceState() {} },
    localStorage: { getItem(key) { assert.equal(key, "auth_token"); return token; } },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener() {},
    postMessage(message) { posted.push(message); },
    fetch: async (url, init) => {
      request = { url, init };
      return {
        ok: true, status: 200, headers: { get: () => "application/json" },
        json: async () => payload,
        clone: () => ({ json: async () => payload })
      };
    }
  };
  function MockXHR() {}
  MockXHR.prototype.open = function() {};
  MockXHR.prototype.send = function() {};
  runInNewContext(readFileSync(new URL("../src/page-bridge.js", import.meta.url), "utf8"), { window: pageWindow, history: pageWindow.history, fetch: pageWindow.fetch, XMLHttpRequest: MockXHR, URL, Date, Math, JSON, Object, String, Number, Array, Set, RegExp, Error, Promise });
  await listeners.get("message")({
    source: pageWindow, origin,
    data: { type: "AI_RELAY_PAGE_BRIDGE_REQUEST", id: "fastai-1", request: { url: `${origin}/api/v1/channels/available`, method: "GET", headers: { Accept: "application/json" } } }
  });
  assert.equal(request.init.headers.Authorization, `Bearer ${token}`);
  assert.equal(request.init.headers["X-User-UI-Request"], "1");
  assert.equal(request.init.credentials, "include");
  assert.equal(JSON.stringify(posted).includes(token), false);
  request = null;
  await listeners.get("message")({
    source: pageWindow, origin,
    data: { type: "AI_RELAY_PAGE_BRIDGE_REQUEST", id: "fastai-2", request: { url: `${origin}/api/v1/user/profile`, method: "GET", headers: { Accept: "application/json" } } }
  });
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(request.init.headers["X-User-UI-Request"], undefined);
  assert.equal(JSON.stringify(posted).includes(token), false);
  request = null;
  pageWindow.localStorage.getItem = () => "";
  await listeners.get("message")({
    source: pageWindow, origin,
    data: { type: "AI_RELAY_PAGE_BRIDGE_REQUEST", id: "fastai-3", request: { url: `${origin}/api/v1/channels/available`, method: "GET", headers: { Accept: "application/json" } } }
  });
  assert.equal(request, null);
  assert.match(posted.at(-1).error, /未找到 FastAIToken 登录凭据/);
});
test("captures CheapRouter model prices from the logged-in DOM", async () => {
  const listeners = new Map();
  const posted = [];
  const origin = "https://cheaprouter.cc";
  const card = {
    id: "",
    dataset: {},
    textContent: "OpenAI Token GPT满血稳定分组 gpt-4o 输入 每百万 Tokens 官方价 $2 实付价 ¥3 输出 每百万 Tokens 官方价 $10 实付价 ¥15 缓存读取 每百万 Tokens 官方价 $0.2 实付价 ¥0.3",
    querySelector(selector) {
      if (selector === "h2,h3,h4") return { textContent: "gpt-4o" };
      return null;
    },
    querySelectorAll(selector) {
      if (selector === "span,div,p") return [{ children: [], textContent: "GPT满血稳定分组" }];
      return [];
    }
  };
  const pageWindow = {
    location: { href: `${origin}/models`, origin },
    history: { pushState() {}, replaceState() {} },
    document: { querySelectorAll: () => [card] },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener() {},
    postMessage(message) { posted.push(message); },
    fetch: async () => ({ clone: () => ({ json: async () => ({}) }) })
  };
  function MockXHR() {}
  MockXHR.prototype.open = function() {};
  MockXHR.prototype.send = function() {};
  runInNewContext(readFileSync(new URL("../src/page-bridge.js", import.meta.url), "utf8"), { window: pageWindow, document: pageWindow.document, history: pageWindow.history, fetch: pageWindow.fetch, XMLHttpRequest: MockXHR, URL, Date, Math, JSON, Object, String, Number, Array, Set, RegExp, Error, Promise });
  await listeners.get("message")({
    source: pageWindow,
    origin,
    data: { type: "AI_RELAY_PAGE_CAPTURE_REQUEST", id: "cheaprouter-1" }
  });
  const result = posted.at(-1).response;
  assert.equal(result.ok, true);
  assert.equal(result.body.sourceFormat, "cheaprouter-dom");
  assert.equal(result.body.data[0].model_name, "gpt-4o");
  assert.equal(result.body.data[0].input_price, 3);
  assert.equal(result.body.data[0].output_price, 15);
  assert.equal(result.body.data[0].price_currency, "CNY");
});


test("closes a temporary FastAIToken tab when page loading fails", async () => {
  const removed = [];
  const tabs = {
    query: async () => [],
    create: async () => ({ id: 42, status: "loading" }),
    get: async () => { throw new Error("tab lookup failed"); },
    remove: async tabId => removed.push(tabId),
    onUpdated: { addListener() {}, removeListener() {} },
    onRemoved: { addListener() {}, removeListener() {} }
  };
  await assert.rejects(findOrOpenPageTab(tabs, { baseUrl: "https://fastaitoken.com/available-channels" }), /tab lookup failed/);
  assert.deepEqual(removed, [42]);
});


test("matches official model and compares station offer", () => {
  const official = [{ name: "openai/gpt-4o", aliases: ["gpt-4o"], provider: "openai", input: 5, output: 15 }];
  assert.equal(matchOne("gpt-4o", official).match.name, "openai/gpt-4o");
  const [comparison] = buildComparisonRows({
    stations: [{ id: "station-a", name: "A", rechargeRate: 1, basePricePerMillion: 0.55 }],
    snapshots: [{ stationId: "station-a", collectedAt: 1, status: "success", normalized: { sourceFormat: "pqh", data: [{ model_name: "gpt-4o", model_display_name: "GPT-4o", input_price: 1, output_price: 2, price_currency: "USD", evidence: "exact" }], group_ratio: {} } }],
    references: { models: official, exchangeRate: 1 },
    usage: { input: 1_000_000, output: 200_000 }
  });
  assert.equal(comparison.offers[0].dailyCost, 1.4);
});

test("normalizes model settings and adapter suggestions", () => {
  const settings = normalizeSettings({
    refreshIntervalMinutes: 0,
    defaultCurrency: "EUR",
    llm: { enabled: true, apiKey: "secret", temperature: 2 },
    jev: { enabled: true, modelId: "custom-model-v2", endpoint: "https://jev.example/api/pricing", responseFormat: "pqh" }
  });
  assert.equal("refreshIntervalMinutes" in settings, false);
  assert.equal(settings.defaultCurrency, "CNY");
  assert.equal(settings.llm.temperature, 1);
  assert.equal("apiKey" in settings.llm, false);
  assert.equal(settings.jev.modelId, "custom-model-v2");
  assert.equal("apiKey" in settings.jev, false);
  assert.equal(normalizeSettings({ jev: { baseUrl: "http://relay.example" } }).jev.baseUrl, "");
  const inferred = inferStationAdapter({ baseUrl: "https://relay.example/sora", auth: { type: "bearer" } }, settings.jev);
  assert.equal(inferred.endpoint, "/api/pricing");
  const pricingPage = inferStationAdapter({ baseUrl: "https://relay.example/pricing" }, {});
  assert.equal(pricingPage.endpoint, "/api/pricing");
  assert.equal(inferred.responseFormat, "pqh");
  const modelList = inferStationAdapter({ baseUrl: "https://relay.example/v1/models", adapter: { endpoint: "/api/ai/pricing" } }, {});
  assert.equal(modelList.endpoint, "/v1/models");
  const suggestion = parseAdapterSuggestion('```json\n{"endpoint":"pricing","method":"post","confidence":120}\n```');
  assert.equal(suggestion.endpoint, "/pricing");
  assert.equal(suggestion.method, "POST");
  assert.equal(suggestion.confidence, 100);
});

test("normalizes provider profiles and active selection", () => {
  const settings = normalizeSettings({
    providerProfiles: {
      llm: [{ id: "openrouter", name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: "secret", temperature: 2 }],
      jev: [{ id: "jev-main", name: "Jev", baseUrl: "https://jev.example/v1/systemone" }]
    },
    activeProviders: { llm: "openrouter", jev: "jev-main" }
  });
  assert.equal(settings.activeProviders.llm, "openrouter");
  assert.equal(settings.providerProfiles.llm[0].temperature, 1);
  assert.equal(settings.providerProfiles.jev[0].baseUrl, "https://jev.example/v1/systemone");
  assert.equal("apiKey" in settings.providerProfiles.llm[0], false);
});

test("keeps zero pricing values and blocks insecure remote URLs", () => {
  const station = normalizeStation({ baseUrl: "https://relay.example", rechargeRate: 0, basePricePerMillion: 0 });
  assert.equal(station.rechargeRate, 0);
  assert.equal(station.basePricePerMillion, 0);
  assert.equal(isSecureRemoteUrl("https://relay.example"), true);
  assert.equal(isSecureRemoteUrl("http://localhost:3000"), true);
  assert.equal(isSecureRemoteUrl("http://relay.example"), false);
  assert.throws(() => normalizeStation({ baseUrl: "http://relay.example" }), /HTTPS/);
  assert.equal(normalizeSettings({ llm: { baseUrl: "http://relay.example" } }).llm.baseUrl, "");
});

test("current-site registration keeps only allowed HTTP origins", () => {
  assert.equal(currentSiteOrigin("https://user:secret@relay.example:8443/pricing?token=secret#section"), "https://relay.example:8443");
  assert.equal(currentSiteOrigin("http://localhost:3000/pricing"), "http://localhost:3000");
  assert.equal(currentSiteOrigin("http://relay.example/pricing"), "");
  assert.equal(currentSiteOrigin("javascript:alert(1)"), "");
  assert.equal(currentSiteOrigin("chrome://settings"), "");
});
test("opens a temporary FastAIToken tab when no site tab is available", async () => {
  const opened = [];
  const tabs = {
    query: async () => [],
    create: async options => {
      opened.push(options);
      return { id: 42, url: options.url, status: "complete" };
    },
    get: async tabId => ({ id: tabId, url: "https://www.fastaitoken.com/available-channels", status: "complete" }),
    onUpdated: { addListener() {}, removeListener() {} },
    onRemoved: { addListener() {}, removeListener() {} }
  };
  const result = await findOrOpenPageTab(tabs, { baseUrl: "https://www.fastaitoken.com/available-channels", mode: "page" });
  assert.equal(result.temporary, true);
  assert.equal(result.tab.id, 42);
  assert.deepEqual(opened, [{ url: "https://www.fastaitoken.com/available-channels", active: false }]);
});

test("opens a temporary NexaVlinks tab when no site tab is available", async () => {
  const opened = [];
  const tabs = {
    query: async () => [],
    create: async options => {
      opened.push(options);
      return { id: 43, url: options.url, status: "complete" };
    },
    get: async tabId => ({ id: tabId, url: "https://www.nexavlinks.com/modelsmarket", status: "complete" }),
    onUpdated: { addListener() {}, removeListener() {} },
    onRemoved: { addListener() {}, removeListener() {} }
  };
  const result = await findOrOpenPageTab(tabs, { baseUrl: "https://www.nexavlinks.com/modelsmarket", mode: "page" });
  assert.equal(result.temporary, true);
  assert.equal(result.tab.id, 43);
  assert.deepEqual(opened, [{ url: "https://www.nexavlinks.com/modelsmarket", active: false }]);
});

test("reuses an existing matching FastAIToken tab", async () => {
  const tabs = {
    query: async () => [
      { id: 3, url: "https://www.fastaitoken.com/account" },
      { id: 4, url: "https://www.fastaitoken.com/available-channels" }
    ],
    create: async () => assert.fail("should reuse the exact page"),
    onUpdated: { addListener() {}, removeListener() {} },
    onRemoved: { addListener() {}, removeListener() {} }
  };
  const result = await findOrOpenPageTab(tabs, { baseUrl: "https://www.fastaitoken.com/available-channels", mode: "page" });
  assert.equal(result.tab.id, 4);
  assert.equal(result.temporary, false);
});



test("page discovery requires the initiating tab when origins are ambiguous", () => {
  const tabs = [
    { id: 4, url: "https://relay.example/account-a" },
    { id: 9, url: "https://relay.example/account-b" },
    { id: 11, url: "https://relay.example.evil/account" },
    { id: 12, url: "https://other.example/" }
  ];
  assert.equal(selectPageTab(tabs, "https://relay.example", 9), tabs[1]);
  assert.equal(selectPageTab(tabs, "https://relay.example", 20), null);
  assert.equal(selectPageTab(tabs, "https://relay.example", 20, "/account-b"), tabs[1]);
  assert.equal(selectPageTab([tabs[0]], "https://relay.example", 20), tabs[0]);
  assert.equal(selectPageTab(tabs, "https://relay.example", 11), null);
  assert.equal(selectPageTab(tabs, "https://relay.example"), null);
  assert.equal(selectPageTab([tabs[0]], "https://relay.example"), tabs[0]);
});
test("installs bridge scripts when an existing page has no bridge", async () => {
  const injections = [];
  const results = [{ result: { current: false } }, { result: false }];
  const scripting = { executeScript: async script => { injections.push(script); return [script.func?.name?.startsWith("probe") ? results.shift() : {}]; } };
  assert.equal(await ensurePageBridge(scripting, 42), null);
  assert.deepEqual(injections.map(({ target, world, files }) => ({ target, world, files })), [
    { target: { tabId: 42 }, world: "MAIN", files: undefined },
    { target: { tabId: 42 }, world: "MAIN", files: ["src/page-bridge.js"] },
    { target: { tabId: 42 }, world: "ISOLATED", files: undefined },
    { target: { tabId: 42 }, world: undefined, files: ["src/content-bridge.js"] }
  ]);
});

test("upgrades a legacy page bridge without adding another request proxy", async () => {
  const capture = { ok: true, status: 200, body: { data: [{ model_name: "gpt-4o" }] } };
  const injections = [];
  const results = [{ result: { legacy: true, capture } }, { result: true }];
  const scripting = { executeScript: async script => { injections.push(script); return [script.func?.name?.startsWith("probe") ? results.shift() : {}]; } };
  assert.equal(await ensurePageBridge(scripting, 42), capture);
  assert.deepEqual(injections.filter(script => script.files).map(({ target, world, files }) => ({ target, world, files })), [
    { target: { tabId: 42 }, world: "MAIN", files: ["src/page-bridge.js"] }
  ]);
  assert.equal(injections[1].world, "MAIN");
});

test("does not reinject an already installed bridge", async () => {
  const injections = [];
  const results = [{ result: { current: true } }, { result: true }];
  const scripting = { executeScript: async script => { injections.push(script); return [script.func?.name?.startsWith("probe") ? results.shift() : {}]; } };
  assert.equal(await ensurePageBridge(scripting, 42), null);
  assert.equal(injections.some(script => script.files), false);
});

test("rejects invalid page-mode price payloads", async () => {
  await assert.rejects(() => collectStation({
    id: "station-page-invalid",
    name: "Invalid page station",
    baseUrl: "https://relay.example",
    mode: "page",
    adapter: { endpoint: "/pricing", method: "GET", responseFormat: "auto" }
  }, { pageFetch: async () => ({ ok: true, status: 200, body: { data: [{ model_name: "x", input_price: -1 }] } }) }), /价格数据校验/);
});

test("redacts station credentials from portable state", () => {
  const redacted = redactStation({ id: "station-a", auth: { type: "basic", token: "secret", username: "user", password: "pass" } });
  assert.deepEqual(redacted.auth, { type: "basic" });
  assert.equal(redacted.id, "station-a");
});


test("builds bounded JEV choices and sends only comparison fields", () => {
  const candidates = [{ name: "openai/gpt-4o", display_name: "GPT-4o", provider: "openai", aliases: ["gpt-4o"] }];
  const matchTask = buildJevModelMatchTask("relay-gpt-4o", candidates);
  assert.equal(matchTask.questions.model_match.type, "choice");
  assert.ok(matchTask.questions.model_match.criteria["__no_match__"]);
  assert.ok(matchTask.questions.model_match.criteria["openai/gpt-4o"]);
  assert.equal(matchTask.state.proxy_model, "relay-gpt-4o");
  assert.equal(buildJevModelMatchTask("relay\nmodel", candidates).state.proxy_model, "relay model");

  const reviewTask = buildJevComparisonTask({
    stationId: "private-station-id", stationName: "Private station", modelName: "relay-gpt-4o",
    officialName: "openai/gpt-4o", groupName: "private group", groupRatio: 1.2, tierName: "night",
    prices: { input: 1, output: 2 }, officialPrices: { input: 5, output: 15 },
    diffPercent: -75, stale: false, evidence: "estimated", cacheReadEstimated: true,
    baseUrl: "https://private.example", rawMeta: { token: "station-secret" }
  });
  assert.equal(reviewTask.questions.comparison_review.type, "choice");
  assert.equal(reviewTask.state.comparison.price_gap_direction, "proxy_cheaper");
  assert.equal(buildJevComparisonTask({ modelName: "relay", officialName: "openai/model", diffPercent: null }).state.comparison.price_gap_direction, "unavailable");
  const serialized = JSON.stringify(reviewTask);
  assert.doesNotMatch(serialized, /private-station-id|private group|private\.example|station-secret/);
  assert.doesNotMatch(serialized, /"input":1|"output":2|"officialPrices"|-75/);
});


test("selects unique unresolved rows for batch JEV matching", () => {
  const targets = getJevModelBatchTargets([
    { stationId: "station-a", modelName: "relay-gpt-4o", matchRuleId: "fuzzy", matchCandidateCount: 1, matchConfidence: 0.75 },
    { stationId: "station-a", modelName: "relay-gpt-4o", matchRuleId: "fuzzy", matchCandidateCount: 1, matchConfidence: 0.75 },
    { stationId: "station-a", modelName: "[Provider] RELAY-GPT-4O-EXPIRES-ON-2026-10-07", matchRuleId: "fuzzy", matchCandidateCount: 1, matchConfidence: 0.75 },
    { stationId: "station-a", modelName: "gpt-4o", matchRuleId: "exact", matchCandidateCount: 1, matchConfidence: 1 },
    { stationId: "station-a", modelName: "duplicate-gpt", matchRuleId: "exact", matchCandidateCount: 2, matchConfidence: 1 },
    { stationId: "station-b", modelName: "gpt-4o", matchRuleId: "manual", matchCandidateCount: 1, matchConfidence: 1 },
    { stationId: "station-b", modelName: "relay-claude", matchRuleId: "unmatched", matchCandidateCount: 0, matchConfidence: 0 }
  ]);
  assert.deepEqual(targets.map(({ stationId, modelName }) => [stationId, modelName]), [["station-a", "relay-gpt-4o"], ["station-a", "duplicate-gpt"], ["station-b", "relay-claude"]]);
});

test("blocks batch JEV during worker and official-reference refreshes", () => {
  const dashboard = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../src/service-worker.js", import.meta.url), "utf8");
  assert.ok(worker.includes('refreshInProgress: !["complete", "error"].includes(progress.phase) || Boolean(refreshReferencesTask)'));
  assert.ok(worker.includes('references = await refreshOfficialReferences(forceReferences)'));
  assert.ok(worker.includes('await refreshOfficialReferences(true)'));
  assert.ok(worker.includes('const activeForced = refreshReferencesForced'));
  assert.ok(worker.includes("if (!force || activeForced) return result"));
  assert.ok(worker.includes("return refreshOfficialReferences(true)"));
  assert.ok(worker.includes("notifyReferencesRefresh(true)"));
  assert.ok(worker.includes("notifyReferencesRefresh(false)"));
  assert.ok(dashboard.includes('message?.type === "REFERENCES_REFRESHING"'));
  assert.ok(dashboard.includes("state.refreshInProgress = Boolean(data.refreshInProgress)"));
  assert.ok(dashboard.includes('state.refreshInProgress = progress.refreshInProgress ?? !["complete", "error"].includes(progress.phase)'));
  assert.ok(dashboard.includes('if (state.refreshInProgress || ["#refresh-all", "#fetch-references"]'));
  assert.ok(worker.includes("function assertModelMatchJevIdle()"));
  assert.equal(worker.match(/assertModelMatchJevIdle\(\);/g)?.length, 4);
  assert.ok(dashboard.includes('error.message === "数据刷新中，模型匹配核验已停止"'));
  assert.ok(dashboard.includes("interrupted = rows.length - index"));
});

test("requires a dedicated JEV profile and validates typed JEV Choice answers", async () => {
  const config = resolveJevTaskConfig({ jev: { baseUrl: "https://jev.example/v1/systemone", modelId: "jev-latest" } }, "jev-secret");
  assert.deepEqual(config, { baseUrl: "https://jev.example/v1/systemone", model: "jev-latest", apiKey: "jev-secret" });
  assert.throws(() => resolveJevTaskConfig({ llm: { baseUrl: "https://llm.example/v1", model: "gpt-4o" } }, "llm-secret"), /JEV/);
  assert.throws(() => resolveJevTaskConfig({ jev: { baseUrl: "https://jev.example/v1/systemone", modelId: "jev-latest" } }, ""), /JEV API Key/);

  const questions = { model_match: { type: "choice", instructions: "Choose a matching model.", criteria: { "openai/gpt-4o": "GPT-4o", __no_match__: "No candidate matches" } } };
  let requestDetails;
  const result = await requestJevChoices({
    ...config, state: { proxy_model: "relay-gpt-4o" }, questions,
    fetchImpl: async (url, init) => {
      requestDetails = { url, init };
      return response({ model: "jev-1.13.0", answers: { model_match: { type: "choice", choice: "openai/gpt-4o", confidence: 0.92, probabilities: { "openai/gpt-4o": 0.92, __no_match__: 0.08 } } } });
    }
  });
  assert.equal(requestDetails.url, "https://jev.example/v1/systemone");
  assert.equal(requestDetails.init.headers.Authorization, "Bearer jev-secret");
  assert.deepEqual(JSON.parse(requestDetails.init.body).questions, questions);
  assert.equal(result.answers.model_match.choice, "openai/gpt-4o");

  await assert.rejects(requestJevChoices({
    ...config, state: {}, questions,
    fetchImpl: async () => response({ answers: { model_match: { type: "choice", choice: "not-a-candidate", confidence: 0.99, probabilities: {} } } })
  }), /JEV.*choice/i);
});

test("does not fall back from an active JEV profile to a legacy key", () => {
  assert.equal(selectProviderApiKey("jev", "profile-a", "", "legacy-secret"), "");
  assert.equal(selectProviderApiKey("jev", "", "", "legacy-secret"), "legacy-secret");
  assert.equal(selectProviderApiKey("jev", "profile-a", "active-secret", "legacy-secret"), "active-secret");
  assert.equal(selectProviderApiKey("llm", "profile-a", "", "legacy-secret"), "legacy-secret");
});

test("stores provider keys separately by channel and profile", async () => {
  const values = {};
  const area = {
    async get(key) { return key ? { [key]: values[key] } : values; },
    async set(next) { Object.assign(values, next); },
    async remove(key) { delete values[key]; }
  };
  const chromeApi = { storage: { session: area } };
  await setProviderApiKey("llm", "openrouter", "llm-secret", chromeApi);
  await setProviderApiKey("jev", "jev-main", "jev-secret", chromeApi);
  assert.equal(await getProviderApiKey("llm", "openrouter", chromeApi), "llm-secret");
  assert.equal(await getProviderApiKey("jev", "jev-main", chromeApi), "jev-secret");
  assert.equal(await hasProviderApiKey("llm", "openrouter", chromeApi), true);
  assert.equal(await getProviderApiKey("llm", "jev-main", chromeApi), "");
});

test("persists provider keys in local storage and migrates session values", async () => {
  const localValues = {};
  const sessionValues = { "ai-price-analyzer:provider-api-keys": { llm: { legacy: "old-secret" } } };
  const area = values => ({
    async get(key) { return key ? { [key]: values[key] } : values; },
    async set(next) { Object.assign(values, next); },
    async remove(key) { delete values[key]; }
  });
  const chromeApi = { storage: { local: area(localValues), session: area(sessionValues) } };
  assert.equal(await getProviderApiKey("llm", "legacy", chromeApi), "old-secret");
  await setProviderApiKey("llm", "legacy", "new-secret", chromeApi);
  assert.deepEqual(localValues["ai-price-analyzer:provider-api-keys"], { llm: { legacy: "new-secret" } });
  assert.equal(sessionValues["ai-price-analyzer:provider-api-keys"], undefined);
});

test("discovers model catalogs and probes LLM/JEV endpoints", async () => {
  assert.deepEqual(parseModelCatalog({ data: [{ id: "gpt-4o" }, { id: "gpt-4o" }, { id: "disabled", enabled: false }] }).map(model => model.id), ["gpt-4o"]);
  assert.deepEqual(parseModelCatalog({ models: [{ id: "other" }, { id: "jev-pro", kind: "decision" }] }, "jev").map(model => model.id), ["jev-pro"]);

  let listingRequest;
  const listing = await fetchModelCatalog({
    baseUrl: "https://api.example/",
    apiKey: "secret",
    fetchImpl: async (url, init) => {
      listingRequest = { url, init };
      return { ok: true, status: 200, url, json: async () => ({ data: [{ id: "gpt-4o", name: "GPT-4o" }] }) };
    }
  });
  assert.equal(listingRequest.url, "https://api.example/v1/models");
  assert.equal(listingRequest.init.headers.Authorization, "Bearer secret");
  assert.equal(listing.models[0].name, "GPT-4o");

  let llmRequest;
  const llmResult = await testModelConnection({
    baseUrl: "https://api.example",
    apiKey: "secret",
    model: "gpt-4o",
    fetchImpl: async (url, init) => {
      llmRequest = { url, init };
      return { ok: true, status: 200, json: async () => ({ model: "gpt-4o", choices: [{ message: { content: "连接正常" } }] }) };
    }
  });
  assert.equal(llmRequest.url, "https://api.example/v1/chat/completions");
  assert.equal(JSON.parse(llmRequest.init.body).model, "gpt-4o");
  assert.equal(llmResult.model, "gpt-4o");

  let jevListingRequest;
  const jevListing = await fetchModelCatalog({
    baseUrl: "https://jev.example/v1/systemone",
    apiKey: "jev-secret",
    kind: "jev",
    fetchImpl: async (url, init) => {
      jevListingRequest = { url, init };
      return { ok: true, status: 200, url, json: async () => ({ data: [{ id: "jev-latest" }, { id: "gpt-4o" }] }) };
    }
  });
  assert.equal(jevListingRequest.url, "https://jev.example/v1/models");
  assert.deepEqual(jevListing.models.map(model => model.id), ["jev-latest"]);

  let jevRequest;
  await testModelConnection({
    baseUrl: "https://jev.example/v1/systemone",
    apiKey: "jev-secret",
    model: "jev-pro",
    kind: "jev",
    fetchImpl: async (url, init) => {
      jevRequest = { url, init };
      return { ok: true, status: 200, json: async () => ({ answers: { income_hype: { type: "noul", noul: 0.97 } } }) };
    }
  });
  assert.equal(jevRequest.url, "https://jev.example/v1/systemone");
  assert.equal(JSON.parse(jevRequest.init.body).questions.income_hype.type, "noul");
});

test("limits JEV actions to the extension UI", () => {
  assert.equal(isExtensionPageSender({ url: "chrome-extension://abc/dashboard.html" }, "chrome-extension://abc/"), true);
  assert.equal(isExtensionPageSender({ url: "https://relay.example/pricing" }, "chrome-extension://abc/"), false);
});

test("blocks JEV worker actions from station pages", async () => {
  const previousChrome = globalThis.chrome;
  let onMessage;
  globalThis.chrome = {
    runtime: {
      onMessage: { addListener(listener) { onMessage = listener; } },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      getURL: () => "chrome-extension://test-extension/"
    },
    alarms: { onAlarm: { addListener() {} } }
  };
  try {
    await import(`../src/service-worker.js?test=${Date.now()}`);
    for (const type of ["ANALYZE_JEV", "SAVE_JEV_MODEL_MATCH", "REMOVE_JEV_MODEL_MATCH"]) {
      const response = await new Promise(resolve => onMessage({ type }, { id: "test-extension", url: "https://relay.example/pricing" }, resolve));
      assert.deepEqual(response, { ok: false, error: "此 JEV 操作仅能从扩展面板发起" });
    }
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
});

test("keeps dashboard facet checkboxes at a compact fixed size", () => {
  const css = readFileSync(new URL("../styles/dashboard.css", import.meta.url), "utf8");
  const rule = css.match(/\.facet-option input\s*\{([^}]+)\}/)?.[1];
  const option = css.match(/\.facet-option\s*\{([^}]+)\}/)?.[1];
  assert.ok(option, "facet option sizing rule is missing");
  assert.match(option, /min-height:\s*24px/);

  assert.ok(rule, "facet checkbox sizing rule is missing");
  assert.match(rule, /flex:\s*0\s+0\s+16px/);
  assert.match(rule, /width:\s*16px/);
  assert.match(rule, /height:\s*16px/);
  assert.match(rule, /min-height:\s*16px/);
  assert.match(rule, /padding:\s*0/);
  const stationOptions = css.match(/\.station-filter-menu \.facet-options\s*\{([^}]+)\}/)?.[1];
  assert.ok(stationOptions, "station filter sizing rule is missing");
  assert.match(stationOptions, /max-height:\s*min\(420px,\s*45vh\)/);
});

test("keeps every section card collapsible behind the global toggles", () => {
  const read = name => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
  const baseCss = read("styles/base.css");
  assert.match(baseCss, /\[data-collapsed="true"\] > \*:not\(:first-child\) \{ display: none; \}/);

  let cardCount = 0;
  for (const page of ["dashboard.html", "options.html"]) {
    const html = read(page);
    assert.match(html, /id="expand-all"/, `${page} is missing the expand-all button`);
    assert.match(html, /id="collapse-all"/, `${page} is missing the collapse-all button`);
    const keys = new Set();
    for (const match of html.matchAll(/<[a-z-]+ [^>]*data-collapsible[^>]*>/g)) {
      cardCount += 1;
      const tag = match[0];
      const key = tag.match(/data-collapse-key="([^"]+)"/)?.[1] || tag.match(/id="([^"]+)"/)?.[1];
      assert.ok(key, `collapsible card in ${page} needs an id or data-collapse-key: ${tag}`);
      assert.ok(!keys.has(key), `duplicate collapse key ${key} in ${page}`);
      keys.add(key);
      assert.match(html.slice(match.index, match.index + 200), /class="(panel-heading|config-heading|toolbar-main|data-panel-copy)"/, `first child of ${key} must hold the collapse toggle`);
    }
  }
  assert.equal(cardCount, 7);
});

test("defaults provider filters to Anthropic, DeepSeek, OpenAI, and z-ai", () => {
  const source = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  assert.match(source, /const DEFAULT_PROVIDER_FILTER = \["anthropic", "deepseek", "openai", "z-ai"\]/);
  assert.equal((source.match(/provider: DEFAULT_PROVIDER_FILTER/g) || []).length, 2);
});

test("indexes dashboard search text and station lookups", () => {
  const row = {
    displayName: "Claude 3.7 Sonnet",
    modelName: "claude-3-7-sonnet",
    stationName: "Relay One",
    groupName: "Default",
    officialName: "anthropic/claude-3.7-sonnet",
    provider: "anthropic",
    stationId: "station-1"
  };
  const station = { id: "station-1", name: "Relay One", enabled: true };
  const index = createDashboardIndex([row], [station]);
  assert.equal(index.searchTextByRow.get(row), "claude 3.7 sonnet claude-3-7-sonnet relay one default anthropic/claude-3.7-sonnet anthropic");
  assert.equal(index.stationById.get("station-1"), station);
});

test("labels global section controls for icon-only mobile layout", () => {
  for (const page of ["dashboard.html", "options.html"]) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), "utf8");
    assert.match(html, /id="expand-all"[^>]*aria-label="展开全部卡片"/);
    assert.match(html, /id="collapse-all"[^>]*aria-label="折叠全部卡片"/);
  }
});

test("provides configurable dashboard pagination and back-to-top controls", () => {
  const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles/dashboard.css", import.meta.url), "utf8");
  assert.deepEqual([...html.matchAll(/<option value="(\d+)"/g)].map(([, value]) => Number(value)), [20, 50, 100, 200, 500]);
  assert.match(html, /<option value="20" selected>20<\/option>/);
  assert.match(source, /const PAGE_SIZE = 20;/);
  assert.match(css, /\.comparison-pagination\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(source, /paginateRows\(filtered, state\.page, Number\(\$\("#page-size"\)\.value\) \|\| PAGE_SIZE\)/);
  assert.match(source, /\$\("#page-size"\)\.addEventListener\("change"/);
  assert.match(html, /id="back-to-top"[^>]*aria-label="回到顶部"/);
  assert.match(html, /id="back-to-top"[^>]*>.*?data-icon="arrow-up"/);
  assert.match(icon("arrow-up"), /<path d="M12 19V5"\/>/);
  assert.match(source, /window\.addEventListener\("scroll"/);
  assert.match(source, /backToTop\.addEventListener\("click"/);
});

test("filters quotes by any entered model across all stations", () => {
  const rows = [
    { modelName: "claude-3-7-sonnet", displayName: "Claude 3.7 Sonnet", stationName: "Relay One", officialName: "anthropic/claude-3.7-sonnet", canonicalModel: "claude-3.7-sonnet" },
    { modelName: "gpt-4.1", displayName: "GPT-4.1", stationName: "Relay Two", officialName: "openai/gpt-4.1", canonicalModel: "gpt-4.1" }
  ];
  const index = createDashboardIndex(rows, []);
  assert.equal(matchesModelQueries(index.modelTextByRow.get(rows[0]), ["gpt-4.1", "claude-3.7"]), true);
  assert.equal(matchesModelQueries(index.modelTextByRow.get(rows[1]), ["claude-3.7"]), false);
  assert.equal(matchesModelQueries(index.modelTextByRow.get(rows[1]), ["  ", ""]), true);

  const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  assert.match(html, /id="model-filter-inputs"/);
  assert.match(dashboard, /state\.modelTextByRow = index\.modelTextByRow/);
  assert.match(dashboard, /data-model-filter/);
});
