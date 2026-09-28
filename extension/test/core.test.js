import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { parseOpenRouterData, parseOfficialExchangeRate } from "../src/core/openrouter.js";
import { collectStation } from "../src/core/collectors.js";
import { addRecommendationScores, buildComparisonRows, getProxyPrices, getTierShares, workloadCost } from "../src/core/pricing.js";
import { matchOne } from "../src/core/matching.js";
import { normalizePricingPayload } from "../src/core/collectors.js";
import { DEFAULT_DAILY_USAGE, currentSiteOrigin, isSecureRemoteUrl, normalizeSettings, normalizeStation, REFRESH_PRESETS, TOKENS_PER_MILLION, USAGE_PRESETS } from "../src/shared/schema.js";
import { NORMALIZATION_VERSION } from "../src/core/normalizers.js";
import { snapshotNeedsRefresh } from "../src/core/snapshot-policy.js";
import { selectPageTab } from "../src/core/page-tabs.js";
import { inferStationAdapter, parseAdapterSuggestion } from "../src/core/adapters.js";
import { redactStation } from "../src/shared/db.js";
import { getProviderApiKey, hasProviderApiKey, setProviderApiKey } from "../src/shared/credentials.js";
import { fetchModelCatalog, parseModelCatalog, testModelConnection } from "../src/core/model-api.js";

const pqhFixture = {
  pricing_version: 1,
  group_ratio: { "余额": 1.2 },
  data: [{ model_name: "gpt-4o", model_ratio: 2, completion_ratio: 3, enable_groups: ["余额"] }]
};

const response = body => ({
  ok: true,
  status: 200,
  headers: { get: () => "application/json" },
  json: async () => body
});

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
  assert.deepEqual(REFRESH_PRESETS.map(preset => preset.minutes), [5, 15, 30, 60]);
  assert.equal(USAGE_PRESETS.find(preset => preset.id === "legacy").usage.requests, 7900);
});

test("normalizes the official exchange-rate override", () => {
  assert.equal(normalizeSettings({ exchangeRate: 7.25 }).exchangeRate, 7.25);
  assert.equal(normalizeSettings({ exchangeRate: 0 }).exchangeRate, 7.3);
});

test("applies recharge ratio only to foreign-currency prices", () => {
  assert.equal(getProxyPrices({ input_price: 2, output_price: 3, price_currency: "USD" }, 1, 1.2).input, 2.4);
  assert.equal(getProxyPrices({ input_price: 2, output_price: 3, price_currency: "CNY" }, 1, 1.2).input, 2);
});

test("derives and preserves the station recharge ratio inputs", () => {
  const station = normalizeStation({ baseUrl: "https://relay.example", rechargeRmb: 12, rechargeCredits: 10 });
  assert.equal(station.rechargeRate, 1.2);
  assert.equal(station.rechargeRmb, 12);
  assert.equal(station.rechargeCredits, 10);
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

test("auto-discovers an API pricing route from a pricing page URL", async () => {
  const requests = [];
  const snapshot = await collectStation({
    id: "station-new-api",
    name: "New API",
    baseUrl: "https://relay.example/pricing",
    adapter: { endpoint: "/api/ai/pricing", method: "GET", responseFormat: "auto" }
  }, {
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return url.endsWith("/api/pricing")
        ? response({ data: [{ model_name: "gpt-4o", model_ratio: 2, completion_ratio: 3 }] })
        : { ok: false, status: 404, headers: { get: () => "text/html" }, text: async () => "<html></html>" };
    }
  });
  assert.equal(requests[0].url, "https://relay.example/api/pricing");
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.rawMeta.url, "https://relay.example/api/pricing");
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
  let request;
  const snapshot = await collectStation({ id: "station-jiji", name: "Jiji", baseUrl: "https://www.jiji.cc/extension/models?user_id=1&token=test-token", adapter: { endpoint: "/api/ai/pricing" } }, {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response([{ result: { data: { json: { providers: [{ name: "OpenAI", models: [{ model_id: "gpt-4o", input_price: "0.000005", output_price: "0.000015", group_prices: [{ name: "余额", multiplier: 1 }] }] }] } } } }]);
    }
  });
  const url = new URL(request.url);
  assert.equal(url.pathname, "/extension/api/trpc/extension.modelMarket");
  assert.equal(url.searchParams.get("batch"), "1");
  assert.equal(request.init.headers.Authorization, "Bearer test-token");
  assert.equal(request.init.headers["x-trpc-source"], "browser-client");
  assert.equal(snapshot.normalized.data[0].model_name, "gpt-4o");
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
    jev: { enabled: true, endpoint: "https://jev.example/api/pricing", responseFormat: "pqh" }
  });
  assert.equal(settings.refreshIntervalMinutes, 15);
  assert.equal(settings.defaultCurrency, "CNY");
  assert.equal(settings.llm.temperature, 1);
  assert.equal("apiKey" in settings.llm, false);
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

test("page discovery requires the initiating tab when origins are ambiguous", () => {
  const tabs = [
    { id: 4, url: "https://relay.example/account-a" },
    { id: 9, url: "https://relay.example/account-b" },
    { id: 11, url: "https://relay.example.evil/account" },
    { id: 12, url: "https://other.example/" }
  ];
  assert.equal(selectPageTab(tabs, "https://relay.example", 9), tabs[1]);
  assert.equal(selectPageTab(tabs, "https://relay.example", 20), null);
  assert.equal(selectPageTab(tabs, "https://relay.example", 11), null);
  assert.equal(selectPageTab(tabs, "https://relay.example"), null);
  assert.equal(selectPageTab([tabs[0]], "https://relay.example"), tabs[0]);
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
      return { ok: true, status: 200, json: async () => ({ answers: { income_hype: "yes" } }) };
    }
  });
  assert.equal(jevRequest.url, "https://jev.example/v1/systemone");
  assert.equal(JSON.parse(jevRequest.init.body).questions.income_hype.type, "noul");
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
});
