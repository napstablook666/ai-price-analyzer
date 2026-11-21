import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { formatRefreshSummary, icon } from "../src/shared/ui.js";
import assert from "node:assert/strict";
import { dropFloatingModels, fetchImageReferences, fetchReferences, parseOpenRouterData, parseOfficialExchangeRate } from "../src/core/openrouter.js";
import { collectStation as collectPreparedStation } from "../src/core/collectors.js";
import { ALL_IN_ONE_MODELS_ENDPOINT, CENTOS_PRICING_ENDPOINT, HEPINGAN_CHANNELS_ENDPOINT, WINDHUB_PRICING_ENDPOINT, PROVIDER_REGISTRY, prepareStationInput, providerById, providerForStation } from "../src/core/provider-registry.js";
import { AIAPI_EFFECTIVE_PRICE_FIELDS, AIAPI_GROUP_PRICE_FIELDS, AIAPI_PRICE_KEYS } from "../src/core/aiapi-contract.js";
import { buildStationRequest, resolveStationCollection } from "../src/core/request-strategy.js";
import { addRecommendationStatus, buildComparisonRows, currencyToRmb, filterComparisonsByMode, getProxyPriceQuote, getProxyPrices, summarizeComparisons, workloadCost } from "../src/core/pricing.js";
import { getPartialDiagnostics } from "../src/core/partial-diagnostics.js";
import { createDashboardIndex, matchesModelQueries, modeSwitchFilters, paginateRows, parsePageInput, rowBandClasses } from "../src/dashboard-index.js";
import { dashboardPriceLines, formatSourcePrice } from "../src/dashboard-pricing.js";
import { buildModelMatchIndex, matchModel, matchModelWithOverrides, matchOne } from "../src/core/matching.js";
import { canonicalKey, resolveCanonicalModel } from "../src/core/canonical.js";
import { normalizePricingPayload } from "../src/core/normalizers.js";
import { BOC_EXCHANGE_URL, OPENROUTER_IMAGES_URL, OPENROUTER_URL, convertRechargeAmount, DEFAULT_EXCHANGE_RATE, DEFAULT_MONTHLY_USAGE, currentSiteOrigin, isSecureRemoteUrl, normalizeSettings, normalizeStation, TOKENS_PER_MILLION, usagePresetId, usagePresetOptions, usagePresetUsage } from "../src/shared/schema.js";
import { fetchMagpieUsage, magpieSyncLabel, mergeGatewayUsage, monthlyUsageFromGateway, normalizeMagpieBaseUrl, normalizeMagpieSyncInterval, normalizeMagpieSyncState } from "../src/core/magpie-usage.js";
import { NORMALIZATION_VERSION, normalizeProxyData } from "../src/core/normalizers.js";
import { snapshotNeedsRefresh } from "../src/core/snapshot-policy.js";
import {
  CONTENT_BRIDGE_VERSION,
  CONTENT_PROBE_REQUEST_TYPE,
  CONTENT_PROBE_RESPONSE_TYPE,
  LEGACY_PAGE_WINDOW_CAPTURE_REQUEST_TYPE,
  LEGACY_PAGE_WINDOW_REQUEST_TYPE,
  LEGACY_PAGE_WINDOW_RESPONSE_TYPE,
  PAGE_BRIDGE_VERSION,
  PAGE_RUNTIME_CAPTURE_TYPE,
  PAGE_RUNTIME_FETCH_TYPE,
  PAGE_WINDOW_CAPTURE_REQUEST_TYPE,
  PAGE_WINDOW_REQUEST_TYPE,
  PAGE_WINDOW_RESPONSE_TYPE
} from "../src/core/bridge-protocol.js";
import { ensurePageBridge, findOrOpenPageTab, resetContentBridge, selectPageTab } from "../src/core/page-tabs.js";
import { inferStationAdapter } from "../src/core/adapters.js";
import { getComparisonRevision, getLatestSnapshots, getSnapshots, getStations, putSnapshot, putStations, redactStation } from "../src/shared/db.js";
import { addProviderStationPresets } from "../src/core/station-presets.js";
import { runWithConcurrency, withKeyedLock } from "../src/core/concurrency.js";
import { runRefreshAll } from "../src/core/refresh-scheduler.js";

import { loadSitePlugins } from "../src/site-plugins/loader.js";
import { SITE_PLUGIN_CATALOG } from "../src/site-plugins/catalog.js";

// Legacy collector fixtures exercise every adapter; production loading is tested separately.
await loadSitePlugins(SITE_PLUGIN_CATALOG.map(plugin => plugin.id));
const collectStationInput = (stationInput, options = {}) => {
  const collection = resolveStationCollection(stationInput);
  // 这组用例的 fetch 桩只认价格接口：默认不探 /api/status，要测探测就显式传 probeRecharge。
  return collectPreparedStation(collection.station, { probeRecharge: false, ...options, collection });
};

const pqhFixture = {
  pricing_version: 1,
  group_ratio: { "余额": 1.2 },
  data: [{ model_name: "gpt-4o", model_ratio: 2, completion_ratio: 3, enable_groups: ["余额"] }]
};

const cunFixture = {
  success: true,
  pricing_version: "1",
  group_ratio: { default: 1 },
  usable_group: { default: "Default" },
  data: [{ model_name: "gpt-4o", model_ratio: 2, completion_ratio: 3, enable_groups: ["default"] }]
};
const tokenFluxFixture = {
  success: true,
  pricing_version: "abc123",
  auto_groups: ["Codex号池"],
  group_ratio: {
    default: 1,
    "Gork": 0.5,
    "MIMO": 0.5,
    "Codex号池": 0.2,
    "Claude Code 特惠": 0.2,
    "绘图模型": 1,
    "[稳定]Codex号池": 0.2,
    "[特价]Codex号池": 0.2
  },
  usable_group: {
    default: "默认分组",
    Gork: "",
    Codex号池: ""
  },
  vendors: [
    { id: 1, name: "OpenAI", icon: "OpenAI.Color" },
    { id: 3, name: "DeepSeek", icon: "DeepSeek.Color" },
    { id: 19, name: "xAI", icon: "XAI" }
  ],
  supported_endpoint: {
    openai: { path: "/v1/chat/completions", method: "POST" },
    "image-generation": { path: "/v1/images/generations", method: "POST" }
  },
  data: [
    {
      model_name: "deepseek-v4-flash",
      description: "DeepSeek V4 Flash",
      vendor_id: 3,
      quota_type: 0,
      model_ratio: 0.07,
      model_price: 0,
      owner_by: "",
      completion_ratio: 2,
      cache_ratio: 0.07142857142857142,
      enable_groups: ["default"],
      supported_endpoint_types: ["openai"]
    },
    {
      model_name: "gpt-5.6-latitude",
      description: "GPT-5.6 Latitude with tiered pricing",
      vendor_id: 1,
      quota_type: 0,
      model_ratio: 2.5,
      model_price: 0,
      completion_ratio: 6,
      cache_ratio: 0.1,
      enable_groups: ["default", "Codex号池"],
      supported_endpoint_types: ["openai"],
      billing_mode: "tiered_expr",
      billing_expr: "len <= 272000 ? tier(\"standard\", p * 5 + c * 30 + cr * 0.5 + cc * 6.25) : tier(\"long_context\", p * 10 + c * 45 + cr * 1 + cc * 12.5)"
    },
    {
      model_name: "gpt-image-2.5",
      vendor_id: 1,
      quota_type: 1,
      model_ratio: 0,
      model_price: 0.1,
      owner_by: "",
      completion_ratio: 0,
      enable_groups: ["default", "绘图模型"],
      supported_endpoint_types: ["image-generation"]
    },
    {
      model_name: "wan2.7-i2v",
      vendor_id: 18,
      quota_type: 1,
      model_ratio: 0,
      model_price: 1,
      owner_by: "",
      completion_ratio: 0,
      enable_groups: ["default"],
      supported_endpoint_types: ["openai"],
      billing_usage_schema: {
        resolution: { enum: ["480P", "720P", "1080P"] },
        seconds: { type: "number", unit: "second" }
      }
    }
  ]
};

const centosFixture = {
  success: true,
  pricing_version: "centos-fixture",
  group_ratio: { default: 1, "ClaudeAWS企业分组": 4.5 },
  usable_group: { default: "默认分组", "ClaudeAWS企业分组": "ClaudeAWS企业分组" },
  supported_endpoint: {
    openai: { path: "/v1/chat/completions", method: "POST" },
    "image-generation": { path: "/v1/images/generations", method: "POST" }
  },
  data: [
    {
      model_name: "centos-token",
      quota_type: 0,
      model_ratio: 0.4,
      completion_ratio: 2,
      cache_ratio: 0.25,
      create_cache_ratio: 0.1,
      enable_groups: ["default"],
      supported_endpoint_types: ["openai"]
    },
    {
      model_name: "centos-enterprise",
      quota_type: 0,
      model_ratio: 1,
      completion_ratio: 3,
      cache_ratio: 0.5,
      enable_groups: ["ClaudeAWS企业分组"],
      supported_endpoint_types: ["openai"]
    },
    {
      model_name: "centos-request",
      quota_type: 1,
      model_price: 0.2,
      enable_groups: ["default"],
      supported_endpoint_types: ["openai"]
    },
    {
      model_name: "centos-image",
      quota_type: 1,
      model_price: 0.3,
      enable_groups: ["default"],
      supported_endpoint_types: ["image-generation"]
    },
    {
      model_name: "centos-tiered",
      quota_type: 0,
      model_ratio: 0.8,
      completion_ratio: 2,
      enable_groups: ["default"],
      billing_mode: "tiered_expr",
      billing_expr: "tier(\"standard\", p * 1 + c * 2)"
    },
    {
      model_name: "centos-tiered-bounded",
      quota_type: 0,
      model_ratio: 37.5,
      completion_ratio: 1,
      enable_groups: ["default"],
      billing_mode: "tiered_expr",
      billing_expr: "len <= 32768 ? tier(\"输入<=32k\", p * 4 + c * 18) : tier(\"32k<输入<=200k\", p * 6 + c * 22)"
    },
    {
      model_name: "centos-tiered-request",
      quota_type: 1,
      model_price: 0.08,
      enable_groups: ["default"],
      billing_mode: "tiered_expr",
      billing_expr: "tier(\"request\", fixed(0.08))"
    },
    {
      model_name: "centos-tiered-image",
      quota_type: 1,
      model_price: 0.014,
      enable_groups: ["default"],
      supported_endpoint_types: ["image-generation"],
      billing_mode: "tiered_expr",
      billing_expr: "tier(\"image\", fixed(0.014)) * image_count"
    },
    {
      model_name: "centos-tiered-night",
      quota_type: 0,
      model_ratio: 37.5,
      completion_ratio: 3,
      enable_groups: ["default"],
      billing_mode: "tiered_expr",
      billing_expr: "(tier(\"base\", p * 3 + c * 9)) * (hour(\"Asia/Shanghai\") >= 22 || hour(\"Asia/Shanghai\") < 8 ? 0.5 : 1)"
    }
  ]
};

const allInOneFixture = {
  code: 0,
  message: "ok",
  data: {
    list: [
      {
        model_id: "all-token-model",
        model_name: "all-token-model",
        display_name: "All Token Model",
        billing_mode: "token",
        input_price: 2,
        output_price: 8,
        cache_read_price: 0.2,
        cache_creation_price: 1
      },
      {
        model_id: "all-tiered-model",
        model_name: "all-tiered-model",
        display_name: "All Tiered Model",
        billing_mode: "tiered",
        pricing_tiers: [
          { tier_label: "0-100K", min_tokens: 0, max_tokens: 100000, input_price: 1, output_price: 4, cache_read_price: 0.1 },
          { tier_label: "100K+", min_tokens: 100001, max_tokens: null, input_price: 2, output_price: 6, cache_creation_price: 0.8 }
        ]
      },
      { model_id: "all-per-request", billing_mode: "per_request", per_request_price: 0.05 },
      { model_id: "all-missing", billing_mode: "token" },
      {
        model_id: "all-video-model",
        billing_mode: "special",
        category: "video",
        per_second_prices: { "480P": 0.3, "768P": 0.35 }
      }
    ]
  }
};

const response = body => ({
  ok: true,
  status: 200,
  headers: { get: () => "application/json" },
  json: async () => body
});

const aiApiFixture = {
  ok: true,
  data: {
    version: 2,
    source: "model_prices",
    provider: "configured",
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


const trueSotaFixture = {
  code: 0,
  message: "success",
  data: {
    groups: [{ id: 53, name: "GPT", platform: "openai", rate_multiplier: 1.5 }],
    models: [{ name: "gpt-5.4", platform: "openai", group_id: 53, input_price: 0.000002, output_price: 0.000008, cache_price: 0.0000002 }]
  }
};


const nodeAiFixture = {
  code: 0,
  message: "success",
  data: {
    groups: [
      {
        id: "image",
        name: "Image",
        rate_multiplier: 0.5,
        user_rate_multiplier: 0.8,
        image_rate_independent: true,
        image_rate_multiplier: 1.25,
        models: [{
          name: "node-image",
          pricing: {
            billing_mode: "image",
            input_price: 0.000001,
            image_output_price: 0.25,
            per_request_price: 2,
            intervals: []
          }
        }, {
          name: "node-image-generation",
          pricing: {
            billing_mode: "image_generation",
            image_output_price: 0.1,
            intervals: []
          }
        }]
      },
      {
        id: "text",
        name: "Text",
        rate_multiplier: 0.5,
        user_rate_multiplier: 1.5,
        models: [{
          name: "node-text",
          pricing: {
            billing_mode: "token",
            input_price: 0.000001,
            output_price: 0.000002,
            cache_read_price: 0.0000001,
            cache_write_price: 0.0000002,
            intervals: [
              { tier_label: "<200K", input_price: 0.000001, output_price: 0.000002, cache_read_price: 0.0000001 },
              { tier_label: ">=200K", input_price: 0.000002, output_price: 0.000004, cache_read_price: 0.0000002, cache_write_price: 0.0000004 }
            ],
            official_pricing: { input_price: 9, output_price: 9 }
          }
        }, {
          name: "node-request",
          pricing: {
            billing_mode: "request",
            per_request_price: 0.4,
            intervals: []
          }
        }]
      }
    ]
  }
};
const killAiFixture = {
  code: 0,
  message: "success",
  data: {
    description: "KillAI model plaza sample",
    groups: [
      {
        id: "text",
        name: "Text",
        platform: "openai",
        rate_multiplier: 1.5,
        long_context_pricing_enabled: true,
        models: [{
          name: "kill-text",
          pricing: {
            billing_mode: "token",
            input_price: 0.000002,
            output_price: 0.000008,
            intervals: [
              { tier_label: "standard", input_price: 0.000001, output_price: 0.000004, cache_read_price: 0.0000002 },
              { tier_label: "long", input_price: 0.000002, output_price: 0.000006, cache_read_price: 0.0000004 }
            ]
          }
        }]
      },
      {
        id: "image",
        name: "Image",
        platform: "openai",
        rate_multiplier: 2,
        models: [{
          name: "kill-image",
          pricing: {
            billing_mode: "image",
            image_input_price: 0.000003,
            image_output_price: 0.000004
          }
        }]
      },
      {
        id: "request",
        name: "Request",
        platform: "openai",
        rate_multiplier: 1.5,
        models: [{
          name: "kill-request",
          pricing: {
            billing_mode: "per_request",
            per_request_price: 0.2
          }
        }]
      }
    ]
  }
};



const killAiPricingFixture = {
  success: true,
  pricing_version: "5a90f2b86c08bd983a9a2e6d66c255f4eaef9c4bc934386d2b6ae84ef0ff1f1f",
  auto_groups: [],
  group_ratio: { "ChatGPT Pro": 0.16, "Claude随时失效": 0.2, DeepSeek: 0.14 },
  usable_group: { "ChatGPT Pro": "ChatGPT Pro", "Claude随时失效": "Claude随时失效", DeepSeek: "DeepSeek", default: "default" },
  vendors: [{ id: -1012, name: "OpenAI", icon: "OpenAI.Color" }],
  data: [{
    model_name: "gpt-6.1-terra",
    vendor_id: -1012,
    quota_type: 0,
    model_ratio: 37.5,
    model_price: 0,
    owner_by: "",
    completion_ratio: 2,
    enable_groups: ["ChatGPT Pro企业", "ChatGPT Pro企业定制", "ChatGPT Pro"],
    supported_endpoint_types: ["openai", "anthropic"],
    billing_mode: "tiered_expr",
    billing_expr: "(len <= 512000 ? tier(\"standard\", p * 1 + c * 5 + cr * 0.05 + cc * 1.25) : tier(\"long_context\", p * 2 + c * 7.5 + cr * 0.1 + cc * 2.5)) * ((param(\"service_tier\") == \"fast\" || param(\"service_tier\") == \"priority\") ? 2 : 1)",
    pricing_version: "5a90f2b86c08bd983a9a2e6d66c255f4eaef9c4bc934386d2b6ae84ef0ff1f1f"
  }]
};

const fuckEveryoneFixture = {
  code: 0,
  message: "success",
  data: {
    groups: [
      {
        name: "Text",
        rate_multiplier: 0.5,
        user_rate_multiplier: 1.5,
        models: [{ name: "text-model", pricing: { billing_mode: "token", input_price: 0.000001, output_price: 0.000002, cache_write_1h_price: 0.0000003, intervals: [] } }]
      },
      {
        name: "Image",
        rate_multiplier: 0.5,
        user_rate_multiplier: 2,
        image_rate_independent: true,
        image_rate_multiplier: 1.25,
        models: [{ name: "image-model", pricing: { billing_mode: "image", image_input_price: 0.000003, image_output_price: 0.04, intervals: [] } }]
      },
      {
        name: "Video",
        rate_multiplier: 0.5,
        user_rate_multiplier: 1,
        video_rate_independent: true,
        video_rate_multiplier: 1.2,
        models: [{ name: "video-model", pricing: { billing_mode: "per_request", per_request_price: 0.2, intervals: [] } }]
      }
    ]
  }
};

const fuckEveryoneScreenshotFixture = {
  code: 0,
  message: "success",
  data: {
    groups: [{
      name: "ccmax 高智商",
      rate_multiplier: 1,
      user_rate_multiplier: 1,
      models: [
        { name: "claude-fable-5", pricing: { billing_mode: "token", input_price: 0.00001, output_price: 0.00005, cache_read_price: 0.000001, cache_write_price: 0.0000125, cache_write_1h_price: 0.0000125, intervals: [] } },
        { name: "claude-fable-5.1", pricing: { billing_mode: "token", input_price: 0.00001, output_price: 0.00005, cache_read_price: 0.000001, cache_write_price: 0.0000125, cache_write_1h_price: 0.0000125, intervals: [] } }
      ]
    }]
  }
};
test("adds the all-in-one station preset idempotently and seeds an empty list", () => {
  const stations = addProviderStationPresets([{ id: "one", baseUrl: "https://soleapi.com" }], [providerById("all-in-one")]);
  assert.equal(stations.length, 2);
  assert.equal(stations[1].baseUrl, "https://all-in-one.icu/#/tenant/models");
  assert.equal(stations[1].mode, "page");
  assert.equal(stations[1].adapter.endpoint, ALL_IN_ONE_MODELS_ENDPOINT);
  assert.equal(stations[1].adapter.responseFormat, "all-in-one-models");
  assert.equal(addProviderStationPresets(stations, [providerById("all-in-one")]), stations);
  assert.equal(addProviderStationPresets([], [providerById("all-in-one")]).length, 1);
});

test("opens the all-in-one hash-route page when no site tab is available", async () => {
  const opened = [];
  const tabs = {
    query: async () => [],
    create: async options => {
      opened.push(options);
      return { id: 45, url: options.url, status: "complete" };
    },
    get: async tabId => ({ id: tabId, url: "https://all-in-one.icu/#/tenant/models", status: "complete" }),
    onUpdated: { addListener() {}, removeListener() {} },
    onRemoved: { addListener() {}, removeListener() {} }
  };
  const result = await findOrOpenPageTab(tabs, {
    baseUrl: "https://all-in-one.icu",
    mode: "page",
    adapter: { kind: "all-in-one-models", pageUrl: "https://all-in-one.icu/#/tenant/models" }
  });
  assert.equal(result.temporary, true);
  assert.deepEqual(opened, [{ url: "https://all-in-one.icu/#/tenant/models", active: false }]);
});

test("adds the missing AIAPI station once for an existing registry", () => {
  const current = [{ id: "one", baseUrl: "https://soleapi.com" }];
  const stations = addProviderStationPresets(current, [providerById("aiapi")]);
  assert.equal(stations.length, 2);
  assert.equal(stations[1].baseUrl, "https://cn.aiapi.bot/dashboard/model-prices");
  assert.equal(stations[1].mode, "page");
  assert.equal(stations[1].adapter.kind, "aiapi-model-catalog");
  assert.equal(stations[1].adapter.responseFormat, "aiapi-model-catalog");
  assert.equal(addProviderStationPresets(stations, [providerById("aiapi")]), stations);
  assert.equal(addProviderStationPresets([], [providerById("aiapi")]).length, 1);
});


test("adds and collects TrueSOTA public model pricing", async () => {
  const current = [{ id: "one", baseUrl: "https://soleapi.com" }];
  const stations = addProviderStationPresets(current, [providerById("true-sota")]);
  assert.equal(stations.length, 2);
  assert.equal(stations[1].baseUrl, "https://true-sota.com/model-pricing");
  assert.equal(stations[1].mode, "direct");
  assert.equal(stations[1].adapter.kind, "true-sota-model-pricing");
  assert.equal(addProviderStationPresets(stations, [providerById("true-sota")]), stations);
  assert.equal(addProviderStationPresets([], [providerById("true-sota")]).length, 1);

  const station = {
    id: "station-true-sota",
    name: "TrueSOTA",
    baseUrl: "https://true-sota.com/model-pricing",
    auth: { type: "bearer", token: "must-not-be-sent" },
    adapter: { endpoint: "/wrong", method: "POST", responseFormat: "pqh" }
  };
  const adapter = inferStationAdapter(station);
  assert.equal(adapter.mode, "direct");
  assert.equal(adapter.endpoint, "/api/v1/model-pricing");
  assert.equal(adapter.method, "GET");
  assert.equal(adapter.authType, "none");
  const prepared = prepareStationInput({ ...station, adapter });
  assert.equal(prepared.baseUrl, "https://true-sota.com/model-pricing");
  assert.equal(prepared.auth.type, "none");
  assert.equal(prepared.adapter.kind, "true-sota-model-pricing");

  let request;
  const snapshot = await collectStationInput({ ...station, adapter }, {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response(trueSotaFixture);
    }
  });
  assert.equal(request.url, "https://true-sota.com/api/v1/model-pricing");
  assert.equal(request.init.credentials, "omit");
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.sourceFormat, "true-sota-model-pricing");
  assert.equal(snapshot.normalized.data[0].input_price, 3);
  assert.equal(snapshot.normalized.data[0].output_price, 12);
  assert.equal(snapshot.normalized.data[0].cache_read_price, 0.3);
  assert.equal(snapshot.normalized.group_ratio.GPT, 1.5);
});

test("adds two plugins that share one host but live on different paths", () => {
  const pricing = addProviderStationPresets([], [providerById("stellaisle")]);
  assert.equal(pricing.length, 1);
  const both = addProviderStationPresets(pricing, [providerById("stellaisle-carpool")]);
  assert.equal(both.length, 2);
  assert.equal(both[1].id, "stellaisle-carpool");
  assert.equal(both[1].baseUrl, "https://token.stellaisle.com/carpool-market");
  // 再跑一遍不重复加
  assert.equal(addProviderStationPresets(both, [providerById("stellaisle"), providerById("stellaisle-carpool")]), both);
});

test("prepares a shared-host station with the plugin it was created from", () => {
  // 一个域名两个插件：插件 id 比路径更可信，别让先注册的那个把站点改到自己的接口上。
  const prepared = prepareStationInput({
    id: "stellaisle-carpool",
    pluginId: "stellaisle-carpool",
    baseUrl: "https://token.stellaisle.com/pricing",
    adapter: { kind: "stellaisle", endpoint: "/api/pricing", method: "GET", responseFormat: "stellaisle" }
  });
  assert.equal(prepared.baseUrl, "https://token.stellaisle.com/carpool-market");
  assert.equal(prepared.mode, "page");
  assert.equal(prepared.adapter.kind, "stellaisle-carpool");
  assert.match(prepared.adapter.endpoint, /^\/api\/carpool-market\?/);
  // 没写插件 id 的老站点仍按路径认插件。
  assert.equal(providerForStation({ baseUrl: "https://token.stellaisle.com/pricing" }).id, "stellaisle");
  assert.equal(providerForStation({ baseUrl: "https://token.stellaisle.com/carpool-market" }).id, "stellaisle-carpool");
});

test("飓星分组广场：按分组展开报价，不可用分组与未定价模型跳过", () => {
  const payload = {
    success: true,
    group_ratio: {},
    data: [{ model_name: "base-only", quota_type: 0, model_ratio: 1, completion_ratio: 2, enable_groups: [] }],
    __aux: {
      groups: {
        data: {
          items: [
            { group_id: 37, vendor_name: "SWS", name: "认证特惠供应商s001", ratio: 0.088, status: "ok" },
            { group_id: 11, vendor_name: "平台认证", name: "认证供应商SG", ratio: 0.473, status: "unstable" }
          ]
        }
      },
      groupPrices: [
        // 逐条拉取存的是整包响应，分组详情在 data 里。用裸详情测会漏掉这层解包。
        {
          success: true,
          data: {
            group_id: 37,
            model_prices: [
              { model_name: "gpt-6-luna", pricing_mode: "tiered", billing_expr: 'len <= 272000 ? tier("standard", p * 0.1 + c * 0.5) : tier("long_context", p * 0.2 + c * 0.75)' },
              { model_name: "codex-auto-review", pricing_mode: "token", input_per_m: 0.066, output_per_m: 0.396 },
              { model_name: "gpt-reserve", pricing_mode: "unconfigured" }
            ]
          }
        },
        {
          success: true,
          data: {
            group_id: 11,
            model_prices: [{ model_name: "gemini-3.8-flash", pricing_mode: "tiered", billing_expr: 'tier("standard", p * 0.75 + c * 3.75)' }]
          }
        }
      ]
    }
  };
  const normalized = normalizePricingPayload(payload, "stellaisle", { priceCurrency: "CREDITS", priceCurrencyVerified: true });
  assert.equal(normalized.error, undefined);
  // 基准价那一条被分组报价顶掉：站内基准价倍率 1，没人买得到，混进榜里只会把价格抬高一截。
  assert.deepEqual([...new Set(normalized.data.map(row => row.model_name))].sort(), ["codex-auto-review", "gpt-6-luna"]);
  const luna = normalized.data.filter(row => row.model_name === "gpt-6-luna");
  assert.deepEqual(luna.map(row => [row.tier_name, row.input_price]), [["standard", 0.0088], ["long_context", 0.0176]]);
  assert.equal(luna[0].proxy_group_name, "SWS · 认证特惠供应商s001");
  assert.equal(luna[0].group_ratio, 0.088);
  const codex = normalized.data.find(row => row.model_name === "codex-auto-review");
  assert.equal(codex.input_price, 0.066);
  assert.equal(codex.group_ratio, 1);
});

test("飓星分组广场：分组价对不上分组表时退回基准价并标降级", () => {
  const payload = {
    success: true,
    group_ratio: {},
    data: [{ model_name: "base-only", quota_type: 0, model_ratio: 1, completion_ratio: 2, enable_groups: [] }],
    __aux: {
      groups: {
        data: {
          items: [{ group_id: 37, vendor_name: "SWS", name: "认证特惠供应商s001", ratio: 0.088, status: "ok" }]
        }
      },
      // 分组详情里的 group_id 和分组表里的任何一个都对不上：价格还在，口径已经不是分组的了。
      groupPrices: [
        { success: true, data: { group_id: 999, model_prices: [{ model_name: "ghost", pricing_mode: "token", input_per_m: 1, output_per_m: 2 }] } }
      ]
    }
  };
  const normalized = normalizePricingPayload(payload, "stellaisle", { priceCurrency: "CREDITS", priceCurrencyVerified: true });
  assert.equal(normalized.incomplete, true);
  assert.equal(normalized.degradedReasons.length, 1);
  assert.match(normalized.degradedReasons[0], /对不上分组表/);
  // 丢分组不等于丢价格：基准价还在，站不会从比价里消失。
  assert.equal(normalized.data.length, 1);
  assert.equal(normalized.data[0].model_name, "base-only");
});

test("飓星分组广场：分组价一条没拿到时标降级，不装作这个站没分组", () => {
  const payload = {
    success: true,
    group_ratio: {},
    data: [{ model_name: "base-only", quota_type: 0, model_ratio: 1, completion_ratio: 2, enable_groups: [] }],
    __aux: {
      groups: {
        data: {
          items: [
            { group_id: 37, vendor_name: "SWS", name: "认证特惠供应商s001", ratio: 0.088, status: "ok" },
            { group_id: 31, vendor_name: "sailapi", name: "pro不降智高缓", ratio: 0.11, status: "ok" }
          ]
        }
      }
    }
  };
  const normalized = normalizePricingPayload(payload, "stellaisle", { priceCurrency: "CREDITS", priceCurrencyVerified: true });
  assert.equal(normalized.incomplete, true);
  assert.equal(normalized.degradedReasons.length, 1);
  assert.match(normalized.degradedReasons[0], /2 个可用分组，分组价一条也没拿到/);
  assert.equal(normalized.data.length, 1);
});

test("飓星分组广场：没有分组报文时不瞎标降级", () => {
  // 站点本来就没分组（或者压根不是分组站）时，不该给每一行挂一条警告。
  const payload = {
    success: true,
    group_ratio: {},
    data: [{ model_name: "base-only", quota_type: 0, model_ratio: 1, completion_ratio: 2, enable_groups: [] }]
  };
  const normalized = normalizePricingPayload(payload, "stellaisle", { priceCurrency: "CREDITS", priceCurrencyVerified: true });
  assert.equal(normalized.incomplete, undefined);
  assert.equal(normalized.degradedReasons, undefined);
  assert.equal(normalized.data.length, 1);
});

test("辅助接口失败会标降级，而不是装作主价格就够", async () => {
  const pricing = {
    success: true,
    group_ratio: {},
    data: [{ model_name: "base-only", quota_type: 0, model_ratio: 1, completion_ratio: 2, enable_groups: [] }]
  };
  const snapshot = await collectStationInput({
    id: "station-stellaisle-aux-down",
    name: "飓星API",
    baseUrl: "https://token.stellaisle.com/pricing",
    adapter: { kind: "stellaisle", endpoint: "/api/pricing", method: "GET", responseFormat: "stellaisle" }
  }, {
    fetchImpl: async url => {
      if (url.includes("/api/pricing")) return response(pricing);
      // 分组表挂掉：主价格还在，但分组维度这次没了。
      throw new Error("group-plaza down");
    }
  });
  // 有价格但缺维度，是「部分解析」而不是「成功」。
  assert.equal(snapshot.status, "partial");
  assert.match(snapshot.rawMeta.degradedReasons.join(" "), /groups 请求失败/);
  assert.equal(snapshot.normalized.data.length, 1);
});

test("辅助接口正常时不挂降级标记", async () => {
  const pricing = {
    success: true,
    group_ratio: {},
    data: [{ model_name: "base-only", quota_type: 0, model_ratio: 1, completion_ratio: 2, enable_groups: [] }]
  };
  const groups = {
    success: true,
    data: { items: [{ group_id: 37, vendor_name: "SWS", name: "认证特惠供应商s001", ratio: 0.088, status: "ok" }] }
  };
  const detail = {
    success: true,
    data: { group_id: 37, model_prices: [{ model_name: "gpt-6-luna", pricing_mode: "token", input_per_m: 0.0088, output_per_m: 0.044 }] }
  };
  const snapshot = await collectStationInput({
    id: "station-stellaisle-aux-ok",
    name: "飓星API",
    baseUrl: "https://token.stellaisle.com/pricing",
    adapter: { kind: "stellaisle", endpoint: "/api/pricing", method: "GET", responseFormat: "stellaisle" }
  }, {
    fetchImpl: async url => {
      if (url.includes("/api/pricing")) return response(pricing);
      if (url.includes("/api/group-plaza/groups/")) return response(detail);
      if (url.includes("/api/group-plaza")) return response(groups);
      return response({ success: false });
    }
  });
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.rawMeta.degradedReasons, undefined);
  assert.equal(snapshot.normalized.data[0].model_name, "gpt-6-luna");
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
  const provider = providerForStation(station);
  assert.equal(provider.responseFormat, "aiapi-model-catalog");
  assert.equal(adapter.mode, "page");
  assert.equal(adapter.endpoint, "/api/me/model-catalog");
  assert.equal(adapter.method, "GET");
  assert.equal(adapter.responseFormat, "aiapi-model-catalog");
  assert.equal(adapter.authType, "none");
  const prepared = prepareStationInput({ ...station, adapter });
  assert.equal(prepared.baseUrl, "https://cn.aiapi.bot/dashboard/model-prices");
  assert.equal(prepared.auth.type, "none");
  assert.equal(prepared.adapter.kind, "aiapi-model-catalog");
  assert.equal(prepared.adapter.responseFormat, "aiapi-model-catalog");
  const requests = [];
  const pageFetch = async request => {
    requests.push(request);
    return request.capture
      ? { ok: true, status: 404, body: { data: [] } }
      : { ok: true, status: 200, body: aiApiFixture };
  };
  pageFetch.supportsCapture = true;
  const snapshot = await collectStationInput({ ...station, adapter }, { pageFetch });
  assert.equal(requests[1].url, "https://cn.aiapi.bot/api/me/model-catalog");
  assert.equal(requests[1].headers.Authorization, undefined);
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.sourceFormat, "aiapi-model-catalog");
  const model = snapshot.normalized.data[0];
  assert.ok(snapshot.normalized.data.length > 0);
  assert.ok(Number.isFinite(model.input_price));
  assert.equal(model.model_name, "gpt-5.6-luna");
  assert.equal(model.proxy_group_name, "Starter 0.25x");
  assert.equal(snapshot.normalized.group_ratio[model.proxy_group_name], 0.25);
  assert.deepEqual(getProxyPrices(model, snapshot.normalized.group_ratio[model.proxy_group_name]), {
    input: 0.25, output: 1.5, cacheRead: 0.025, cacheWrite: 0.1, request: null, imageOutput: null, imagePrice: null
  });
});

