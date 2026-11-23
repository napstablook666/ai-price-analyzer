import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { PROVIDER_REGISTRY, providerById } from "../src/core/provider-registry.js";
import { addProviderStationPresets } from "../src/core/station-presets.js";
import { SITE_PLUGIN_CATALOG, sitePluginCatalogForStations, sitePluginForStation } from "../src/site-plugins/catalog.js";
import { loadSitePlugin, loadSitePlugins, loadedSitePluginIds, pruneSitePlugins, resetSitePluginLoader, syncSitePlugins } from "../src/site-plugins/loader.js";
import { collectStation } from "../src/core/collectors.js";

import { resolveStationCollection } from "../src/core/request-strategy.js";
import { buildComparisonRows } from "../src/core/pricing.js";

async function withCleanRegistry(callback) {
  resetSitePluginLoader();
  try { await callback(); }
  finally { resetSitePluginLoader(); }
}

test("plugin catalog exposes metadata without registering providers", async () => {
  await withCleanRegistry(async () => {
    assert.ok(SITE_PLUGIN_CATALOG.length >= 20);
    assert.equal(PROVIDER_REGISTRY.length, 0);
    const serialized = JSON.stringify(sitePluginCatalogForStations([]));
    assert.doesNotMatch(serialized, /"load"|"preset"|"prepare"|"request"/);
    const catalogSource = readFileSync(new URL("../src/site-plugins/catalog.js", import.meta.url), "utf8");
    const imports = [...catalogSource.matchAll(/import \{ sitePlugin as \w+ \} from "(\.\/providers\/[^"]+\.js)"/g)];
    assert.equal(imports.length, SITE_PLUGIN_CATALOG.length);
    for (const match of imports) {
      assert.ok(existsSync(new URL(`../src/site-plugins/${match[1].slice(2)}`, import.meta.url)), match[1]);
    }
  });
});

test("contains no dynamic imports in the extension service-worker source tree", () => {
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) visit(target);
      else if (entry.name.endsWith(".js")) {
        const source = readFileSync(target, "utf8");
        assert.doesNotMatch(source, /\bimport\s*\(/, `dynamic import found in ${target.pathname}`);
      }
    }
  };
  visit(new URL("../src/", import.meta.url));
});

test("loads only selected local plugins and deduplicates module requests", async () => {
  await withCleanRegistry(async () => {
    const [centos, repeated] = await Promise.all([loadSitePlugin("centos"), loadSitePlugin("centos")]);
    assert.equal(centos, repeated);
    assert.deepEqual(loadedSitePluginIds(), ["centos"]);
    await assert.rejects(loadSitePlugin("not-a-plugin"), /未知站点插件/);
    assert.deepEqual(loadedSitePluginIds(), ["centos"]);
  });
});

test("restores saved stations by plugin id or unique host and re-registers pruned modules", async () => {
  await withCleanRegistry(async () => {
    const stations = [
      { id: "a", pluginId: "centos", baseUrl: "https://ai.centos.hk/pricing" },
      { id: "b", baseUrl: "https://all-in-one.icu" },
      { id: "c", pluginId: "centos", baseUrl: "https://ai.centos.hk/pricing" }
    ];
    assert.equal(sitePluginForStation(stations[1])?.id, "all-in-one");
    const providers = await syncSitePlugins(stations);
    assert.deepEqual(providers.map(provider => provider.id).sort(), ["all-in-one", "centos"]);
    pruneSitePlugins([stations[0]]);
    assert.deepEqual(loadedSitePluginIds(), ["centos"]);
    await loadSitePlugins(["all-in-one", "centos"]);
    assert.deepEqual(loadedSitePluginIds().sort(), ["all-in-one", "centos"]);
  });
});

test("adds multiple selected presets once and derives added state from stations", async () => {
  await withCleanRegistry(async () => {
    const providers = await loadSitePlugins(["centos", "windhub"]);
    const stations = addProviderStationPresets([], providers, { exchangeRate: 7.2 });
    assert.equal(stations.length, 2);
    assert.deepEqual(stations.map(station => station.pluginId).sort(), ["centos", "windhub"]);
    assert.equal(stations.find(station => station.pluginId === "windhub").category, "public");
    assert.equal(addProviderStationPresets(stations, providers), stations);
    const added = sitePluginCatalogForStations(stations).filter(plugin => plugin.added).map(plugin => plugin.id);
    assert.deepEqual(added.sort(), ["centos", "windhub"]);
    assert.equal(providerById("centos").id, "centos");
  });
});

test("橘子API 安装预设后匿名采价，充值档位与待支付金额已核验", async () => {
  await withCleanRegistry(async () => {
    const providers = await loadSitePlugins(["juziai"]);
    const [preset] = addProviderStationPresets([], providers);
    const collection = resolveStationCollection({ ...preset, baseUrl: "https://api.juziai.cc/pricing" });
    const station = collection.station;

    assert.equal(sitePluginForStation(station).id, "juziai");
    assert.equal(station.mode, "direct");
    assert.equal(station.auth.type, "none");
    assert.equal(station.priceCurrency, "CREDITS");
    assert.equal(station.priceCurrencyVerified, true);
    assert.equal(station.rechargeAuto, false);
    assert.equal(station.rechargeRateVerified, false);
    assert.equal(station.rechargePlansVerified, true);
    assert.equal(station.rechargePaymentsVerified, true);
    assert.deepEqual(station.rechargeTiers.map(tier => [tier.amount, tier.discount]), [
      [1, 0.75], [5, 0.73], [10, 0.72], [30, 0.7], [50, 0.69], [100, 0.68],
      [200, 0.67], [300, 0.66], [500, 0.65], [1000, 0.62], [2000, 0.6]
    ]);
    assert.match(station.rechargePlans[0].note, /订单 108c9947/);
    assert.equal(station.rechargePayments[0].faceAmount, 1);
    assert.equal(station.rechargePayments[0].payAmount, 0.75);
    assert.equal(station.rechargePayments[0].status, "pending");
    assert.equal(station.rechargePayments[0].paidRmb, null);
    assert.match(station.rechargePayments[0].note, /订单 108c9947/);

    const fixture = JSON.parse(readFileSync(new URL("./fixtures/juziai-pricing.json", import.meta.url), "utf8"));
    const requests = [];
    const snapshot = await collectStation(station, {
      collection,
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return new Response(JSON.stringify(fixture), { headers: { "content-type": "application/json" } });
      }
    });

    assert.equal(requests.length, 1);
    assert.equal(new URL(requests[0].url).pathname, "/api/pricing");
    assert.equal(requests[0].init.method, "GET");
    assert.equal(requests[0].init.credentials, "omit");
    assert.equal(requests[0].init.headers.Authorization, undefined);
    assert.equal(snapshot.status, "success");
    assert.equal(snapshot.source, "tokenflux");
    assert.equal(snapshot.rechargeRateVerified, false);
    assert.equal(snapshot.normalized.sourceFormat, "tokenflux");
    assert.equal(snapshot.normalized.data.length, 9);
    assert.equal(Object.keys(snapshot.normalized.group_ratio).length, 14);

    const token = snapshot.normalized.data.find(row => row.model_name === "[量]gpt-5.5" && row.proxy_group_name === "default");
    assert.deepEqual([token.input_price, token.output_price, token.cache_read_price], [5, 30, 0.5]);
    const request = snapshot.normalized.data.find(row => row.model_name === "[次1]glm-5.3" && row.proxy_group_name === "default");
    assert.equal(request.request_price, 0.03);
  });
});