test("does not treat AIAPI model metadata as price values", async () => {
  const payload = structuredClone(aiApiFixture);
  payload.data.groups[0].models[0].metadata = { input: "tokens", output: "tokens" };
  let requests = 0;
  const pageFetch = async () => {
    requests += 1;
    return { ok: true, status: 200, body: payload };
  };
  pageFetch.supportsCapture = true;
  const snapshot = await collectStationInput({
    id: "station-aiapi-metadata",
    name: "AIAPI",
    baseUrl: "https://cn.aiapi.bot/dashboard/model-prices",
    mode: "page",
    adapter: { kind: "aiapi-model-catalog", endpoint: "/api/me/model-catalog", method: "GET" }
  }, { pageFetch });
  assert.equal(requests, 1);
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.data[0].input_price, 0.25);
});


test("supports top-level AIAPI model prices as a compatibility shape", async () => {
  const payload = {
    ok: true,
    data: {
      catalogVersion: "public-catalog-v1",
      groups: [],
      models: [{
        id: "gpt-5.6-luna",
        displayName: "GPT-5.6 Luna",
        effective: { inputPer1M: 0.25, outputPer1M: 1.5, cacheReadPer1M: 0.025, cacheCreatePer1M: 0.1 }
      }]
    }
  };
  let endpoint;
  const pageFetch = async request => {
    if (!request.capture) endpoint = request.url;
    return request.capture
      ? { ok: true, status: 404, body: { data: [] } }
      : { ok: true, status: 200, body: payload };
  };
  pageFetch.supportsCapture = true;
  const snapshot = await collectStationInput({
    id: "station-aiapi-top-level",
    name: "AIAPI",
    baseUrl: "https://cn.aiapi.bot/dashboard/model-prices",
    mode: "page",
    adapter: { kind: "aiapi-model-catalog", endpoint: "/api/me/model-catalog", method: "GET" }
  }, { pageFetch });
  assert.equal(snapshot.status, "success");
  assert.equal(endpoint, "https://cn.aiapi.bot/api/me/model-catalog");
  assert.equal(snapshot.normalized.sourceFormat, "aiapi-model-catalog");
  assert.equal(snapshot.normalized.data[0].proxy_group_name, "public-catalog-v1");
  assert.equal(snapshot.normalized.data[0].input_price, 0.25);
});


test("does not route generic effective model shapes to AIAPI", () => {
  for (const payload of [
    { data: { models: [{ id: "other-model", effective: { latencyMs: 12 } }] } },
    { data: { models: [{ id: "other-model", effective: { inputPer1M: 1 } }] } },
    { data: { provider: "other", models: [{ id: "other-model", effective: { inputPer1M: 1 } }] } },
    { data: { catalogVersion: "other-catalog-v1", models: [{ id: "other-model", effective: { inputPer1M: 1 } }] } },
    { data: { groups: [{ name: "other", models: [{ id: "other-model", effective: { latencyMs: 12 } }] }] } }
  ]) {
    const normalized = normalizePricingPayload(payload);
    assert.notEqual(normalized.sourceFormat, "aiapi-model-catalog");
    assert.equal(normalized.data.length, 0);
  }
});


test("normalizes every registered AIAPI model price field", () => {
  const outputByField = {
    inputPer1M: "input_price",
    outputPer1M: "output_price",
    cacheReadPer1M: "cache_read_price",
    cacheCreatePer1M: "cache_write_price",
    cacheCreate1hPer1M: "cache_write_1h_price"
  };
  for (const field of AIAPI_EFFECTIVE_PRICE_FIELDS) {
    const normalized = normalizePricingPayload({
      data: {
        source: "cnaiapi",
        groups: [{ name: "Starter", billingMultiplier: 1, models: [{ id: "contract-model", effective: { [field]: 1 } }] }]
      }
    });
    assert.equal(normalized.sourceFormat, "aiapi-model-catalog", field);
    assert.equal(normalized.data.length, 1, field);
    assert.equal(normalized.data[0][outputByField[field]], 1, field);
  }
});

test("reports an empty AIAPI catalog separately from invalid prices", async () => {
  const pageFetch = async request => ({
    ok: true,
    status: 200,
    body: request.capture ? { data: [] } : { ok: true, data: { groups: [], models: [] } }
  });
  pageFetch.supportsCapture = true;
  await assert.rejects(() => collectStationInput({
    id: "station-aiapi-empty",
    name: "AIAPI",
    baseUrl: "https://cn.aiapi.bot/dashboard/model-prices",
    mode: "page",
    adapter: { kind: "aiapi-model-catalog", endpoint: "/api/me/model-catalog", method: "GET" }
  }, { pageFetch }), /未生成可用价格数据/);
});


test("rejects invalid AIAPI price values from page capture", async () => {
  const payload = structuredClone(aiApiFixture);
  payload.data.groups[0].models[0].effective.inputPer1M = "not-a-price";
  const pageFetch = async () => ({ ok: true, status: 200, body: payload });
  pageFetch.supportsCapture = true;
  await assert.rejects(() => collectPreparedStation({
    id: "station-aiapi-invalid",
    name: "AIAPI",
    baseUrl: "https://cn.aiapi.bot/dashboard/model-prices",
    mode: "page",
    adapter: { kind: "aiapi-model-catalog", endpoint: "/api/me/model-catalog", method: "GET" }
  }, {
    pageFetch,
    collection: { endpoints: [], priceKeys: AIAPI_PRICE_KEYS, request: {} }
  }), /页面响应未通过价格数据校验/);
});


test("rejects invalid normalized prices from the AIAPI page endpoint", async () => {
  const pageFetch = async request => request.capture
    ? { ok: true, status: 404, body: { data: [] } }
    : {
      ok: true,
      status: 200,
      body: { normalized: { data: [{ model_name: "gpt-5.6-luna", input_price: -1, output_price: 1 }] } }
    };
  pageFetch.supportsCapture = true;
  await assert.rejects(() => collectStationInput({
    id: "station-aiapi-invalid-normalized",
    name: "AIAPI",
    baseUrl: "https://cn.aiapi.bot/dashboard/model-prices",
    mode: "page",
    adapter: { kind: "aiapi-model-catalog", endpoint: "/api/me/model-catalog", method: "GET" }
  }, { pageFetch }), /页面响应未通过价格数据校验/);
});

test("captures the AIAPI model catalog from page requests", async () => {
  const origin = "https://cn.aiapi.bot";
  const listeners = new Map();
  const posted = [];
  const document = { body: { innerText: "" }, querySelectorAll: () => [] };
  let capturedPayload = aiApiFixture;
  const pageWindow = {
    location: { hostname: "cn.aiapi.bot", origin, href: `${origin}/dashboard/model-prices` },
    history: { pushState() {}, replaceState() {} },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener() {},
    postMessage(message) { posted.push(message); },
    fetch: async () => ({ headers: { get: () => null }, clone: () => ({ json: async () => capturedPayload }) })
  };
  function MockXHR() {}
  MockXHR.prototype.open = function() {};
  MockXHR.prototype.send = function() {};
  runInNewContext(readFileSync(new URL("../src/page-bridge.js", import.meta.url), "utf8"), {
    window: pageWindow, document, history: pageWindow.history, fetch: pageWindow.fetch, XMLHttpRequest: MockXHR,
    URL, Date, Math, JSON, Object, String, Number, Array, Set, RegExp, Error, Promise
  });
  const capture = async id => {
    await pageWindow.fetch(`${origin}/api/me/model-catalog`);
    await new Promise(resolve => setImmediate(resolve));
    await listeners.get("message")({
      source: pageWindow,
      origin,
      data: { type: PAGE_WINDOW_CAPTURE_REQUEST_TYPE, id }
    });
    return posted.at(-1);
  };
  const initialCapture = await capture("aiapi-capture");
  assert.equal(initialCapture.response.ok, true);
  assert.equal(initialCapture.response.body.data.groups[0].models[0].effective.inputPer1M, 0.25);
  for (const field of AIAPI_EFFECTIVE_PRICE_FIELDS) {
    capturedPayload = {
      ok: true,
      data: {
        source: "aiapi",
        provider: "AIAPI",
        groups: [{ models: [{ effective: { [field]: 1 } }] }],
        models: []
      }
    };
    const fieldCapture = await capture(`aiapi-${field}`);
    assert.equal(fieldCapture.response.ok, true, field);
  }
  capturedPayload = {
    ok: true,
    data: {
      source: "aiapi",
      provider: "AIAPI",
      groups: [{ [AIAPI_GROUP_PRICE_FIELDS[0]]: 1, models: [] }],
      models: []
    }
  };
  const groupCapture = await capture("aiapi-group-billing");
  assert.equal(groupCapture.response.ok, true, AIAPI_GROUP_PRICE_FIELDS[0]);
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
  assert.equal(model.id, "openai/gpt-4o");
  assert.equal(model.price_currency, "USD");
});