test("velamost 匿名采集 price-map 全目录，美元报价与页面起价一致，分组倍率只折算一次", async () => {
  await withCleanRegistry(async () => {
    const providers = await loadSitePlugins(["velamost", "ooioo"]);
    const velamost = providers.find(provider => provider.id === "velamost");
    const ooioo = providers.find(provider => provider.id === "ooioo");
    const [velamostPreset] = addProviderStationPresets([], [velamost]);
    const collection = resolveStationCollection({ ...velamostPreset, baseUrl: "https://velamost.com/pricing" });
    const station = collection.station;

    assert.equal(sitePluginForStation(station).id, "velamost");
    assert.equal(station.mode, "direct");
    assert.equal(station.auth.type, "none");
    assert.equal(station.priceCurrency, "USD");
    assert.equal(station.priceCurrencyVerified, true);
    assert.equal(station.rechargeAuto, false);
    assert.equal(station.rechargeRateVerified, false);

    const fixture = JSON.parse(readFileSync(new URL("./fixtures/velamost-pricing.json", import.meta.url), "utf8"));
    const requests = [];
    const snapshot = await collectStation(station, {
      collection,
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return new Response(JSON.stringify(fixture), { headers: { "content-type": "application/json" } });
      }
    });

    assert.equal(requests.length, 1, "匿名报价采集不应请求需登录的充值接口");
    assert.equal(new URL(requests[0].url).pathname, "/api/pricing");
    assert.equal(requests[0].init.method, "GET");
    assert.equal(requests[0].init.credentials, "omit");
    assert.equal(requests[0].init.headers.Authorization, undefined);
    assert.equal(snapshot.status, "success");
    assert.equal(snapshot.source, "tokenflux");
    assert.equal(snapshot.normalized.sourceFormat, "tokenflux");
    assert.equal(snapshot.normalized.data.length, 126);
    assert.equal(Object.keys(snapshot.normalized.group_ratio).length, 7);

    // 走 model_ratio 的模型：归一价 = model_ratio × 2 × 分组倍率，与页面「起」价逐字一致。
    const lite = snapshot.normalized.data.find(row => row.model_name === "claude-sonnet-5" && row.proxy_group_name === "Claude- lite");
    assert.deepEqual([lite.input_price, lite.output_price, lite.cache_read_price], [2.7, 13.5, 0.27]);
    const officialLite = snapshot.normalized.data.find(row => row.model_name === "gpt-5.4-mini-2026-03-17");
    assert.deepEqual([officialLite.input_price, officialLite.output_price], [225, 1350]);

    // billing_expr 的模型：表达式系数折算后落到 USD/百万。
    const carbon = snapshot.normalized.data.find(row => row.model_name === "gemini-4-carbon");
    assert.deepEqual([carbon.input_price, carbon.output_price, carbon.cache_read_price, carbon.cache_write_price], [1.8, 9, 0.09, 2.25]);
    assert.equal(snapshot.normalized.data.every(row => row.price_currency === "USD"), true);

    // 同模型归行：velamost 与 ooioo 的 claude-fable-5 落在同一比价行。
    const [ooiooPreset] = addProviderStationPresets([], [ooioo]);
    const ooiooCollection = resolveStationCollection({ ...ooiooPreset, baseUrl: "https://ooioo.work/pricing" });
    const ooiooStation = ooiooCollection.station;
    const ooiooFixture = JSON.parse(readFileSync(new URL("./fixtures/ooioo-pricing.json", import.meta.url), "utf8"));
    const ooiooSnapshot = await collectStation(ooiooStation, {
      collection: ooiooCollection,
      fetchImpl: async () => new Response(JSON.stringify(ooiooFixture), { headers: { "content-type": "application/json" } })
    });
    const comparisons = buildComparisonRows({
      stations: [station, ooiooStation],
      snapshots: [snapshot, ooiooSnapshot],
      references: { models: [] },
      showUnmatched: true,
      usage: { input: 1_000_000, output: 0 }
    });
    const fable = comparisons.find(row => row.canonicalModel === "claude-fable-5");
    assert.ok(fable, "claude-fable-5 应出现在比价行");
    assert.deepEqual([...new Set(fable.offers.map(offer => offer.stationId))].sort(), ["ooioo", "velamost"]);
  });
});

test("ooioo 匿名采集 price-map 全目录，USD 报价与 1:1 充值比例按公开文档记录", async () => {
  await withCleanRegistry(async () => {
    const providers = await loadSitePlugins(["ooioo"]);
    const [preset] = addProviderStationPresets([], providers);
    const collection = resolveStationCollection({ ...preset, baseUrl: "https://ooioo.work/pricing" });
    const station = collection.station;

    assert.equal(sitePluginForStation(station).id, "ooioo");
    assert.equal(station.mode, "direct");
    assert.equal(station.auth.type, "none");
    assert.equal(station.priceCurrency, "USD");
    assert.equal(station.priceCurrencyVerified, true);
    assert.equal(station.rechargeAuto, false);
    assert.equal(station.rechargeRmb, 1);
    assert.equal(station.rechargeCredits, 1);
    assert.equal(station.rechargeRateVerified, true);
    assert.equal(station.rechargePlansVerified, false);
    assert.deepEqual(station.rechargePlans, []);
    assert.match(station.rechargeRateNote, /充值金额与余额 1:1/);
    assert.match(station.rechargeRateNote, /未登录核验/);

    const fixture = JSON.parse(readFileSync(new URL("./fixtures/ooioo-pricing.json", import.meta.url), "utf8"));
    const requests = [];
    const snapshot = await collectStation(station, {
      collection,
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return new Response(JSON.stringify(fixture), { headers: { "content-type": "application/json" } });
      }
    });

    assert.equal(requests.length, 1);
    assert.equal(new URL(requests[0].url).pathname, "/api/pricing");
    assert.equal(requests[0].init.method, "GET");
    assert.equal(requests[0].init.credentials, "omit");
    assert.equal(requests[0].init.headers.Authorization, undefined);
    assert.equal(snapshot.status, "success");
    assert.equal(snapshot.source, "tokenflux");
    assert.equal(snapshot.normalized.sourceFormat, "tokenflux");
    assert.equal(snapshot.normalized.data.length, 104);
    assert.equal(Object.keys(snapshot.normalized.group_ratio).length, 7);
    assert.equal(snapshot.normalized.incomplete, undefined);
    assert.equal(snapshot.normalized.unpricedModels, undefined);

    // 走 model_ratio 的模型：归一出的价格与渲染后的模型广场页面逐字一致。
    const glm = snapshot.normalized.data.find(row => row.model_name === "glm-5.3-flash");
    assert.deepEqual([glm.input_price, glm.output_price, glm.cache_read_price], [0.24, 0.84, 0.069]);

    // 带 billing_expr 的模型：表达式系数折算后落到 USD/百万。
    const astra = snapshot.normalized.data.find(row => row.model_name === "gpt-6-astra" && row.proxy_group_name === "codex-plus");
    assert.deepEqual(
      [astra.input_price, astra.output_price, astra.cache_read_price, astra.cache_write_price],
      [0.8, 4, 0.08, 1]
    );

    // 全站 quota_type=0、model_price=0：没有按次或按张报价，且每一行都是 USD。
    assert.equal(snapshot.normalized.data.some(row => row.request_price !== null), false);
    assert.equal(snapshot.normalized.data.every(row => row.price_currency === "USD"), true);
  });
});

test("91Token 匿名采集保留计费条件与9个复杂计费缺口，充值报价已验证但渠道实付未验证", async () => {
  await withCleanRegistry(async () => {
    const providers = await loadSitePlugins(["91token"]);
    const [preset] = addProviderStationPresets([], providers, { exchangeRate: 7.2 });
    const collection = resolveStationCollection({ ...preset, baseUrl: "https://www.91token.com/console/topup" });
    const station = collection.station;
    assert.equal(sitePluginForStation(station).id, "91token");
    assert.equal(station.mode, "direct");
    assert.equal(station.auth.type, "none");
    assert.equal(station.rechargeRateVerified, true);
    assert.equal(station.rechargeAuto, false);
    assert.equal(station.priceCurrency, "CREDITS");
    assert.deepEqual(station.rechargeTiers, []);
    assert.equal(station.rechargeRate, 1);
    assert.equal(station.rechargePlansVerified, true);
    assert.deepEqual(station.rechargePlans.map(plan => [plan.amount, plan.credits, plan.discount]), [10, 20, 50, 100, 200, 500].map(amount => [amount, amount, undefined]));
    assert.ok(station.rechargePlans.every(plan => plan.kind === "topup" && plan.verified && plan.availability === "self_service"));
    assert.deepEqual(station.rechargePayments, []);
    assert.equal(station.rechargePaymentsVerified, false);
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/91token-pricing.json", import.meta.url), "utf8"));
    const requests = [];
    const snapshot = await collectStation(station, {
      collection,
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return new Response(JSON.stringify(fixture), { headers: { "content-type": "application/json" } });
      }
    });
    assert.equal(requests.length, 1, "匿名报价采集不应额外请求需登录的充值接口");
    assert.equal(new URL(requests[0].url).pathname, "/api/pricing");
    assert.equal(requests[0].init.credentials, "omit");
    assert.equal(requests[0].init.headers.Authorization, undefined);
    assert.equal(snapshot.recharge, undefined);
    assert.equal(snapshot.rechargeRateVerified, true);
    assert.equal(snapshot.status, "partial");
    assert.equal(snapshot.normalized.data.length, 129);
    assert.equal(new Set(snapshot.normalized.data.map(row => row.model_name)).size, 54);
    assert.equal(snapshot.normalized.unpricedModels.length, 9);
    assert.ok(snapshot.normalized.unpricedModels.includes("viduq4-preview"));
    assert.deepEqual(snapshot.normalized.unsupportedBillingModes.slice().sort(), [
      "视频按 token 用量、分辨率和参考视频联合计费，暂不支持",
      "视频按实际 credits 或分辨率与时长估算计费，暂不支持",
      "视频按输入与输出秒数及分辨率联合计费，暂不支持"
    ].sort());
    assert.deepEqual(snapshot.normalized.unpricedModels.slice().sort(), [
      "doubao-seedance-2-5", "viduq3-ad", "viduq3-pro", "viduq3-turbo", "doubao-seedance-2-0",
      "doubao-seedance-2-0-fast", "viduq4-preview", "MiniMax-H3", "doubao-seedance-2-0-mini"
    ].sort());
    assert.equal(snapshot.normalized.data.filter(row => row.media_type === "video").length, 6);
    assert.ok(snapshot.normalized.data.every(row => !snapshot.normalized.unpricedModels.includes(row.model_name)),
      "unsupported video model names must not also have ordinary token-price rows");
    const fable = snapshot.normalized.data.find(row => row.model_name === "claude-fable-5" && row.proxy_group_name === "Claude MAX");
    assert.equal(fable.input_price, 13);
    assert.equal(fable.output_price, 65);
    assert.equal(fable.cache_read_price, 1.3);
    const opus = snapshot.normalized.data.find(row => row.model_name === "claude-opus-5" && row.proxy_group_name === "Claude 特惠");
    assert.equal(opus.input_price, 1.5);
    assert.equal(opus.output_price, 7.5);
    const peak = snapshot.normalized.data.find(row => row.model_name === "deepseek-v4-pro" && row.tier_name === "peak" && row.proxy_group_name === "国产模型 官转渠道");
    assert.equal(peak.input_price, 4.5);
    assert.match(peak.billing_conditions[0].expression, /Asia\/Shanghai/);
    const serviceTier = snapshot.normalized.data.find(row => row.model_name === "gpt-6-sol");
    assert.ok(serviceTier.billing_conditions.every(condition => condition.type === "context"));
    const image = snapshot.normalized.data.find(row => row.model_name === "gpt-image-2");
    assert.equal(image.media_type, "image");
    assert.ok(image.image_price > 0);
    const comparisons = buildComparisonRows({ stations: [station], snapshots: [snapshot], references: { models: [] }, usage: { input: 1_000_000, output: 1_000_000 } });
    const offers = comparisons.flatMap(row => row.offers);
    const offer = offers.find(row => row.modelName === "claude-fable-5" && row.groupName === "Claude MAX");
    assert.equal(offer.quotedPrices.input, 13, "比价链不能重复乘分组倍率");
    assert.equal(offer.quotedPrices.output, 65);
    assert.ok(offers.some(row => row.modelName === "gpt-image-2" && row.billingMode === "image"));
    assert.ok(offers.every(row => !snapshot.normalized.unpricedModels.includes(row.modelName)));
  });
});