test("OpenRouter 浮动别名折回目标模型，不另开 ~ 供应商", () => {
  const rows = parseOpenRouterData({ data: [
    { id: "anthropic/claude-sonnet-5.5", name: "Anthropic: Claude Sonnet 5.5", canonical_slug: "anthropic/claude-sonnet-5.5", pricing: { prompt: "0.000003", completion: "0.000015" } },
    { id: "~anthropic/claude-sonnet-latest", name: "Anthropic: Claude Sonnet Latest", canonical_slug: "~anthropic/claude-sonnet-latest", alias_target: { slug: "anthropic/claude-sonnet-5.5" }, pricing: { prompt: "0.000003", completion: "0.000015" } }
  ] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "anthropic/claude-sonnet-5.5");
  assert.equal(rows[0].provider, "anthropic");
  assert.equal(rows[0].input, 3);
  assert.ok(rows[0].aliases.includes("~anthropic/claude-sonnet-latest"));
});

test("目标不在列表里的浮动别名顶替目标身份", () => {
  const [row] = parseOpenRouterData({ data: [{
    id: "~deepseek/deepseek-latest",
    name: "DeepSeek Latest",
    alias_target: { slug: "deepseek/deepseek-v4" },
    pricing: { prompt: "0.0000003", completion: "0.0000012" }
  }] });
  assert.equal(row.id, "deepseek/deepseek-v4");
  assert.equal(row.provider, "deepseek");
  assert.equal(row.input, 0.3);
  assert.ok(row.aliases.includes("~deepseek/deepseek-latest"));
});

test("旧缓存里的浮动别名读出来就丢掉", async () => {
  const stale = [
    { id: "~deepseek/deepseek-latest", provider: "~deepseek", input: 1, output: 2, price_currency: "USD" },
    { id: "deepseek/deepseek-v4", provider: "deepseek", input: 1, output: 2, price_currency: "USD" }
  ];
  assert.deepEqual(dropFloatingModels(stale).map(model => model.id), ["deepseek/deepseek-v4"]);
  // 网络挂了回落到缓存时也要清一遍，不然供应商栏会继续留着 ~deepseek。
  const result = await fetchReferences({ fetchImpl: () => Promise.reject(new Error("offline")), cache: { models: stale } });
  assert.deepEqual(result.models.map(model => model.id), ["deepseek/deepseek-v4"]);
});

// 使用不理会 AbortSignal 的桩，证明期限本身能结束等待，而非依赖 fetch 的实现。
test("reference deadlines preserve cached data and do not discard successful sources", async () => {
  const cachedModel = { id: "cached/model", provider: "cached", input: 1, output: 2 };
  const cachedQuote = { unit: "image", value: 0.04 };
  const cache = { models: [cachedModel], exchangeRate: 7.2, imageQuotes: { "image/a": cachedQuote }, imageModels: [], imageQuotesFetchedAt: 1 };
  const signals = new Map();
  const result = await fetchReferences({
    cache,
    now: 100_000_000,
    timeouts: { models: 20, exchangeRate: 1000, images: 20 },
    fetchImpl: (url, { signal }) => {
      signals.set(url, signal);
      if (url.startsWith(BOC_EXCHANGE_URL)) return Promise.resolve({ ok: true, text: async () => "<tr><td>美元</td><td>0</td><td>0</td><td>0</td><td>0</td><td>710</td></tr>" });
      return new Promise(() => {});
    }
  });
  assert.equal(signals.get(OPENROUTER_URL).aborted, true);
  assert.equal(signals.get(OPENROUTER_IMAGES_URL).aborted, true);
  assert.deepEqual(result.models, cache.models);
  assert.deepEqual(result.imageQuotes, cache.imageQuotes);
  assert.equal(result.exchangeRate, 7.1);
  assert.equal(result.warnings.length, 2);
  assert.ok(result.warnings.every(warning => warning.includes("请求超时")));
});

test("image references isolate endpoint failures and preserve each failed model cache", async () => {
  const quote = { unit: "image", value: 0.2 };
  const now = 100_000_000;
  const result = await fetchImageReferences({
    now,
    cache: { imageQuotes: { "image/b": quote }, imageQuotesFetchedAt: 1 },
    fetchImpl: async url => {
      if (url === OPENROUTER_IMAGES_URL) return { ok: true, json: async () => ({ data: [{ id: "image/a" }, { id: "image/b" }] }) };
      if (url.includes("image/b/endpoints")) throw new Error("endpoint offline");
      return { ok: true, json: async () => ({ id: "image/a", endpoints: [{ provider_name: "provider", pricing: [{ billable: "output_image", unit: "image", cost_usd: 0.05 }] }] }) };
    }
  });
  assert.equal(result.imageQuotes["image/a"].value, 0.05);
  assert.deepEqual(result.imageQuotes["image/b"], quote);
  assert.equal(result.imageQuotesFetchedAt, 1);
  assert.match(result.warning, /1 个模型不可用/);
  let requests = 0;
  const cached = await fetchImageReferences({
    now,
    cache: { ...result, imageQuotesFetchedAt: now },
    fetchImpl: async () => { requests += 1; throw new Error("should reuse cache"); }
  });
  assert.equal(requests, 0);
  assert.deepEqual(cached.imageQuotes, result.imageQuotes);
});

test("image reference timeout stops pending requests and does not launch queued endpoints", async () => {
  const endpoints = [];
  const signals = [];
  await assert.rejects(fetchImageReferences({
    timeoutMs: 20,
    fetchImpl: async (url, { signal }) => {
      if (url === OPENROUTER_IMAGES_URL) return { ok: true, json: async () => ({ data: Array.from({ length: 10 }, (_, index) => ({ id: `image/${index}` })) }) };
      endpoints.push(url);
      signals.push(signal);
      return new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    }
  }), /请求超时/);
  assert.equal(endpoints.length, 6);
  assert.ok(signals.every(signal => signal.aborted));
});
test("reference cancellation aborts every pending source and retains cache", async () => {
  const controller = new AbortController();
  const signals = [];
  let allStarted;
  const started = new Promise(resolve => { allStarted = resolve; });
  const cache = { models: [{ id: "cached/a" }], exchangeRate: 7.1, imageQuotes: {}, imageModels: [] };
  const task = fetchReferences({
    cache, signal: controller.signal,
    fetchImpl: (url, { signal }) => {
      signals.push(signal);
      if (signals.length === 3) allStarted();
      return new Promise(() => {});
    }
  });
  await started;
  controller.abort(new Error("cancel reference refresh"));
  const result = await task;
  assert.ok(signals.every(signal => signal.aborted));
  assert.deepEqual(result.models, cache.models);
  assert.equal(result.exchangeRate, cache.exchangeRate);
  assert.equal(result.warnings.length, 3);
});

test("maps OpenRouter USD credits to the unified CREDITS benchmark", () => {
  const [official] = parseOpenRouterData({ data: [{
    id: "openai/gpt-4o",
    name: "GPT-4o",
    pricing: { prompt: "0.000005", completion: "0.000015" }
  }] });
  const [comparison] = buildComparisonRows({
    stations: [{ id: "station-openrouter", name: "OpenRouter baseline", rechargeRate: 2, basePricePerMillion: 2 }],
    snapshots: [{
      stationId: "station-openrouter",
      collectedAt: 1,
      status: "success",
      normalized: { data: [{ model_name: "gpt-4o", input_price: 5, output_price: 15, price_currency: "CREDITS" }], group_ratio: {} }
    }],
    references: { models: [official], exchangeRate: 5, openRouterRechargeRate: 7 },
    usage: { input: TOKENS_PER_MILLION, output: 200_000 }
  });
  const [offer] = comparison.offers;
  assert.equal(official.price_currency, "USD");
  assert.equal(offer.officialCurrency, "CREDITS");
  assert.equal(offer.officialQuotedPrices.input, 5);
  assert.equal(offer.officialPrices.input, 35);
  assert.equal(offer.officialMonthlyCost, 56);
});

test("parses China Bank HTML exchange rate", () => {
  const html = "<table><tr><td>美元</td><td>718.12</td><td>716.33</td><td>720.88</td><td>720.88</td><td>719.03</td></tr></table>";
  assert.equal(parseOfficialExchangeRate(html), 7.1903);
});

test("calculates token workload per million, not per token", () => {
  assert.equal(workloadCost({ input: 0.5, output: 1 }, { input: 1_000_000, output: 200_000 }), 0.7);
  assert.equal(workloadCost({ imageOutput: 0.1, imagePrice: 0.02 }, { imageTokens: 1_000_000, images: 2 }), 0.14);
  assert.equal(workloadCost({ cacheWrite1h: 0.5 }, { cacheWrite1h: 1_000_000 }), 0.5);
});

test("uses the recent 30-day workload as the default usage", () => {
  const settings = normalizeSettings();
  assert.deepEqual(settings.usage, DEFAULT_MONTHLY_USAGE);
  assert.equal(settings.usage.input, 326.81 * TOKENS_PER_MILLION);
  assert.equal(settings.usage.cacheRead, 4434.31 * TOKENS_PER_MILLION);
  assert.equal(settings.usage.output, 28.98 * TOKENS_PER_MILLION);
  assert.equal(settings.usage.cacheWrite, 1.91 * TOKENS_PER_MILLION);
  assert.equal(settings.usage.cacheWrite1h, 0);
  assert.equal(usagePresetUsage("recent30d").requests, 54378);
});
test("offers magpie 30-day, baseline and custom usage without the retired 7-day preset", () => {
  assert.deepEqual(usagePresetOptions().map(option => option.id), ["recent30d", "baseline", "custom"]);
  assert.equal(usagePresetUsage("recent7d"), null);
  assert.equal(usagePresetUsage("recent30d").requests, 54378);
  const baseline = usagePresetUsage("baseline");
  assert.equal(baseline.input, 30 * TOKENS_PER_MILLION);
  assert.equal(baseline.output, 6 * TOKENS_PER_MILLION);
  assert.equal(usagePresetId(baseline), "baseline");
});

test("migrates old and retired usage presets to the current default", () => {
  const legacyUsages = [
    { requests: 32567, input: 196.25 * TOKENS_PER_MILLION, cacheRead: 2077.49 * TOKENS_PER_MILLION, output: 20.03 * TOKENS_PER_MILLION, cacheWrite: 0.79 * TOKENS_PER_MILLION, peakShare: 0.4 },
    { requests: 0, input: TOKENS_PER_MILLION, cacheRead: 0, output: 200_000, cacheWrite: 0, imageTokens: 0, images: 0, peakShare: 0.5 },
    { requests: 44400, input: 372.6 * TOKENS_PER_MILLION, cacheRead: 2865.3 * TOKENS_PER_MILLION, output: 29.7 * TOKENS_PER_MILLION, cacheWrite: 0, imageTokens: 0, images: 0, peakShare: 7 / 24 },
    { requests: 7900, input: 66.5 * TOKENS_PER_MILLION, cacheRead: 550.7 * TOKENS_PER_MILLION, output: 5.5 * TOKENS_PER_MILLION, cacheWrite: 0, imageTokens: 0, images: 0, peakShare: 7 / 24 },
    // 已下线的「实测月用量」预设，保存过它的设置要被迁到当前默认。
    { requests: 45494, input: 382.95 * TOKENS_PER_MILLION, cacheRead: 2946.28 * TOKENS_PER_MILLION, output: 30.74 * TOKENS_PER_MILLION, cacheWrite: 0, cacheWrite1h: 0, imageTokens: 0, images: 0, peakShare: 7 / 24 }
  ];
  // peakShare 随分档加权一起下线，老设置里的这个键要被清掉。
  for (const usage of legacyUsages) assert.deepEqual(normalizeSettings({ usage }).usage, DEFAULT_MONTHLY_USAGE);
  assert.equal(normalizeSettings({ usage: { ...DEFAULT_MONTHLY_USAGE, input: TOKENS_PER_MILLION } }).usage.input, TOKENS_PER_MILLION);
});

test("uses synced 30-day usage for defaults and retired presets while preserving custom fields", () => {
  const measured = { requests: 999, input: 5_000_123, cacheRead: 7_000_000, cacheWrite: 100, output: 200_000 };
  const retired = { requests: 321, input: 8_000_023, cacheRead: 9_000_099, cacheWrite: 200, output: 100_000 };
  const magpieSync = { recent30d: { usage: measured, syncedAt: 10 }, recent7d: { usage: retired, syncedAt: 20 } };
  for (const usage of [undefined, DEFAULT_MONTHLY_USAGE, { ...retired, input: 8_000_000, cacheRead: 9_000_100 }]) {
    const settings = normalizeSettings({ magpieSync, usage: { ...usage, imageInputTokens: 123, imageOutputTokens: 456, images: 7 } });
    assert.equal(usagePresetId(settings.usage, settings.magpieSync), "recent30d");
    for (const [field, value] of Object.entries(measured)) assert.equal(settings.usage[field], value);
    assert.equal(settings.usage.imageInputTokens, 123);
    assert.equal(settings.usage.imageOutputTokens, 456);
    assert.equal(settings.usage.images, 7);
    assert.equal(settings.magpieSync.recent7d, undefined);
    assert.deepEqual(normalizeSettings(settings), settings);
  }
  for (const usage of [usagePresetUsage("baseline"), { ...DEFAULT_MONTHLY_USAGE, input: 1_234_567, cacheWrite1h: 321 }]) {
    assert.deepEqual(normalizeSettings({ usage, magpieSync }).usage, usage);
  }
});
test("matches usage presets regardless of retired settings", () => {
  const usage = { requests: 0, input: 30 * TOKENS_PER_MILLION, cacheRead: 0, output: 6_000_000, cacheWrite: 0, imageTokens: 0, images: 0, peakShare: 0.3 };
  assert.equal(usagePresetId(usage), "baseline");
  assert.equal(usagePresetId({ ...DEFAULT_MONTHLY_USAGE }), "recent30d");
  assert.equal(usagePresetId({ ...DEFAULT_MONTHLY_USAGE, peakShare: 0.5 }), "recent30d");
  assert.equal(usagePresetId({ ...usage, input: 900_000 }), "custom");
});
test("converts a magpie usage window into monthly volume", () => {
  const payload = { calls: 1200, input: 3_000_000, cache_read: 9_000_000, cache_write: 1_000_000, output: 500_000 };
  assert.deepEqual(monthlyUsageFromGateway(payload, 30), { requests: 1200, input: 3_000_000, cacheRead: 9_000_000, cacheWrite: 1_000_000, output: 500_000 });
  const week = monthlyUsageFromGateway(payload, 7);
  assert.equal(week.requests, Math.round(1200 * 30 / 7));
  assert.equal(week.input, 3_000_000 * 30 / 7);
  assert.deepEqual(monthlyUsageFromGateway({}, 30), { requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
  assert.deepEqual(monthlyUsageFromGateway({ calls: -5, input: "abc" }, 30), { requests: 0, input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
});

test("keeps user-entered fields when merging gateway usage", () => {
  const current = { ...DEFAULT_MONTHLY_USAGE, imageTokens: 0.5, imageInputTokens: 1_000_000 };
  const merged = mergeGatewayUsage(current, { requests: 10, input: 1, cacheRead: 2, cacheWrite: 3, output: 4 });
  assert.equal(merged.requests, 10);
  assert.equal(merged.input, 1);
  assert.equal(merged.imageTokens, 0.5);
  assert.equal(merged.imageInputTokens, 1_000_000);
});

test("only accepts loopback magpie gateway addresses", () => {
  assert.equal(normalizeMagpieBaseUrl("http://127.0.0.1:3425"), "http://127.0.0.1:3425");
  assert.equal(normalizeMagpieBaseUrl("http://localhost:3425/foo"), "http://localhost:3425");
  assert.equal(normalizeMagpieBaseUrl("https://example.com"), "http://127.0.0.1:3425");
  assert.equal(normalizeMagpieBaseUrl("ftp://127.0.0.1:3425"), "http://127.0.0.1:3425");
  assert.equal(normalizeMagpieBaseUrl(""), "http://127.0.0.1:3425");
  assert.equal(normalizeMagpieBaseUrl("not a url"), "http://127.0.0.1:3425");
});

test("normalizes the magpie sync interval", () => {
  assert.equal(normalizeMagpieSyncInterval(0), 0);
  assert.equal(normalizeMagpieSyncInterval("1440"), 1440);
  assert.equal(normalizeMagpieSyncInterval(7), 360);
  assert.equal(normalizeMagpieSyncInterval(undefined), 360);
});

test("fetches magpie usage and reports a readable error when the gateway is down", async () => {
  const okFetch = async (url) => {
    assert.match(url, /\/v1\/magpie\/usage\?period=30d$/);
    return { ok: true, status: 200, json: async () => ({ calls: 100, input: 2_000_000, cache_read: 0, cache_write: 0, output: 0 }) };
  };
  const result = await fetchMagpieUsage({ fetchImpl: okFetch, period: "30d", days: 30 });
  assert.equal(result.usage.requests, 100);
  assert.equal(result.usage.input, 2_000_000);
  assert.equal(result.window.days, 30);

  await assert.rejects(
    () => fetchMagpieUsage({ fetchImpl: async () => { throw new TypeError("Failed to fetch"); } }),
    /连不上本机 magpie 网关/
  );
  await assert.rejects(
    () => fetchMagpieUsage({ fetchImpl: async () => ({ ok: false, status: 404 }) }),
    /magpie 网关返回 404/
  );
  await assert.rejects(
    () => fetchMagpieUsage({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad"); } }) }),
    /不是 JSON/
  );
});

test("uses synced magpie numbers for the presets and falls back to the builtin snapshot", () => {
  const magpieSync = normalizeMagpieSyncState({
    recent30d: { usage: { requests: 999, input: 5_000_000, cacheRead: 0, cacheWrite: 0, output: 0 }, syncedAt: 1_700_000_000_000 }
  });
  assert.equal(usagePresetUsage("recent30d", magpieSync).requests, 999);
  assert.equal(usagePresetUsage("recent7d", magpieSync), null);
  assert.equal(usagePresetId({ ...DEFAULT_MONTHLY_USAGE, ...usagePresetUsage("recent30d", magpieSync) }, magpieSync), "recent30d");
  assert.equal(usagePresetId({ ...DEFAULT_MONTHLY_USAGE, ...usagePresetUsage("recent30d", magpieSync) }), "custom");
  assert.match(usagePresetOptions(magpieSync).find(option => option.id === "recent30d").label, /同步/);
  assert.match(usagePresetOptions().find(option => option.id === "recent30d").label, /内置快照/);
});

// 回归：点「立即同步」后输入框回填的是取整到 4 位小数的百万值，读回来和网关原始值差几百个 token。
// 之前用严格相等判定，一同步就掉成「自定义」。
test("keeps the magpie preset selected after the inputs are rounded for display", () => {
  const T = TOKENS_PER_MILLION;
  const magpieSync = normalizeMagpieSyncState({
    recent30d: { usage: { requests: 36085, input: 373_945_123, cacheRead: 1_741_243_900, cacheWrite: 907_000, output: 17_251_100 }, syncedAt: 1_700_000_000_000 }
  });
  const asDisplayed = usage => {
    const rounded = { ...usage, requests: Math.round(usage.requests) };
    for (const field of ["input", "cacheRead", "cacheWrite", "cacheWrite1h", "output"]) {
      rounded[field] = Math.round((usage[field] / T) * 1e4) / 1e4 * T;
    }
    return rounded;
  };
  const measured = usagePresetUsage("recent30d", magpieSync);
  assert.equal(usagePresetId(asDisplayed(measured), magpieSync), "recent30d");
  // 用户真的改了一项，仍然要判成自定义。
  assert.equal(usagePresetId({ ...asDisplayed(measured), input: measured.input + 5 * T }, magpieSync), "custom");
});

test("drops an empty magpie sync state and keeps the last good numbers", () => {
  assert.equal(normalizeMagpieSyncState(null), null);
  assert.equal(normalizeMagpieSyncState({ error: "boom" }), null);
  assert.equal(normalizeMagpieSyncState({ recent7d: { usage: { requests: 7 }, syncedAt: 999 } }), null);
  assert.equal(magpieSyncLabel({ recent7d: { syncedAt: 999 } }), "还没同步过");
  const state = normalizeMagpieSyncState({ error: "boom", attemptedAt: 5, recent30d: { usage: { requests: 7 }, syncedAt: 9 } });
  assert.equal(state.error, "boom");
  assert.equal(state.recent30d.usage.requests, 7);
  assert.equal(normalizeSettings({ magpieSync: state }).magpieSync.recent30d.usage.requests, 7);
  assert.equal(normalizeSettings({}).magpieSync, null);
  assert.match(magpieSyncLabel({ error: "boom" }), /上次同步失败：boom/);
  assert.equal(magpieSyncLabel(null), "还没同步过");
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
  const unverified = getProxyPriceQuote({ input_price: 2, output_price: 3, price_currency: "USD" }, 1, 1.2, undefined, true, false);
  assert.equal(unverified.costPrices.input, 2);
  assert.deepEqual(unverified.pricingUnavailableReasons, []);
  assert.equal(getProxyPrices({ input_price: 2, price_currency: "USD" }, 1, 1.2, undefined, false, true).input, null);
});

test("keeps missing CREDITS output prices missing in comparison", () => {
  const station = {
    id: "credits-output-gap",
    name: "公益站报价",
    category: "public",
    priceCurrencyVerified: true,
    rechargeRateVerified: false
  };
  const normalized = {
    data: [{
      model_name: "model-gap",
      model_display_name: "Model Gap",
      input_price: 2,
      output_price: null,
      completion_ratio: null,
      price_currency: "CREDITS",
      enable_groups: ["Channel Gap"],
      proxy_group_name: "Channel Gap"
    }]
  };
  const [comparison] = buildComparisonRows({
    stations: [station],
    snapshots: [{ stationId: station.id, collectedAt: 1, status: "success", normalized }],
    references: { models: [] },
    usage: { input: 1_000_000, output: 1_000_000 }
  });
  const offer = comparison.offers[0];
  assert.equal(offer.quotedPrices.input, 2);
  assert.equal(offer.quotedPrices.output, null);
  assert.notEqual(offer.quotedPrices.output, offer.quotedPrices.input);
  assert.equal(getProxyPrices({ input_price: 2, completion_ratio: 3, price_currency: "CREDITS" }).output, 6);
  assert.equal(getProxyPrices({ input_price: 2, output_price: 0, completion_ratio: null, price_currency: "CREDITS" }).output, 0);
});

test("uses a 1:1 comparison rate unless recharge verification is explicitly true", () => {
  const offerFor = (station, snapshotRateVerified) => {
    const snapshot = {
      stationId: station.id,
      collectedAt: 1,
      status: "success",
      ...(snapshotRateVerified === undefined ? {} : { rechargeRateVerified: snapshotRateVerified }),
      normalized: { data: [{ model_name: "rate-model", input_price: 2, output_price: 4, price_currency: "CREDITS" }] }
    };
    const [comparison] = buildComparisonRows({
      stations: [station],
      snapshots: [snapshot],
      references: { models: [] },
      usage: { input: 1_000_000, output: 0 }
    });
    return comparison.offers[0];
  };

  const falseStation = offerFor({ id: "rate-false", rechargeRate: 7.3, rechargeRateVerified: false, priceCurrencyVerified: true }, true);
  assert.equal(falseStation.costPrices.input, 2);
  assert.equal(falseStation.monthlyCost, 2);
  assert.equal(falseStation.pricingUnavailable, false);
  assert.deepEqual(falseStation.pricingUnavailableReasons, []);

  const missingStation = offerFor({ id: "rate-missing", rechargeRate: 7.3, priceCurrencyVerified: true });
  assert.equal(missingStation.costPrices.input, 2);
  assert.equal(missingStation.monthlyCost, 2);
  assert.equal(missingStation.pricingUnavailable, false);
  assert.deepEqual(missingStation.pricingUnavailableReasons, []);

  const confirmedStation = offerFor({ id: "rate-confirmed", rechargeRate: 1.2, rechargeRateVerified: true, priceCurrencyVerified: true });
  assert.equal(confirmedStation.costPrices.input, 2.4);
  assert.equal(confirmedStation.monthlyCost, 2.4);
  assert.equal(confirmedStation.pricingUnavailable, false);

  const unverifiedCurrency = offerFor({ id: "currency-unverified", rechargeRate: 7.3, rechargeRateVerified: false, priceCurrencyVerified: false });
  assert.equal(unverifiedCurrency.costPrices, null);
  assert.equal(unverifiedCurrency.pricingUnavailable, true);
  assert.deepEqual(unverifiedCurrency.pricingUnavailableReasons, ["currency_unverified"]);
});

test("老设置里的签到字段在归一化时清掉", () => {
  const settings = normalizeSettings({
    checkinState: { "relay.example": { status: "success" } },
    checkinLoginWatch: { "relay.example": 1730000000000 },
    checkinAutomation: { "relay.example": true },
    checkinResults: { "relay.example": { status: "success" } }
  });
  for (const key of ["checkinState", "checkinLoginWatch", "checkinAutomation", "checkinResults"]) {
    assert.equal(settings[key], undefined, `${key} 应该从设置里清掉`);
  }
  const station = normalizeStation({ baseUrl: "https://relay.example", checkin: { enabled: true, lastAt: "2026-11-19" } });
  assert.equal(station.checkin, undefined);
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
  assert.equal(defaultStation.priceCurrency, "CREDITS");
  assert.equal(defaultStation.category, "paid");
  assert.equal(normalizeStation({ baseUrl: "https://relay.example", category: "benchmark" }).category, "benchmark");
  assert.equal(normalizeStation({ baseUrl: "https://relay.example", category: "unknown" }).category, "paid");
  assert.equal(normalizeStation({ baseUrl: "https://relay.example", rechargeCurrency: "USD" }).rechargeCurrency, "USD");
  assert.equal(defaultStation.rechargeCurrency, "CNY");
  const creditsStation = normalizeStation({ baseUrl: "https://relay.example", rechargeRmb: 12, rechargeCredits: 10, rechargeCurrency: "USD", priceCurrency: "CREDITS", priceCurrencyVerified: true });
  assert.equal(creditsStation.priceCurrency, "CREDITS");
  assert.equal(creditsStation.priceCurrencyVerified, true);
  assert.equal(creditsStation.rechargeCurrency, "USD");
  assert.equal(creditsStation.rechargeRmb, 12);
  assert.equal(creditsStation.rechargeCredits, 10);
});


test("isolates public stations from paid and benchmark comparisons", () => {
  const stations = [
    { id: "paid", name: "Paid", category: "paid", rechargeRate: 7, rechargeRateVerified: true, priceCurrencyVerified: true },
    { id: "benchmark", name: "Benchmark", category: "benchmark", rechargeRate: 7, rechargeRateVerified: true, priceCurrencyVerified: true },
    { id: "public-a", name: "Public A", category: "public", rechargeRate: 7, rechargeRateVerified: false, priceCurrencyVerified: true },
    { id: "public-b", name: "Public B", category: "public", rechargeRate: 3, rechargeRateVerified: false, priceCurrencyVerified: true }
  ];
  const snapshots = stations.map(station => ({
    stationId: station.id,
    collectedAt: 1,
    status: "success",
    normalized: { data: [{ model_name: "shared-model", input_price: 2, output_price: 4, price_currency: "CREDITS" }] }
  }));
  const comparisons = buildComparisonRows({
    stations,
    snapshots,
    references: { exchangeRate: 8, openRouterRechargeRate: 8, models: [{ name: "shared-model", provider: "official", input: 1, output: 1 }] },
    usage: { input: TOKENS_PER_MILLION, output: 0 }
  });
  assert.equal(comparisons.length, 2);

  const paid = comparisons.find(comparison => comparison.comparisonGroup === "standard");
  const publicComparison = comparisons.find(comparison => comparison.comparisonGroup === "public");
  assert.equal(paid.offers.length, 2);
  assert.equal(paid.offers[0].monthlyCost, 14);
  assert.deepEqual(paid.offers.map(offer => offer.stationId), ["paid", "benchmark"]);
  assert.equal(paid.offers[0].officialMonthlyCost, 8);
  assert.equal(publicComparison.offers.length, 2);
  assert.deepEqual(publicComparison.offers.map(offer => offer.stationId), ["public-a", "public-b"]);
  assert.ok(publicComparison.offers.every(offer => offer.monthlyCost === null));
  assert.ok(publicComparison.offers.every(offer => offer.officialMonthlyCost === null && offer.diffPercent === null));
  assert.ok(publicComparison.offers.every(offer => offer.costCurrency === "CREDITS"));
  assert.ok(publicComparison.offers.every(offer => !offer.recommended && !offer.recommendationLabel));
});

test("keeps unmatched public offers when paid unmatched rows are hidden", () => {
  const [comparison] = buildComparisonRows({
    stations: [{ id: "public", name: "Public", category: "public", priceCurrencyVerified: true, rechargeRateVerified: false }],
    snapshots: [{ stationId: "public", collectedAt: 1, status: "success", normalized: { data: [{ model_name: "public-only-model", input_price: 1, output_price: 2, price_currency: "CREDITS" }] } }],
    references: { models: [] },
    showUnmatched: false,
    usage: { input: TOKENS_PER_MILLION, output: 0 }
  });
  assert.ok(comparison);
  assert.equal(comparison.comparisonGroup, "public");
  assert.equal(comparison.offers[0].officialName, "");
});



test("blocks conversion when the source currency is missing or unverified", () => {
  assert.equal(currencyToRmb(undefined, 1.2), null);
  assert.equal(currencyToRmb("", 1.2), null);
  assert.equal(currencyToRmb(" unknown ", 1.2), null);
  assert.equal(currencyToRmb("UNSPECIFIED", 1.2), null);
  assert.equal(currencyToRmb("NONE", 1.2), null);
  assert.equal(currencyToRmb("CNY", 1.2), 1);
  assert.equal(currencyToRmb("RMB", 1.2), 1);
  assert.equal(currencyToRmb("¥", 1.2), 1);
  assert.equal(currencyToRmb("USD", 1.2), 1.2);
  assert.equal(currencyToRmb("CREDITS", 1.2), 1.2);
  assert.equal(currencyToRmb("POINTS", 1.2), 1.2);
  assert.equal(currencyToRmb("EUR", 1.2), null);

  const missing = getProxyPriceQuote({ input_price: 2 }, 1, 1.2, undefined, true, true);
  assert.equal(missing.costPrices, null);
  assert.ok(missing.pricingUnavailableReasons.includes("currency_unverified"));

  const stationUnverified = getProxyPriceQuote({ input_price: 2, price_currency: "CNY" }, 1, 1.2, undefined, false, true);
  assert.equal(stationUnverified.costPrices, null);
  assert.deepEqual(stationUnverified.pricingUnavailableReasons, ["currency_unverified"]);
});
test("uses manually configured pricing JSON without a network request", async () => {
  const snapshot = await collectStationInput({
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


test("preserves generic pricing currencies across payload shapes", () => {
  const rows = [
    { model_name: "generic-cny", input_price: 2, output_price: 4, price_currency: " cny " },
    { model_name: "generic-usd", input_price: 3, output_price: 6, price_currency: " usd " },
    { model_name: "generic-dollar-symbol", input_price: 2, output_price: 4, price_currency: "$" },
    { model_name: "generic-yen-symbol", input_price: 2, output_price: 4, price_currency: "¥" },
    { model_name: "generic-credits", input_price: 4, output_price: 8, price_currency: " credits " },
    { model_name: "generic-missing", input_price: 1, output_price: 2 },
    { model_name: "generic-empty", input_price: 1, output_price: 2, price_currency: "" },
    { model_name: "generic-currency", input_price: 1, output_price: 2, currency: "USD" },
    { model_name: "generic-unknown", input_price: 1, output_price: 2, price_currency: "UNKNOWN", currency: "USD" }
  ];
  for (const payload of [rows, { data: rows }, { models: rows }]) {
    const normalized = normalizePricingPayload(payload);
    assert.deepEqual(normalized.data.map(item => item.price_currency), ["CNY", "USD", "$", "¥", "CREDITS", "UNKNOWN", "UNKNOWN", "USD", "UNKNOWN"]);
  }
  for (const payload of [rows, { data: rows }, { models: rows }]) {
    const stationNormalized = normalizePricingPayload(payload, "auto", { modelListCurrency: "CREDITS", priceCurrencyVerified: true });
    assert.deepEqual(stationNormalized.data.map(item => item.price_currency), rows.map(() => "CREDITS"));
  }
  const confirmed = normalizePricingPayload({ data: [{ model_name: "generic-fallback", input_price: 1, output_price: 2 }] }, "auto", { priceCurrency: "CREDITS", priceCurrencyVerified: true });
  assert.equal(confirmed.data[0].price_currency, "CREDITS");
  const unverified = normalizePricingPayload({ data: [{ model_name: "generic-unverified", input_price: 1, output_price: 2 }] }, "auto", { priceCurrency: "CREDITS", priceCurrencyVerified: false });
  assert.equal(unverified.data[0].price_currency, "UNKNOWN");
  const rechargeOnly = normalizePricingPayload({ data: [{ model_name: "generic-recharge-only", input_price: 1, output_price: 2 }] }, "auto", { priceCurrency: "CNY", priceCurrencyVerified: false });
  assert.equal(rechargeOnly.data[0].price_currency, "UNKNOWN");
});



test("每个时段档各自成行，不再加权合并", () => {
  const [comparison] = buildComparisonRows({
    stations: [{ id: "station-tier", name: "Tier station", rechargeRate: 1, basePricePerMillion: 2 }],
    snapshots: [{ stationId: "station-tier", collectedAt: 1, status: "success", normalized: { group_ratio: { Default: 1 }, data: [
      { model_name: "tiered-model", model_display_name: "Tiered", tier_name: "peak", proxy_group_name: "Default", enable_groups: ["Default"], input_price: 10, output_price: 10, price_currency: "USD" },
      { model_name: "tiered-model", model_display_name: "Tiered", tier_name: "offpeak", proxy_group_name: "Default", enable_groups: ["Default"], input_price: 2, output_price: 2, price_currency: "USD" }
    ] } }],
    references: { exchangeRate: 1, models: [{ name: "tiered-model", provider: "official", input: 1, output: 1 }] },
    usage: { input: TOKENS_PER_MILLION, cacheRead: 0, cacheWrite: 0, output: 0, requests: 0 },
    rules: [{ id: "exact", name: "精确名称", enabled: true }]
  });
  assert.equal(comparison.offers.length, 2);
  const byTier = Object.fromEntries(comparison.offers.map(offer => [offer.tierName, offer.monthlyCost]));
  assert.equal(byTier.offpeak, 2);
  assert.equal(byTier.peak, 10);
});

test("keeps every dashboard sort key backed by a comparison row field", () => {
  const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
  const sortMenus = [...html.matchAll(/<select id="sort-(?:by|secondary)">([\s\S]*?)<\/select>/g)].map(match => match[1]).join(" ");
  const keys = [...sortMenus.matchAll(/value="([^"]+)"/g), ...html.matchAll(/data-sort-keys="([^"]+)"/g)].flatMap(match => match[1].split(" "));
  const [comparison] = buildComparisonRows({
    stations: [{ id: "station-sort", name: "Sort station", rechargeRate: 1, basePricePerMillion: 2 }],
    snapshots: [{ stationId: "station-sort", collectedAt: 1, status: "success", normalized: { data: [{ model_name: "sort-model", enable_groups: ["Default"], input_price: 1, output_price: 1 }] } }],
    references: { exchangeRate: 1, models: [{ name: "sort-model", provider: "official", input: 1, output: 1 }] },
    usage: { input: TOKENS_PER_MILLION, peakShare: 0.25 },
    rules: [{ id: "exact", name: "精确名称", enabled: true }]
  });
  const row = comparison.offers[0];
  for (const key of new Set(keys.filter(value => value !== "none"))) {
    assert.ok(key === "model" || key in row, `dashboard sort key ${key} is missing on comparison rows`);
  }
});

test("uses the page capture fallback before configured page endpoints", async () => {
  let request;
  const pageFetch = async value => { request = value; return response(pqhFixture); };
  pageFetch.supportsCapture = true;
  const snapshot = await collectStationInput({ id: "station-capture", name: "Captured", baseUrl: "https://relay.example", mode: "page" }, { pageFetch });
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
  const snapshot = await collectStationInput({ id: "station-page-endpoint", name: "Page endpoint", baseUrl: "https://relay.example", mode: "page", adapter: { endpoint: "/pricing", method: "GET", responseFormat: "auto" } }, { pageFetch });
  assert.equal(requests.length, 2);
  assert.equal(snapshot.normalized.data[0].model_name, "gpt-4o");
});

// 站点偶尔一次握手失败就抛 TypeError: Failed to fetch，这一站不该直接记成失败。
test("retries a station after a transient network failure", async () => {
  let calls = 0;
  const pageFetch = Object.assign(async () => {
    calls += 1;
    if (calls === 1) throw new TypeError("Failed to fetch");
    return response(pqhFixture);
  }, { supportsCapture: true });
  const snapshot = await collectStationInput({ id: "station-flaky", name: "Flaky", baseUrl: "https://relay.example", mode: "page" }, { pageFetch, retryDelayMs: 0 });
  assert.equal(snapshot.status, "success");
  assert.equal(calls, 2);
});

test("does not retry a station that answered with an auth failure", async () => {
  let calls = 0;
  const pageFetch = Object.assign(async () => {
    calls += 1;
    return { ok: false, status: 401, body: { message: "未授权" } };
  }, { supportsCapture: true });
  await assert.rejects(collectStationInput({ id: "station-unauthorized", name: "Unauthorized", baseUrl: "https://relay.example", mode: "page", adapter: { endpoint: "/pricing", method: "GET", responseFormat: "auto" } }, { pageFetch }));
  assert.equal(calls, 2);
});

test("reports an unreachable station in plain Chinese after exhausting retries", async () => {
  let calls = 0;
  const pageFetch = Object.assign(async () => {
    calls += 1;
    throw new TypeError("Failed to fetch");
  }, { supportsCapture: true });
  await assert.rejects(
    collectStationInput({ id: "station-down", name: "Down", baseUrl: "https://relay.example", mode: "page", adapter: { endpoint: "/pricing", method: "GET", responseFormat: "auto" } }, { pageFetch, retryDelayMs: 0 }),
    /Down 网络请求失败/
  );
  assert.equal(calls, 6);
});

test("collects CodeGo pricing catalog from its pricing page URL", async () => {
  const station = { id: "station-codego", name: "CodeGo", baseUrl: "https://codegoai.com/pricing" };
  const adapter = inferStationAdapter(station);
  let requestUrl;
  const snapshot = await collectStationInput({ ...station, adapter }, {
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

test("applies DDDai group ratio once and defers media prices to the workbench", async () => {
  const station = {
    id: "station-dddai",
    name: "DDDai",
    baseUrl: "https://dddai.dev/pricing",
    auth: { type: "bearer", token: "must-not-be-sent" }
  };
  const adapter = inferStationAdapter(station);
  assert.equal(adapter.mode, "direct");
  assert.equal(adapter.endpoint, "/api/pricing");
  assert.equal(adapter.method, "GET");
  let request;
  const snapshot = await collectStationInput({ ...station, adapter }, {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response({
        success: true,
        pricing_version: "test",
        auto_groups: ["gemini"],
        group_ratio: { gemini: 0.3 },
        usable_group: { gemini: "Gemini" },
        media_groups: { image: "media", video: "media" },
        model_group_ratio: { "gemini-2.0-flash": { gemini: 0.04411764705882353 } },
        data: [{ model_name: "gemini-2.0-flash", model_ratio: 0.05, completion_ratio: 4, enable_groups: ["gemini"] }, { model_name: "gpt-image-2", model_ratio: 0, completion_ratio: 0, quota_type: 1, model_price: 1, enable_groups: ["media"] }]
      });
    }
  });
  const model = snapshot.normalized.data[0];
  assert.equal(request.url, "https://dddai.dev/api/pricing");
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(request.init.credentials, "omit");
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.sourceFormat, "new-api-pricing");
  assert.equal(snapshot.normalized.data.length, 1);
  assert.equal(model.model_ratio, 0.015);
  assert.equal(model.group_ratio, 0.3);
  assert.deepEqual(model.enable_groups, ["gemini"]);
});


test("collects SoleAPI prices from its public API", async () => {
  const station = { id: "station-soleapi", name: "SoleAPI", baseUrl: "https://soleapi.com/zh/models", auth: { type: "bearer", token: "must-not-be-sent" }, adapter: { endpoint: "/api/zh/models", method: "POST" } };
  const adapter = inferStationAdapter(station, { enabled: true, endpoint: "/api/pricing", responseFormat: "pqh" });
  assert.equal(adapter.mode, "direct");
  assert.equal(adapter.endpoint, "/api/public/models");
  assert.equal(adapter.method, "GET");
  assert.equal(adapter.responseFormat, "auto");
  const requests = [];
  const snapshot = await collectStationInput({ ...station, mode: adapter.mode, adapter }, {
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
  assert.equal(model.price_currency, "CREDITS");
  assert.equal(model.proxy_group_name, "MiniMax Official");
  assert.equal(getProxyPrices(model, 1, 1.2).input, 3.024);
  assert.equal(imageModel.request_price, 0.004);
  assert.equal(imageModel.image_price, 0.4);
  assert.equal(getProxyPrices(imageModel, 1, 1.2).request, 0.0048);
});

test("collects Liuguang public model price books without credentials", async () => {
  const station = {
    id: "station-liuguang",
    name: "Liuguang",
    baseUrl: "https://www.liuguang.ai/pricing",
    mode: "page",
    auth: { type: "bearer", token: "must-not-be-sent" },
    adapter: { endpoint: "/wrong", method: "POST", responseFormat: "pqh" }
  };
  const adapter = inferStationAdapter(station);
  assert.equal(adapter.mode, "direct");
  assert.equal(adapter.endpoint, "/api/models");
  assert.equal(adapter.method, "GET");
  assert.equal(adapter.responseFormat, "auto");
  assert.equal(prepareStationInput({ ...station, adapter }).baseUrl, "https://www.liuguang.ai");
  let request;
  const snapshot = await collectStationInput({ ...station, adapter }, {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response({ models: [
        { id: "gpt-test", label: "GPT Test", vendor: "OpenAI", modality: "chat", priceBooks: [{ label: "Standard", book: { basis: "points", currency: "points", rules: [
          { metric: "input_tokens", amount: "2", per: 1000000, conditions: [] },
          { metric: "output_tokens", amount: "8", per: 1000000, conditions: [] },
          { metric: "cached_tokens", amount: "0.5", per: 1000000, conditions: [] },
          { metric: "cache_write_5m_tokens", amount: "3", per: 1000000, conditions: [] }
        ] } }] },
        { id: "image-test", label: "Image Test", modality: "image", priceBooks: [{ label: "Image", book: { basis: "points", currency: "points", rules: [{ metric: "images", amount: "0.4", per: 1, conditions: [] }] } }] },
        { id: "conditional", label: "Conditional", modality: "chat", priceBooks: [{ label: "Conditional", book: { basis: "points", currency: "points", rules: [
          { metric: "input_tokens", amount: "1", per: 1000000, conditions: [{ field: "resolution", op: "eq", value: "720p" }] },
          { metric: "output_tokens", amount: "2", per: 1000000, conditions: [] }
        ] } }] }
      ] });
    }
  });
  assert.equal(request.url, "https://www.liuguang.ai/api/models");
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(request.init.credentials, "omit");
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.sourceFormat, "liuguang-models");
  assert.equal(snapshot.normalized.data.length, 2);
  const chat = snapshot.normalized.data.find(item => item.model_name === "gpt-test");
  assert.equal(chat.input_price, 2);
  assert.equal(chat.output_price, 8);
  assert.equal(chat.cache_read_price, 0.5);
  assert.equal(chat.cache_write_price, 3);
  assert.equal(chat.price_currency, "CREDITS");
  assert.equal(getProxyPrices(chat, 1, 0.02).input, 0.04);
  assert.equal(snapshot.normalized.data.find(item => item.model_name === "image-test").image_price, 0.4);
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
    const snapshot = await collectStationInput({ ...station, ...adapter }, {
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


test("carries token123 pricing currencies through comparison", async () => {
  const station = {
    id: "token123",
    name: "T蜜",
    baseUrl: "https://token123.cfd",
    priceCurrency: "CREDITS",
    rechargeRate: 1.2,
    rechargeRateVerified: true,
    priceCurrencyVerified: true,
    adapter: inferStationAdapter({ baseUrl: "https://token123.cfd" })
  };
  const snapshot = await collectStationInput(station, {
    fetchImpl: async () => response({ data: [
      { model_name: "token-cny", input_price: 2, output_price: 4, price_currency: "CNY" },
      { model_name: "token-usd", input_price: 2, output_price: 4, price_currency: "USD" },
      { model_name: "token-dollar", input_price: 2, output_price: 4, price_currency: "$" },
      { model_name: "token-credits", input_price: 2, output_price: 4 }
    ] })
  });
  assert.equal(snapshot.status, "success");
  assert.deepEqual(snapshot.normalized.data.map(item => item.price_currency), ["CREDITS", "CREDITS", "CREDITS", "CREDITS"]);

  const rows = buildComparisonRows({
    stations: [station],
    snapshots: [{ stationId: station.id, collectedAt: 1, status: snapshot.status, normalized: snapshot.normalized }],
    references: { models: [] },
    usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, requests: 0 }
  });
  const offers = rows.flatMap(row => row.offers);
  const cnyOffer = offers.find(offer => offer.modelName === "token-cny");
  const usdOffer = offers.find(offer => offer.modelName === "token-usd");
  const dollarOffer = offers.find(offer => offer.modelName === "token-dollar");
  const creditsOffer = offers.find(offer => offer.modelName === "token-credits");
  assert.equal(cnyOffer.sourceCurrency, "CREDITS");
  assert.equal(cnyOffer.pricingUnavailable, false);
  assert.equal(cnyOffer.monthlyCost, 2.4);
  assert.equal(usdOffer.sourceCurrency, "CREDITS");
  assert.equal(usdOffer.pricingUnavailable, false);
  assert.equal(usdOffer.monthlyCost, 2.4);
  assert.equal(dollarOffer.sourceCurrency, "CREDITS");
  assert.equal(dollarOffer.pricingUnavailable, false);
  assert.equal(dollarOffer.monthlyCost, 2.4);
  assert.equal(creditsOffer.sourceCurrency, "CREDITS");
  assert.equal(creditsOffer.pricingUnavailable, false);
  assert.equal(creditsOffer.monthlyCost, 2.4);

  const blockedRows = buildComparisonRows({
    stations: [{ ...station, priceCurrencyVerified: false }],
    snapshots: [{ stationId: station.id, collectedAt: 1, status: snapshot.status, normalized: snapshot.normalized }],
    references: { models: [] },
    usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, requests: 0 }
  });
  for (const offer of blockedRows.flatMap(row => row.offers)) {
    assert.equal(offer.pricingUnavailable, true);
    assert.ok(offer.pricingUnavailableReasons.includes("currency_unverified"));
  }
});

test("repairs stale ordinary station currency verification before comparison", async () => {
  const savedStation = {
    id: "token123-stale",
    name: "T蜜",
    baseUrl: "https://token123.cfd",
    priceCurrency: "UNKNOWN",
    priceCurrencyVerified: false,
    rechargeRate: 1.2,
    rechargeRateVerified: true,
    adapter: inferStationAdapter({ baseUrl: "https://token123.cfd" })
  };
  const prepared = prepareStationInput(savedStation);
  assert.equal(prepared.priceCurrency, "CREDITS");
  assert.equal(prepared.priceCurrencyVerified, true);

  const snapshot = await collectStationInput(savedStation, {
    fetchImpl: async () => response({ data: [{ model_name: "stale-token-model", input_price: 2, output_price: 4 }] })
  });
  const [comparison] = buildComparisonRows({
    stations: [prepared],
    snapshots: [{ stationId: savedStation.id, collectedAt: 1, status: snapshot.status, normalized: snapshot.normalized }],
    references: { models: [] },
    usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, requests: 0 }
  });
  const offer = comparison.offers[0];
  assert.equal(offer.sourceCurrency, "CREDITS");
  assert.equal(offer.pricingUnavailable, false);
  assert.equal(offer.monthlyCost, 2.4);
});

test("canonicalizes ordinary and protected model-list currencies before comparison", async () => {
  const ordinaryStations = [
    { id: "dddai-stale", baseUrl: "https://dddai.dev/pricing", priceCurrency: "USD", priceCurrencyVerified: false, rechargeRate: 1.5, rechargeRateVerified: true },
    { id: "custom-stale", baseUrl: "https://custom-relay.example/pricing", priceCurrency: "UNKNOWN", priceCurrencyVerified: false, rechargeRmb: 2, rechargeCredits: 1, rechargeRateVerified: false }
  ];
  for (const station of ordinaryStations) {
    const prepared = prepareStationInput(station);
    assert.equal(prepared.priceCurrency, "CREDITS");
    assert.equal(prepared.priceCurrencyVerified, true);
    assert.equal(prepared.rechargeRateVerified, true);
  }

  const dddai = ordinaryStations[0];
  const preparedDddai = prepareStationInput(dddai);
  const snapshot = await collectStationInput(dddai, {
    fetchImpl: async () => response({ data: [{ model_name: "stale-dddai-model", input_price: 2, output_price: 4 }] })
  });
  assert.equal(snapshot.normalized.data[0].price_currency, "CREDITS");
  const [comparison] = buildComparisonRows({
    stations: [preparedDddai],
    snapshots: [{ stationId: dddai.id, collectedAt: 1, status: snapshot.status, normalized: snapshot.normalized }],
    references: { models: [] },
    usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, requests: 0 }
  });
  assert.equal(comparison.offers[0].sourceCurrency, "CREDITS");
  assert.equal(comparison.offers[0].pricingUnavailable, false);
  assert.equal(comparison.offers[0].monthlyCost, 3);

  const protectedProviders = [
    { id: "killai-stale", baseUrl: "https://api.killai.cc/model-plaza?embedded=1", priceCurrency: "UNKNOWN", currency: "USD", payload: killAiPricingFixture },
    { id: "fuck-stale", baseUrl: "https://fuck-everyone.com/model-plaza?embedded=1", priceCurrency: "USD", currency: "CREDITS", payload: fuckEveryoneFixture }
  ];
  for (const provider of protectedProviders) {
    const collectionInput = {
      id: `${provider.id}-collection`,
      baseUrl: provider.baseUrl,
      priceCurrency: provider.priceCurrency,
      priceCurrencyVerified: false,
      rechargeRate: 1.2,
      rechargeRateVerified: false
    };
    const collected = await collectStationInput(collectionInput, {
      fetchImpl: async () => response(provider.payload)
    });
    assert.ok(collected.normalized.data.length > 0);
    assert.ok(collected.normalized.data.every(item => item.price_currency === provider.currency));

    const getReasons = stationInput => {
      const prepared = normalizeStation(prepareStationInput(stationInput));
      const legacySnapshot = {
        ...collected,
        stationId: prepared.id,
        priceCurrencyVerified: false,
        rechargeRateVerified: false
      };
      const comparisons = buildComparisonRows({
        stations: [prepared],
        snapshots: [legacySnapshot],
        references: { models: [] },
        usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, requests: 0 }
      });
      return comparisons.flatMap(row => row.offers).flatMap(offer => offer.pricingUnavailableReasons);
    };

    for (const verification of ["missing", "false"]) {
      const stationInput = { ...collectionInput, id: `${provider.id}-${verification}` };
      if (verification === "missing") delete stationInput.priceCurrencyVerified;
      const prepared = normalizeStation(prepareStationInput(stationInput));
      assert.equal(prepared.priceCurrency, provider.currency);
      assert.equal(prepared.priceCurrencyVerified, true);
      assert.equal(prepared.rechargeRateVerified, false);
      assert.deepEqual([...new Set(getReasons(stationInput))].sort(), []);
    }

    const confirmedRateInput = { ...collectionInput, id: `${provider.id}-rate-confirmed`, rechargeRateVerified: true };
    const confirmedRate = normalizeStation(prepareStationInput(confirmedRateInput));
    assert.equal(confirmedRate.priceCurrencyVerified, true);
    assert.equal(confirmedRate.rechargeRateVerified, true);
    assert.deepEqual([...new Set(getReasons(confirmedRateInput))], []);

    const missingRateInput = { ...collectionInput, id: `${provider.id}-rate-missing` };
    delete missingRateInput.rechargeRateVerified;
    assert.equal(prepareStationInput(missingRateInput).rechargeRateVerified, false);
  }
});


test("keeps model-list credits independent from recharge payment currency", async () => {
  for (const [rechargeCurrency, rechargeRate] of [["CNY", 2], ["USD", 8]]) {
    const station = {
      id: `token123-${rechargeCurrency}`,
      name: "T蜜",
      baseUrl: "https://token123.cfd",
      rechargeCurrency,
      rechargeRate,
      rechargeRateVerified: true,
      priceCurrencyVerified: true,
      adapter: inferStationAdapter({ baseUrl: "https://token123.cfd" })
    };
    const snapshot = await collectStationInput(station, {
      fetchImpl: async () => response({ data: [{ model_name: "token-model", input_price: 2, output_price: 4 }] })
    });
    assert.equal(snapshot.normalized.data[0].price_currency, "CREDITS");
    const [comparison] = buildComparisonRows({
      stations: [station],
      snapshots: [{ stationId: station.id, collectedAt: 1, status: snapshot.status, normalized: snapshot.normalized }],
      references: { models: [] },
      usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, requests: 0 }
    });
    const offer = comparison.offers[0];
    assert.equal(offer.sourceCurrency, "CREDITS");
    assert.equal(offer.pricingUnavailable, false);
    assert.equal(offer.monthlyCost, 2 * rechargeRate);
  }
});

test("adds the missing DDDai station once for an existing registry", () => {
  const current = [{ id: "one", baseUrl: "https://soleapi.com" }];
  const stations = addProviderStationPresets(current, [providerById("dddai")]);
  assert.equal(stations.length, 2);
  assert.equal(stations[0], current[0]);
  assert.equal(stations[1].id, "dddai");
  assert.equal(stations[1].name, "dddai.dev");
  assert.equal(stations[1].baseUrl, "https://dddai.dev/pricing");
  assert.equal(stations[1].enabled, true);
  assert.equal(addProviderStationPresets(stations, [providerById("dddai")]), stations);
  const collision = addProviderStationPresets([{ id: "dddai", baseUrl: "https://other.example" }], [providerById("dddai")]);
  assert.equal(collision[1].id, "dddai-2");
  assert.equal(addProviderStationPresets([], [providerById("dddai")]).length, 1);
});
test("adds the missing Liuguang station once for an existing registry", () => {
  const current = [{ id: "one", baseUrl: "https://soleapi.com" }];
  const stations = addProviderStationPresets(current, [providerById("liuguang")]);
  assert.equal(stations.length, 2);
  assert.equal(stations[0], current[0]);
  assert.equal(stations[1].id, "liuguang");
  assert.equal(stations[1].name, "liuguang.ai");
  assert.equal(stations[1].baseUrl, "https://www.liuguang.ai/pricing");
  assert.equal(stations[1].adapter.endpoint, "/api/models");
  assert.equal(stations[1].enabled, true);
  assert.equal(addProviderStationPresets(stations, [providerById("liuguang")]), stations);
  const collision = addProviderStationPresets([{ id: "liuguang", baseUrl: "https://other.example" }], [providerById("liuguang")]);
  assert.equal(collision[1].id, "liuguang-2");
});

test("adds the missing CheapRouter station once for an existing registry", () => {
  const current = [{ id: "one", baseUrl: "https://soleapi.com" }];
  const stations = addProviderStationPresets(current, [providerById("cheaprouter")]);
  assert.equal(stations.length, 2);
  assert.equal(stations[1].id, "cheaprouter");
  assert.equal(stations[1].baseUrl, "https://cheaprouter.cc/models");
  assert.equal(stations[1].mode, "direct");
  assert.equal(stations[1].adapter.kind, "cheaprouter");
  assert.equal(stations[1].adapter.endpoint, "/api/v1/pricing/public?timezone=Asia%2FShanghai");
  assert.equal(addProviderStationPresets(stations, [providerById("cheaprouter")]), stations);
  assert.equal(addProviderStationPresets([], [providerById("cheaprouter")]).length, 1);
});


test("adds the missing FastAIToken station once for an existing registry", () => {
  const current = [{ id: "one", baseUrl: "https://soleapi.com" }];
  const stations = addProviderStationPresets(current, [providerById("fastaitoken")]);
  assert.equal(stations.length, 2);
  assert.equal(stations[0], current[0]);
  assert.equal(stations[1].baseUrl, "https://www.fastaitoken.com/available-channels");
  assert.equal(stations[1].enabled, true);
  assert.equal(addProviderStationPresets(stations, [providerById("fastaitoken")]), stations);
  const collision = addProviderStationPresets([{ id: "fastaitoken", baseUrl: "https://other.example" }], [providerById("fastaitoken")]);
  assert.equal(collision[1].id, "fastaitoken-2");
  assert.equal(addProviderStationPresets([], [providerById("fastaitoken")]).length, 1);
});

test("adds the missing NexaVlinks station once for an existing registry", () => {
  const current = [{ id: "one", baseUrl: "https://soleapi.com" }];
  const stations = addProviderStationPresets(current, [providerById("nexavlinks")]);
  assert.equal(stations.length, 2);
  assert.equal(stations[1].baseUrl, "https://www.nexavlinks.com/modelsmarket");
  assert.equal(stations[1].mode, "page");
  assert.equal(stations[1].adapter.endpoint, "/api/v1/channels/catalog?available_only=true&timezone=Asia%2FShanghai");
  assert.equal(addProviderStationPresets(stations, [providerById("nexavlinks")]), stations);
  assert.equal(addProviderStationPresets([], [providerById("nexavlinks")]).length, 1);
});

test("adds the missing CUN.AI station once for an existing registry", () => {
  const stations = addProviderStationPresets([{ id: "one", baseUrl: "https://soleapi.com" }], [providerById("cun")]);
  assert.equal(stations[1].baseUrl, "https://www.cun.ai/pricing");
  assert.equal(stations[1].mode, "page");
  assert.equal(stations[1].adapter.kind, "cun");
  assert.equal(addProviderStationPresets(stations, [providerById("cun")]), stations);
  assert.equal(addProviderStationPresets([], [providerById("cun")]).length, 1);
});

test("adds the Hepingan station preset", () => {
  const stations = addProviderStationPresets([{ id: "one", baseUrl: "https://soleapi.com" }], [providerById("hepingan")]);
  assert.equal(stations.length, 2);
  assert.equal(stations[1].id, "hepingan");
  assert.equal(stations[1].baseUrl, "https://api.hepingan.top/available-channels");
  assert.equal(stations[1].mode, "page");
  assert.equal(stations[1].adapter.endpoint, HEPINGAN_CHANNELS_ENDPOINT);
});

test("injects every registry preset and forwards the exchange rate", () => {
  const current = [{ id: "existing", baseUrl: "https://relay.example" }];
  const stations = addProviderStationPresets(current, PROVIDER_REGISTRY, { exchangeRate: 8.2 });
  const added = stations.slice(current.length);
  assert.deepEqual(new Set(added.map(station => station.id)), new Set(PROVIDER_REGISTRY.filter(entry => entry.host && entry.preset).map(entry => entry.id)));
  assert.equal(added.find(station => station.id === "sidrune").rechargeRmb, 8.2);
  assert.equal(normalizeStation(added.find(station => station.id === "sidrune")).rechargeRate, 8.2);
  const nodeAi = added.find(station => station.id === "nodeai");
  assert.equal(nodeAi.rechargeRmb, 1);
  assert.equal(nodeAi.rechargeCurrency, "CNY");
  assert.equal(nodeAi.rechargeCredits, 1);
  assert.equal(normalizeStation(nodeAi).rechargeRate, 1);
  const fuckEveryone = added.find(station => station.id === "fuck-everyone");
  assert.equal(fuckEveryone.rechargeRmb, 1);
  assert.equal(fuckEveryone.rechargeCurrency, "CNY");
  assert.equal(fuckEveryone.rechargeCredits, 1);
  assert.equal(fuckEveryone.rechargeRateVerified, false);
  assert.equal(fuckEveryone.rechargeRateNote, "站点未公开币种与充值折算，当前按 CNY 1:1 估算。");
  assert.equal(fuckEveryone.priceCurrency, "CREDITS");
  assert.equal(fuckEveryone.priceCurrencyVerified, true);
  assert.equal(normalizeStation(fuckEveryone).rechargeRateVerified, false);
  const killAi = added.find(station => station.id === "killai");
  assert.equal(killAi.mode, "direct");
  assert.equal(killAi.rechargeRmb, 1);
  assert.equal(killAi.rechargeCurrency, "CNY");
  assert.equal(killAi.rechargeCredits, 1);
  assert.equal(killAi.rechargeRateVerified, false);
  assert.equal(killAi.priceCurrency, "USD");
  assert.equal(killAi.priceCurrencyVerified, true);
  assert.equal(normalizeStation(killAi).rechargeRateVerified, false);
  const maolao = added.find(station => station.id === "maolaoapi");
  assert.equal(maolao.rechargeRmb, 1.03);
  assert.equal(maolao.rechargeCredits, 1);
  assert.equal(maolao.rechargeRateVerified, true);
  assert.equal(maolao.priceCurrency, "CREDITS");
  assert.deepEqual(normalizeStation(maolao).rechargeTiers.map(tier => [tier.amount, tier.discount]), [
    [10, 1], [20, 1], [50, 1], [100, 1], [200, 0.98], [500, 0.95], [1000, 0.9]
  ]);
  // OpenLux 的 /api/status price=1 是美元口径，自动采集会把价格算低 6.7 倍，预设里锁死了手填值。
  const openLux = added.find(station => station.id === "openlux");
  assert.equal(openLux.rechargeRmb, 6.68752);
  assert.equal(openLux.rechargeAuto, false);
  assert.equal(openLux.rechargeRateVerified, true);
  assert.equal(openLux.priceCurrency, "USD");
  assert.equal(normalizeStation(openLux).rechargeAuto, false);
  assert.equal(normalizeStation(openLux).rechargeRate, 6.68752);
  assert.deepEqual(normalizeStation(openLux).rechargeTiers.map(tier => [tier.amount, tier.discount]).slice(0, 2), [[10, 0.99], [50, 0.985]]);
});
test("allocates a unique preset id when an existing station uses the provider id", () => {
  const stations = addProviderStationPresets([{ id: "dddai", baseUrl: "https://other.example" }], PROVIDER_REGISTRY);
  const dddai = stations.find(station => station.baseUrl === "https://dddai.dev/pricing");
  assert.equal(dddai.id, "dddai-2");
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
  const snapshot = await collectStationInput(station, { pageFetch });
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
  const capturedSnapshot = await collectStationInput(station, { pageFetch: capturedPageFetch });
  assert.equal(capturedSnapshot.normalized.data[0].input_price, 2);
});

test("normalizes Hepingan channel prices from an authenticated page capture", async () => {
  const station = { id: "station-hepingan", name: "hepingan.top", baseUrl: "https://api.hepingan.top/available-channels", mode: "page" };
  const prepared = prepareStationInput({ baseUrl: "https://api.hepingan.top" });
  assert.equal(prepared.baseUrl, "https://api.hepingan.top/available-channels");
  assert.equal(prepared.adapter.endpoint, HEPINGAN_CHANNELS_ENDPOINT);
  let captureCount = 0;
  const pageFetch = async request => {
    assert.equal(request.capture, true);
    captureCount += 1;
    return {
      ok: true,
      status: 200,
      body: { data: [{ name: "Hepingan", platforms: [{ platform: "OpenAI", groups: [{ id: 1, name: "default", rate_multiplier: 1 }], supported_models: [{ model_id: "gpt-4o", name: "GPT-4o", pricing: { input_price: 0.000001, output_price: 0.000002 }, group_pricing: { "1": { input_price: 0.000001, output_price: 0.000002 } } }] }] }] }
    };
  };
  pageFetch.supportsCapture = true;
  const snapshot = await collectStationInput(station, { pageFetch });
  assert.equal(captureCount, 1);
  const collection = resolveStationCollection(station);
  assert.equal(collection.request.credentials, "include");
  assert.equal(collection.request.pageAuth.storageKey, "auth_token");
  assert.equal(collection.request.pageAuth.header, "Authorization");
  assert.equal(collection.request.pageAuth.scheme, "Bearer");
  assert.deepEqual(collection.request.pageAuth.sessionFailureStatuses, [401]);
  assert.deepEqual(collection.request.pageAuth.refresh, {
    endpoint: "/api/v1/auth/refresh",
    credentials: "same-origin",
    requestTokenKey: "refresh_token",
    responsePath: "data",
    accessTokenKey: "access_token",
    refreshTokenStorageKey: "refresh_token",
    refreshTokenKey: "refresh_token",
    expiresInKey: "expires_in",
    expiresAtStorageKey: "token_expires_at",
    statuses: [401]
  });
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.data[0].model_name, "gpt-4o");
  assert.equal(snapshot.normalized.data[0].input_price, 1);
  assert.equal(snapshot.normalized.data[0].output_price, 2);
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
  const snapshot = await collectStationInput({ id: "station-a", name: "A", baseUrl: "https://relay.example", adapter: { endpoint: "/pricing", method: "GET", responseFormat: "auto" } }, {
    fetchImpl: async () => response(pqhFixture)
  });
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.data[0].model_name, "gpt-4o");
  assert.equal(snapshot.normalizationVersion, NORMALIZATION_VERSION);
});

test("probes a public model-list URL without credentials", async () => {
  let request;
  const snapshot = await collectStationInput({ id: "station-models", name: "Models", baseUrl: "https://relay.example/v1/models", adapter: { endpoint: "/v1/models", method: "GET", responseFormat: "auto" } }, {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response({ data: [{ id: "gpt-4o", name: "GPT-4o" }] });
    }
  });
  assert.equal(request.url, "https://relay.example/v1/models");
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(request.init.credentials, "omit");
  assert.equal(snapshot.normalized.data[0].model_name, "gpt-4o");
});

test("collects New API pricing from a pricing page URL", async () => {
  const requests = [];
  const snapshot = await collectStationInput({
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
test("normalizes NodeAI model-plaza pricing with explicit dispatch", () => {
  const normalized = normalizePricingPayload(nodeAiFixture, "nodeai-model-plaza");
  assert.equal(normalized.sourceFormat, "nodeai-model-plaza");
  assert.deepEqual(normalized.group_ratio, { Image: 0.8, Text: 1.5 });
  assert.equal(normalized.data.length, 4);

  const image = normalized.data.find(model => model.model_name === "node-image");
  assert.equal(image.image_price, 2.5);
  assert.equal(image.request_price, null);
  assert.equal(image.group_ratio, 0.8);
  assert.equal(image.price_currency, "CNY");
  const imagePrices = getProxyPrices(image, 1, 7.2);
  assert.equal(imagePrices.imagePrice, 2.5);
  assert.equal(workloadCost(imagePrices, { requests: 100, images: 2 }), 5);
  assert.equal(workloadCost(imagePrices, { requests: 100 }), 0);
  const imageGeneration = normalized.data.find(model => model.model_name === "node-image-generation");
  assert.equal(imageGeneration.image_price, 0.125);
  assert.equal(imageGeneration.request_price, null);

  const request = normalized.data.find(model => model.model_name === "node-request");
  assert.ok(Math.abs(request.request_price - 0.6) < 1e-12);
  assert.equal(request.image_price, null);

  const text = normalized.data.find(model => model.model_name === "node-text");
  assert.equal(text.input_price, 1.5);
  assert.equal(text.output_price, 3);
  assert.equal(text.cache_read_price, 0.15);
  assert.equal(text.price_currency, "CNY");
  const textPrices = getProxyPrices(text, 1, 7.2);
  assert.equal(textPrices.input, 1.5);
  assert.equal(textPrices.output, 3);
  assert.equal(text.cache_write_price, null);

  const direct = normalizeProxyData(nodeAiFixture, { responseFormat: "nodeai-model-plaza" });
  assert.equal(direct.sourceFormat, "nodeai-model-plaza");
});
test("normalizes KillAI model-plaza token intervals and image fields without asserting a currency", () => {
  const normalized = normalizePricingPayload(killAiFixture, "killai-model-plaza");
  assert.equal(normalized.sourceFormat, "killai-model-plaza");
  assert.deepEqual(normalized.group_ratio, { Text: 1.5, Image: 2, Request: 1.5 });
  assert.equal(normalized.data.length, 4);
  assert.notEqual(normalized.incomplete, true);
  assert.equal(normalized.unsupportedBillingModes, undefined);

  const standard = normalized.data.find(model => model.tier_name === "standard");
  assert.equal(standard.input_price, 1.5);
  assert.equal(standard.output_price, 6);
  assert.equal(standard.cache_read_price, 0.3);
  const long = normalized.data.find(model => model.tier_name === "long");
  assert.equal(long.input_price, 3);
  assert.equal(long.output_price, 9);
  assert.equal(long.cache_read_price, 0.6);

  const image = normalized.data.find(model => model.model_name === "kill-image");
  assert.equal(image.image_input_price, 6);
  assert.equal(image.image_output_price, 8);
  assert.equal(image.image_price, null);
  assert.equal(image.price_currency, "UNKNOWN");

  const request = normalized.data.find(model => model.model_name === "kill-request");
  assert.ok(request);
  assert.ok(Math.abs(request.request_price - 0.3) < 1e-12);
  assert.deepEqual({
    input: request.input_price,
    output: request.output_price,
    cacheRead: request.cache_read_price,
    cacheWrite: request.cache_write_price,
    cacheWrite1h: request.cache_write_1h_price ?? null,
    imageInput: request.image_input_price,
    imageOutput: request.image_output_price,
    imagePrice: request.image_price
  }, {
    input: null,
    output: null,
    cacheRead: null,
    cacheWrite: null,
    cacheWrite1h: null,
    imageInput: null,
    imageOutput: null,
    imagePrice: null
  });
  const aliasFixture = structuredClone(killAiFixture);
  const aliasPricing = aliasFixture.data.groups.find(group => group.id === "request").models[0].pricing;
  aliasPricing.request_price = aliasPricing.per_request_price;
  delete aliasPricing.per_request_price;
  const aliasRequest = normalizePricingPayload(aliasFixture, "killai-model-plaza").data.find(model => model.model_name === "kill-request");
  assert.ok(Math.abs(aliasRequest.request_price - 0.3) < 1e-12);
});


test("does not misclassify NodeAI model-plaza payloads in auto mode", () => {
  const normalized = normalizePricingPayload(nodeAiFixture);
  assert.equal(normalized.sourceFormat, "unknown");
  assert.deepEqual(normalized.data, []);
});

test("normalizes fuck-everyone model-plaza token, image, and per-request pricing", () => {
  const unknown = normalizePricingPayload(fuckEveryoneFixture, "fuck-everyone-model-plaza");
  assert.equal(unknown.sourceFormat, "fuck-everyone-model-plaza");
  assert.deepEqual(unknown.group_ratio, { Text: 1.5, Image: 2, Video: 1 });
  assert.equal(unknown.data.length, 3);
  assert.ok(unknown.data.every(model => model.price_currency === "UNKNOWN"));
  assert.ok(Math.abs(unknown.data.find(model => model.model_name === "text-model").cache_write_1h_price - 0.45) < 1e-12);
  assert.equal(unknown.data.find(model => model.model_name === "image-model").image_output_price, 50000);
  assert.equal(unknown.data.find(model => model.model_name === "video-model").request_price, 0.24);

  const confirmed = normalizePricingPayload(fuckEveryoneFixture, "fuck-everyone-model-plaza", { priceCurrency: "CNY" });
  const image = confirmed.data.find(model => model.model_name === "image-model");
  const text = confirmed.data.find(model => model.model_name === "text-model");
  const imagePrices = getProxyPrices(image, 1, 1, 2, true);
  const textPrices = getProxyPrices(text, 1, 1, 2, true);
  assert.equal(image.price_currency, "CNY");
  assert.equal(imagePrices.imageInput, 3.75);
  assert.equal(imagePrices.imageOutput, 50000);
  assert.ok(Math.abs(textPrices.cacheWrite1h - 0.45) < 1e-12);
  assert.ok(Math.abs(workloadCost(textPrices, { cacheWrite1h: 1_000_000 }) - 0.45) < 1e-12);
});

test("prices fuck-everyone video billing_mode as per-request video quotes", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/fuck-everyone-video-pricing.json", import.meta.url), "utf8"));
  const normalized = normalizePricingPayload(fixture, "fuck-everyone-model-plaza", { priceCurrency: "CREDITS", priceCurrencyVerified: true });
  assert.equal(normalized.unsupportedBillingModes, undefined);
  assert.deepEqual(normalized.data.map(row => [row.proxy_group_name, Number(row.request_price.toFixed(6)), row.media_type]), [
    ["grok特价", 0.0008, "video"],
    ["grok heavy", 0.0112, "video"],
    ["视频分组", 0.04, "video"]
  ]);
});

test("collects the captured fuck-everyone video payload anonymously", async () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/fuck-everyone-video-pricing.json", import.meta.url), "utf8"));
  const [, preset] = addProviderStationPresets([{ id: "seed", baseUrl: "https://seed.example" }], [providerById("fuck-everyone")]);
  const adapter = inferStationAdapter(preset);
  let request;
  const snapshot = await collectStationInput({ ...preset, adapter }, {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response(fixture);
    }
  });
  assert.equal(request.url, "https://fuck-everyone.com/api/v1/model-plaza");
  assert.equal(request.init.credentials, "omit");
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.unsupportedBillingModes, undefined);
  assert.deepEqual(snapshot.normalized.data.map(row => [row.proxy_group_name, Number(row.request_price.toFixed(6)), row.media_type]), [
    ["grok特价", 0.0008, "video"],
    ["grok heavy", 0.0112, "video"],
    ["视频分组", 0.04, "video"]
  ]);
});
test("shares partial diagnostic formatting across refresh consumers", () => {
  const diagnostics = getPartialDiagnostics({
    unsupportedBillingModes: ["per_second"],
    invalidPricingValues: ["Tiered:tiered-model:interval:1"],
    unpricedModels: ["Missing:shared-model:default"],
    filteredChannels: ["model-a:Private channel"]
  });
  assert.deepEqual(diagnostics.reasons, [
    { key: "unsupportedBillingModes", values: ["per_second"], message: "部分计费模式未解析：per_second" },
    { key: "invalidPricingValues", values: ["Tiered:tiered-model:interval:1"], message: "价格字段异常：Tiered:tiered-model:interval:1" },
    { key: "unpricedModels", values: ["Missing:shared-model:default"], message: "未定价模型：Missing:shared-model:default" },
    { key: "filteredChannels", values: ["model-a:Private channel"], message: "已过滤渠道：model-a:Private channel" }
  ]);
  assert.equal(diagnostics.message, "部分计费模式未解析：per_second；价格字段异常：Tiered:tiered-model:interval:1；未定价模型：Missing:shared-model:default；已过滤渠道：model-a:Private channel");
  assert.equal(getPartialDiagnostics().message, "部分解析");
});

test("keeps tier-level model-plaza gaps across unlabeled interval order", async () => {
  const [, preset] = addProviderStationPresets([{ id: "seed", baseUrl: "https://seed.example" }], [providerById("fuck-everyone")]);
  const adapter = inferStationAdapter(preset);
  const settings = { ...preset, adapter, priceCurrency: "CNY", priceCurrencyVerified: true, rechargeRateVerified: true };
  const createFixture = intervals => ({
    code: 0,
    message: "success",
    data: {
      groups: [{
        name: "Tiered",
        rate_multiplier: 1,
        user_rate_multiplier: 1,
        models: [{ name: "tiered-model", pricing: { billing_mode: "token", intervals } }]
      }]
    }
  });

  for (const [intervals, missingIndex] of [
    [[{ input_price: 0.000001, output_price: 0.000002 }, {}], 1],
    [[{}, { input_price: 0.000001, output_price: 0.000002 }], 0]
  ]) {
    const fixture = createFixture(intervals);
    const normalized = normalizePricingPayload(fixture, "fuck-everyone-model-plaza", { priceCurrency: "CNY" });
    assert.equal(normalized.data.length, 1);
    assert.equal(normalized.incomplete, true);
    assert.deepEqual(normalized.unpricedModels, [`Tiered:tiered-model:interval:${missingIndex}`]);
    const snapshot = await collectStationInput(settings, { fetchImpl: async () => response(fixture) });
    assert.equal(snapshot.status, "partial");
    assert.deepEqual(snapshot.normalized.unpricedModels, [`Tiered:tiered-model:interval:${missingIndex}`]);
    const [comparison] = buildComparisonRows({
      stations: [settings],
      snapshots: [{ stationId: settings.id, collectedAt: 1, status: snapshot.status, normalized: snapshot.normalized }],
      references: { models: [{ name: "tiered-model", provider: "openai", input: 1, output: 1 }] },
      usage: { input: 1_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, requests: 0 }
    });
    const tierOffer = comparison.offers.find(offer => offer.modelName === "tiered-model");
    assert.ok(tierOffer);
    assert.ok(Number.isFinite(tierOffer.quotedPrices.input));
    assert.equal(tierOffer.costPrices, null);
    assert.equal(tierOffer.monthlyCost, null);
    assert.equal(tierOffer.diffPercent, null);
    assert.equal(tierOffer.recommendationEligible, false);
    assert.equal(tierOffer.recommended, false);
  }
});


test("renders the one-hour cache write price in dashboard price lines", () => {
  assert.deepEqual(dashboardPriceLines({ input: 1, output: 2, cacheWrite1h: 3 }).find(([label]) => label === "缓存写入（1h）"), ["缓存写入（1h）", 3, false]);
});


test("keeps screenshot model quotes in source USD while gating converted comparison costs", () => {
  assert.equal(formatSourcePrice(10, "USD"), "$10");
  assert.equal(formatSourcePrice(0.09, "CREDITS"), "0.09");
  assert.equal(formatSourcePrice(0.1313, "CREDITS", 6), "0.1313");
  assert.equal(formatSourcePrice(0.375, "CNY"), "¥0.375");
  const station = {
    id: "station-fuck-everyone-screenshot",
    name: "fuck-everyone.com",
    rechargeRate: 7.3,
    rechargeRateVerified: false,
    priceCurrency: "USD",
    priceCurrencyVerified: false,
    basePricePerMillion: 2
  };
  const normalized = normalizePricingPayload(fuckEveryoneScreenshotFixture, "fuck-everyone-model-plaza", { priceCurrency: "USD" });
  const fable = normalized.data.find(model => model.model_name === "claude-fable-5");
  assert.equal(fable.input_price, 10);
  assert.equal(fable.output_price, 50);
  const [comparison] = buildComparisonRows({
    stations: [station],
    snapshots: [{ stationId: station.id, collectedAt: 1, status: "success", normalized }],
    references: { models: [] },
    usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, requests: 0 }
  });
  const offer = comparison.offers.find(item => item.modelName === "claude-fable-5");
  assert.equal(offer.sourceCurrency, "USD");
  assert.equal(offer.quotedPrices.input, 10);
  assert.equal(offer.prices.input, 10);
  assert.equal(offer.costPrices, null);
  assert.equal(offer.monthlyCost, null);
  assert.equal(offer.diffPercent, null);
  assert.equal(offer.recommendationEligible, false);
  assert.equal(offer.recommended, false);

  const [confirmedComparison] = buildComparisonRows({
    stations: [{ ...station, priceCurrencyVerified: true, rechargeRateVerified: true }],
    snapshots: [{ stationId: station.id, collectedAt: 1, status: "success", normalized }],
    references: { models: [] },
    usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, requests: 0 }
  });
  const confirmedOffer = confirmedComparison.offers.find(item => item.modelName === "claude-fable-5");
  assert.equal(confirmedOffer.quotedPrices.input, 10);
  assert.equal(confirmedOffer.costPrices.input, 73);
  assert.equal(confirmedOffer.monthlyCost, 73);

  const [fallbackComparison] = buildComparisonRows({
    stations: [{ ...station, priceCurrencyVerified: true }],
    snapshots: [{ stationId: station.id, collectedAt: 1, status: "success", normalized }],
    references: { models: [] },
    usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, requests: 0 }
  });
  const fallbackOffer = fallbackComparison.offers.find(item => item.modelName === "claude-fable-5");
  assert.equal(fallbackOffer.costPrices.input, 10);
  assert.equal(fallbackOffer.monthlyCost, 10);
  assert.deepEqual(fallbackOffer.pricingUnavailableReasons, []);

  const [emptyComparison] = buildComparisonRows({
    stations: [station],
    snapshots: [{ stationId: station.id, collectedAt: 1, status: "success", normalized: { data: [{ model_name: "empty-model", price_currency: "USD" }] } }],
    references: { models: [] },
    usage: { input: 1_000_000 }
  });
  const emptyOffer = emptyComparison.offers[0];
  assert.equal(emptyOffer.quotedPrices, null);
  assert.ok(emptyOffer.pricingUnavailableReasons.includes("price_missing"));
});

test("collects fuck-everyone directly and compares unconfirmed recharge rates at 1:1", async () => {
  const [, preset] = addProviderStationPresets([{ id: "seed", baseUrl: "https://seed.example" }], [providerById("fuck-everyone")]);
  assert.equal(preset.priceCurrency, "CREDITS");
  const adapter = inferStationAdapter(preset);
  assert.equal(adapter.endpoint, "/api/v1/model-plaza");
  assert.equal(adapter.responseFormat, "fuck-everyone-model-plaza");
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init };
    return response(fuckEveryoneFixture);
  };
  const unknownSnapshot = await collectStationInput({ ...preset, adapter }, { fetchImpl });
  assert.equal(request.url, "https://fuck-everyone.com/api/v1/model-plaza");
  assert.equal(request.init.credentials, "omit");
  assert.equal(unknownSnapshot.normalized.data[0].price_currency, "CREDITS");

  const confirmedSnapshot = await collectStationInput({ ...preset, adapter, priceCurrency: "CNY", priceCurrencyVerified: true }, { fetchImpl });
  assert.equal(confirmedSnapshot.normalized.data[0].price_currency, "CREDITS");
  const partialFixture = structuredClone(fuckEveryoneFixture);
  partialFixture.data.groups[0].models.push({ name: "seconds-model", pricing: { billing_mode: "per_second", per_second_price: 0.1 } });
  const partialSnapshot = await collectStationInput({ ...preset, adapter, priceCurrency: "CNY", priceCurrencyVerified: true, rechargeRateVerified: true }, { fetchImpl: async () => response(partialFixture) });
  assert.equal(partialSnapshot.status, "partial");
  assert.deepEqual(partialSnapshot.normalized.unsupportedBillingModes, ["per_second"]);
  assert.equal(partialSnapshot.normalized.data.some(model => model.model_name === "seconds-model"), false);
  const partialRows = buildComparisonRows({
    stations: [preset],
    snapshots: [partialSnapshot],
    references: { models: [{ name: "image-model", provider: "openai", input: 1, output: 1 }] },
    usage: DEFAULT_MONTHLY_USAGE
  });
  const partialOffer = partialRows.find(row => row.canonicalModel === "image-model")?.offers[0];
  assert.equal(partialOffer.incomplete, true);
  assert.deepEqual(partialOffer.unsupportedBillingModes, ["per_second"]);
  const unpricedFixture = structuredClone(fuckEveryoneFixture);
  unpricedFixture.data.groups[0].models.push({ name: "unpriced-model", pricing: { billing_mode: "token" } });
  const unpricedSnapshot = await collectStationInput({ ...preset, adapter, priceCurrency: "CNY", priceCurrencyVerified: true, rechargeRateVerified: true }, { fetchImpl: async () => response(unpricedFixture) });
  assert.equal(unpricedSnapshot.status, "partial");
  assert.deepEqual(unpricedSnapshot.normalized.unpricedModels, ["Text:unpriced-model:default"]);
  assert.deepEqual(unpricedSnapshot.rawMeta.unpricedModels, ["Text:unpriced-model:default"]);
  const unpricedRows = buildComparisonRows({
    stations: [{ ...preset, priceCurrency: "CNY", priceCurrencyVerified: true, rechargeRateVerified: true }],
    snapshots: [unpricedSnapshot],
    references: { models: [{ name: "text-model", provider: "openai", input: 1, output: 1 }] },
    usage: DEFAULT_MONTHLY_USAGE
  });
  const unpricedOffer = unpricedRows.find(row => row.canonicalModel === "text-model")?.offers[0];
  assert.equal(unpricedOffer.incomplete, true);
  assert.deepEqual(unpricedOffer.unpricedModels, ["Text:unpriced-model:default"]);
  const verifiedSnapshot = await collectStationInput({ ...preset, adapter, priceCurrency: "CNY", priceCurrencyVerified: true, rechargeRateVerified: true }, { fetchImpl });

  const rows = addRecommendationStatus(buildComparisonRows({
    stations: [preset],
    snapshots: [unknownSnapshot],
    references: { models: [{ name: "image-model", provider: "openai", input: 1, output: 1 }] },
    usage: DEFAULT_MONTHLY_USAGE
  }));
  const offer = rows.find(row => row.canonicalModel === "image-model")?.offers[0];
  assert.equal(offer.pricingUnavailable, false);
  assert.equal(offer.pricingUnavailableReasons.includes("recharge_unverified"), false);
  assert.ok(Number.isFinite(offer.monthlyCost));
  assert.equal(offer.recommendationEligible, true);
  assert.equal(offer.recommended, true);
  const rechargeRows = buildComparisonRows({
    stations: [{ ...preset, priceCurrency: "CNY", priceCurrencyVerified: true }],
    snapshots: [confirmedSnapshot],
    references: { models: [{ name: "image-model", provider: "openai", input: 1, output: 1 }] },
    usage: DEFAULT_MONTHLY_USAGE
  });
  assert.equal(rechargeRows.find(row => row.canonicalModel === "image-model")?.offers[0].pricingUnavailable, false);

  const incompleteRows = buildComparisonRows({
    stations: [{ ...preset, rechargeRateVerified: true }],
    snapshots: [verifiedSnapshot],
    references: { models: [{ name: "image-model", provider: "openai", input: 1, output: 1 }] },
    usage: { ...DEFAULT_MONTHLY_USAGE, cacheWrite1h: 1_000_000 }
  });
  assert.equal(incompleteRows.find(row => row.canonicalModel === "image-model")?.offers[0].pricingUnavailable, true);
});


test("keeps model-plaza unpriced diagnostics for empty and mixed groups", async () => {
  const [, preset] = addProviderStationPresets([{ id: "seed", baseUrl: "https://seed.example" }], [providerById("fuck-everyone")]);
  const adapter = inferStationAdapter(preset);
  const settings = { ...preset, adapter, priceCurrency: "CNY", priceCurrencyVerified: true, rechargeRateVerified: true };
  const emptyFixture = {
    code: 0,
    message: "success",
    data: { groups: [{ name: "Empty", rate_multiplier: 1, models: [{ name: "empty-model", pricing: { billing_mode: "token" } }] }] }
  };
  const emptySnapshot = await collectStationInput(settings, { fetchImpl: async () => response(emptyFixture) });
  assert.equal(emptySnapshot.status, "partial");
  assert.deepEqual(emptySnapshot.normalized.data, []);
  assert.deepEqual(emptySnapshot.normalized.unpricedModels, ["Empty:empty-model:default"]);
  assert.deepEqual(emptySnapshot.rawMeta.unpricedModels, ["Empty:empty-model:default"]);

  const mixedFixture = {
    code: 0,
    message: "success",
    data: {
      groups: [
        { name: "Paid", rate_multiplier: 1, models: [{ name: "shared-model", pricing: { billing_mode: "token", input_price: 0.000001, output_price: 0.000002 } }] },
        { name: "Missing", rate_multiplier: 1, models: [{ name: "shared-model", pricing: { billing_mode: "token" } }] }
      ]
    }
  };
  const mixedSnapshot = await collectStationInput(settings, { fetchImpl: async () => response(mixedFixture) });
  assert.equal(mixedSnapshot.status, "partial");
  assert.equal(mixedSnapshot.normalized.data.length, 1);
  assert.equal(mixedSnapshot.normalized.data[0].proxy_group_name, "Paid");
  assert.deepEqual(mixedSnapshot.normalized.unpricedModels, ["Missing:shared-model:default"]);
  const reversedFixture = structuredClone(mixedFixture);
  reversedFixture.data.groups.reverse();
  const reversed = normalizePricingPayload(reversedFixture, "fuck-everyone-model-plaza", { priceCurrency: "CNY" });
  assert.deepEqual(reversed.unpricedModels, ["Missing:shared-model:default"]);
});

test("migrates legacy fuck-everyone UNKNOWN source currency during station preparation", async () => {
  const legacy = {
    id: "station-fuck-everyone-legacy",
    name: "fuck-everyone.com",
    baseUrl: "https://fuck-everyone.com/model-plaza?embedded=1",
    priceCurrency: "UNKNOWN",
  };
  const prepared = prepareStationInput(legacy);
  assert.equal(prepared.priceCurrency, "CREDITS");
  assert.equal(prepared.priceCurrencyVerified, true);
  assert.equal(prepared.rechargeRateVerified, false);

  const snapshot = await collectStationInput(legacy, { fetchImpl: async () => response(fuckEveryoneScreenshotFixture) });
  assert.equal(snapshot.normalized.data[0].price_currency, "CREDITS");
  assert.equal(snapshot.priceCurrencyVerified, true);
  assert.equal(snapshot.rechargeRateVerified, false);
  const comparisons = buildComparisonRows({
    stations: [prepared],
    snapshots: [snapshot],
    references: { models: [] },
    usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, requests: 0 }
  });
  const offer = comparisons.flatMap(comparison => comparison.offers)[0];
  assert.equal(offer.pricingUnavailable, false);
  assert.equal(offer.pricingUnavailableReasons.includes("recharge_unverified"), false);
  assert.ok(Number.isFinite(offer.costPrices.input));
  const confirmedUnknown = prepareStationInput({ ...legacy, priceCurrencyVerified: true });
  assert.equal(confirmedUnknown.priceCurrency, "CREDITS");
  assert.equal(confirmedUnknown.priceCurrencyVerified, true);
});

test("rejects invalid model-plaza multipliers and per-request prices", async () => {
  const [, preset] = addProviderStationPresets([{ id: "seed", baseUrl: "https://seed.example" }], [providerById("fuck-everyone")]);
  const adapter = inferStationAdapter(preset);
  const invalidMultiplier = structuredClone(fuckEveryoneFixture);
  invalidMultiplier.data.groups[0].rate_multiplier = -1;
  await assert.rejects(() => collectStationInput({ ...preset, adapter }, { fetchImpl: async () => response(invalidMultiplier) }), /价格数据校验失败/);
  const parsedInvalidRate = normalizePricingPayload(invalidMultiplier, "fuck-everyone-model-plaza");
  assert.equal(parsedInvalidRate.data.some(row => row.model_name === "text-model"), false);
  assert.deepEqual(parsedInvalidRate.invalidPricingValues, ["Text:multiplier"]);
  assert.deepEqual(parsedInvalidRate.unpricedModels, ["Text:text-model:default"]);
  const invalidGroupMultiplier = structuredClone(fuckEveryoneFixture);
  invalidGroupMultiplier.data.groups[0].user_rate_multiplier = "not-a-multiplier";
  const parsedInvalidGroup = normalizePricingPayload(invalidGroupMultiplier, "fuck-everyone-model-plaza");
  assert.equal(parsedInvalidGroup.data.some(row => row.model_name === "text-model"), false);
  assert.deepEqual(parsedInvalidGroup.invalidPricingValues, ["Text:multiplier"]);
  assert.deepEqual(parsedInvalidGroup.unpricedModels, ["Text:text-model:default"]);
  const invalidRequestPrice = structuredClone(fuckEveryoneFixture);
  invalidRequestPrice.data.groups[2].models[0].pricing.per_request_price = "not-a-price";
  await assert.rejects(() => collectStationInput({ ...preset, adapter }, { fetchImpl: async () => response(invalidRequestPrice) }), /价格数据校验失败/);
  const parsed = normalizePricingPayload(invalidRequestPrice, "fuck-everyone-model-plaza");
  assert.equal(parsed.incomplete, true);
  assert.deepEqual(parsed.invalidPricingValues, ["video-model"]);
  const invalidRows = buildComparisonRows({
    stations: [{ ...preset, priceCurrency: "CNY", priceCurrencyVerified: true, rechargeRateVerified: true }],
    snapshots: [{ stationId: preset.id, status: "partial", collectedAt: 1, normalized: parsed }],
    references: { models: [{ name: "text-model", provider: "openai", input: 1, output: 1 }] },
    usage: DEFAULT_MONTHLY_USAGE
  });
  assert.deepEqual(invalidRows.find(row => row.canonicalModel === "text-model")?.offers[0].invalidPricingValues, ["video-model"]);
});

test("refreshes snapshots created before normalization changes", () => {
  const station = { baseUrl: "https://www.jiji.cc/extension/models", adapter: { kind: "jiji" } };
  assert.equal(snapshotNeedsRefresh(station, { normalizationVersion: NORMALIZATION_VERSION - 1 }), true);
  assert.equal(snapshotNeedsRefresh(station, { normalizationVersion: 17 }), true);
  assert.equal(snapshotNeedsRefresh(station, { normalizationVersion: 18 }), true);
  assert.equal(snapshotNeedsRefresh(station, { normalizationVersion: NORMALIZATION_VERSION }), false);
  assert.equal(snapshotNeedsRefresh({ baseUrl: "https://relay.example" }, { normalizationVersion: NORMALIZATION_VERSION - 1 }), true);
  assert.equal(snapshotNeedsRefresh({ baseUrl: "https://relay.example" }, { normalizationVersion: NORMALIZATION_VERSION }), false);
});

test("keeps Jiji model-plaza prices in CNY per-million units", () => {
  const normalized = normalizePricingPayload({ code: 0, data: { groups: [{ name: "Claude Code Max", rate_multiplier: 1.5, models: [{ name: "claude-fable-5", pricing: { input_price: "10", output_price: "50", cache_read_price: "1", per_request_price: "0.2" } }] }] } });
  const [model] = normalized.data;
  assert.equal(normalized.sourceFormat, "jiji");
  assert.equal(model.input_price, 15);
  assert.equal(model.output_price, 75);
  assert.equal(model.cache_read_price, 1.5);
  assert.ok(Math.abs(model.request_price - 0.3) < 1e-12);
  assert.equal(model.price_currency, "CNY");
});

test("normalizes Sidrune model-plaza public pricing", () => {
  const normalized = normalizePricingPayload({
    code: 0,
    data: {
      groups: [
        { id: "default", name: "Default", rate_multiplier: 2 },
        { id: "promo", name: "Promo", rate_multiplier: 3, promo_active: true, promo_rate_multiplier: 1.5 }
      ],
      pricing: [
        {
          name: "gpt-sidrune",
          group_ids: ["default", "promo"],
          input_price: 0.000002,
          output_price: 0.000008,
          cache_read_price: 0.0000002,
          cache_write_price: 0.0000005
        },
        {
          name: "image-sidrune",
          group_ids: ["promo"],
          billing_mode: "image",
          intervals: [{ tier_label: "1K", per_request_price: 0.15 }]
        }
      ]
    }
  });
  assert.equal(normalized.sourceFormat, "sidrune-model-plaza");
  assert.deepEqual(normalized.group_ratio, { Default: 2, Promo: 1.5 });
  const defaultModel = normalized.data.find(model => model.proxy_group_name === "Default");
  const promoModel = normalized.data.find(model => model.proxy_group_name === "Promo" && model.model_name === "gpt-sidrune");
  const imageModel = normalized.data.find(model => model.model_name === "image-sidrune");
  assert.equal(defaultModel.input_price, 4);
  assert.equal(defaultModel.output_price, 16);
  assert.ok(Math.abs(defaultModel.cache_read_price - 0.4) < 1e-12);
  assert.equal(promoModel.input_price, 3);
  assert.equal(promoModel.group_ratio, 1.5);
  // 按张的价落在 image_price 上，走 media_type 分榜；request_price 只留按次计费的站点。
  assert.equal(imageModel.size_tier, "1K");
  assert.equal(imageModel.media_type, "image");
  assert.ok(Math.abs(imageModel.image_price - 0.225) < 1e-12);
  assert.equal(imageModel.request_price, null);
});

test("reads native fetch JSON bodies before normalizing", async () => {
  const payload = [{ result: { data: { json: { providers: [{ name: "OpenAI", models: [{ model_id: "gpt-6-luna", input_price: "0.1", output_price: "0.5", group_prices: [{ group_name: "Codex Luna", input_price: "0.02", output_price: "0.1", multiplier: "0.2" }] }] }] } } } }];
  const snapshot = await collectStationInput({ id: "station-jiji-native", name: "Jiji", baseUrl: "https://www.jiji.cc/extension/models?token=test-token", adapter: { endpoint: "/api/ai/pricing" } }, {
    fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })
  });
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.data[0].model_name, "gpt-6-luna");
});

test("adapts Jiji model page URLs to the authenticated model-market API", async () => {
  const jijiRootAdapter = inferStationAdapter({ baseUrl: "https://jiji.cc" });
  assert.equal(jijiRootAdapter.mode, "direct");
  assert.equal(jijiRootAdapter.endpoint, "/extension/api/model-market");
  const preparedJiji = prepareStationInput({ baseUrl: "https://www.jiji.cc/extension/models?user_id=1" });
  assert.equal(preparedJiji.baseUrl, "https://www.jiji.cc/custom/13235f4cd3f1e94e");
  assert.equal(preparedJiji.mode, "page");
  let request;
  const snapshot = await collectStationInput({ id: "station-jiji", name: "Jiji", baseUrl: "https://www.jiji.cc/extension/models?user_id=1&token=test-token", mode: "page", adapter: { endpoint: "/api/ai/pricing" } }, {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response({ code: 0, data: { groups: [], providers: [{ name: "OpenAI", models: [{ model_id: "gpt-4o", input_price: "0.000005", output_price: "0.000015", group_prices: [{ name: "余额", multiplier: 1 }] }] }] } });
    }
  });
  const url = new URL(request.url);
  assert.equal(url.pathname, "/extension/api/model-market");
  assert.equal(url.search, "");
  assert.equal(request.init.credentials, "omit");
  assert.equal(request.init.headers.Authorization, "Bearer test-token");
  assert.equal(snapshot.normalized.data[0].model_name, "gpt-4o");
});
test("leaves unsupported Jiji paths on the configured request endpoint", () => {
  const collection = resolveStationCollection({
    id: "station-jiji-custom",
    name: "Jiji custom API",
    baseUrl: "https://jiji.cc/custom-user-api",
    adapter: { endpoint: "/custom-user-api", method: "GET" }
  });
  assert.equal(collection.station.adapter.endpoint, "/custom-user-api");
  assert.equal(collection.endpoints.some(endpoint => endpoint.includes("/extension/api/model-market")), false);
});