test("91Token 补验只迁移首版默认充值配置，保留自定义比例、方案和渠道证据", async () => {
  await withCleanRegistry(async () => {
    await loadSitePlugin("91token");
    const legacyNote = "公开 status 的 price=1、usd_exchange_rate=1，定价页充值视角与标准视角同价，暂按 1 元对应 1 美元额度记录。充值方案、赠送档位及渠道实付需要登录核实，当前比例未验证，不参与已验证推荐。";
    const legacy = {
      pluginId: "91token", baseUrl: "https://91token.com/pricing",
      rechargeRmb: 1, rechargeCredits: 1, rechargeRate: 1, rechargeCurrency: "CNY",
      rechargeRateVerified: false, rechargeRateNote: legacyNote,
      rechargeTiers: [], rechargePlans: [], rechargePayments: [],
      rechargePlansVerified: false, rechargePaymentsVerified: false,
      priceCurrencyNote: "首版：充值比例未验证"
    };
    const migrated = resolveStationCollection(legacy).station;
    assert.equal(migrated.rechargeRateVerified, true);
    assert.equal(migrated.rechargePlans.length, 6);
    assert.equal(migrated.rechargePlansVerified, true);
    assert.equal(migrated.rechargePaymentsVerified, false);
    assert.match(migrated.rechargeRateNote, /登录核验/);
    assert.match(migrated.priceCurrencyNote, /已核实 1 元换 1 额度/);
    const fresh = resolveStationCollection({ baseUrl: "https://91token.com/wallet" }).station;
    assert.equal(fresh.baseUrl, "https://91token.com/pricing");
    assert.equal(fresh.rechargeRateVerified, true);
    assert.equal(fresh.rechargeRate, 1);
    assert.equal(fresh.rechargePlans.length, 6);
    const customInputs = [
      { ...legacy, rechargeRmb: 80, rechargeCredits: 100, rechargeRate: 0.8 },
      { ...legacy, rechargeRateNote: "用户手工选择未验证", rechargePlans: [] },
      { ...legacy, rechargeRateNote: "用户实测", rechargeRateVerified: true,
        rechargePlans: [{ kind: "manual", amount: 80, credits: 100, currency: "CNY", availability: "manual", verified: true, recurring: false, accumulates: false }],
        rechargePlansVerified: false },
      { ...legacy, rechargeTiers: [{ amount: 100, discount: 0.9 }],
        rechargePayments: [{ channel: "alipay", faceAmount: 100, payAmount: 80, currency: "CNY", paidRmb: 80 }],
        rechargePaymentsVerified: true }
    ];
    for (const input of customInputs) {
      const actual = resolveStationCollection(input).station;
      assert.equal(actual.rechargeRateVerified, input.rechargeRateVerified);
      assert.equal(actual.rechargeRateNote, input.rechargeRateNote);
      assert.equal(actual.priceCurrencyNote, input.priceCurrencyNote);
      assert.deepEqual(actual.rechargePlans, input.rechargePlans);
      assert.deepEqual(actual.rechargeTiers, input.rechargeTiers);
      assert.deepEqual(actual.rechargePayments, input.rechargePayments);
      assert.equal(actual.rechargePlansVerified, input.rechargePlansVerified);
      assert.equal(actual.rechargePaymentsVerified, input.rechargePaymentsVerified);
    }
    const rateOnly = resolveStationCollection({ baseUrl: legacy.baseUrl, rechargeRate: 0.8 }).station;
    assert.equal(rateOnly.rechargeRate, 0.8, "补缺省金额不能覆盖旧版仅保存的 rechargeRate");
    assert.equal(rateOnly.rechargeRateVerified, false);
  });
});

test("SpiderAI 安装预设后匿名采集完整目录，倍率、媒体单价与充值只换算一次", async () => {
  await withCleanRegistry(async () => {
    const providers = await loadSitePlugins(["spiderai"]);
    const stations = addProviderStationPresets([], providers);
    assert.equal(addProviderStationPresets(stations, providers), stations);
    const collection = resolveStationCollection(stations[0]);
    const station = collection.station;
    assert.equal(sitePluginForStation(station).id, "spiderai");
    assert.equal(station.mode, "direct");
    assert.equal(station.auth.type, "none");
    assert.equal(station.priceCurrency, "CREDITS");
    assert.equal(station.rechargeAuto, false);
    assert.equal(station.rechargeRateVerified, true);
    assert.ok(Math.abs(station.rechargeRate - 6.359721088071961) < 1e-10);
    assert.equal(station.rechargePlansVerified, true);
    assert.deepEqual(station.rechargePlans.map(plan => [plan.amount, plan.credits]), [
      [50, 7.86], [100, 15.73], [500, 78.62], [1000, 157.24],
      [1500, 235.86], [2000, 314.48], [3000, 471.72], [5000, 786.20]
    ]);
    assert.deepEqual(station.rechargeTiers, []);
    assert.deepEqual(station.rechargePayments, []);
    assert.equal(station.rechargePaymentsVerified, false);
    const html = readFileSync(new URL("./fixtures/spiderai-pricing-page.html", import.meta.url), "utf8");
    const requests = [];
    const snapshot = await collectStation(station, {
      collection,
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
      },
      pageFetch: async () => assert.fail("公开采价不得访问浏览器登录态")
    });
    assert.equal(requests.length, 1, "不应请求登录充值接口或额外模型目录");
    assert.equal(requests[0].url, "https://spiderai.fun/");
    assert.equal(requests[0].init.credentials, "omit");
    assert.equal(requests[0].init.method, "GET");
    assert.equal(requests[0].init.headers.Authorization, undefined);
    assert.equal(snapshot.status, "success");
    assert.equal(snapshot.source, "spiderai-public-page");
    assert.equal(snapshot.recharge, undefined);
    const rows = snapshot.normalized.data;
    assert.equal(rows.length, 241);
    assert.equal(new Set(rows.map(row => row.model_name)).size, 77);
    assert.equal(Object.keys(snapshot.normalized.group_ratio).length, 20);
    assert.ok(rows.every(row => row.price_currency === "CREDITS"));
    const find = (model, group, tier) => rows.find(row => row.model_name === model && row.proxy_group_name === group && (!tier || row.tier_name === tier));
    const opus = find("claude-opus-5-5", "Claude 经济版");
    assert.deepEqual([opus.input_price, opus.output_price, opus.cache_write_price, opus.cache_read_price], [0.8, 4, 1, 0.04]);
    const sol = rows.filter(row => row.model_name === "gpt-6.2-sol" && row.proxy_group_name === "GPT 经济版");
    assert.deepEqual(sol.map(row => [row.input_price, row.output_price, row.min_tokens, row.max_tokens ?? null]), [[0.2, 1, 0, 272000], [0.4, 1.5, 272001, null]]);
    const haiku = rows.filter(row => row.model_name === "claude-haiku-5-5" && row.proxy_group_name === "Claude 通用版");
    assert.deepEqual(haiku.map(row => [row.min_tokens, row.max_tokens ?? null]), [[0, 100000], [100001, null]]);
    // 档名就是对比表里显示的那一列，用页面上的说法。
    const peak = find("deepseek-v4-pro", "DeepSeek 官方 API", "高峰时段");
    const offPeak = find("deepseek-v4-pro", "DeepSeek 官方 API", "空闲时段");
    assert.equal(peak.input_price, 1.251);
    assert.equal(offPeak.input_price, 0.6255);
    assert.ok(peak.billing_conditions.every(condition => condition.type === "time"));
    assert.match(peak.billing_conditions[0].expression, /Asia\/Shanghai/);
    assert.equal(offPeak.billing_conditions[0].expression, `!(${peak.billing_conditions[0].expression})`);
    assert.equal(find("deepseek-v4-pro", "DeepSeek 云厂商版").input_price, 0.9);
    const image = rows.find(row => row.model_name === "gpt-image-2" && row.proxy_group_name === "GPT 经济版" && row.size_tier === "4K");
    assert.equal(image.image_price, 0.04);
    assert.equal(image.input_price, null);
    const video = rows.find(row => row.model_name === "grok-imagine-video" && row.size_tier === "720p");
    assert.equal(video.request_price, 0.028);
    assert.equal(video.request_unit, "second");
    assert.equal(video.media_type, "video");
    assert.ok(rows.filter(row => row.proxy_group_name === "GPT 生图").every(row => row.media_type === "image"));
    assert.ok(!rows.some(row => row.proxy_group_name === "GPT Codex 专用" && row.image_price !== null));
    assert.ok(!rows.some(row => /Muse|Hunyuan|TypeSafe|Gemini 官方/.test(row.proxy_group_name)));
    const comparisons = buildComparisonRows({ stations: [station], snapshots: [snapshot], references: { models: [] }, usage: { input: 1_000_000, output: 1_000_000 } });
    const offers = comparisons.flatMap(row => row.offers);
    const offer = offers.find(row => row.modelName === "claude-opus-5-5" && row.groupName === "Claude 经济版");
    assert.equal(offer.quotedPrices.input, 0.8);
    assert.equal(offer.quotedPrices.output, 4);
    assert.ok(Math.abs(offer.costPrices.input - 0.8 * station.rechargeRate) < 1e-10);
    assert.equal(offer.pricingUnavailable, false);
    assert.ok(offers.some(row => row.modelName === "gpt-image-2" && row.billingMode === "image"));
    assert.ok(offers.some(row => row.modelName === "grok-imagine-video" && row.requestUnit === "second"));
  });
});