test("builds requests from the resolved collection strategy", () => {
  const collection = resolveStationCollection({ baseUrl: "https://jiji.cc" });
  const request = buildStationRequest(collection.station, collection.endpoints[0], {
    ...collection.request,
    headers: { "x-test": "frozen" },
    pageHeaders: ["x-test"],
    credentials: "same-origin"
  });
  assert.equal(request.headers["x-test"], "frozen");
  assert.equal(request.credentials, "same-origin");
  assert.equal(request.pageRequest.headers["x-test"], "frozen");
});
test("requires page-session providers to opt into credentials", () => {
  for (const id of ["cun", "aiapi", "fastaitoken", "nexavlinks"]) {
    assert.equal(providerById(id)?.request.credentials, "include", id);
  }
});

test("adapts NodeAI model plaza to its JSON API endpoint", async () => {
  const adapter = inferStationAdapter({ baseUrl: "https://nodeai.cc/model-plaza" });
  assert.equal(adapter.mode, "direct");
  assert.equal(adapter.endpoint, "/api/v1/model-plaza");
  assert.equal(adapter.method, "GET");
  assert.equal(adapter.responseFormat, "nodeai-model-plaza");
  assert.equal(adapter.authType, "none");

  const prepared = prepareStationInput({
    baseUrl: "https://www.nodeai.cc/model-plaza?tab=all",
    auth: { type: "bearer", token: "must-not-be-sent" }
  });
  assert.equal(prepared.baseUrl, "https://nodeai.cc/model-plaza");
  assert.equal(prepared.mode, "direct");
  assert.equal(prepared.adapter.endpoint, "/api/v1/model-plaza");
  assert.equal(prepared.adapter.responseFormat, "nodeai-model-plaza");
  assert.equal(prepared.auth.type, "none");

  let request;
  const snapshot = await collectStationInput({
    id: "station-nodeai",
    name: "NodeAI",
    baseUrl: "https://www.nodeai.cc/model-plaza"
  }, {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response(nodeAiFixture);
    }
  });
  assert.equal(request.url, "https://nodeai.cc/api/v1/model-plaza");
  assert.equal(request.init.credentials, "omit");
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.sourceFormat, "nodeai-model-plaza");
});
test("collects SevenAI public model-plaza intervals as comparable CREDITS", async () => {
  const registered = addProviderStationPresets([{ id: "existing", baseUrl: "https://relay.example" }], PROVIDER_REGISTRY);
  const preset = registered.find(station => station.id === "sevenai");
  assert.ok(preset);
  assert.equal(addProviderStationPresets(registered, PROVIDER_REGISTRY), registered);
  assert.equal(preset.rechargeRateVerified, false);

  const prepared = prepareStationInput({
    id: "station-sevenai",
    name: "SevenAI",
    baseUrl: "https://www.sevenai.moe/model-plaza?embedded=1",
    auth: { type: "bearer", token: "must-not-be-sent" }
  });
  assert.equal(prepared.baseUrl, "https://www.sevenai.moe/model-plaza?embedded=1");
  assert.equal(prepared.mode, "direct");
  assert.equal(prepared.auth.type, "none");
  assert.equal(prepared.adapter.responseFormat, "sevenai-model-plaza");

  let request;
  const snapshot = await collectStationInput({ ...prepared, id: "station-sevenai", name: "SevenAI" }, {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response({ code: 0, message: "success", data: { description: "", groups: [{
        name: "GROK",
        rate_multiplier: 0.12,
        models: [{
          name: "grok-4.5",
          pricing: {
            billing_mode: "token",
            input_price: 0.000002,
            output_price: 0.000006,
            cache_read_price: 0.0000003,
            intervals: [
              { tier_label: "<200K", min_tokens: 0, max_tokens: 200000, input_price: 0.000002, output_price: 0.000006, cache_read_price: 0.0000003 },
              { tier_label: ">200K", min_tokens: 200001, max_tokens: null, input_price: 0.000003, output_price: 0.000009, cache_read_price: 0.00000045 }
            ]
          }
        }]
      }] } });
    }
  });
  assert.equal(request.url, "https://www.sevenai.moe/api/v1/model-plaza?timezone=Asia%2FShanghai");
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.credentials, "omit");
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.rechargeRateVerified, false);
  assert.equal(snapshot.normalized.data.length, 2);
  assert.deepEqual(snapshot.normalized.group_ratio, { GROK: 0.12 });
  assert.deepEqual(snapshot.normalized.data.map(row => row.tier_name), ["<200K", ">200K"]);
  assert.deepEqual(snapshot.normalized.data.map(row => [row.input_price, row.output_price, row.cache_read_price].map(value => Number(value.toFixed(6)))), [
    [0.24, 0.72, 0.036],
    [0.36, 1.08, 0.054]
  ]);
  assert.ok(snapshot.normalized.data.every(row => row.price_currency === "CREDITS" && row.proxy_group_name === "GROK"));
  const comparisons = buildComparisonRows({
    stations: [prepared],
    snapshots: [{ ...snapshot, stationId: prepared.id }]
  });
  const offers = comparisons.flatMap(row => row.offers).filter(row => row.stationId === prepared.id);
  // 上下文档各自成行，不再按 50/50 摊成一个均价。
  assert.deepEqual(offers.map(row => row.tierName).sort(), ["<200K", ">200K"]);
  const offer = offers.find(row => row.tierName === "<200K");
  assert.ok(offer);
  assert.equal(offer.pricingUnavailable, false);
  assert.equal(offer.costPrices.input, 0.24);
  const blankGroupRate = normalizePricingPayload({
    code: 0,
    data: {
      groups: [{
        name: "GROK",
        rate_multiplier: " ",
        models: [{ name: "grok-4.5", pricing: { billing_mode: "token", input_price: 0.000002 } }]
      }]
    }
  }, "sevenai-model-plaza");
  assert.equal(blankGroupRate.incomplete, true);
  assert.deepEqual(blankGroupRate.invalidPricingValues, ["GROK:multiplier"]);
  assert.deepEqual(blankGroupRate.unpricedModels, ["GROK:grok-4.5:default"]);
});

test("parses SevenAI image billing by size tier with the image multiplier", async () => {
  const imageGroupFixture = {
    code: 0, message: "success",
    data: {
      groups: [{
        name: "GPT-生图模型",
        rate_multiplier: 2,
        image_rate_independent: true,
        image_rate_multiplier: 0.5,
        models: [{
          name: "gpt-2-image",
          pricing: {
            billing_mode: "image",
            per_request_price: 0.2,
            intervals: [
              { tier_label: "1K", per_request_price: 0.1 },
              { tier_label: "2K", per_request_price: 0.15 },
              { tier_label: "4K", per_request_price: 0.2 }
            ]
          }
        }]
      }]
    }
  };
  const normalized = normalizePricingPayload(imageGroupFixture, "sevenai-model-plaza", { priceCurrency: "CREDITS", priceCurrencyVerified: true });
  assert.equal(normalized.unsupportedBillingModes, undefined);
  // 档位价只乘图片独立倍率（0.5），不重复乘文本分组倍率 2。
  assert.deepEqual(normalized.data.map(row => [row.size_tier, row.image_price, row.media_type, row.group_ratio]), [
    ["1K", 0.05, "image", 2],
    ["2K", 0.075, "image", 2],
    ["4K", 0.1, "image", 2]
  ]);
  assert.equal(normalized.unpricedModels, undefined);

  // 图片没有独立倍率时回退分组倍率。
  const noIndependent = structuredClone(imageGroupFixture);
  noIndependent.data.groups[0].image_rate_independent = false;
  const fallback = normalizePricingPayload(noIndependent, "sevenai-model-plaza");
  assert.deepEqual(fallback.data.map(row => [row.size_tier, row.image_price]), [
    ["1K", 0.2], ["2K", 0.3], ["4K", 0.4]
  ]);

  // 档位缺价要留痕，不能悄悄丢掉整张模型。
  const missingTier = structuredClone(imageGroupFixture);
  delete missingTier.data.groups[0].models[0].pricing.intervals[1].per_request_price;
  const withGap = normalizePricingPayload(missingTier, "sevenai-model-plaza");
  assert.deepEqual(withGap.unpricedModels, ["GPT-生图模型:gpt-2-image:2K"]);
  assert.deepEqual(withGap.data.map(row => row.size_tier), ["1K", "4K"]);

  // 顶层单笔兜底：没有分档时按整图一次价出。
  const flatImage = {
    code: 0, data: { groups: [{ name: "GPT-生图模型", rate_multiplier: 1, models: [{
      name: "gpt-flat", pricing: { billing_mode: "image", per_request_price: 0.04 }
    }] }] }
  };
  const flat = normalizePricingPayload(flatImage, "sevenai-model-plaza");
  assert.deepEqual(flat.data.map(row => [row.image_price, row.media_type]), [[0.04, "image"]]);
  assert.equal(flat.unpricedModels, undefined);
});

test("adapts KillAI pricing to a cookie session without a page", async () => {
  const preset = addProviderStationPresets([{ id: "seed", baseUrl: "https://seed.example" }], PROVIDER_REGISTRY)
    .find(station => station.baseUrl === "https://api.killai.cc/pricing");
  assert.ok(preset);
  assert.equal(preset.mode, "direct");
  assert.equal(preset.priceCurrency, "USD");
  assert.equal(preset.priceCurrencyVerified, true);
  assert.equal(preset.rechargeRateVerified, false);

  const adapter = inferStationAdapter({ baseUrl: preset.baseUrl });
  assert.equal(adapter.mode, "direct");
  assert.equal(adapter.endpoint, "/api/pricing");
  assert.equal(adapter.method, "GET");
  assert.equal(adapter.responseFormat, "pqh");
  assert.equal(adapter.authType, "none");

  const prepared = prepareStationInput({
    baseUrl: "https://api.killai.cc/model-plaza?tab=all",
    auth: { type: "bearer", token: "must-not-be-sent" }
  });
  assert.equal(prepared.baseUrl, "https://api.killai.cc/pricing");
  assert.equal(prepared.mode, "direct");
  assert.equal(prepared.auth.type, "none");
  assert.equal(prepared.priceCurrency, "USD");
  assert.equal(prepared.priceCurrencyVerified, true);
  assert.equal(prepared.rechargeRateVerified, false);

  const resolved = resolveStationCollection({ id: "station-killai", name: "KillAI", baseUrl: "https://api.killai.cc/pricing" });
  assert.equal(resolved.request.pageAuth, null);
  assert.equal(resolved.request.credentials, "omit");
  assert.equal(resolved.request.cookieAuth.cookieName, "new_api_refresh");
  assert.equal(resolved.request.cookieAuth.refreshPath, "/api/user/auth/refresh");
  assert.equal(resolved.request.cookieAuth.accessTokenPath, "data.access_token");
  assert.equal(resolved.request.cookieAuth.expiresAtPath, "data.access_expires_at");

  let request;
  const snapshot = await collectStationInput({
    id: "station-killai",
    name: "KillAI",
    baseUrl: "https://api.killai.cc/pricing",
    auth: { type: "bearer", token: "must-not-be-sent" }
  }, {
    fetchImpl: async (url, options) => {
      request = { url, ...options };
      return response(killAiPricingFixture);
    }
  });
  assert.equal(request.url, "https://api.killai.cc/api/pricing");
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(snapshot.status, "success");

  const station = { ...preset, id: "station-killai-unverified" };
  const comparisonSnapshot = { ...snapshot, stationId: station.id };
  const [comparison] = buildComparisonRows({
    stations: [station],
    snapshots: [comparisonSnapshot],
    references: { models: [] },
    usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, requests: 0 }
  });
  const offers = comparison.offers;
  assert.ok(offers.length > 0);
  for (const offer of offers) {
    assert.equal(offer.pricingUnavailable, false);
    assert.ok(!offer.pricingUnavailableReasons.includes("currency_unverified"));
    assert.ok(!offer.pricingUnavailableReasons.includes("recharge_unverified"));
  }
});
test("adapts all-in-one.icu page auth and token/tiered pricing", async () => {
  const station = {
    id: "station-all-in-one",
    name: "all-in-one.icu",
    baseUrl: "https://all-in-one.icu/#/tenant/models",
    auth: { type: "bearer", token: "must-not-be-sent" },
    adapter: { endpoint: "/wrong", method: "POST", responseFormat: "pqh" }
  };
  const provider = providerForStation(station);
  assert.equal(provider.id, "all-in-one");
  assert.equal(provider.responseFormat, "all-in-one-models");
  const adapter = inferStationAdapter(station);
  assert.equal(adapter.mode, "page");
  assert.equal(adapter.endpoint, ALL_IN_ONE_MODELS_ENDPOINT);
  assert.equal(adapter.method, "GET");
  assert.equal(adapter.responseFormat, "all-in-one-models");
  assert.equal(adapter.authType, "none");
  const prepared = prepareStationInput({ ...station, adapter });
  assert.equal(prepared.auth.type, "none");
  assert.equal(prepared.baseUrl, "https://all-in-one.icu/#/tenant/models");

  let request;
  const snapshot = await collectStationInput({ ...station, adapter }, {
    pageFetch: async value => {
      request = value;
      return response(allInOneFixture);
    }
  });
  assert.equal(request.url, "https://all-in-one.icu/api/tenant/models");
  assert.equal(request.method, "GET");
  assert.equal(request.credentials, "include");
  assert.equal(request.headers.Authorization, undefined);
  assert.equal(request.pageAuth.source, "localStorage");
  assert.equal(request.pageAuth.storageKey, "tenant_access_token");
  assert.equal(request.pageAuth.storagePaths, undefined);
  assert.deepEqual(request.pageAuth.refresh, {
    endpoint: "/api/tenant/auth/refresh",
    credentials: "same-origin",
    requestTokenKey: "refresh_token",
    responsePath: "data",
    accessTokenKey: "access_token",
    refreshTokenStorageKey: "tenant_refresh_token",
    refreshTokenKey: "refresh_token",
    statuses: [401, 403]
  });
  assert.equal(request.pageAuth.header, "Authorization");
  assert.equal(request.pageAuth.scheme, "Bearer");
  assert.deepEqual(request.pageAuth.sessionFailureStatuses, [401, 403]);
  assert.equal(snapshot.status, "partial");
  assert.equal(snapshot.normalized.sourceFormat, "all-in-one-models");
  assert.equal(snapshot.normalized.data.every(row => row.price_currency === "CNY"), true);

  const token = snapshot.normalized.data.find(row => row.model_name === "all-token-model");
  assert.equal(token.model_display_name, "All Token Model");
  assert.deepEqual([token.input_price, token.output_price, token.cache_read_price, token.cache_write_price].map(value => Number(value.toFixed(6))), [2, 8, 0.2, 1]);
  const tiers = snapshot.normalized.data.filter(row => row.model_name === "all-tiered-model");
  assert.equal(tiers.length, 2);
  assert.deepEqual(tiers.map(row => [row.tier_name, row.min_tokens, row.max_tokens, row.input_price, row.output_price]), [
    ["0-100K", 0, 100000, 1, 4], ["100K+", 100001, null, 2, 6]
  ]);
  assert.equal(Number(tiers[1].cache_write_price.toFixed(6)), 0.8);
  const perRequest = snapshot.normalized.data.find(row => row.model_name === "all-per-request");
  assert.equal(perRequest.request_price, 0.05);
  assert.equal(perRequest.input_price, null);
  assert.equal(perRequest.output_price, null);
  // special = 视频按秒计价，每个分辨率档一行
  const video = snapshot.normalized.data.filter(row => row.model_name === "all-video-model");
  assert.deepEqual(video.map(row => [row.tier_name, row.request_price, row.media_type]), [
    ["480P", 0.3, "video"], ["768P", 0.35, "video"]
  ]);
  assert.equal(video.every(row => row.input_price === null), true);
  assert.equal(snapshot.normalized.unsupportedBillingModes, undefined);
  assert.equal(snapshot.normalized.invalidPricingValues, undefined);
  assert.deepEqual(snapshot.normalized.unpricedModels, ["all-missing:default"]);
});

test("keeps all-in-one invalid prices in partial diagnostics", () => {
  const payload = structuredClone(allInOneFixture);
  payload.data.list = [{ model_id: "all-invalid", billing_mode: "token", input_price: "not-a-price" }];
  const normalized = normalizePricingPayload(payload, "all-in-one-models");
  assert.equal(normalized.incomplete, true);
  assert.deepEqual(normalized.invalidPricingValues, ["all-invalid:default"]);
  assert.deepEqual(normalized.data, []);
});

test("reports all-in-one special models that carry no per-second prices", () => {
  const normalized = normalizePricingPayload({
    code: 0,
    data: { list: [{ model_id: "all-special-empty", billing_mode: "special", per_second_prices: { "2K": 0 } }] }
  }, "all-in-one-models");
  assert.equal(normalized.incomplete, true);
  assert.deepEqual(normalized.unsupportedBillingModes, ["special"]);
  assert.deepEqual(normalized.data, []);
});

test("does not fall back from malformed all-in-one tiers to model prices", () => {
  const normalized = normalizePricingPayload({
    code: 0,
    data: { list: [{ model_id: "all-malformed-tier", billing_mode: "tiered", input_price: 0.000001, pricing_tiers: [null] }] }
  }, "all-in-one-models");
  assert.equal(normalized.incomplete, true);
  assert.deepEqual(normalized.invalidPricingValues, ["all-malformed-tier:tier:0:tier"]);
  assert.deepEqual(normalized.data, []);
});

test("does not misclassify all-in-one envelopes without its explicit format", () => {
  const normalized = normalizePricingPayload(allInOneFixture);
  assert.equal(normalized.sourceFormat, "unknown");
  assert.deepEqual(normalized.data, []);
});

test("adapts the TokenFlux pricing API and station preset", async () => {
  const registered = addProviderStationPresets([{ id: "seed", baseUrl: "https://relay.example" }], PROVIDER_REGISTRY);
  const preset = registered.find(station => station.id === "tokenflux");
  assert.ok(preset);
  assert.equal(preset.mode, "direct");
  assert.equal(preset.priceCurrency, "CREDITS");
  assert.equal(preset.priceCurrencyVerified, true);
  assert.equal(preset.rechargeRateVerified, false);

  const adapter = inferStationAdapter({ baseUrl: "https://tokenflux.cloud/pricing" });
  assert.equal(adapter.mode, "direct");
  assert.equal(adapter.endpoint, "/api/pricing");
  assert.equal(adapter.method, "GET");
  assert.equal(adapter.responseFormat, "tokenflux");
  assert.equal(adapter.authType, "none");

  const prepared = prepareStationInput({
    baseUrl: "https://tokenflux.cloud/pricing",
    auth: { type: "bearer", token: "must-not-be-sent" }
  });
  assert.equal(prepared.baseUrl, "https://tokenflux.cloud/pricing");
  assert.equal(prepared.mode, "direct");
  assert.equal(prepared.auth.type, "none");
  assert.equal(prepared.adapter.responseFormat, "tokenflux");

  let request;
  const snapshot = await collectStationInput({
    id: "station-tokenflux",
    name: "TokenFlux",
    baseUrl: "https://tokenflux.cloud/pricing"
  }, {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response(tokenFluxFixture);
    }
  });
  assert.equal(request.url, "https://tokenflux.cloud/api/pricing");
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.credentials, "omit");
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.sourceFormat, "tokenflux");
  assert.deepEqual(snapshot.normalized.group_ratio, {
    default: 1, Gork: 0.5, MIMO: 0.5, "Codex号池": 0.2,
    "Claude Code 特惠": 0.2, "绘图模型": 1, "[稳定]Codex号池": 0.2, "[特价]Codex号池": 0.2
  });
  assert.equal(snapshot.normalized.unsupportedBillingModes, undefined);
  assert.equal(snapshot.normalized.incomplete, undefined);

  const flash = snapshot.normalized.data.find(row => row.model_name === "deepseek-v4-flash");
  assert.ok(flash);
  assert.equal(flash.input_price, 0.14);
  assert.equal(flash.output_price, 0.28);
  assert.equal(flash.cache_read_price, 0.01);
  assert.equal(flash.cache_write_price, null);
  assert.equal(flash.price_currency, "CREDITS");
  assert.equal(flash.proxy_group_name, "default");
  assert.equal(flash.group_ratio, 1);

  const tiered = snapshot.normalized.data.filter(row => row.model_name === "gpt-5.6-latitude");
  assert.equal(tiered.length, 4);
  const standard = tiered.find(row => row.proxy_group_name === "default" && row.tier_name === "standard");
  assert.ok(standard);
  assert.equal(standard.input_price, 5);
  assert.equal(standard.output_price, 30);
  assert.equal(standard.cache_read_price, 0.5);
  assert.equal(standard.cache_write_price, 6.25);
  assert.equal(standard.min_tokens, 0);
  assert.equal(standard.max_tokens, 272000);
  const longContext = tiered.find(row => row.proxy_group_name === "default" && row.tier_name === "long_context");
  assert.ok(longContext);
  assert.equal(longContext.input_price, 10);
  assert.equal(longContext.min_tokens, 272001);
  assert.equal(longContext.max_tokens, undefined);
  const pooled = tiered.find(row => row.proxy_group_name === "Codex号池" && row.tier_name === "standard");
  assert.ok(pooled);
  assert.equal(pooled.input_price, 1);
  assert.equal(Number(pooled.output_price.toFixed(6)), 6);

  const image = snapshot.normalized.data.find(row => row.model_name === "gpt-image-2.5");
  assert.ok(image);
  assert.equal(image.image_price, 0.1);
  assert.equal(image.request_price, null);
  assert.equal(image.input_price, null);
  assert.equal(image.output_price, null);

  const video = snapshot.normalized.data.find(row => row.model_name === "wan2.7-i2v");
  assert.ok(video);
  assert.equal(video.request_price, 1);
  assert.equal(video.image_price, null);
});
test("adapts and collects the ai.centos.hk public TokenFlux pricing API", async () => {
  const provider = providerForStation({ baseUrl: "https://ai.centos.hk/pricing" });
  assert.equal(provider.id, "centos");
  assert.equal(providerForStation({ baseUrl: "https://ai.centos.hk/other" }), null);

  assert.equal(providerForStation({ baseUrl: "https://www.ai.centos.hk/pricing" }), null);
  const adapter = inferStationAdapter({
    baseUrl: "https://ai.centos.hk/pricing",
    auth: { type: "bearer", token: "must-not-be-sent" }
  });
  assert.equal(adapter.mode, "direct");
  assert.equal(adapter.endpoint, CENTOS_PRICING_ENDPOINT);
  assert.equal(adapter.method, "GET");
  assert.equal(adapter.responseFormat, "tokenflux");
  assert.equal(adapter.authType, "none");

  const prepared = prepareStationInput({
    baseUrl: "https://ai.centos.hk/pricing",
    auth: { type: "api-key", token: "must-not-be-sent" }
  });
  assert.equal(prepared.baseUrl, "https://ai.centos.hk/pricing");
  assert.equal(prepared.mode, "direct");
  assert.deepEqual(prepared.auth, { type: "none" });
  assert.equal(prepared.adapter.endpoint, CENTOS_PRICING_ENDPOINT);
  assert.equal(prepared.adapter.responseFormat, "tokenflux");
  assert.equal(prepared.priceCurrency, "CREDITS");
  assert.equal(prepared.priceCurrencyVerified, true);
  assert.equal(prepared.rechargeRateVerified, false);

  let request;
  const snapshot = await collectStationInput({
    id: "station-centos",
    name: "ai.centos.hk",
    baseUrl: "https://ai.centos.hk/pricing",
    auth: { type: "bearer", token: "must-not-be-sent" }
  }, {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response(centosFixture);
    }
  });
  assert.equal(request.url, "https://ai.centos.hk/api/pricing");
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.credentials, "omit");
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(request.init.headers["X-API-Key"], undefined);
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.sourceFormat, "tokenflux");
  assert.equal(snapshot.normalized.unsupportedBillingModes, undefined);
  assert.equal(snapshot.normalized.incomplete, undefined);

  const token = snapshot.normalized.data.find(row => row.model_name === "centos-token");
  assert.ok(token);
  assert.equal(token.input_price, 0.8);
  assert.equal(token.output_price, 1.6);
  assert.equal(token.cache_read_price, 0.2);
  assert.equal(Number(token.cache_write_price.toFixed(6)), 0.08);
  assert.equal(token.price_currency, "CREDITS");
  assert.equal(token.group_ratio, 1);

  const enterprise = snapshot.normalized.data.find(row => row.model_name === "centos-enterprise");
  assert.ok(enterprise);
  assert.equal(enterprise.input_price, 9);
  assert.equal(enterprise.output_price, 27);
  assert.equal(enterprise.cache_read_price, 4.5);
  assert.equal(enterprise.group_ratio, 4.5);

  const requestPrice = snapshot.normalized.data.find(row => row.model_name === "centos-request");
  assert.ok(requestPrice);
  assert.equal(requestPrice.request_price, 0.2);
  assert.equal(requestPrice.input_price, null);
  assert.equal(requestPrice.output_price, null);

  const image = snapshot.normalized.data.find(row => row.model_name === "centos-image");
  assert.ok(image);
  assert.equal(image.image_price, 0.3);
  assert.equal(image.request_price, null);
  assert.equal(image.input_price, null);
  assert.equal(image.output_price, null);
  // tiered_expr 现在能解析：系数档、长度分档、按次、按张、时段折扣各走一条路径。
  const tiered = snapshot.normalized.data.filter(row => row.model_name === "centos-tiered");
  assert.equal(tiered.length, 1);
  assert.equal(tiered[0].tier_name, "standard");
  assert.equal(tiered[0].input_price, 1);
  assert.equal(tiered[0].output_price, 2);
  assert.equal(tiered[0].min_tokens, undefined);
  assert.equal(tiered[0].max_tokens, undefined);

  const bounded = snapshot.normalized.data.filter(row => row.model_name === "centos-tiered-bounded");
  assert.deepEqual(bounded.map(row => [row.tier_name, row.input_price, row.min_tokens, row.max_tokens]), [
    ["输入<=32k", 4, 0, 32768],
    ["32k<输入<=200k", 6, 32769, undefined]
  ]);

  const perRequest = snapshot.normalized.data.filter(row => row.model_name === "centos-tiered-request");
  assert.equal(perRequest.length, 1);
  assert.equal(perRequest[0].request_price, 0.08);
  assert.equal(perRequest[0].input_price, null);

  const perImage = snapshot.normalized.data.filter(row => row.model_name === "centos-tiered-image");
  assert.equal(perImage.length, 1);
  assert.equal(perImage[0].image_price, 0.014);
  assert.equal(perImage[0].request_price, null);
  assert.equal(perImage[0].media_type, "image");

  const night = snapshot.normalized.data.filter(row => row.model_name === "centos-tiered-night");
  assert.equal(night.length, 1);
  assert.equal(night[0].input_price, 3);
  assert.equal(night[0].tier_time_discount, 0.5);
  assert.match(night[0].tier_time_condition, /hour\("Asia\/Shanghai"\) >= 22/);

  assert.equal(snapshot.rechargeRateVerified, false);
  const comparisonStation = normalizeStation({
    id: "station-centos-comparison",
    name: "ai.centos.hk",
    baseUrl: "https://ai.centos.hk/pricing",
    rechargeRate: 8,
    rechargeRateVerified: false,
    priceCurrency: "CREDITS",
    priceCurrencyVerified: true
  });
  const comparison = buildComparisonRows({
    stations: [comparisonStation],
    snapshots: [{ ...snapshot, stationId: comparisonStation.id }],
    references: { models: [] },
    usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, requests: 0 }
  });
  const centosOffer = comparison.flatMap(row => row.offers).find(offer => offer.modelName === "centos-token");
  assert.ok(centosOffer);
  assert.equal(centosOffer.costPrices.input, 0.8);
  assert.equal(centosOffer.monthlyCost, 0.8);

  const current = [{ id: "seed", baseUrl: "https://relay.example" }];
  const stations = addProviderStationPresets(current, [providerById("centos")]);
  assert.equal(stations.length, 2);
  assert.equal(stations[1].id, "centos");
  assert.equal(stations[1].name, "ai.centos.hk");
  assert.equal(stations[1].baseUrl, "https://ai.centos.hk/pricing");
  // 官方文档写「充值费率——费用一比一充值」，/api/status 的 price = 1、usd_exchange_rate = 1，
  // 两处对上，所以这一条算已验证；哪天文档或字段变了，这条断言会先红。
  assert.equal(stations[1].rechargeRateVerified, true);
  assert.equal(addProviderStationPresets(stations, [providerById("centos")]), stations);
  assert.equal(addProviderStationPresets([], [providerById("centos")]).length, 1);
  const conflict = addProviderStationPresets([{ id: "centos", baseUrl: "https://relay.example" }], [providerById("centos")]);
  assert.equal(conflict[1].id, "centos-2");
});