test("SpiderAI 保留用户自定义充值比例、方案和证据，不补默认金额覆盖 rate-only 记录", async () => {
  await withCleanRegistry(async () => {
    await loadSitePlugin("spiderai");
    const input = {
      baseUrl: "https://spiderai.fun/#purchase", rechargeRmb: 9, rechargeCredits: 2,
      rechargeRateVerified: true, rechargeRateNote: "手动核实", rechargeCurrency: "CNY",
      rechargePlans: [{ kind: "topup", amount: 90, credits: 20, currency: "CNY", verified: true }],
      rechargePlansVerified: false, rechargeTiers: [{ amount: 10, discount: 0.9 }],
      rechargePayments: [{ channel: "alipay", faceAmount: 20, payAmount: 90, currency: "CNY", paidRmb: 90, note: "测试用自定义证据" }],
      rechargePaymentsVerified: true, priceCurrencyNote: "保留说明"
    };
    const actual = resolveStationCollection(input).station;
    assert.equal(actual.rechargeRate, 4.5);
    assert.equal(actual.rechargeRateNote, input.rechargeRateNote);
    assert.equal(actual.priceCurrencyNote, input.priceCurrencyNote);
    assert.equal(actual.rechargePlans[0].credits, 20);
    assert.equal(actual.rechargePlansVerified, false);
    assert.equal(actual.rechargePaymentsVerified, true);
    assert.deepEqual(actual.rechargeTiers, input.rechargeTiers);
    const onlyRate = resolveStationCollection({ baseUrl: input.baseUrl, rechargeRate: 0.8 }).station;
    assert.equal(onlyRate.rechargeRate, 0.8);
    assert.equal(onlyRate.rechargeRateVerified, false);
    assert.deepEqual(onlyRate.rechargePlans, []);
  });
});

test("SpiderAI HTML 解码拒绝旧模板和目录漂移，未报价缓存留空且不执行脚本", async () => {
  await withCleanRegistry(async () => {
    const plugin = await loadSitePlugin("spiderai");
    const decode = plugin.request.decodeResponse;
    const html = readFileSync(new URL("./fixtures/spiderai-pricing-page.html", import.meta.url), "utf8");
    const source = JSON.parse(html.match(/const PX_DATA=(\{[^\r\n]*\});/)[1]);
    const page = data => `const PX_DATA=${JSON.stringify(data)};`;
    assert.throws(() => decode("<html>login</html>"), /marker not found/);
    assert.throws(() => decode("const PX_DATA={broken};"), SyntaxError);
    assert.throws(() => decode(page({ ...source, usd: null })), /active USD catalogue/);
    assert.throws(() => decode("x".repeat(4_000_001)), /bounded HTML/);
    assert.throws(() => decode(page({ ...source, usd: { ...source.usd, rates: {} } })), /group rate missing/);
    assert.throws(() => decode(page({ ...source, usd: { ...source.usd, media: {} } })), /media price missing/);
    globalThis.__spideraiExecuted = false;
    try {
      const payload = decode(html + "\nglobalThis.__spideraiExecuted = true;");
      assert.equal(globalThis.__spideraiExecuted, false);
      assert.equal(payload.groups.filter(group => !group.id.includes(":media")).length, 20);
      const changed = structuredClone(source);
      const product = changed.catalog.find(product => product.id === "codex");
      const model = (product.groupModels || product.models)[0];
      model.channelBaseCny = { input: null, cacheRead: null };
      const decoded = decode(page(changed));
      const raw = decoded.data.find(row => row.name === model.name);
      assert.equal(raw.tiers[0].input, null);
      assert.equal(raw.tiers[0].cacheRead, null);
      const collection = resolveStationCollection(plugin.preset);
      await assert.rejects(collectStation(collection.station, {
        collection, retries: 1, fetchImpl: async () => new Response("<html>login</html>")
      }), /marker not found/);
    } finally { delete globalThis.__spideraiExecuted; }
  });
});
test("PoloAI 匿名采价保留未支持计费项，登录充值报价1:1与四档快捷金额已核实", async () => {
  await withCleanRegistry(async () => {
    const plugin = await loadSitePlugin("poloai");
    const collection = resolveStationCollection(plugin.preset);
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/poloai-pricing-sample.json", import.meta.url), "utf8"));
    const requests = [];
    const snapshot = await collectStation(collection.station, {
      collection,
      retries: 1,
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return new Response(JSON.stringify(fixture), { headers: { "content-type": "application/json" } });
      },
      pageFetch: async () => assert.fail("公开定价不得访问浏览器登录态")
    });

    assert.deepEqual(requests.map(({ url, init }) => [url, init.method, init.credentials]), [["https://poloai.top/api/pricing", "GET", "omit"]]);
    assert.equal(snapshot.status, "partial");
    assert.equal(snapshot.source, "poloai");
    assert.equal(collection.station.priceCurrency, "USD");
    assert.equal(collection.station.priceCurrencyVerified, true);
    assert.equal(snapshot.rechargeRateVerified, true);
    assert.equal(collection.station.rechargeRmb, 1);
    assert.equal(collection.station.rechargeCredits, 1);
    const topup = JSON.parse(readFileSync(new URL("./fixtures/poloai-topup-sample.json", import.meta.url), "utf8"));
    assert.match(collection.station.rechargeRateNote, /登录核验.*充值1元人民币=1美元额度/);
    assert.match(collection.station.rechargeRateNote, /支付宝最低50元，Stripe最低70元/);
    assert.match(collection.station.rechargeRateNote, /第三方收银台实付与实际到账尚未核实/);
    assert.equal(collection.station.rechargeAuto, false);
    assert.equal(collection.station.rechargePlansVerified, true);
    assert.equal(collection.station.rechargePaymentsVerified, false);
    assert.deepEqual(collection.station.rechargeTiers, []);
    assert.deepEqual(collection.station.rechargePayments, []);
    assert.deepEqual(topup.topupInfo.data.discount, {});
    assert.deepEqual(topup.subscriptions.data, []);
    assert.deepEqual(collection.station.rechargePlans.map(plan => plan.amount), topup.topupInfo.data.amount_options);
    for (const plan of collection.station.rechargePlans) {
      assert.deepEqual([plan.credits, plan.currency, plan.verified, plan.availability], [plan.amount, "CNY", true, "self_service"]);
      assert.ok(topup.quotes.some(quote => quote.amount === plan.amount && Number(quote.response.data) === plan.amount));
    }
    assert.ok(topup.quotes.every(quote => quote.status === 200 && Number(quote.response.data) === quote.amount));
    assert.equal(topup.quotes.filter(quote => quote.amount === 200).length, 2);
    assert.deepEqual(topup.topupInfo.data.pay_methods.map(method => method.type), ["alipay", "stripe"]);
    assert.deepEqual([topup.topupInfo.data.min_topup, topup.topupInfo.data.stripe_min_topup], [50, 70]);
    assert.equal(topup.paymentsVerified, false);
    assert.equal(topup.ordersCreated, false);

    const rows = snapshot.normalized.data;
    const find = (name, group, tier) => rows.find(row => row.model_name === name && row.proxy_group_name === group && (!tier || row.tier_name === tier));
    assert.deepEqual([find("claude-fable-5", "Claude-code稳定").input_price, find("claude-fable-5", "Claude-code稳定").output_price], [10, 50]);
    assert.deepEqual(rows.filter(row => row.model_name === "gpt-6-sol").map(row => [row.input_price, row.output_price]), [[1.6, 8], [3.2, 12]]);
    assert.equal(find("grok-imagine-image", "grok官key").image_price, 0.09);
    assert.deepEqual([find("sora-2-guan", "sora").request_price, find("sora-2-guan", "sora").request_unit], [0.45, "second"]);
    assert.equal(find("gemini-nano-banana-2.1-c", "特价香蕉画图").request_price, 0.16);
    assert.equal(find("gpt-image-2-c", "image2c特价").image_price, 0.06);

    assert.deepEqual(snapshot.normalized.unpricedModels, snapshot.rawMeta.unpricedModels);
    assert.deepEqual(snapshot.rawMeta.unpricedModels.slice().sort(), [
      "doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128", "doubao-seedance-2-0-mini-260615",
      "gemini-3-pro-image-preview", "gpt-6.1-terra", "qwen-plus", "suno_lyrics", "suno_music"
    ].sort());
    assert.equal(rows.some(row => snapshot.rawMeta.unpricedModels.includes(row.model_name)), false);
    assert.deepEqual(snapshot.rawMeta.unsupportedBillingModes.slice().sort(), [
      "12h 缓存写入暂不支持", "Seedance 分辨率、参考视频与 token 用量联合计费暂不支持",
      "图片尺寸专项价格的计费单位尚未核实，暂不参与比价", "歌曲或歌词按 clips 数量计价，暂不能当作每请求价格",
      "思考模式与普通模式分档暂不支持"
    ].sort());

    const offers = buildComparisonRows({ stations: [collection.station], snapshots: [snapshot], references: { models: [] }, usage: { input: 1_000_000, output: 1_000_000 } }).flatMap(row => row.offers);
    const quote = offers.find(row => row.modelName === "claude-fable-5");
    assert.deepEqual([quote.sourceCurrency, quote.quotedPrices.input, quote.quotedPrices.output], ["USD", 10, 50]);
    assert.equal(quote.pricingUnavailable, false);
  });
});