test("adapts maolaoapi's public pricing API and its recharge tiers", async () => {
  const fixture = {
    success: true,
    pricing_version: "maolao-fixture",
    group_ratio: { default: 1, "Codex-Pro": 0.4 },
    usable_group: { default: "默认分组", "Codex-Pro": "Codex-Pro" },
    data: [
      { model_name: "maolao-token", quota_type: 0, model_ratio: 1, completion_ratio: 4, model_price: 0, enable_groups: ["default"] },
      {
        model_name: "maolao-tiered",
        quota_type: 0,
        model_ratio: 0,
        completion_ratio: 1,
        model_price: 0,
        enable_groups: ["default"],
        billing_mode: "tiered_expr",
        billing_expr: 'len < 200000 ? tier("标准费率", p * 2 + c * 6) : tier("长上下文", p * 4 + c * 12)'
      }
    ]
  };

  const provider = providerForStation({ baseUrl: "https://maolaoapi.com/pricing" });
  assert.equal(provider.id, "maolaoapi");
  assert.equal(providerForStation({ baseUrl: "https://maolaoapi.com/console/topup" }).id, "maolaoapi");
  assert.equal(providerForStation({ baseUrl: "https://maolaoapi.com/docs" }), null);

  const prepared = prepareStationInput({ baseUrl: "https://maolaoapi.com/pricing", auth: { type: "api-key", token: "must-not-be-sent" } });
  assert.equal(prepared.mode, "direct");
  assert.deepEqual(prepared.auth, { type: "none" });
  assert.equal(prepared.adapter.endpoint, "/api/pricing");
  assert.equal(prepared.adapter.responseFormat, "tokenflux");
  assert.equal(prepared.priceCurrency, "CREDITS");
  assert.equal(prepared.priceCurrencyVerified, true);
  assert.equal(prepared.rechargeRateVerified, true);
  const presetStation = normalizeStation(addProviderStationPresets([], [providerById("maolaoapi")])[0]);
  assert.equal(presetStation.rechargeRate, 1.03);
  assert.deepEqual(presetStation.rechargeTiers.map(tier => [tier.amount, tier.discount]), [
    [10, 1], [20, 1], [50, 1], [100, 1], [200, 0.98], [500, 0.95], [1000, 0.9]
  ]);

  let request;
  const snapshot = await collectStationInput({ id: "station-maolao", baseUrl: "https://maolaoapi.com/pricing" }, {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response(fixture);
    }
  });
  assert.equal(request.url, "https://maolaoapi.com/api/pricing");
  assert.equal(request.init.credentials, "omit");
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(snapshot.status, "success");

  const token = snapshot.normalized.data.find(row => row.model_name === "maolao-token");
  assert.equal(token.input_price, 2);
  assert.equal(token.output_price, 8);
  assert.equal(token.price_currency, "CREDITS");
  // 长度分档的 billing_expr 拆成两行，标准档按 p*2 / c*6 折算。
  const tiered = snapshot.normalized.data.filter(row => row.model_name === "maolao-tiered");
  assert.deepEqual(tiered.map(row => [row.tier_name, row.input_price, row.output_price, row.max_tokens]), [
    ["标准费率", 2, 6, 200000],
    ["长上下文", 4, 12, undefined]
  ]);
});

test("adapts WindHub's verified public pricing contract and keeps anonymous requests", async () => {
  const windhub = structuredClone(centosFixture);
  windhub.pricing_version = "windhub-fixture";
  windhub.auto_groups = ["default", "Translate"];
  windhub.usable_group = { default: "默认分组", Translate: "免费分组" };
  windhub.vendors = [{ id: 3, name: "Example vendor" }];
  windhub.supported_endpoint = { openai: { path: "/v1/chat/completions", method: "POST" } };
  windhub.data[0].vendor_id = 3;
  windhub.data[0].supported_endpoint_types = ["openai"];
  const registered = addProviderStationPresets([{ id: "seed", baseUrl: "https://relay.example" }], PROVIDER_REGISTRY);
  const preset = registered.find(station => station.id === "windhub");
  assert.ok(preset);
  assert.equal(preset.category, "public");
  assert.equal(preset.enabled, true);
  assert.deepEqual(preset.auth, { type: "none" });
  assert.equal(preset.rechargeRmb, 1);
  assert.equal(preset.rechargeCredits, 1);
  assert.equal(preset.adapter.endpoint, WINDHUB_PRICING_ENDPOINT);
  assert.equal(preset.adapter.responseFormat, "windhub");
  assert.equal(addProviderStationPresets(registered, [providerById("windhub")]), registered);
  assert.equal(addProviderStationPresets([], [providerById("windhub")]).length, 1);
  const provider = providerForStation({ baseUrl: "https://windhub.cc/pricing" });
  assert.equal(provider.id, "windhub");
  assert.equal(providerForStation({ baseUrl: "https://windhub.cc/other" }), null);
  let request;
  const snapshot = await collectStationInput({ id: "station-windhub", name: "WindHub", baseUrl: "https://windhub.cc/pricing", auth: { type: "bearer", token: "must-not-be-sent" } }, { fetchImpl: async (url, init) => { request = { url, init }; return response(windhub); } });
  assert.equal(request.url, "https://windhub.cc/api/pricing");
  assert.equal(request.init.method, "GET");
  assert.equal(request.init.credentials, "omit");
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(snapshot.normalized.sourceFormat, "windhub");
  assert.deepEqual(snapshot.normalized.auto_groups, ["default", "Translate"]);
  assert.deepEqual(snapshot.normalized.usable_group, windhub.usable_group);
  assert.deepEqual(snapshot.normalized.supported_endpoint, windhub.supported_endpoint);
  const row = snapshot.normalized.data.find(item => item.model_name === "centos-token");
  assert.ok(row);
  assert.equal(row.price_currency, "CREDITS");
  assert.equal(row.vendor, "Example vendor");
  assert.deepEqual(row.supported_endpoint_types, ["openai"]);
  assert.equal(row.input_price, 0.8);
  assert.equal(row.output_price, 1.6);
  assert.equal(row.cache_read_price, 0.2);
  assert.equal(Number(row.cache_write_price.toFixed(6)), 0.08);
  assert.equal(row.group_ratio, 1);
});

test("surfaces a failed WindHub envelope as a station error snapshot", async () => {
  const snapshot = await collectStationInput({ id: "station-windhub-error", name: "WindHub", baseUrl: "https://windhub.cc/pricing" }, {
    fetchImpl: async () => response({ success: false, data: [] })
  });
  assert.equal(snapshot.status, "error");
  assert.match(snapshot.error, /WindHub/);
  assert.equal(snapshot.normalized.data.length, 0);
});

test("surfaces an empty successful WindHub envelope as a station error snapshot", async () => {
  const snapshot = await collectStationInput({ id: "station-windhub-empty", name: "WindHub", baseUrl: "https://windhub.cc/pricing" }, {
    fetchImpl: async () => response({ success: true, data: [{}], group_ratio: { default: 1 } })
  });
  assert.equal(snapshot.status, "error");
  assert.match(snapshot.error, /WindHub/);
});

test("seeds public presets for an empty station list without changing general preset defaults", () => {
  const publicStations = addProviderStationPresets([], [providerById("windhub")]);
  assert.deepEqual(publicStations.map(station => station.id), ["windhub"]);
  assert.ok(publicStations.every(station => station.category === "public" && station.enabled === true));
  assert.deepEqual(addProviderStationPresets(publicStations, [providerById("windhub")]), publicStations);
});

test("filters paid and public comparison groups without mixing summaries", () => {
  const comparisons = [
    { comparisonGroup: "standard", canonicalModel: "paid-model", offers: [{ stationId: "paid" }] },
    { comparisonGroup: "public", canonicalModel: "public-model", offers: [{ stationId: "public" }] }
  ];
  assert.deepEqual(filterComparisonsByMode(comparisons, "paid"), [comparisons[0]]);
  assert.deepEqual(filterComparisonsByMode(comparisons, "public"), [comparisons[1]]);
  assert.deepEqual(summarizeComparisons(filterComparisonsByMode(comparisons, "public")), { modelCount: 1, offerCount: 1, stationCount: 1, bestSaving: 0 });
});

test("rejects a failed TokenFlux envelope in its explicit format", () => {
  const failed = normalizeProxyData({ ...tokenFluxFixture, success: false }, { responseFormat: "tokenflux" });
  assert.equal(failed.sourceFormat, "unknown");
  assert.deepEqual(failed.data, []);
});
test("skips malformed TokenFlux rows and applies group ratios", () => {
  const normalized = normalizePricingPayload({
    ...tokenFluxFixture,
    data: [
      { model_name: "invalid", model_ratio: "not-a-price", completion_ratio: 1, enable_groups: ["default"] },
      { model_name: "codex-pool-model", model_ratio: 1, completion_ratio: 3, enable_groups: ["Codex号池"] }
    ]
  }, "tokenflux");
  assert.equal(normalized.data.length, 1);
  assert.equal(normalized.data[0].model_name, "codex-pool-model");
  assert.equal(normalized.data[0].input_price, 0.4);
  assert.equal(Number(normalized.data[0].output_price.toFixed(6)), 1.2);
  assert.equal(normalized.data[0].group_ratio, 0.2);
});
test("adapts the Sidrune model plaza URL and station preset", () => {
  const adapter = inferStationAdapter({ baseUrl: "https://sidrune.ai/model-plaza" });
  assert.equal(adapter.mode, "direct");
  assert.equal(adapter.endpoint, "/api/v1/model-plaza/public");
  assert.equal(adapter.method, "GET");
  assert.equal(adapter.authType, "none");
  const prepared = prepareStationInput({ baseUrl: "https://www.sidrune.ai/model-plaza?tab=all", auth: { type: "bearer", token: "must-not-be-sent" } });
  assert.equal(prepared.baseUrl, "https://www.sidrune.ai/model-plaza");
  assert.equal(prepared.mode, "direct");
  assert.equal(prepared.auth.type, "none");
  assert.equal(prepared.adapter.kind, "sidrune-model-plaza");
  const stations = addProviderStationPresets([{ id: "one", baseUrl: "https://soleapi.com" }], [providerById("sidrune")]);
  assert.equal(stations[1].baseUrl, "https://sidrune.ai/model-plaza");
  const sidrune = normalizeStation(stations[1]);
  assert.equal(sidrune.rechargeCurrency, "USD");
  assert.equal(sidrune.rechargeRmb, DEFAULT_EXCHANGE_RATE);
  assert.equal(sidrune.rechargeCredits, 1);
  assert.equal(sidrune.rechargeRate, DEFAULT_EXCHANGE_RATE);
  assert.equal(convertRechargeAmount(sidrune.rechargeRmb, "CNY", "USD", DEFAULT_EXCHANGE_RATE), 1);
  const customRate = addProviderStationPresets([{ id: "one", baseUrl: "https://soleapi.com" }], [providerById("sidrune")], { exchangeRate: 8.2 });
  assert.equal(normalizeStation(customRate[1]).rechargeRate, 8.2);
  const customSidrune = normalizeStation({
    baseUrl: "https://sidrune.ai/model-plaza",
    rechargeCurrency: "CNY",
    rechargeRmb: 8,
    rechargeCredits: 2,
    rechargeRate: 4
  });
  assert.equal(customSidrune.rechargeCurrency, "CNY");
  assert.equal(customSidrune.rechargeRate, 4);
  assert.equal(addProviderStationPresets(stations, [providerById("sidrune")]), stations);
});


test("collects Sidrune public model prices without credentials", async () => {
  let request;
  const snapshot = await collectStationInput({
    id: "station-sidrune-public",
    name: "Sidrune",
    baseUrl: "https://sidrune.ai/model-plaza?tab=all",
    auth: { type: "bearer", token: "must-not-be-sent" }
  }, {
    fetchImpl: async (url, init) => {
      request = { url, init };
      return response({ code: 0, data: {
        groups: [{ id: "default", name: "Default", rate_multiplier: 2 }],
        pricing: [{ name: "gpt-sidrune", group_ids: ["default"], input_price: 0.000002, output_price: 0.000008 }]
      } });
    }
  });
  assert.equal(request.url, "https://sidrune.ai/api/v1/model-plaza/public");
  assert.equal(request.init.credentials, "omit");
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.data[0].input_price, 4);
});


test("Sidrune 的媒体报价维度不当作价格，不连累同批合法报价", async () => {
  const mediaPayload = {
    code: 0,
    data: {
      groups: [{ id: "default", name: "Default", rate_multiplier: 2 }],
      pricing: [
        { name: "gpt-sidrune", group_ids: ["default"], input_price: 0.000002, output_price: 0.000008 },
        { name: "seedance-video", group_ids: ["default"], media: {
          protocol: "seedance", kind: "video", currency: "CNY",
          prices: [
            { unit: "million_output_tokens", amount: "46", resolution: "480p", input: "text", audio: false },
            { unit: "million_output_tokens", amount: "70", resolution: "720p", input: "image", audio: true }
          ]
        } }
      ]
    }
  };
  const snapshot = await collectStationInput({
    id: "station-sidrune-media",
    name: "Sidrune",
    baseUrl: "https://sidrune.ai/model-plaza?tab=all",
    auth: { type: "bearer", token: "must-not-be-sent" }
  }, {
    fetchImpl: async () => response(mediaPayload)
  });
  // 整单响应不被拒绝：文本模型照常出价，媒体模型进显式缺口。
  assert.equal(snapshot.status, "partial");
  assert.equal(snapshot.normalized.invalidPricingValues, undefined);
  assert.equal(snapshot.normalized.data[0].input_price, 4);
  assert.deepEqual(snapshot.normalized.unpricedModels, ["seedance-video"]);
});

test("Sidrune 媒体结构里的数值型或无 unit 的 input 仍 fail-closed", async () => {
  const badMediaPrices = [
    { unit: "million_output_tokens", amount: "1", input: -1 },
    { unit: "million_output_tokens", amount: "1", input: "abc" },
    { amount: "1", input: "text" }
  ];
  for (const mediaPrice of badMediaPrices) {
    const payload = {
      code: 0,
      data: {
        groups: [{ id: "default", name: "Default", rate_multiplier: 1 }],
        pricing: [{ name: "bad-model", group_ids: ["default"], media: { prices: [mediaPrice] } }]
      }
    };
    await assert.rejects(
      () => collectStationInput({
        id: "station-sidrune-bad",
        name: "Sidrune",
        baseUrl: "https://sidrune.ai/model-plaza?tab=all",
        auth: { type: "bearer", token: "must-not-be-sent" }
      }, { fetchImpl: async () => response(payload) }),
      /价格数据校验失败/
    );
  }
});


test("passes Jiji bearer auth through page-mode fetches", async () => {
  const requests = [];
  const pageFetch = async request => {
    requests.push(request);
    if (request.capture) return { ok: false, status: 404, body: {} };
    return response([{ result: { data: { json: { providers: [{ name: "OpenAI", models: [{ model_id: "gpt-4o", input_price: "0.1", output_price: "0.5" }] }] } } } }]);
  };
  pageFetch.supportsCapture = true;
  const snapshot = await collectStationInput({
    id: "station-jiji-page",
    name: "Jiji",
    baseUrl: "https://www.jiji.cc/extension/models?token=test-token",
    mode: "page",
    adapter: { kind: "jiji", endpoint: "/extension/api/trpc/extension.modelMarket", method: "GET" }
  }, { pageFetch });
  const request = requests.find(item => !item.capture);
  assert.equal(request.headers.Authorization, "Bearer test-token");
  assert.equal(request.credentials, "omit");
  assert.equal(request.pageAuth.source, "localStorage");
  assert.equal(snapshot.status, "success");
});

test("collects NexaVlinks catalog prices through the logged-in page", async () => {
  const station = { id: "station-nexa", name: "NexaVlinks", baseUrl: "https://www.nexavlinks.com/modelsmarket" };
  const adapter = inferStationAdapter(station);
  assert.equal(adapter.mode, "page");
  assert.equal(adapter.endpoint, "/api/v1/channels/catalog?available_only=true&timezone=Asia%2FShanghai");
  assert.equal(adapter.method, "GET");
  const prepared = prepareStationInput({ baseUrl: "https://nexavlinks.com" });
  assert.equal(prepared.baseUrl, "https://nexavlinks.com/modelsmarket");
  assert.equal(prepared.mode, "page");
  const requests = [];
  const pageFetch = async request => {
    if (request.capture) return { ok: false, status: 404, body: { data: [] } };
    requests.push(request);
    return {
      ok: true,
      status: 200,
      body: {
        code: 0,
        data: [{
          name: "标准",
          platforms: [{
            platform: "openai",
            groups: [{ id: 19, name: "稳定", rate_multiplier: 0.3 }],
            supported_models: [{
              name: "gpt-5.4",
              platform: "openai",
              pricing: { billing_mode: "token", input_price: 0.0000025, output_price: 0.000015 }
            }]
          }]
        }]
      }
    };
  };
  pageFetch.supportsCapture = true;
  const snapshot = await collectStationInput({ ...station, adapter }, { pageFetch });
  assert.equal(requests[0].url, "https://www.nexavlinks.com/api/v1/channels/catalog?available_only=true&timezone=Asia%2FShanghai");
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.sourceFormat, "fastaitoken");
  assert.equal(snapshot.normalized.data[0].model_name, "gpt-5.4");
  assert.equal(snapshot.normalized.data[0].input_price, 0.75);
  assert.equal(snapshot.normalized.data[0].output_price, 4.5);
});

test("collects CUN.AI prices through the logged-in page", async () => {
  const station = { id: "station-cun", name: "CUN.AI", baseUrl: "https://www.cun.ai/pricing" };
  const adapter = inferStationAdapter(station);
  assert.equal(adapter.mode, "page");
  assert.equal(adapter.endpoint, "/api/pricing");
  assert.equal(adapter.method, "GET");
  const prepared = prepareStationInput({ baseUrl: "https://cun.ai" });
  assert.equal(prepared.baseUrl, "https://cun.ai/pricing");
  assert.equal(prepared.adapter.kind, "cun");
  const requests = [];
  const pageFetch = async request => {
    if (request.capture) return { ok: false, status: 404, body: { data: [] } };
    requests.push(request);
    return { ok: true, status: 200, body: cunFixture };
  };
  pageFetch.supportsCapture = true;
  const snapshot = await collectStationInput({ ...station, adapter }, { pageFetch });
  assert.equal(requests[0].url, "https://www.cun.ai/api/pricing");
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.data[0].model_name, "gpt-4o");
});