test("PoloAI 登录补验迁移旧默认配置，不覆盖自定义比例和充值证据", async () => {
  await withCleanRegistry(async () => {
    const plugin = await loadSitePlugin("poloai");
    const legacy = {
      pluginId: "poloai", baseUrl: "https://poloai.top/pricing",
      rechargeRmb: 1, rechargeCredits: 1, rechargeRate: 1, rechargeRateVerified: true,
      rechargeRateNote: "公开证据：PoloAPI 帮助文档《价格-充值-分组介绍》（管理员9个月前更新）明确写明充值1元人民币=1美元额度，并支持自定义金额；第三方于2026-08-21记录Stripe $10额度实扣¥10。按公开政策记1:1，status的price/stripe_unit_price仅作交叉检查，不单独作为到账证明。公开资料未列固定赠额档位；当前结算和档位仍未登录实测。",
      rechargeTiers: [], rechargePlans: [], rechargePayments: [],
      rechargePlansVerified: false, rechargePaymentsVerified: false,
      priceCurrencyNote: "首版：档位尚未核验"
    };
    const upgraded = resolveStationCollection(legacy).station;
    assert.equal(upgraded.rechargeRateNote, plugin.preset.rechargeRateNote);
    assert.equal(upgraded.priceCurrencyNote, plugin.preset.priceCurrencyNote);
    assert.equal(upgraded.rechargePlansVerified, true);
    assert.deepEqual(upgraded.rechargePlans.map(plan => plan.amount), [200, 500, 1000, 2000]);
    assert.equal(upgraded.rechargePaymentsVerified, false);
    const fresh = resolveStationCollection({ baseUrl: "https://poloai.top/wallet" }).station;
    assert.equal(fresh.baseUrl, "https://poloai.top/pricing");
    assert.equal(fresh.rechargePlansVerified, true);
    assert.equal(fresh.rechargePlans.length, 4);
    const customInputs = [
      { ...legacy, rechargeRmb: 80, rechargeCredits: 100, rechargeRate: 0.8 },
      { ...legacy, rechargeRateNote: "保留手工备注", rechargeRateVerified: false },
      { ...legacy, rechargePlans: [{ kind: "manual", amount: 80, credits: 100, currency: "CNY", availability: "manual", verified: true }], rechargePlansVerified: false },
      { ...legacy, rechargeTiers: [{ amount: 100, discount: 0.9 }],
        rechargePayments: [{ channel: "alipay", faceAmount: 100, payAmount: 80, currency: "CNY", paidRmb: 80 }], rechargePaymentsVerified: true }
    ];
    for (const input of customInputs) {
      const actual = resolveStationCollection(input).station;
      assert.equal(actual.rechargeRate, input.rechargeRate);
      assert.equal(actual.rechargeRateVerified, input.rechargeRateVerified);
      assert.equal(actual.rechargeRateNote, input.rechargeRateNote);
      assert.equal(actual.priceCurrencyNote, input.priceCurrencyNote);
      assert.deepEqual(actual.rechargeTiers, input.rechargeTiers);
      assert.deepEqual(actual.rechargePlans.map(plan => [plan.amount, plan.credits]), input.rechargePlans.map(plan => [plan.amount, plan.credits]));
      assert.equal(actual.rechargePlansVerified, input.rechargePlansVerified);
      assert.equal(actual.rechargePaymentsVerified, input.rechargePaymentsVerified);
    }
    const rateOnly = resolveStationCollection({ baseUrl: legacy.baseUrl, rechargeRate: 0.8 }).station;
    assert.equal(rateOnly.rechargeRate, 0.8);
    assert.equal(rateOnly.rechargeRateVerified, false);
    assert.deepEqual(rateOnly.rechargePlans, []);
    assert.equal(rateOnly.rechargePlansVerified, false);
  });
});
test("keeps every static script selector and local page asset connected", () => {
  for (const page of ["dashboard", "options"]) {
    const html = readFileSync(new URL(`../${page}.html`, import.meta.url), "utf8");
    const source = readFileSync(new URL(`../src/${page}.js`, import.meta.url), "utf8");
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${page} contains duplicate ids`);
    const available = new Set(ids);
    for (const match of source.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)) {
      assert.ok(available.has(match[1]), `${page}.js queries missing #${match[1]}`);
    }
    for (const match of source.matchAll(/querySelector(?:All)?\("([a-z][a-z0-9]*[ >][^"]*)"\)/g)) {
      assert.fail(`${page}.js 用了依赖标签层级的后代选择器 "${match[1]}"，页面标签一改就取到 null，改用 id 或 data-* 锚点`);
    }
    for (const match of html.matchAll(/(?:src|href)="((?:src|styles|icons)\/[^"]+)"/g)) {
      assert.ok(existsSync(new URL(`../${match[1]}`, import.meta.url)), `${page} references missing ${match[1]}`);
    }
  }
});

test("toolbar icon opens the dashboard instead of a popup", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.action?.default_popup, undefined, "工具栏图标不能再挂 popup");
  const source = readFileSync(new URL("../src/service-worker.js", import.meta.url), "utf8");
  assert.ok(source.includes("chrome.action?.onClicked?.addListener"), "service worker 必须接住图标点击");
  assert.ok(source.includes('"dashboard.html"'), "图标点击要落到 dashboard.html");
  assert.equal(existsSync(new URL("../popup.html", import.meta.url)), false, "popup.html 已删，别再加载回来");
});

test("keeps dialogs as siblings instead of nesting them", () => {
  for (const page of ["dashboard", "options"]) {
    const html = readFileSync(new URL(`../${page}.html`, import.meta.url), "utf8");
    const stack = [];
    for (const match of html.matchAll(/<\/?dialog\b[^>]*>/g)) {
      if (match[0].startsWith("</")) {
        const top = stack.pop();
        assert.ok(top, `${page} closes an unopened dialog`);
      } else if (!match[0].endsWith("/>")) {
        assert.equal(stack.length, 0, `${page} nests <dialog ${match[0].slice(7, 60)} inside another dialog`);
        stack.push(match[0]);
      }
    }
    assert.equal(stack.length, 0, `${page} leaves a dialog unclosed`);
  }
});
// 页面脚本跑在浏览器里，语法错误不是测试能靠字符串断言抓到的，这里直接让 Node 解析一遍。
test("every source module parses as a valid ES module", () => {
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) {
        visit(target);
        continue;
      }
      if (!entry.name.endsWith(".js")) continue;
      const source = readFileSync(target);
      assert.doesNotThrow(
        () => execFileSync(process.execPath, ["--input-type=module", "--check"], { input: source, stdio: ["pipe", "pipe", "pipe"] }),
        `syntax error in ${target.pathname}`
      );
    }
  };
  visit(new URL("../src/", import.meta.url));
});

test("sidrune 视频走明确未支持分路，混合采集保留有效图片档位和 partial", async () => {
  await withCleanRegistry(async () => {
    const plugin = await loadSitePlugin("sidrune");
    const [preset] = addProviderStationPresets([], [plugin], { exchangeRate: 7.2 });
    const collection = resolveStationCollection(preset);
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/sidrune-pricing.json", import.meta.url), "utf8"));
    const names = ["doubao-seedance-2-0-260128", "doubao-seedance-2-5-260628", "doubao-seedance-2-0-fast-260128", "doubao-seedance-2-0-mini-260615"];
    // 只保留真实视频报价的分路字段，分组复用现有 fixture。
    fixture.data.pricing.push(...names.map(name => ({
      name, group_ids: [46], billing_mode: "video", input_price: null, output_price: null,
      media: { protocol: "seedance", kind: "video", currency: "CNY", prices: [{ unit: "million_output_tokens", amount: "70", resolution: "480p", input: "text", audio: false }] }
    })));
    const snapshot = await collectStation(collection.station, {
      collection, retries: 1,
      fetchImpl: async () => new Response(JSON.stringify(fixture), { headers: { "content-type": "application/json" } })
    });
    assert.equal(snapshot.status, "partial");
    assert.deepEqual(snapshot.normalized.unpricedModels.slice().sort(), names.slice().sort());
    assert.deepEqual(snapshot.normalized.unsupportedBillingModes, ["视频按输出 token、分辨率等条件计费，暂不能折算为文本输入价"]);
    assert.ok(snapshot.normalized.data.every(row => !names.includes(row.model_name)));
    const images = snapshot.normalized.data.filter(row => row.model_name === "gpt-image-2" && row.proxy_group_name === "GPT-Pro");
    assert.deepEqual(images.map(row => [row.size_tier, row.image_price]), [["1K", 0.15], ["2K", 0.25], ["4K", 0.35]]);
  });
});

for (const id of ["openlux", "relayrouter"]) {
  test(`${id} 采集区分零价缺口和有效按次价，不把缺失、非法或负价当免费`, async () => {
    await withCleanRegistry(async () => {
      const plugin = await loadSitePlugin(id);
      const collection = resolveStationCollection(plugin.preset);
      const fixture = JSON.parse(readFileSync(new URL(`./fixtures/${id}-pricing.json`, import.meta.url), "utf8"));
      fixture.group_ratio["MJ-3"] = 0.147;
      const base = { quota_type: 1, model_ratio: 0, enable_groups: ["MJ-3"], supported_endpoint_types: ["MJ action"], model_type: "图像" };
      fixture.data.push(
        { ...base, model_name: "mj_custom_zoom", model_price: 0 },
        { ...base, model_name: "mj_inpaint", model_price: 0 },
        { ...base, model_name: "request-missing" },
        { ...base, model_name: "request-invalid", model_price: "bad" },
        { ...base, model_name: "request-negative", model_price: -1 },
        { ...base, model_name: "mj_imagine", model_price: 0.3 }
      );
      const snapshot = await collectStation(collection.station, {
        collection, retries: 1,
        fetchImpl: async () => new Response(JSON.stringify(fixture), { headers: { "content-type": "application/json" } })
      });
      const expected = ["mj_custom_zoom", "mj_inpaint", "request-missing", "request-invalid", "request-negative"];
      assert.equal(snapshot.status, "partial");
      assert.deepEqual(snapshot.normalized.unpricedModels.slice().sort(), expected.slice().sort());
      assert.deepEqual(snapshot.normalized.unsupportedBillingModes.slice().sort(), [
        "站点按次报价为 0，尚未确认免费，不参与比价", "按次价格缺失、无效或为负数，无法给出单位价"
      ].sort());
      assert.ok(snapshot.normalized.data.every(row => !expected.includes(row.model_name)));
      const valid = snapshot.normalized.data.find(row => row.model_name === "mj_imagine");
      assert.equal(valid.request_price, 0.0441);
      const offers = buildComparisonRows({ stations: [collection.station], snapshots: [snapshot], references: { models: [] }, usage: { input: 1_000_000, output: 1_000_000 } }).flatMap(row => row.offers);
      assert.ok(offers.every(row => !expected.includes(row.modelName)));
    });
  });
}