test("collects CheapRouter prices from the public API directly", async () => {
  const station = { id: "station-cheaprouter", name: "CheapRouter", baseUrl: "https://cheaprouter.cc/models" };
  const adapter = inferStationAdapter(station);
  assert.equal(adapter.mode, "direct");
  assert.equal(adapter.endpoint, "/api/v1/pricing/public?timezone=Asia%2FShanghai");
  assert.equal(adapter.method, "GET");
  const prepared = prepareStationInput({ baseUrl: "https://cheaprouter.cc/models?tab=all" });
  assert.equal(prepared.baseUrl, "https://cheaprouter.cc/models");
  assert.equal(prepared.mode, "direct");
  assert.equal(prepared.adapter.kind, "cheaprouter");
  let request;
  const fetchImpl = async (url, init) => {
    request = { url, init };
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
  const pageFetch = async () => {
    throw new Error("CheapRouter must not use pageFetch");
  };
  const snapshot = await collectStationInput({ ...station, adapter }, { fetchImpl, pageFetch });
  assert.equal(request.url, "https://cheaprouter.cc/api/v1/pricing/public?timezone=Asia%2FShanghai");
  assert.equal(request.init.credentials, "omit");
  assert.equal(snapshot.status, "success");
  assert.equal(snapshot.normalized.data[0].model_name, "gpt-4o");
  assert.equal(snapshot.normalized.data[0].input_price, 0.18);
  assert.equal(snapshot.normalized.data[0].output_price, 1.08);
  assert.equal(snapshot.normalized.data[0].price_currency, "CREDITS");
});

test("scopes confirmed model overrides by station", () => {
  const official = [
    { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet", provider: "anthropic" },
    { id: "anthropic/claude-3.7-haiku", name: "Claude 3.7 Haiku", provider: "anthropic" },
    { id: "openai/gpt-4o", name: "GPT-4o", provider: "openai" }
  ];
  const override = [{ stationId: "station-a", modelName: "relay-sonnet", officialModelId: "anthropic/claude-3.7-sonnet" }];
  assert.equal(matchModelWithOverrides("relay-sonnet", official, { stationId: "station-a", overrides: override })[0].ruleId, "manual");
  assert.equal(matchModelWithOverrides("relay-sonnet-expires-on-2026-12-31", official, { stationId: "station-a", overrides: override })[0].ruleId, "manual");
  assert.deepEqual(matchModelWithOverrides("relay-sonnet", official, { stationId: "station-b", overrides: override }), []);
});

test("indexed model matcher ignores legacy rule settings and keeps override scope", () => {
  const official = [
    { id: "openai/gpt-4o", name: "openai/gpt-4o", aliases: ["gpt-4o"] },
    { id: "duplicate-gpt-4o", name: "gpt-4o" },
    { id: "anthropic/claude-3.7-sonnet", name: "anthropic/claude-3.7-sonnet", aliases: ["claude-3.7-sonnet"] },
    { id: "google/gemini-2.0-flash", name: "google/gemini-2.0-flash", aliases: ["gemini-2.0-flash"] }
  ];
  const overrides = [{ stationId: "station-a", modelName: "relay-sonnet", officialModelId: "anthropic/claude-3.7-sonnet" }];
  const index = buildModelMatchIndex(official, overrides, { canonicalIndex: null });
  const legacyRules = [
    { id: "exact", enabled: false },
    { id: "suffix", enabled: true },
    { id: "ignore_version", enabled: true },
    { id: "fuzzy", enabled: true }
  ];

  assert.deepEqual(matchModel("gpt-4o", official, legacyRules, index).map(({ match, ruleId }) => [match.id, ruleId]), [
    ["openai/gpt-4o", "exact"],
    ["duplicate-gpt-4o", "exact"]
  ]);
  assert.deepEqual(matchModel("custom-claude-3.7-sonnet", official, legacyRules, index), []);
  assert.deepEqual(matchModel("gemini-2.0-flash-20260220", official, legacyRules, index), []);
  assert.deepEqual(matchModel("xclaude-3.7-sonnetx", official, legacyRules, index), []);
  assert.deepEqual(normalizeSettings({ matchingRules: legacyRules }).matchingRules, legacyRules);
  assert.equal(matchModelWithOverrides("relay-sonnet", official, { stationId: "station-a", overrides, index })[0].ruleId, "manual");
  assert.deepEqual(matchModelWithOverrides("relay-sonnet", official, { stationId: "station-b", overrides, index }), []);
});

test("canonical layer unifies relay spellings before the legacy rules", () => {
  const official = [
    { id: "z-ai/glm-5.3", name: "GLM-5.3" },
    { id: "anthropic/claude-opus-5.5", name: "Claude Opus 5.5" }
  ];
  const index = buildModelMatchIndex(official);
  const rules = [{ id: "exact", enabled: true }];
  const cases = [
    ["z-ai/glm-5.3:thinking", "z-ai/glm-5.3"],
    ["【限时】GLM-5.3", "z-ai/glm-5.3"],
    ["GLM-5-3", "z-ai/glm-5.3"],
    ["claude-opus-5.5", "anthropic/claude-opus-5.5"],
    ["Claude Opus 5.5", "anthropic/claude-opus-5.5"],
    ["Anthropic: Claude Opus 5.5", "anthropic/claude-opus-5.5"]
  ];
  for (const [name, expected] of cases) {
    const [result] = matchModel(name, official, rules, index);
    assert.equal(result.match.id, expected, name);
    assert.equal(result.ruleId, "canonical", name);
    assert.equal(result.canonical.id, canonicalKey(expected));
  }
  assert.deepEqual(matchModel("unknown-relay-model", official, rules, index), []);
  assert.equal(matchModel("GLM-5.3", official, [{ id: "exact", enabled: false }], index)[0].ruleId, "canonical");
});

test("canonical helpers normalize paths, decorations, and vendor prefixes", () => {
  assert.equal(canonicalKey("openrouter/anthropic/claude-opus-4.8:thinking"), "claude-opus-4-8");
  assert.equal(canonicalKey("【限时】GLM-5.3"), "glm-5-3");
  assert.equal(canonicalKey("gpt-5.5-20260101"), "gpt-5-5");
  assert.equal(resolveCanonicalModel("deepseek-v4.1-flash-1017")?.id, "deepseek-v4-1-flash");
  assert.equal(resolveCanonicalModel("totally-unknown-model-x"), null);
});

test("pagination keeps every quote reachable while bounding each page", () => {
  const rows = Array.from({ length: 205 }, (_, index) => index);
  const pages = [0, 1, 2].map(page => paginateRows(rows, page, 100));
  assert.deepEqual(pages.map(page => page.rows.length), [100, 100, 5]);
  assert.deepEqual(pages.flatMap(page => page.rows), rows);
  assert.equal(paginateRows(rows, 99, 100).page, 2);
  assert.deepEqual(paginateRows([], 0, 100), { page: 0, pageCount: 0, rows: [] });
});

test("page jump input accepts typed pages and clamps them into range", () => {
  assert.equal(parsePageInput("3", 59), 2);
  assert.equal(parsePageInput(" 12 ", 59), 11);
  assert.equal(parsePageInput("999", 59), 58);
  assert.equal(parsePageInput("0", 59), 0);
  assert.equal(parsePageInput("-4", 59), 0);
  assert.equal(parsePageInput("2.7", 59), 1);
  assert.equal(parsePageInput("", 59), null);
  assert.equal(parsePageInput("   ", 59), null);
  assert.equal(parsePageInput("abc", 59), null);
  assert.equal(parsePageInput(null, 59), null);
  assert.equal(parsePageInput("5", 0), 0);
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


test("persists recharge and model price currencies independently", async () => {
  await withSnapshotDb([], async () => {
    await putStations([{
      id: "token123",
      name: "T蜜",
      baseUrl: "https://token123.cfd",
      rechargeCurrency: "USD",
      rechargeRmb: 72,
      rechargeCredits: 60,
      rechargeRate: 1.2,
      rechargeRateVerified: true,
      priceCurrency: "CREDITS",
      priceCurrencyVerified: true
    }]);
    const [saved] = await getStations();
    assert.equal(saved.rechargeCurrency, "USD");
    assert.equal(saved.rechargeRmb, 72);
    assert.equal(saved.rechargeCredits, 60);
    assert.equal(saved.priceCurrency, "CREDITS");
    assert.equal(saved.priceCurrencyVerified, true);
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
  await collectStationInput({
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
  await collectStationInput({
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

test("isolates the Hepingan v3 bridge from stale v2 listeners and uses page auth", async () => {
  const listeners = new Map();
  const posted = [];
  let token = "hepingan-page-token";
  let storageReads = 0;
  let request = null;
  const payload = { data: [{ name: "Hepingan", platforms: [{ platform: "OpenAI", groups: [], supported_models: [] }] }] };
  const origin = "https://api.hepingan.top";
  const pageAuth = { source: "localStorage", storageKey: "auth_token", header: "Authorization", scheme: "Bearer", missingMessage: "未找到 Hepingan 登录凭据，请先在当前 Chrome 配置文件登录后重试" };
  const pageWindow = {
    location: { hostname: "api.hepingan.top", href: `${origin}/available-channels`, origin },
    history: { pushState() {}, replaceState() {} },
    document: { body: {}, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem(key) { storageReads += 1; assert.equal(key, "auth_token"); return token; } },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener() {},
    postMessage(message) { posted.push(message); },
    fetch: async (url, init) => {
      request = { url, init };
      return {
        ok: true,
        status: 200,
        headers: { get: () => "application/json" },
        json: async () => payload,
        clone: () => ({ json: async () => payload })
      };
    }
  };
  function MockXHR() {}
  MockXHR.prototype.open = function() {};
  MockXHR.prototype.send = function() {};
  runInNewContext(readFileSync(new URL("../src/page-bridge.js", import.meta.url), "utf8"), { window: pageWindow, document: pageWindow.document, history: pageWindow.history, fetch: pageWindow.fetch, XMLHttpRequest: MockXHR, URL, Date, Math, JSON, Object, String, Number, Array, Set, RegExp, Error, Promise });
  await listeners.get("message")({
    source: pageWindow,
    origin,
    data: { type: PAGE_WINDOW_CAPTURE_REQUEST_TYPE, id: "hepingan-capture" }
  });
  assert.equal(posted.at(-1).type, PAGE_WINDOW_RESPONSE_TYPE);
  assert.equal(posted.at(-1).response.ok, false);
  await listeners.get("message")({
    source: pageWindow,
    origin,
    data: { type: "AI_RELAY_PAGE_BRIDGE_REQUEST_V2", id: "hepingan-v2", request: { url: `${origin}${HEPINGAN_CHANNELS_ENDPOINT}`, method: "GET" } }
  });
  assert.equal(request, null);
  assert.equal(posted.some(message => message.id === "hepingan-v2"), false);
  await listeners.get("message")({
    source: pageWindow,
    origin,
    data: { type: PAGE_WINDOW_REQUEST_TYPE, id: "hepingan-v3", request: { url: `${origin}${HEPINGAN_CHANNELS_ENDPOINT}`, method: "GET", credentials: "include", headers: { Accept: "application/json" }, pageAuth } }
  });
  assert.equal(request.init.headers.Authorization, `Bearer ${token}`);
  assert.equal(request.init.credentials, "include");
  assert.equal(posted.at(-1).type, PAGE_WINDOW_RESPONSE_TYPE);
  assert.equal(JSON.stringify(posted).includes(token), false);
  storageReads = 0;
  request = null;
  await listeners.get("message")({
    source: pageWindow,
    origin,
    data: { type: PAGE_WINDOW_REQUEST_TYPE, id: "hepingan-other", request: { url: `${origin}/api/v1/user/profile`, method: "GET" } }
  });
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(request.init.credentials, "omit");
  assert.equal(storageReads, 0);
  request = null;
  storageReads = 0;
  token = "";
  await listeners.get("message")({
    source: pageWindow,
    origin,
    data: { type: PAGE_WINDOW_REQUEST_TYPE, id: "hepingan-no-token", request: { url: `${origin}${HEPINGAN_CHANNELS_ENDPOINT}`, method: "GET", pageAuth } }
  });
  assert.equal(request, null);
  assert.equal(storageReads, 1);
  assert.match(posted.at(-1).error, /未找到 Hepingan 登录凭据/);
  assert.equal(posted.at(-1).type, PAGE_WINDOW_RESPONSE_TYPE);
});

test("站点 301 到 www 时，裸域地址的请求落到页面 origin，Authorization 不被跨域重定向吃掉", async () => {
  const listeners = new Map();
  const posted = [];
  const calls = [];
  const pageOrigin = "https://www.jiji.cc";
  const modelApi = "https://jiji.cc/extension/api/model-market";
  const pageAuth = { source: "localStorage", storageKey: "auth_token", header: "Authorization", scheme: "Bearer", missingMessage: "未找到 Jiji 登录凭据，请先在当前 Chrome 配置文件登录后重试" };
  const pageWindow = {
    location: { hostname: "www.jiji.cc", href: `${pageOrigin}/custom/13235f4cd3f1e94e`, origin: pageOrigin },
    history: { pushState() {}, replaceState() {} },
    document: { body: {}, querySelector: () => null, querySelectorAll: () => [] },
    localStorage: { getItem: () => "jiji-token", length: 1, key: () => "auth_token" },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener() {},
    postMessage(message) { posted.push(message); },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => ({ data: [] }), clone: () => ({ json: async () => ({ data: [] }) }) };
    }
  };
  function MockXHR() {}
  MockXHR.prototype.open = function() {};
  MockXHR.prototype.send = function() {};
  runInNewContext(readFileSync(new URL("../src/page-bridge.js", import.meta.url), "utf8"), { window: pageWindow, history: pageWindow.history, fetch: pageWindow.fetch, XMLHttpRequest: MockXHR, URL, Date, Math, JSON, Object, String, Number, Array, Set, RegExp, Error, Promise });
  await listeners.get("message")({
    source: pageWindow,
    origin: pageOrigin,
    data: { type: PAGE_WINDOW_REQUEST_TYPE, id: "jiji-www", request: { url: modelApi, method: "GET", headers: { Accept: "application/json" }, pageAuth } }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${pageOrigin}/extension/api/model-market`);
  assert.equal(calls[0].init.headers.Authorization, "Bearer jiji-token");
  assert.equal(posted.at(-1).type, PAGE_WINDOW_RESPONSE_TYPE);
  assert.equal(posted.at(-1).response.ok, true);

  posted.length = 0;
  calls.length = 0;
  await listeners.get("message")({
    source: pageWindow,
    origin: pageOrigin,
    data: { type: PAGE_WINDOW_REQUEST_TYPE, id: "jiji-other-host", request: { url: "https://evil.example/extension/api/model-market", method: "GET" } }
  });
  assert.equal(calls.length, 0);
  assert.match(posted.at(-1).error, /页面请求必须同源/);
});

test("refreshes page auth once and stops after a failed refresh", async () => {
  const listeners = new Map();
  const posted = [];
  const storage = new Map([
    ["auth_token", "expired-token"],
    ["refresh_token", "refresh-token"]
  ]);
  const calls = [];
  let refreshSucceeds = true;
  const origin = "https://api.killai.cc";
  const pageAuth = {
    source: "localStorage",
    storageKey: "auth_token",
    header: "Authorization",
    scheme: "Bearer",
    sessionFailureStatuses: [401],
    refresh: {
      endpoint: "/api/v1/auth/refresh",
      refreshTokenStorageKey: "refresh_token",
      credentials: "same-origin",
      includeAccessToken: true,
      responsePath: "data",
      accessTokenKey: "access_token",
      refreshTokenKey: "refresh_token",
      expiresInKey: "expires_in",
      expiresAtStorageKey: "token_expires_at"
    }
  };
  const jsonResponse = (body, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => body,
    clone: () => ({ json: async () => body })
  });
  const pageWindow = {
    location: { hostname: "api.killai.cc", href: `${origin}/model-plaza?embedded=1`, origin },
    history: { pushState() {}, replaceState() {} },
    localStorage: { getItem: key => storage.get(key) || "", setItem: (key, value) => storage.set(key, value) },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener() {},
    postMessage(message) { posted.push(message); },
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (String(url).endsWith("/api/v1/auth/refresh")) return refreshSucceeds
        ? jsonResponse({ code: 0, data: { access_token: "fresh-token", refresh_token: "rotated-refresh-token", expires_in: 3600 } })
        : jsonResponse({ code: 401, message: "refresh failed" }, 401);
      if (init.headers.Authorization === "Bearer expired-token") return jsonResponse({ code: 401, message: "expired" }, 401);
      return jsonResponse({ data: [{ model_name: "gpt-4o", model_ratio: 1, completion_ratio: 1 }] });
    }
  };
  function MockXHR() {}
  MockXHR.prototype.open = function() {};
  MockXHR.prototype.send = function() {};
  runInNewContext(readFileSync(new URL("../src/page-bridge.js", import.meta.url), "utf8"), { window: pageWindow, history: pageWindow.history, fetch: pageWindow.fetch, XMLHttpRequest: MockXHR, URL, Date, Math, JSON, Object, String, Number, Array, Set, RegExp, Error, Promise });
  const send = async id => {
    posted.length = 0;
    await listeners.get("message")({
      source: pageWindow,
      origin,
      data: { type: PAGE_WINDOW_REQUEST_TYPE, id, request: { url: `${origin}/api/v1/model-plaza?timezone=Asia%2FShanghai`, method: "GET", headers: { Accept: "application/json" }, pageAuth } }
    });
    return posted.at(-1);
  };

  const success = await send("killai-refresh-success");
  assert.deepEqual(calls.map(call => call.url), [
    `${origin}/api/v1/model-plaza?timezone=Asia%2FShanghai`,
    `${origin}/api/v1/auth/refresh`,
    `${origin}/api/v1/model-plaza?timezone=Asia%2FShanghai`
  ]);
  assert.equal(JSON.parse(calls[1].init.body).refresh_token, "refresh-token");
  assert.equal(calls[1].init.credentials, "same-origin");
  assert.equal(calls[1].init.headers.Authorization, "Bearer expired-token");
  assert.equal(calls[2].init.headers.Authorization, "Bearer fresh-token");
  assert.equal(storage.get("auth_token"), "fresh-token");
  assert.equal(storage.get("refresh_token"), "rotated-refresh-token");
  assert.ok(Number(storage.get("token_expires_at")) > Date.now());
  assert.equal(success.response.status, 200);
  assert.equal(JSON.stringify(posted).includes("refresh-token"), false);

  calls.length = 0;
  storage.set("auth_token", "expired-token");
  refreshSucceeds = false;
  const failure = await send("killai-refresh-failure");
  assert.deepEqual(calls.map(call => call.url), [
    `${origin}/api/v1/model-plaza?timezone=Asia%2FShanghai`,
    `${origin}/api/v1/auth/refresh`
  ]);
  assert.equal(failure.response.status, 401);
});
test("classifies page auth failures by provider policy", async () => {
  let status = 401;
  const pageFetch = async () => ({ ok: false, status, body: { message: "unauthorized" } });
  await assert.rejects(
    () => collectStationInput({
      id: "station-hepingan-401",
      name: "hepingan.top",
      baseUrl: "https://api.hepingan.top/available-channels",
      mode: "page"
    }, { pageFetch }),
    /页面会话已失效，请在当前 Chrome 配置文件重新登录后重试/
  );
  status = 403;
  await assert.rejects(
    () => collectStationInput({
      id: "station-hepingan-403",
      name: "hepingan.top",
      baseUrl: "https://api.hepingan.top/available-channels",
      mode: "page"
    }, { pageFetch }),
    /hepingan.top 请求失败（403）/
  );
});
test("treats CUN.AI 403 as an HTTP error", async () => {
  const pageFetch = async () => ({ ok: false, status: 403, body: { message: "forbidden" } });
  await assert.rejects(
    () => collectStationInput({
      id: "station-cun-403",
      name: "CUN.AI",
      baseUrl: "https://www.cun.ai/pricing",
      mode: "page"
    }, { pageFetch }),
    /CUN.AI 请求失败（403）/
  );
});
test("keeps bridge protocol constants synchronized across injected scripts", () => {
  const pageBridge = readFileSync(new URL("../src/page-bridge.js", import.meta.url), "utf8");
  const contentBridge = readFileSync(new URL("../src/content-bridge.js", import.meta.url), "utf8");
  const pageTabs = readFileSync(new URL("../src/core/page-tabs.js", import.meta.url), "utf8");
  const assertLiteral = (source, name, value) => assert.ok(source.includes(`const ${name} = ${JSON.stringify(value)};`), `${name} is out of sync`);

  for (const [name, value] of [
    ["PAGE_BRIDGE_VERSION", PAGE_BRIDGE_VERSION],
    ["PAGE_WINDOW_REQUEST_TYPE", PAGE_WINDOW_REQUEST_TYPE],
    ["PAGE_WINDOW_CAPTURE_REQUEST_TYPE", PAGE_WINDOW_CAPTURE_REQUEST_TYPE],
    ["PAGE_WINDOW_RESPONSE_TYPE", PAGE_WINDOW_RESPONSE_TYPE]
  ]) assertLiteral(pageBridge, name, value);

  for (const [name, value] of [
    ["CONTENT_BRIDGE_VERSION", CONTENT_BRIDGE_VERSION],
    ["PAGE_WINDOW_REQUEST_TYPE", PAGE_WINDOW_REQUEST_TYPE],
    ["PAGE_WINDOW_CAPTURE_REQUEST_TYPE", PAGE_WINDOW_CAPTURE_REQUEST_TYPE],
    ["PAGE_WINDOW_RESPONSE_TYPE", PAGE_WINDOW_RESPONSE_TYPE],
    ["LEGACY_PAGE_WINDOW_RESPONSE_TYPE", LEGACY_PAGE_WINDOW_RESPONSE_TYPE],
    ["CONTENT_PROBE_REQUEST_TYPE", CONTENT_PROBE_REQUEST_TYPE],
    ["CONTENT_PROBE_RESPONSE_TYPE", CONTENT_PROBE_RESPONSE_TYPE],
    ["PAGE_RUNTIME_FETCH_TYPE", PAGE_RUNTIME_FETCH_TYPE],
    ["PAGE_RUNTIME_CAPTURE_TYPE", PAGE_RUNTIME_CAPTURE_TYPE]
  ]) assertLiteral(contentBridge, name, value);
  const assertVersioned = (value, version) => assert.match(value, new RegExp(`V${version}$`), `${value} is out of sync with version ${version}`);
  for (const value of [PAGE_WINDOW_REQUEST_TYPE, PAGE_WINDOW_CAPTURE_REQUEST_TYPE, PAGE_WINDOW_RESPONSE_TYPE]) assertVersioned(value, PAGE_BRIDGE_VERSION);
  for (const value of [CONTENT_PROBE_REQUEST_TYPE, CONTENT_PROBE_RESPONSE_TYPE, PAGE_RUNTIME_FETCH_TYPE, PAGE_RUNTIME_CAPTURE_TYPE]) assertVersioned(value, CONTENT_BRIDGE_VERSION);

  assert.ok(contentBridge.includes("message?.type === PAGE_RUNTIME_FETCH_TYPE"));
  assert.ok(contentBridge.includes("message?.type === PAGE_RUNTIME_CAPTURE_TYPE"));
  assert.ok(pageBridge.includes("type: PAGE_WINDOW_RESPONSE_TYPE"));
  assert.ok(pageTabs.includes("function probePageBridge()"), "probePageBridge 不再按版本号判断是否最新");
  assert.ok(pageTabs.includes("func: probeContentBridge, args: [CONTENT_PROBE_REQUEST_TYPE, CONTENT_PROBE_RESPONSE_TYPE]"));
  assert.ok(pageTabs.includes("contentProbe.result.version < CONTENT_BRIDGE_VERSION"));
});
test("keeps one content bridge listener when legacy and current listeners coexist", () => {
  const source = readFileSync(new URL("../src/content-bridge.js", import.meta.url), "utf8");
  const windowListeners = [];
  const eventListeners = new Map();
  const runtimeListeners = [message => message?.type === "PAGE_FETCH_V2" && undefined];
  const posted = [];
  const pageWindow = {
    location: { origin: "https://relay.example" },
    addEventListener(type, listener) { if (type === "message") windowListeners.push(listener); else eventListeners.set(type, listener); },
    removeEventListener(type, listener) { if (eventListeners.get(type) === listener) eventListeners.delete(type); },
    postMessage(message) {
      posted.push(message);
      if (message.type === PAGE_WINDOW_REQUEST_TYPE) eventListeners.get("ai-relay-page-response:content-probe-id")?.({ detail: { id: "content-probe-id", ok: true, response: { ok: true, status: 200, body: {} } } });
    }
  };
  const context = {
    window: pageWindow,
    chrome: { runtime: { onMessage: { addListener(listener) { runtimeListeners.push(listener); } } } },
    crypto: { randomUUID: () => "content-probe-id" },
    setTimeout,
    clearTimeout
  };
  windowListeners.push(event => {
    if (event.data?.type === "AI_RELAY_CONTENT_BRIDGE_PROBE_REQUEST") pageWindow.postMessage({ type: "AI_RELAY_CONTENT_BRIDGE_PROBE_RESPONSE", id: event.data.id, version: 2 }, pageWindow.location.origin);
  });

  runInNewContext(source, context);
  runInNewContext(source, context);
  assert.equal(runtimeListeners.length, 2);

  for (const listener of windowListeners) listener({ source: pageWindow, origin: pageWindow.location.origin, data: { type: CONTENT_PROBE_REQUEST_TYPE, id: "v3-probe" } });
  assert.equal(posted.filter(message => message.type === CONTENT_PROBE_RESPONSE_TYPE).length, 1);
  assert.equal(posted.filter(message => message.type === "AI_RELAY_CONTENT_BRIDGE_PROBE_RESPONSE").length, 0);

  for (const listener of runtimeListeners) listener({ type: PAGE_RUNTIME_FETCH_TYPE, request: { url: "https://relay.example/pricing", method: "GET" } }, {}, () => {});
  assert.equal(posted.filter(message => message.type === PAGE_WINDOW_REQUEST_TYPE).length, 1);
});


test("isolates a legacy content listener after reset and reinjection", () => {
  const source = readFileSync(new URL("../src/content-bridge.js", import.meta.url), "utf8");
  const windowListeners = [];
  const eventListeners = new Map();
  const runtimeListeners = [message => {
    if (message?.type === "PAGE_FETCH_V3") pageWindow.postMessage({ type: "AI_RELAY_PAGE_BRIDGE_REQUEST_V3", id: "legacy" }, pageWindow.location.origin);
  }];
  const posted = [];
  const pageWindow = {
    location: { origin: "https://relay.example" },
    addEventListener(type, listener) { if (type === "message") windowListeners.push(listener); else eventListeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (type === "message") {
        const index = windowListeners.indexOf(listener);
        if (index >= 0) windowListeners.splice(index, 1);
      } else if (eventListeners.get(type) === listener) eventListeners.delete(type);
    },
    postMessage(message) {
      posted.push(message);
      if (message.type === PAGE_WINDOW_REQUEST_TYPE) eventListeners.get(`ai-relay-page-response:${message.id}`)?.({ detail: { id: message.id, ok: true, response: { ok: true, status: 200, body: {} } } });
    }
  };
  const context = {
    window: pageWindow,
    chrome: { runtime: { onMessage: {
      addListener(listener) { runtimeListeners.push(listener); },
      removeListener(listener) {
        const index = runtimeListeners.indexOf(listener);
        if (index >= 0) runtimeListeners.splice(index, 1);
      }
    } } },
    crypto: { randomUUID: () => "content-recovery-id" },
    setTimeout,
    clearTimeout
  };

  runInNewContext(source, context);
  runInNewContext(`(${resetContentBridge.toString()})()`, context);
  runInNewContext(source, context);
  assert.equal(runtimeListeners.length, 2);

  let responseCount = 0;
  for (const listener of runtimeListeners) listener({ type: PAGE_RUNTIME_FETCH_TYPE, request: { url: "https://relay.example/pricing", method: "GET" } }, {}, () => { responseCount += 1; });
  assert.equal(posted.filter(message => message.type === PAGE_WINDOW_REQUEST_TYPE).length, 1);
  assert.equal(responseCount, 1);
});
test("uses the CUN.AI local uid only for its pricing API", async () => {
  const listeners = new Map();
  const posted = [];
  let request;
  const origin = "https://www.cun.ai";
  const pageWindow = {
    location: { href: `${origin}/pricing`, origin },
    history: { pushState() {}, replaceState() {} },
    localStorage: { getItem(key) { assert.equal(key, "uid"); return "cun-user-id"; } },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener() {},
    postMessage(message) { posted.push(message); },
    fetch: async (url, init) => {
      request = { url, init };
      return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => cunFixture, clone: () => ({ json: async () => cunFixture }) };
    }
  };
  function MockXHR() {}
  MockXHR.prototype.open = function() {};
  MockXHR.prototype.send = function() {};
  runInNewContext(readFileSync(new URL("../src/page-bridge.js", import.meta.url), "utf8"), { window: pageWindow, history: pageWindow.history, fetch: pageWindow.fetch, XMLHttpRequest: MockXHR, URL, Date, Math, JSON, Object, String, Number, Array, Set, RegExp, Error, Promise });
  await listeners.get("message")({
    source: pageWindow,
    origin,
    data: { type: PAGE_WINDOW_REQUEST_TYPE, id: "cun-1", request: { url: `${origin}/api/pricing`, method: "GET", credentials: "include", headers: { Accept: "application/json" }, pageAuth: { source: "localStorage", storageKey: "uid", header: "New-Api-User", missingMessage: "未找到 CUN.AI 登录凭据，请先在当前 Chrome 配置文件登录后重试" } } }
  });
  assert.equal(request.init.headers["New-Api-User"], "cun-user-id");
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(request.init.credentials, "include");
  assert.equal(JSON.stringify(posted).includes("cun-user-id"), false);
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
    data: { type: PAGE_WINDOW_REQUEST_TYPE, id: "fastai-1", request: { url: `${origin}/api/v1/channels/available`, method: "GET", credentials: "include", headers: { Accept: "application/json", "X-User-UI-Request": "1" }, pageAuth: { source: "localStorage", storageKey: "auth_token", header: "Authorization", scheme: "Bearer", missingMessage: "未找到 FastAIToken 登录凭据，请先在当前 Chrome 配置文件登录后重试" } } }
  });
  assert.equal(request.init.headers.Authorization, `Bearer ${token}`);
  assert.equal(request.init.headers["X-User-UI-Request"], "1");
  assert.equal(request.init.credentials, "include");
  assert.equal(JSON.stringify(posted).includes(token), false);
  request = null;
  await listeners.get("message")({
    source: pageWindow, origin,
    data: { type: PAGE_WINDOW_REQUEST_TYPE, id: "fastai-2", request: { url: `${origin}/api/v1/user/profile`, method: "GET", headers: { Accept: "application/json" } } }
  });
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(request.init.headers["X-User-UI-Request"], undefined);
  assert.equal(JSON.stringify(posted).includes(token), false);
  request = null;
  pageWindow.localStorage.getItem = () => "";
  await listeners.get("message")({
    source: pageWindow, origin,
    data: { type: PAGE_WINDOW_REQUEST_TYPE, id: "fastai-3", request: { url: `${origin}/api/v1/channels/available`, method: "GET", headers: { Accept: "application/json" }, pageAuth: { source: "localStorage", storageKey: "auth_token", header: "Authorization", scheme: "Bearer", missingMessage: "未找到 FastAIToken 登录凭据，请先在当前 Chrome 配置文件登录后重试" } } }
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
    data: { type: PAGE_WINDOW_CAPTURE_REQUEST_TYPE, id: "cheaprouter-1" }
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

// 站点一次导航失败时 Chrome 会停在错误页上，注入前要重载一次，不然只会报
// `Frame with ID 0 is showing error page`，用户看不出是网络问题。
test("reloads a temporary tab that landed on a Chrome error page", async () => {
  const listeners = [];
  let reloads = 0;
  const tabs = {
    query: async () => [],
    create: async () => ({ id: 46, status: "loading" }),
    get: async () => reloads
      ? { id: 46, url: "https://fastaitoken.com/available-channels", status: "complete" }
      : { id: 46, url: "chrome-error://chromewebdata/", status: "complete" },
    reload: async tabId => {
      reloads += 1;
      for (const listener of [...listeners]) listener(tabId, { status: "complete" });
    },
    remove: async () => {},
    onUpdated: { addListener: listener => listeners.push(listener), removeListener() {} },
    onRemoved: { addListener() {}, removeListener() {} }
  };
  const result = await findOrOpenPageTab(tabs, { baseUrl: "https://fastaitoken.com/available-channels", mode: "page" });
  assert.equal(reloads, 1);
  assert.equal(result.temporary, true);
  assert.equal(result.tab.url, "https://fastaitoken.com/available-channels");
});

test("reports an unreachable site and closes the tab when the error page persists", async () => {
  const listeners = [];
  const removed = [];
  const tabs = {
    query: async () => [],
    create: async () => ({ id: 47, status: "loading" }),
    get: async tabId => ({ id: tabId, url: "chrome-error://chromewebdata/", status: "complete" }),
    reload: async tabId => {
      for (const listener of [...listeners]) listener(tabId, { status: "complete" });
    },
    remove: async tabId => removed.push(tabId),
    onUpdated: { addListener: listener => listeners.push(listener), removeListener() {} },
    onRemoved: { addListener() {}, removeListener() {} }
  };
  await assert.rejects(findOrOpenPageTab(tabs, { baseUrl: "https://all-in-one.icu/#/tenant/models", mode: "page" }), /采集页面加载失败/);
  assert.deepEqual(removed, [47]);
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
  assert.equal(comparison.offers[0].monthlyCost, 1.4);
});

test("normalizes settings and infers adapters from local rules", () => {
  const settings = normalizeSettings({ refreshIntervalMinutes: 0, defaultCurrency: "EUR" });
  assert.equal("refreshIntervalMinutes" in settings, false);
  assert.equal(settings.defaultCurrency, "CNY");
  const inferred = inferStationAdapter({ baseUrl: "https://relay.example/sora", auth: { type: "bearer" } });
  assert.equal(inferred.endpoint, "/api/sora");
  assert.equal(inferred.responseFormat, "sora");
  const pricingPage = inferStationAdapter({ baseUrl: "https://relay.example/pricing" });
  assert.equal(pricingPage.endpoint, "/api/pricing");
  const modelList = inferStationAdapter({ baseUrl: "https://relay.example/v1/models", adapter: { endpoint: "/api/ai/pricing" } });
  assert.equal(modelList.endpoint, "/v1/models");
});


test("keeps zero pricing values and blocks insecure remote URLs", () => {
  const station = normalizeStation({ baseUrl: "https://relay.example", rechargeRate: 0, basePricePerMillion: 0 });
  assert.equal(station.rechargeRate, 0);
  assert.equal(station.basePricePerMillion, 0);
  assert.equal(isSecureRemoteUrl("https://relay.example"), true);
  assert.equal(isSecureRemoteUrl("http://localhost:3000"), true);
  assert.equal(isSecureRemoteUrl("http://relay.example"), false);
  assert.throws(() => normalizeStation({ baseUrl: "http://relay.example" }), /HTTPS/);
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

test("opens a temporary Jiji model market tab when no site tab is available", async () => {
  const opened = [];
  const tabs = {
    query: async () => [],
    create: async options => {
      opened.push(options);
      return { id: 43, url: options.url, status: "complete" };
    },
    get: async tabId => ({ id: tabId, url: "https://www.jiji.cc/custom/13235f4cd3f1e94e", status: "complete" }),
    onUpdated: { addListener() {}, removeListener() {} },
    onRemoved: { addListener() {}, removeListener() {} }
  };
  const result = await findOrOpenPageTab(tabs, { baseUrl: "https://www.jiji.cc/custom/13235f4cd3f1e94e", mode: "page" });
  assert.equal(result.temporary, true);
  assert.equal(result.tab.id, 43);
  assert.deepEqual(opened, [{ url: "https://www.jiji.cc/custom/13235f4cd3f1e94e", active: false }]);
});

test("opens a temporary Hepingan tab when no site tab is available", async () => {
  const opened = [];
  const tabs = {
    query: async () => [],
    create: async options => {
      opened.push(options);
      return { id: 44, url: options.url, status: "complete" };
    },
    get: async tabId => ({ id: tabId, url: "https://api.hepingan.top/available-channels", status: "complete" }),
    onUpdated: { addListener() {}, removeListener() {} },
    onRemoved: { addListener() {}, removeListener() {} }
  };
  const result = await findOrOpenPageTab(tabs, { baseUrl: "https://api.hepingan.top/available-channels", mode: "page" });
  assert.equal(result.temporary, true);
  assert.equal(result.tab.id, 44);
  assert.deepEqual(opened, [{ url: "https://api.hepingan.top/available-channels", active: false }]);
});

test("reuses an existing Hepingan login page", async () => {
  const existing = { id: 55, url: "https://api.hepingan.top/available-channels" };
  const tabs = {
    query: async () => [existing],
    create: async () => assert.fail("should reuse the existing Hepingan page"),
    onUpdated: { addListener() {}, removeListener() {} },
    onRemoved: { addListener() {}, removeListener() {} }
  };
  const result = await findOrOpenPageTab(tabs, { baseUrl: existing.url, mode: "page" });
  assert.equal(result.tab, existing);
  assert.equal(result.temporary, false);
});

test("opens a clean hepingan page instead of guessing among ambiguous login tabs", async () => {
  const opened = [];
  const tabs = {
    query: async () => [
      { id: 56, url: "https://api.hepingan.top/account-a" },
      { id: 57, url: "https://api.hepingan.top/account-b" }
    ],
    create: async options => {
      opened.push(options);
      return { id: 58, url: options.url, status: "complete" };
    },
    get: async tabId => ({ id: tabId, url: "https://api.hepingan.top/available-channels", status: "complete" }),
    onUpdated: { addListener() {}, removeListener() {} },
    onRemoved: { addListener() {}, removeListener() {} }
  };
  const result = await findOrOpenPageTab(tabs, { baseUrl: "https://api.hepingan.top/available-channels", mode: "page" });
  assert.equal(result.temporary, true);
  assert.equal(result.tab.id, 58);
  assert.deepEqual(opened, [{ url: "https://api.hepingan.top/available-channels", active: false }]);
});

test("reports too many same-site tabs when the provider cannot open a temporary page", async () => {
  const tabs = {
    query: async () => [
      { id: 61, url: "https://api.killai.cc/console" },
      { id: 62, url: "https://api.killai.cc/docs" }
    ],
    create: async () => assert.fail("killai has no openTemporaryPage"),
    onUpdated: { addListener() {}, removeListener() {} },
    onRemoved: { addListener() {}, removeListener() {} }
  };
  const result = await findOrOpenPageTab(tabs, { id: "killai", name: "KillAI", baseUrl: "https://api.killai.cc/pricing", mode: "page" });
  assert.deepEqual(result, { tab: null, temporary: false, reason: "ambiguous" });
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
  // 站点 301 到 www（jiji.cc → www.jiji.cc）时，浏览器里开着的 www 页面要能认出来。
  const wwwTabs = [{ id: 31, url: "https://www.jiji.cc/custom/13235f4cd3f1e94e" }];
  assert.equal(selectPageTab(wwwTabs, "https://jiji.cc", undefined, "https://jiji.cc/custom/13235f4cd3f1e94e")?.id, 31);
  assert.equal(selectPageTab(wwwTabs, "https://jiji.cc", 31)?.id, 31);
  assert.equal(selectPageTab(wwwTabs, "https://other.example", undefined), null);
  const hashTabs = [
    { id: 21, url: "https://all-in-one.icu/#/login" },
    { id: 22, url: "https://all-in-one.icu/#/tenant/models" }
  ];
  assert.equal(selectPageTab(hashTabs, "https://all-in-one.icu", 20, "https://all-in-one.icu/#/tenant/models"), hashTabs[1]);
  const twinTabs = [
    { id: 31, url: "https://all-in-one.icu/#/tenant/models" },
    { id: 32, url: "https://all-in-one.icu/#/tenant/models", active: true }
  ];
  assert.equal(selectPageTab(twinTabs, "https://all-in-one.icu", 20, "https://all-in-one.icu/#/tenant/models"), twinTabs[1]);
});
test("falls back to the active same-origin tab when a declared collection page has drifted", async () => {
  const tabs = {
    query: async () => [
      { id: 41, url: "https://all-in-one.icu/#/tenant/dashboard" },
      { id: 42, url: "https://all-in-one.icu/#/tenant/login?redirect=/tenant/models", active: true }
    ],
    create: async () => assert.fail("should reuse the open tab"),
    onUpdated: { addListener() {}, removeListener() {} },
    onRemoved: { addListener() {}, removeListener() {} }
  };
  const result = await findOrOpenPageTab(tabs, {
    id: "all-in-one",
    baseUrl: "https://all-in-one.icu/#/tenant/models",
    mode: "page",
    adapter: { kind: "all-in-one-models", pageUrl: "https://all-in-one.icu/#/tenant/models" }
  });
  assert.equal(result.tab.id, 42);
  assert.equal(result.temporary, false);
});
test("skips unauthenticated page capture for localStorage-authenticated stations", async () => {
  const requests = [];
  const pageFetch = async request => {
    requests.push(request);
    return response(allInOneFixture);
  };
  pageFetch.supportsCapture = true;
  const snapshot = await collectStationInput({
    id: "station-all-in-one-capture",
    name: "all-in-one.icu",
    baseUrl: "https://all-in-one.icu/#/tenant/models",
    mode: "page"
  }, { pageFetch });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].capture, undefined);
  assert.equal(requests[0].pageAuth.storageKey, "tenant_access_token");
  assert.equal(snapshot.normalized.sourceFormat, "all-in-one-models");
});
test("installs bridge scripts when an existing page has no bridge", async () => {
  const injections = [];
  const results = [{ result: { current: false } }, { result: false }];
  const scripting = { executeScript: async script => { injections.push(script); return [script.func?.name?.startsWith("probe") ? results.shift() : {}]; } };
  assert.equal(await ensurePageBridge(scripting, 42), undefined);
  assert.deepEqual(injections[2].args, [CONTENT_PROBE_REQUEST_TYPE, CONTENT_PROBE_RESPONSE_TYPE]);
  assert.deepEqual(injections.map(({ target, world, files }) => ({ target, world, files })), [
    { target: { tabId: 42 }, world: "MAIN", files: undefined },
    { target: { tabId: 42 }, world: "MAIN", files: ["src/page-bridge.js"] },
    { target: { tabId: 42 }, world: "ISOLATED", files: undefined },
    { target: { tabId: 42 }, world: "ISOLATED", files: undefined },
    { target: { tabId: 42 }, world: undefined, files: ["src/content-bridge.js"] }
  ]);
});

test("rebuilds the page context when a bridge without teardown is still running", async () => {
  const injections = [];
  const reloads = [];
  const updated = { addListener(listener) { updated.fire = listener; }, removeListener() {} };
  const tabs = {
    reload: async tabId => { reloads.push(tabId); queueMicrotask(() => updated.fire(tabId, { status: "complete" })); },
    get: async () => ({ status: "complete", url: "https://jiji.cc/" }),
    onUpdated: updated
  };
  const results = [{ result: { stale: true } }, { result: { version: CONTENT_BRIDGE_VERSION } }];
  const scripting = { executeScript: async script => { injections.push(script); return [script.func?.name?.startsWith("probe") ? results.shift() : {}]; } };
  await ensurePageBridge(scripting, 42, { tabs });
  assert.deepEqual(reloads, [42]);
  assert.deepEqual(injections.filter(script => script.files).map(({ world, files }) => ({ world, files })), [
    { world: "MAIN", files: ["src/page-bridge.js"] }
  ]);
});

test("refuses to run against a bridge it cannot replace when no tab handle is available", async () => {
  const scripting = { executeScript: async script => [script.func ? { result: { stale: true } } : {}] };
  await assert.rejects(() => ensurePageBridge(scripting, 42), /刷新该页面/);
});

test("reinstalls stale v2 page and content bridges", async () => {
  const injections = [];
  const results = [{ result: { current: false, version: 2 } }, { result: { version: 2 } }];
  const scripting = { executeScript: async script => { injections.push(script); return [script.func?.name?.startsWith("probe") ? results.shift() : {}]; } };
  await ensurePageBridge(scripting, 42);
  assert.deepEqual(injections.filter(script => script.files).map(({ target, world, files }) => ({ target, world, files })), [
    { target: { tabId: 42 }, world: "MAIN", files: ["src/page-bridge.js"] },
    { target: { tabId: 42 }, world: undefined, files: ["src/content-bridge.js"] }
  ]);
});

test("reinstalls the page bridge on every pass so stale injected logic cannot survive", async () => {
  const injections = [];
  const results = [{ result: { upgradeable: true } }, { result: { version: CONTENT_BRIDGE_VERSION } }];
  const scripting = { executeScript: async script => { injections.push(script); return [script.func?.name?.startsWith("probe") ? results.shift() : {}]; } };
  await ensurePageBridge(scripting, 42);
  assert.deepEqual(injections.filter(script => script.files).map(({ world, files }) => ({ world, files })), [
    { world: "MAIN", files: ["src/page-bridge.js"] }
  ]);
});

test("reinstalls the content bridge when a page receiver disappears", async () => {
  const injections = [];
  const scripting = { executeScript: async script => { injections.push(script); return [{ result: script.func?.name?.startsWith("probe") ? { current: true } : true }]; } };
  await ensurePageBridge(scripting, 42, { forceContent: true });
  assert.deepEqual(injections.filter(script => script.files).map(({ target, world, files }) => ({ target, world, files })), [
    { target: { tabId: 42 }, world: "MAIN", files: ["src/page-bridge.js"] },
    { target: { tabId: 42 }, world: undefined, files: ["src/content-bridge.js"] }
  ]);
});

test("rejects invalid page-mode price payloads", async () => {
  await assert.rejects(() => collectStationInput({
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



test("bounds refresh workers and settles station failures in input order", async () => {
  let active = 0;
  let maxActive = 0;
  const settled = await runWithConcurrency([40, 10, 20, 5], 2, async (delay, index, slot) => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    try {
      await new Promise(resolve => setTimeout(resolve, delay));
      if (index === 1) throw new Error("station failed");
      return { index, slot };
    } finally {
      active -= 1;
    }
  });
  assert.equal(maxActive, 2);
  assert.deepEqual(settled.map(result => result.status), ["fulfilled", "rejected", "fulfilled", "fulfilled"]);
  assert.deepEqual(settled.map(result => result.value?.index ?? null), [0, null, 2, 3]);
  assert.ok(settled.every(result => result.slot >= 1 && result.slot <= 2));
});

test("serializes same-origin page stations before temporary tab cleanup", async () => {
  const events = [];
  let nextTabId = 1;
  const runPageStation = (name, delay) => withKeyedLock("https://shared.example", async () => {
    const tabId = nextTabId;
    events.push(`${name}:start:${tabId}`);
    await new Promise(resolve => setTimeout(resolve, delay));
    events.push(`${name}:complete:${tabId}`);
    events.push(`tab:${tabId}:removed`);
    nextTabId += 1;
  });
  await Promise.all([runPageStation("first-page", 20), runPageStation("second-page", 5)]);
  assert.deepEqual(events, [
    "first-page:start:1",
    "first-page:complete:1",
    "tab:1:removed",
    "second-page:start:2",
    "second-page:complete:2",
    "tab:2:removed"
  ]);
});

test("station refresh completes while cold reference requests are still pending", async () => {
  const events = [];
  const cache = { models: [], imageQuotes: {} };
  let finishReferences;
  const pendingReferences = new Promise(resolve => { finishReferences = resolve; });
  const result = await runRefreshAll({
    forceReferences: true,
    getStations: async () => [{ id: "first", enabled: true }],
    getValue: async key => { assert.equal(key, "references"); return cache; },
    refreshOfficialReferences: force => { assert.equal(force, true); events.push("references:started"); return pendingReferences; },
    collect: async station => { events.push("station:collected"); return { stationId: station.id, status: "success", normalized: { data: [] } }; },
    putSnapshot: async () => { events.push("snapshot:saved"); },
    notifyProgress: progress => events.push(progress.phase)
  });
  assert.equal(result.summary.successCount, 1);
  assert.equal(result.references, cache);
  assert.ok(events.includes("snapshot:saved"));
  assert.equal(events.at(-1), "complete");
  // 后台任务仍可完成，落库/广播由 service worker 的 reference 刷新入口负责。
  finishReferences({ models: [{ id: "fresh/model" }] });
  await pendingReferences;
});

test("reference refresh rejection warns without failing station collection", async t => {
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args.join(" ")));
  const cache = { models: [{ id: "cached/model" }] };
  const result = await runRefreshAll({
    getStations: async () => [{ id: "first", enabled: true }],
    getValue: async () => cache,
    refreshOfficialReferences: async () => { throw new Error("reference storage failed"); },
    collect: async station => ({ stationId: station.id, status: "success", normalized: { data: [] } }),
    putSnapshot: async () => {},
    notifyProgress() {}
  });
  assert.equal(result.summary.successCount, 1);
  assert.equal(result.references, cache);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /基准参考价更新失败，沿用缓存：reference storage failed/);
});

test("keeps refresh progress and snapshots isolated when stations fail", async () => {
  const stations = [
    { id: "station-a", name: "A", enabled: true },
    { id: "station-b", name: "B", enabled: true },
    { id: "station-c", name: "C", enabled: true }
  ];
  const progress = [];
  const saveAttempts = [];
  const saved = [];
  const result = await runRefreshAll({
    concurrency: 2,
    getStations: async () => stations,
    getValue: async () => ({ models: [] }),
    refreshOfficialReferences: async () => ({ models: [] }),
    collect: async station => {
      if (station.id === "station-a") await new Promise(resolve => setTimeout(resolve, 20));
      if (station.id === "station-b") throw new Error("collect failed");
      return { stationId: station.id, status: "success", normalized: { data: [{ model_name: station.id }] } };
    },
    putSnapshot: async snapshot => {
      saveAttempts.push({ stationId: snapshot.stationId, status: snapshot.status });
      if (snapshot.stationId === "station-c" && snapshot.status === "success") throw new Error("snapshot write failed");
      saved.push(snapshot);
    },
    getSnapshots: async ({ stationId }) => {
      if (stationId === "station-c") throw new Error("snapshot read failed");
      return [];
    },
    errorSnapshot: (station, error) => ({ stationId: station.id, stationName: station.name, status: "error", error: error.message, normalized: { data: [] } }),
    notifyProgress: message => progress.push(message)
  });

  assert.deepEqual(result.results.map(snapshot => snapshot.stationId), ["station-a", "station-b", "station-c"]);
  assert.deepEqual(result.results.map(snapshot => snapshot.status), ["success", "error", "error"]);
  assert.deepEqual(result.summary, {
    total: 3,
    successCount: 1,
    partialCount: 0,
    errorCount: 2,
    totalModels: 1,
    durationMs: result.summary.durationMs
  });
  assert.deepEqual(saveAttempts.filter(({ stationId }) => stationId === "station-c"), [
    { stationId: "station-c", status: "success" },
    { stationId: "station-c", status: "error" }
  ]);
  assert.equal(saveAttempts.some(({ stationId, status }) => stationId === "station-b" && status === "error"), true);
  assert.equal(saved.filter(snapshot => snapshot.status === "error").length, 2);
  const completed = progress.filter(message => message.phase === "station" && message.status !== "running").map(message => message.completed);
  assert.deepEqual(completed, [1, 2, 3]);
  assert.equal(progress.at(-1).phase, "complete");
  assert.equal(progress.at(-1).completed, 3);
});
test("finishes refresh when error snapshot construction fails", async () => {
  const station = { id: "station-factory", name: "Factory failure", enabled: true, adapter: { kind: "test" } };
  const progress = [];
  const saved = [];
  const result = await runRefreshAll({
    concurrency: 1,
    getStations: async () => [station],
    getValue: async () => ({ models: [] }),
    refreshOfficialReferences: async () => ({ models: [] }),
    collect: async () => { throw new Error("collect failed"); },
    putSnapshot: async snapshot => { saved.push(snapshot); },
    getSnapshots: async () => [],
    errorSnapshot: () => { throw new Error("factory failed"); },
    notifyProgress: message => progress.push(message)
  });

  const snapshot = result.results[0];
  assert.equal(result.summary.errorCount, 1);
  assert.equal(snapshot.status, "error");
  assert.equal(snapshot.stationId, station.id);
  assert.equal(snapshot.error, "collect failed；错误快照构造失败：factory failed");
  assert.equal(Number.isFinite(snapshot.collectedAt), true);
  assert.deepEqual(snapshot.normalized.data, []);
  assert.deepEqual(saved, [snapshot]);
  assert.equal(progress.at(-1).phase, "complete");
  assert.equal(progress.at(-1).completed, 1);
});

test("serializes withPageFetch lifecycle and cleans temporary tabs after request failure", async () => {
  const previousChrome = globalThis.chrome;
  const events = [];
  let nextTabId = 1;
  globalThis.chrome = {
    runtime: {
      lastError: undefined,
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      getURL: () => "chrome-extension://test-extension/"
    },
    alarms: { onAlarm: { addListener() {} } },
    tabs: {
      onUpdated: { addListener() {}, removeListener() {} },
      onRemoved: { addListener() {}, removeListener() {} },
      query: async () => [],
      create: async ({ url }) => {
        const id = nextTabId++;
        events.push(`create:${id}:${url}`);
        return { id };
      },
      get: async id => ({ id, status: "complete", url: "https://fastaitoken.com/available-channels" }),
      remove: async id => { events.push(`remove:${id}`); if (id === 1) throw new Error("No tab with id: 1."); if (id === 2) throw new Error("cleanup failed"); },
      sendMessage: (id, message, callback) => {
        events.push(`request:${id}`);
        callback(id === 1 ? { ok: false, error: "bridge failed" } : { ok: true, response: { ok: true, status: 200, body: "ok" } });
      }
    },
    scripting: {
      executeScript: async ({ target, world }) => {
        events.push(`bridge:${target.tabId}`);
        return [{ result: world === "MAIN" ? { current: true } : { version: 999 } }];
      }
    }
  };

  const previousWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);

  try {
    const { withPageFetch } = await import(`../src/service-worker.js?page-fetch-test=${Date.now()}`);
    const station = { id: "page-station", name: "Page station", baseUrl: "https://fastaitoken.com/available-channels", mode: "page" };
    const run = label => withPageFetch(station, undefined, async pageFetch => {
      events.push(`task:${label}`);
      const response = await pageFetch({ url: "https://fastaitoken.com/api/v1/channels/available" });
      return response.body;
    });
    const results = await Promise.allSettled([run("first"), run("second")]);

    assert.deepEqual(results.map(result => result.status), ["rejected", "fulfilled"]);
    assert.equal(results[1].value, "ok");
    const firstRemoval = events.indexOf("remove:1");
    const secondCreation = events.findIndex(event => event.startsWith("create:2:"));
    assert.ok(firstRemoval >= 0, events.join(" | "));
    assert.ok(secondCreation > firstRemoval, events.join(" | "));
    assert.ok(events.includes("remove:2"));
    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0][0]), /临时标签页清理失败/);
  } finally {
    console.warn = previousWarn;
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
  }
});

test("uses shared partial diagnostics in refresh progress", async () => {
  const progress = [];
  await runRefreshAll({
    getStations: async () => [{ id: "partial-station", name: "Partial", enabled: true }],
    getValue: async () => ({}),
    refreshOfficialReferences: async () => ({ models: [] }),
    collect: async () => ({
      stationId: "partial-station",
      status: "partial",
      normalized: {
        data: [{ model_name: "priced-model" }],
        unsupportedBillingModes: ["per_second"],
        unpricedModels: ["Tiered:tiered-model:interval:1"]
      }
    }),
    putSnapshot: async () => {},
    getSnapshots: async () => [],
    errorSnapshot: station => ({ stationId: station.id, status: "error", normalized: { data: [] } }),
    notifyProgress: message => progress.push(message)
  });
  const partialProgress = progress.find(message => message.phase === "station" && message.status === "partial");
  assert.equal(partialProgress.error, "部分计费模式未解析：per_second；未定价模型：Tiered:tiered-model:interval:1");
});

test("keeps refresh progress labels aligned with parallel-slot semantics", () => {
  const dashboard = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const options = readFileSync(new URL("../src/options.js", import.meta.url), "utf8");
  assert.ok(dashboard.includes("并行槽位 ${progress.current}"));
  assert.ok(options.includes("并行槽位 ${progress.current || 1}"));
  assert.equal(options.includes("${progress.current || 1}/${progress.total}"), false);
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
    assert.match(html, /id="collapse-toggle"/, `${page} is missing the collapse toggle button`);
    const keys = new Set();
    for (const match of html.matchAll(/<[a-z-]+ [^>]*data-collapsible[^>]*>/g)) {
      cardCount += 1;
      const tag = match[0];
      const key = tag.match(/data-collapse-key="([^"]+)"/)?.[1] || tag.match(/id="([^"]+)"/)?.[1];
      assert.ok(key, `collapsible card in ${page} needs an id or data-collapse-key: ${tag}`);
      assert.ok(!keys.has(key), `duplicate collapse key ${key} in ${page}`);
      keys.add(key);
      assert.match(html.slice(match.index, match.index + 200), /class="(panel-heading|config-heading|toolbar-main)"/, `first child of ${key} must hold the collapse toggle`);
    }
  }
  // 折叠卡片数量随面板增加而变，这里只保证每个页面都挂了全局按钮且键不冲突。
  // 价格明细表的标题行已删除，dashboard 只剩 toolbar-panel 一张可折叠卡，总数下限相应从 5 降到 4。
  assert.ok(cardCount >= 4);
});

test("refreshes searchable multi-selected dashboard stations", () => {
  const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  assert.match(html, /id="refresh-station-menu"[\s\S]*id="refresh-station-search"[\s\S]*id="refresh-station"[^>]*disabled/);
  assert.match(html, /id="refresh-station-menu"[\s\S]*id="refresh-all"[\s\S]*id="collapse-toggle"[\s\S]*id="open-settings"/);
  assert.doesNotMatch(html, /id="top-menu"/);
  assert.match(source, /\$\("#refresh-station"\)\.addEventListener/);
  assert.match(source, /callService\("REFRESH_STATION", \{ stationIds \}\)/);
  assert.match(source, /data-refresh-station-id/);
  assert.match(source, /refreshStationQuery/);
  // Shift 范围多选：点击时挡掉 label 的默认勾选，自己按起点到目标行整段写；清空要把起点一起丢掉。
  assert.match(source, /event\.shiftKey && anchorIndex >= 0 && targetIndex >= 0/);
  assert.match(source, /state\.refreshStationAnchor = input\.value/);
  assert.match(source, /state\.refreshStationIds\.clear\(\)/);
  assert.match(source, /state\.refreshStationAnchor = null/);
  assert.match(html, /id="refresh-station-clear"/);
});

test("opens site and settings inside the dashboard topbar", () => {
  const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const optionsSource = readFileSync(new URL("../src/options.js", import.meta.url), "utf8");
  const topActions = html.match(/<nav class="top-actions"[\s\S]*?<\/nav>/)?.[0] || "";
  assert.match(topActions, /id="open-settings"[^>]*aria-haspopup="dialog"/);
  assert.match(topActions, /data-comparison-mode="paid"[\s\S]*data-comparison-mode="public"/);
  assert.match(html, /id="settings-layer" hidden/);
  assert.match(html, /data-embed-src="options\.html\?embed=1#installed"/);
  assert.match(html, /data-close-settings/);
  assert.ok(!/class="top-menu-item"[^>]*href=/.test(html), "topbar menu should not link away to the settings page");
  assert.ok(!/data-jump="checkin-panel"/.test(html), "check-in jumps belong in the sidebar panel, not the menu");
  assert.match(source, /options\.html\?embed=1/);
  assert.match(source, /MODEL_ATLAS_SETTINGS_SAVED/);
  assert.match(optionsSource, /is-embedded/);
  assert.match(optionsSource, /MODEL_ATLAS_SETTINGS_SAVED/);
});
test("provides an accessible persisted paid/public dashboard mode boundary", () => {
  const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  assert.match(html, /data-comparison-mode="paid"[^>]*aria-pressed="true"/);
  assert.match(html, /data-comparison-mode="public"[^>]*aria-pressed="false"/);
  assert.match(source, /SAVE_COMPARISON_MODE/);
  assert.match(source, /comparisonMode === "public"/);
  assert.match(source, /仅显示公益站报价/);
  assert.match(source, /paid-only-column/);
});

test("shows the installed plugin list in station settings", () => {
  const html = readFileSync(new URL("../options.html", import.meta.url), "utf8");
  assert.match(html, /id="plugin-installed-list"/);
});

test("normalizes dashboard comparison mode with paid as the default", () => {
  assert.equal(normalizeSettings({}).comparisonMode, "paid");
  assert.equal(normalizeSettings({ comparisonMode: "public" }).comparisonMode, "public");
  assert.equal(normalizeSettings({ comparisonMode: "invalid" }).comparisonMode, "paid");
});

test("defaults provider filters to every provider and remembers the selection", () => {
  const source = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /DEFAULT_PROVIDER_FILTER/);
  assert.match(source, /filters: \{ search: "", stationId: "", provider: readProviderFilter\(\)/);
  assert.match(source, /const PROVIDER_FILTER_STORE = "model-atlas:provider-filter"/);
  assert.match(source, /if \(key === "provider"\) saveProviderFilter\(state\.filters\[key\]\)/);
  assert.match(source, /checked\.length === options\.length \? null : checked/);
  assert.equal((source.match(/modeSwitchFilters\(state\.filters, readProviderFilter\(\)\)/g) || []).length, 1);
  assert.match(source, /mediaModeSwitchFilters\(state\.filters, state\.mediaMode, readProviderFilter\(\)\)/);
});

test("ships one 常用 button that stores a provider list apart from the last selection", () => {
  const source = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles/dashboard.css", import.meta.url), "utf8");
  assert.match(html, /<button type="button" data-facet-favorite="provider"[^>]*>常用<\/button>/);
  assert.equal((html.match(/data-facet-favorite=/g) || []).length, 1);
  assert.match(source, /const PROVIDER_FAVORITE_STORE = "model-atlas:provider-favorite"/);
  // 清空要把键删掉，不留空数组在存储里
  assert.match(source, /else localStorage\.removeItem\(PROVIDER_FAVORITE_STORE\)/);
  // 套用时按当前数据集取交集，一个都不剩就回全选，别把表筛空
  assert.match(source, /const kept = favorite\.filter\(value => offered\.has\(value\)\)/);
  assert.match(source, /常用里的供应商当前都没有报价，已回到全选/);
  assert.match(css, /\.facet-favorite-popover \{[^}]*position: fixed/);
});

test("mode switches drop filters that only exist in the other dataset", () => {
  const filters = modeSwitchFilters({ search: "claude", stationId: "linuxdo", provider: ["windhub"], group: "gpt", models: ["gpt-4o"], showUnmatched: false, sortBy: "model", sortSecondary: "none", sortDirection: "desc" }, ["openai"]);
  assert.deepEqual(filters, { search: "", stationId: "", provider: ["openai"], group: null, models: [], showUnmatched: false, sortBy: "model", sortSecondary: "none", sortDirection: "desc" });
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
    assert.match(html, /id="collapse-toggle"[^>]*aria-label="折叠全部卡片"/);
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
  assert.match(source, /paginateRows\(filtered, state\.page, pageSize\)/);
  assert.match(source, /\$\("#page-size"\)\.addEventListener\("change"/);
  // 页码本身就是输入框：第 [1] / 59 页，不再单独放「跳至」框。
  assert.match(html, /id="comparison-page-input" type="number"/);
  assert.match(html, /class="page-indicator"[^>]*>.*?<span>第<\/span>.*?id="comparison-page-input"/);
  assert.match(html, /id="comparison-page-total"/);
  assert.doesNotMatch(html, /page-jump-field/);
  assert.match(source, /\$\("#comparison-page-total"\)\.textContent = String\(Math\.max\(1, page\.pageCount\)\)/);
  assert.match(source, /\$\("#comparison-page-input"\)\.addEventListener\("change", commitPageInput\)/);
  assert.match(source, /input\.max = String\(Math\.max\(1, state\.pageCount\)\)/);
  assert.match(source, /\$\("#comparison-page-input"\)\.addEventListener\("blur", commitPageInput\)/);
  assert.match(source, /event\.key === "Enter"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /parsePageInput\(\$\("#comparison-page-input"\)\.value, state\.pageCount\)/);
  assert.match(html, /id="back-to-top"[^>]*aria-label="回到顶部"/);
  assert.match(html, /id="back-to-top"[^>]*>.*?data-icon="arrow-up"/);
  assert.match(icon("arrow-up"), /<path d="M12 19V5"\/>/);
  assert.match(source, /window\.addEventListener\("scroll"/);
  assert.match(source, /backToTop\.addEventListener\("click"/);
});

test("every data-icon used by the pages resolves to its own glyph", () => {
  const fallback = icon("circle-help");
  const missing = [];
  for (const page of ["dashboard.html", "options.html"]) {
    const html = readFileSync(new URL(`../${page}`, import.meta.url), "utf8");
    for (const [, name] of html.matchAll(/data-icon="([^"]+)"/g)) {
      if (name !== "circle-help" && icon(name) === fallback) missing.push(`${page}:${name}`);
    }
  }
  for (const file of ["../src/dashboard.js", "../src/options.js"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const [, name] of source.matchAll(/icon\("([^"]+)"/g)) {
      if (name !== "circle-help" && icon(name) === fallback) missing.push(`${file}:${name}`);
    }
  }
  assert.deepEqual([...new Set(missing)], []);
});

test("pages the model-assist review queue with the shared pager", () => {
  const html = readFileSync(new URL("../options.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/options.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles/options.css", import.meta.url), "utf8");
  assert.match(html, /id="llm-review-list"><\/div>\s*<nav class="assistant-pagination" id="llm-pagination"[^>]*hidden/);
  assert.match(html, /id="llm-page-size"[^>]*><option value="20" selected>20<\/option><option value="50">50<\/option><option value="100">100<\/option>/);
  assert.match(html, /id="llm-previous"[^>]*disabled|id="llm-previous"[^>]*aria-label="上一页"/);
  assert.match(source, /import \{ paginateRows \} from "\.\/dashboard-index\.js"/);
  assert.match(source, /const page = paginateAssistant\(rows\);/);
  assert.match(source, /list\.innerHTML = page\.rows\.map\(row =>/);
  assert.match(source, /state\.assistantFilter = button\.dataset\.filter;\s*\n\s*state\.assistantPage = 0;/);
  assert.match(source, /function flipAssistantPage\(delta\)/);
  assert.match(css, /\.assistant-pagination\[hidden\] \{ display: none; \}/);
});

test("includes partial station counts in refresh summaries", () => {
  assert.equal(formatRefreshSummary({ total: 1, successCount: 0, partialCount: 1, errorCount: 0, totalModels: 3, durationMs: 1000 }), "查询完成：0 成功，1 部分成功，0 失败，共 3 个模型 · 1.0 秒");
  assert.equal(formatRefreshSummary({ total: 0 }), "没有启用的站点可查询");
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
  assert.match(html, /id="model-filter-add"/);
  assert.match(dashboard, /MODEL_FILTER_BOXES = 4/);
  assert.match(dashboard, /data-model-filter-remove/);
  assert.match(html, /id="model-filter-remove-box"/);
  assert.match(dashboard, /MODEL_FILTER_BOX_STORE = "model-atlas:model-filter-boxes"/);
  assert.match(dashboard, /saveModelFilterBoxCount\(\)/);
});


test("keeps quote rows neutral and marks where a model band starts", () => {
  const rows = ["gpt-a", "gpt-a", "gpt-b", "gpt-c", "gpt-c"].map(canonicalModel => ({ canonicalModel }));
  assert.deepEqual(rowBandClasses(rows), [
    "model-band-start",
    "",
    "model-band-start",
    "model-band-start",
    ""
  ]);
  assert.deepEqual(rowBandClasses([]), []);
});
test("removes recharge-rate warnings while retaining option inputs and legacy fields", () => {
  const options = readFileSync(new URL("../src/options.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../options.html", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  assert.doesNotMatch(options, /station-recharge-warning|充值折算未核实/);
  assert.doesNotMatch(dashboard, /recharge_unverified|充值比例待核验/);
  assert.match(html, /id="config-recharge-amount"/);
  assert.match(html, /id="config-recharge-currency"/);
  assert.match(html, /id="config-recharge-credits"/);
  assert.match(html, /id="config-recharge-rate" type="number" readonly/);
  assert.match(options, /rechargeRateVerified: collected\.rechargeRmb > 0 && collected\.rechargeCredits > 0/);
  assert.match(options, /rechargeRateVerified: station\.rechargeRateVerified !== false/);
  assert.match(options, /rechargeRateNote: station\.rechargeRateNote \|\| ""/);
});

test("installing a registry plugin adds its addable stations to the workspace right away", async () => {
  const previousChrome = globalThis.chrome;
  const previousIndexedDb = globalThis.indexedDB;
  const kv = new Map();
  const stationRows = [];
  // 内置采集代码的插件按扩展版本号算已装版本，这里让桩返回真实 manifest 版本。
  const bundledVersion = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8")).version;
  const kvStore = {
    get(key) {
      const request = {};
      queueMicrotask(() => { request.result = kv.get(key); request.onsuccess?.(); });
      return request;
    },
    put(value, key) {
      const request = {};
      queueMicrotask(() => { kv.set(key ?? value?.id ?? "settings", structuredClone(value)); request.onsuccess?.(); });
      return request;
    }
  };
  const stationStore = {
    getAll() {
      const request = {};
      queueMicrotask(() => { request.result = stationRows.map(row => structuredClone(row)); request.onsuccess?.(); });
      return request;
    },
    put(value) {
      const request = {};
      queueMicrotask(() => {
        const index = stationRows.findIndex(row => row.id === value.id);
        if (index < 0) stationRows.push(structuredClone(value));
        else stationRows[index] = structuredClone(value);
        request.onsuccess?.();
      });
      return request;
    },
    delete(key) {
      const request = {};
      queueMicrotask(() => {
        const index = stationRows.findIndex(row => row.id === key);
        if (index >= 0) stationRows.splice(index, 1);
        request.onsuccess?.();
      });
      return request;
    }
  };
  const database = {
    close() {},
    objectStoreNames: { contains: () => true },
    transaction(name) {
      const transaction = {
        objectStore: () => (name === "kv" ? kvStore : stationStore)
      };
      queueMicrotask(() => transaction.oncomplete?.());
      return transaction;
    }
  };
  globalThis.indexedDB = {
    open() {
      const request = { result: database };
      queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
      return request;
    }
  };
  globalThis.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage() {},
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      getURL: () => "chrome-extension://test-extension/",
      getManifest: () => ({ version: bundledVersion })
    },
    alarms: { onAlarm: { addListener() {} } },
    tabs: { onUpdated: { addListener() {}, removeListener() {} }, onRemoved: { addListener() {}, removeListener() {} } }
  };
  try {
    const { installPlugins } = await import(`../src/service-worker.js?install-auto-add=${Date.now()}`);
    const first = await installPlugins(["true-sota"]);
    assert.deepEqual(first.installed, ["true-sota"]);
    assert.equal(first.stationsAdded, 1);
    assert.equal(first.results[0].stations, 1);
    assert.equal(stationRows.length, 1);
    assert.equal(stationRows[0].pluginId, "true-sota");

    assert.equal(first.workspace.registry.entries.find(item => item.id === "true-sota")?.installedVersion, bundledVersion);

    const second = await installPlugins(["true-sota"]);
    assert.deepEqual(second.skipped, ["true-sota"]);
    assert.equal(second.stationsAdded, 0);
    assert.equal(stationRows.length, 1);
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
    if (previousIndexedDb === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previousIndexedDb;
  }
});

test("bulk uninstall removes registry records, local plugins, and their stations in one pass", async () => {
  const previousChrome = globalThis.chrome;
  const previousIndexedDb = globalThis.indexedDB;
  const kv = new Map();
  const stationRows = [];
  const kvStore = {
    get(key) {
      const request = {};
      queueMicrotask(() => { request.result = kv.get(key); request.onsuccess?.(); });
      return request;
    },
    put(value, key) {
      const request = {};
      queueMicrotask(() => { kv.set(key ?? value?.id ?? "settings", structuredClone(value)); request.onsuccess?.(); });
      return request;
    }
  };
  const stationStore = {
    getAll() {
      const request = {};
      queueMicrotask(() => { request.result = stationRows.map(row => structuredClone(row)); request.onsuccess?.(); });
      return request;
    },
    put(value) {
      const request = {};
      queueMicrotask(() => {
        const index = stationRows.findIndex(row => row.id === value.id);
        if (index < 0) stationRows.push(structuredClone(value));
        else stationRows[index] = structuredClone(value);
        request.onsuccess?.();
      });
      return request;
    },
    delete(key) {
      const request = {};
      queueMicrotask(() => {
        const index = stationRows.findIndex(row => row.id === key);
        if (index >= 0) stationRows.splice(index, 1);
        request.onsuccess?.();
      });
      return request;
    }
  };
  const database = {
    close() {},
    objectStoreNames: { contains: () => true },
    transaction(name) {
      const transaction = { objectStore: () => (name === "kv" ? kvStore : stationStore) };
      queueMicrotask(() => transaction.oncomplete?.());
      return transaction;
    }
  };
  globalThis.indexedDB = {
    open() {
      const request = { result: database };
      queueMicrotask(() => { request.onupgradeneeded?.(); request.onsuccess?.(); });
      return request;
    }
  };
  globalThis.chrome = {
    runtime: {
      lastError: undefined,
      sendMessage() {},
      onMessage: { addListener() {} },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      getURL: () => "chrome-extension://test-extension/",
      getManifest: () => ({ version: "0.0.0-test" })
    },
    alarms: { onAlarm: { addListener() {} } },
    tabs: { onUpdated: { addListener() {}, removeListener() {} }, onRemoved: { addListener() {}, removeListener() {} } }
  };
  try {
    const { installPlugins, uninstallPlugin, uninstallPlugins } = await import(`../src/service-worker.js?uninstall-bulk=${Date.now()}`);
    const installed = await installPlugins(["true-sota"]);
    assert.deepEqual(installed.installed, ["true-sota"]);
    assert.equal(stationRows.length, 1);

    const removed = await uninstallPlugins(["true-sota"]);
    assert.deepEqual(removed.removed, ["true-sota"]);
    assert.equal(stationRows.length, 0);
    assert.equal(removed.registry.entries.find(item => item.id === "true-sota")?.installed, false);
    assert.equal(kv.get("settings").pluginRegistry.installed["true-sota"], undefined);

    // 单条移除要把工作区原样交回界面：少了它，页面拿不到新状态就不重绘，看起来像没删掉。
    await installPlugins(["true-sota"]);
    const single = await uninstallPlugin("true-sota");
    assert.ok(single && typeof single === "object", "uninstallPlugin 必须返回工作区状态");
    assert.ok(Array.isArray(single.catalog), "工作区要带 catalog，界面靠它重绘已安装列表");
    assert.equal(single.registry.entries.find(item => item.id === "true-sota")?.installed, false);
    assert.deepEqual(single.removed, ["true-sota"]);
    assert.equal(kv.get("settings").pluginRegistry.installed["true-sota"], undefined);
    assert.equal(stationRows.length, 0);

    await assert.rejects(uninstallPlugins([]), /没有选中要移除的插件/);
  } finally {
    if (previousChrome === undefined) delete globalThis.chrome;
    else globalThis.chrome = previousChrome;
    if (previousIndexedDb === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = previousIndexedDb;
  }
});

test("plugin lists support select-all and shift range selection wired to bulk actions", () => {
  const options = readFileSync(new URL("../src/options.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../options.html", import.meta.url), "utf8");
const worker = readFileSync(new URL("../src/service-worker.js", import.meta.url), "utf8");
  assert.match(options, /function applyRangeSelection\(order, anchorId, currentId, checked, selection, isSelectable\)/);
  assert.match(options, /state\.installedSelectable = new Set\(plugins\.filter\(plugin => plugin\.removable !== false\)/);
  assert.match(options, /state\.registryOrder = visible\.map\(entry => String\(entry\.id\)\)/);
  assert.match(options, /applyRangeSelection\(state\.registryOrder, state\.registryAnchorId, id, check\.checked, state\.registrySelected, isSelectable\)/);
  assert.match(options, /applyRangeSelection\(state\.installedOrder, state\.installedAnchorId, id, check\.checked, state\.installedSelected, isSelectable\)/);
  // checkbox 点完的 change 是纯 Event，没有 shiftKey。挂 change 等于区间选择永远不生效，
  // 这条只在真人带 shift 点时暴露，所以用结构断言把接线钉住。
  const shiftHandlers = options
    .split("addEventListener(")
    .slice(1)
    .filter(chunk => chunk.slice(0, 400).includes("event.shiftKey"));
  assert.equal(shiftHandlers.length, 2, "shiftKey 应该只出现在两个批量列表的处理里");
  for (const chunk of shiftHandlers) assert.match(chunk, /^"click"/, "shiftKey 只能在 click 处理里读");
  assert.match(options, /callService\("UNINSTALL_PLUGINS", \{ ids \}\)/);
  // 移除不再弹确认框：点垃圾桶就删，批次同样直接提交。
  assert.doesNotMatch(options, /window\.confirm\(`移除/);
  assert.match(worker, /case "UNINSTALL_PLUGINS": return uninstallPlugins\(message\.ids\)/);
  assert.match(html, /id="installed-select-all" type="checkbox"/);
  assert.match(html, /id="uninstall-selected-plugins"[^>]*disabled/);
  assert.match(html, /id="registry-select-all" type="checkbox"/);
  assert.match(html, /id="plugin-installed-search" type="search"/);
  assert.match(options, /function matchedInstalledPlugins\(plugins, orphans\)/);
  assert.match(options, /\$\("#plugin-installed-search"\)\.addEventListener\("input", renderPluginInstalled\)/);
});

test("saves settings automatically instead of behind a global save button", () => {
  const html = readFileSync(new URL("../options.html", import.meta.url), "utf8");
  const options = readFileSync(new URL("../src/options.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles/options.css", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");

  assert.equal(html.includes("save-all"), false, "the global save button is gone");
  assert.equal(html.includes("save-status"), false, "the autosave status pill is gone too");

  assert.match(options, /const AUTO_SAVE_DELAY = 400;/);
  assert.match(options, /function scheduleSettingsSave\(\)/);
  assert.match(options, /function flushSettingsSave\(\)/);
  assert.match(options, /function scheduleStationsSave\(\)/);
  assert.match(options, /function flushStationsSave\(\)/);
  for (const selector of ["#settings-form", "#llm-form"]) {
    assert.ok(options.includes(`"${selector}"`), `${selector} is wired to autosave`);
  }
  assert.match(options, /form\.addEventListener\("submit", event => \{[\s\S]{0,80}event\.preventDefault\(\);[\s\S]{0,80}flushSettingsSave\(\);/);
  assert.match(options, /window\.addEventListener\("pagehide", \(\) => void flushAutoSave\(\)\)/);
  assert.match(options, /document\.addEventListener\("visibilitychange"/);
  assert.match(options, /station\.enabled = event\.target\.checked;\n\s*scheduleStationsSave\(\);/);
  assert.match(options, /state\.stations = state\.stations\.filter\(station => station\.id !== stationId\);\n\s*renderStations\(\);\n\s*scheduleStationsSave\(\);/);
  // 加站后必须走 scheduleStationsSave：直接 flush 时 stationsDirty 还是 false，等于什么都没写。
  assert.match(options, /scheduleStationsSave\(\);\n\s*toast\("站点已添加/);
  assert.equal(css.includes(".autosave-status"), false, "the autosave pill styles are gone");

  // 抽屉不再每存一次就重拉仪表盘，改在关闭抽屉时刷新。
  assert.match(dashboard, /let settingsStale = false;/);
  assert.match(dashboard, /settingsDirty = true;\n\s*settingsStale = true;/);
  assert.match(dashboard, /if \(settingsStale\) \{[\s\S]{0,80}load\(\);/);
});