test("PoloAI special_prices 经真实 collectStation 映射保留尺寸、价格与分组倍率", async () => {
  await withCleanRegistry(async () => {
    const plugin = await loadSitePlugin("poloai");
    const original = plugin.preset.adapter.priceMap;
    const priceMap = {
      ...original,
      rules: original.rules.map(rule => rule.sourcePath === "special_prices"
        ? { when: { path: "special_prices", present: true }, kind: "request", price: "model_price", unit: "image", mediaType: "image", sizeTiers: { path: "special_prices", format: "object" } }
        : rule)
    };
    const collection = resolveStationCollection(plugin.preset);
    collection.station.adapter.priceMap = priceMap;
    const fixture = JSON.parse(readFileSync(new URL("./fixtures/poloai-pricing-sample.json", import.meta.url), "utf8"));
    const target = fixture.data.find(item => item.model_name === "gemini-3-pro-image-preview");
    assert.ok(target);
    fixture.data = [target];
    const snapshot = await collectStation(collection.station, {
      collection, retries: 1,
      fetchImpl: async () => new Response(JSON.stringify(fixture), { headers: { "content-type": "application/json" } })
    });
    assert.equal(snapshot.status, "success");
    assert.deepEqual(snapshot.normalized.data.map(row => [row.size_tier, row.image_price, row.proxy_group_name]), [
      ["1k", 0.36, "gemini-nanobanana"], ["1k", 0.72, "gemini-as"], ["1k", 0.96, "nanobanana-临时高价"],
      ["1k", 1.32, "企业极速｜一key调用全模型"], ["1k", 1.632, "A-Claude/GPT-svip 极速通道"], ["1k", 0.48, "nanobanana-稳定"],
      ["2k", 0.36, "gemini-nanobanana"], ["2k", 0.72, "gemini-as"], ["2k", 0.96, "nanobanana-临时高价"],
      ["2k", 1.32, "企业极速｜一key调用全模型"], ["2k", 1.632, "A-Claude/GPT-svip 极速通道"], ["2k", 0.48, "nanobanana-稳定"],
      ["4k", 0.36, "gemini-nanobanana"], ["4k", 0.72, "gemini-as"], ["4k", 0.96, "nanobanana-临时高价"],
      ["4k", 1.32, "企业极速｜一key调用全模型"], ["4k", 1.632, "A-Claude/GPT-svip 极速通道"], ["4k", 0.48, "nanobanana-稳定"]
    ]);
    assert.deepEqual(snapshot.normalized.unpricedModels || [], []);
  });
});

test("man8out 匿名采集渠道目录，绝对单价按分组倍率只折算一次，生图走按次计费", async () => {
  await withCleanRegistry(async () => {
    const providers = await loadSitePlugins(["man8out"]);
    const [preset] = addProviderStationPresets([], providers);
    const collection = resolveStationCollection({ ...preset, baseUrl: "https://ai.man8out.com/modelsmarket" });
    const station = collection.station;

    assert.equal(sitePluginForStation(station).id, "man8out");
    assert.equal(station.mode, "direct");
    assert.equal(station.auth.type, "none");
    assert.equal(station.priceCurrency, "USD");
    assert.equal(station.priceCurrencyVerified, true);
    // 收银台实测：充 10 元到账 ◈10.00，手续费 1% 实付 ¥10.10，1 美元额度 = ¥1.01。
    assert.equal(station.rechargeRateVerified, true);
    assert.equal(station.rechargeRate, 1.01);
    assert.equal(station.rechargeRmb, 1.01);
    assert.equal(station.rechargeCredits, 1);
    assert.equal(station.rechargePlansVerified, true);
    assert.equal(station.rechargePlans.length, 10);
    assert.equal(station.rechargePaymentsVerified, true);
    assert.equal(station.rechargePayments.length, 1);
    assert.equal(station.rechargePayments[0].feeRate, 0.01);

    const fixture = JSON.parse(readFileSync(new URL("./fixtures/man8out-catalog.json", import.meta.url), "utf8"));
    const requests = [];
    const snapshot = await collectStation(station, {
      collection,
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return new Response(JSON.stringify(fixture), { headers: { "content-type": "application/json" } });
      }
    });

    // 目录接口匿名可读，不该顺带去碰要登录的 /payment/config 与 /payment/limits。
    assert.equal(requests.length, 1, "匿名采集不应请求需登录的充值接口");
    assert.equal(new URL(requests[0].url).pathname, "/api/v1/channels/catalog");
    assert.equal(new URL(requests[0].url).searchParams.get("available_only"), "true");
    assert.equal(requests[0].init.credentials, "omit");
    assert.equal(requests[0].init.headers.Authorization, undefined);

    assert.equal(snapshot.status, "success");
    assert.equal(snapshot.normalized.sourceFormat, "fastaitoken");
    assert.equal(snapshot.normalized.data.length, 25);
    assert.equal(snapshot.normalized.data.every(row => row.price_currency === "USD"), true);

    // 绝对单价 × 分组倍率：grok 官方 $2/$6 × 0.15，跨 200K 后官方翻倍到 $4/$12 再 × 0.15。
    const grok = snapshot.normalized.data.filter(row => row.model_name === "grok-4.6");
    assert.deepEqual(grok.map(row => row.tier_name), ["standard", "long_context"]);
    const [grokShort, grokLong] = grok;
    assert.ok(Math.abs(grokShort.input_price - 0.3) < 1e-9);
    assert.ok(Math.abs(grokShort.output_price - 0.9) < 1e-9);
    assert.ok(Math.abs(grokShort.cache_read_price - 0.075) < 1e-9);
    assert.ok(Math.abs(grokLong.input_price - 0.6) < 1e-9);
    assert.ok(Math.abs(grokLong.output_price - 1.8) < 1e-9);
    assert.ok(Math.abs(grokLong.cache_read_price - 0.15) < 1e-9);

    // 倍率大于 1 的分组不被钳到 1。
    const opus = snapshot.normalized.data.find(row => row.model_name === "claude-opus-5-5");
    assert.ok(Math.abs(opus.input_price - 6) < 1e-9);
    assert.ok(Math.abs(opus.output_price - 30) < 1e-9);
    assert.ok(Math.abs(opus.cache_read_price - 0.3) < 1e-9);
    assert.ok(Math.abs(opus.cache_write_price - 7.5) < 1e-9);

    // 没有 intervals 的条目走「标准」档，不凭空造档位。
    const glm = snapshot.normalized.data.find(row => row.model_name === "glm-5.3");
    assert.equal(glm.tier_name, "标准");
    assert.ok(Math.abs(glm.input_price - 1.2) < 1e-9);
    assert.ok(Math.abs(glm.output_price - 4.2) < 1e-9);

    // billing_mode=image 走按次价，不摊到 token 单价上。
    const flatImage = snapshot.normalized.data.filter(row => row.model_name === "gpt-image-2.6-flare");
    assert.deepEqual(flatImage.map(row => [row.tier_name, row.request_price, row.input_price]), [["1K", 0.012, null]]);

    const proImage = snapshot.normalized.data.filter(row => row.model_name === "gemini-3.0-pro-image");
    assert.deepEqual(proImage.map(row => [row.tier_name, row.request_price]), [["1K", 0.08], ["2K", 0.12], ["4K", 0.12]]);

    // pricing 为 null 的条目表示「没报价」，不能当免费写进比价。
    assert.equal(snapshot.normalized.data.some(row => row.model_name === "gpt-5.6"), false);
  });
});
