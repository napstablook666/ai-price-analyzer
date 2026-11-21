import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { collectStation } from "../src/core/collectors.js";
import { buildComparisonRows } from "../src/core/pricing.js";
import { resolveStationCollection } from "../src/core/request-strategy.js";
import { addProviderStationPresets } from "../src/core/station-presets.js";
import { sitePluginForStation } from "../src/site-plugins/catalog.js";
import { loadSitePlugin, resetSitePluginLoader } from "../src/site-plugins/loader.js";

const SOURCE = JSON.parse(readFileSync(new URL("./fixtures/leaflow-pricing.json", import.meta.url), "utf8"));
const RECHARGE = JSON.parse(readFileSync(new URL("./fixtures/leaflow-recharge.json", import.meta.url), "utf8"));
const UNPRICED = [
  "cosyvoice-v3-flash", "cosyvoice-v3-plus", "cosyvoice-v3.5-flash", "cosyvoice-v3.5-plus",
  "cyber/deepseek-v4.1-flash", "cyber/wan3.0-video", "qwen-audio-3.1-asr-flash-message",
  "qwen-audio-3.1-asr-flash-streaming", "qwen-audio-3.1-realtime-flash", "speech-2.8-turbo"
];
const model = (source, name = "claude-opus-5-5") => source.items.find(item => item.id === name);
const inputRate = source => source.__aux.prices.items[0].rates.find(rate => rate.dimensions.model === "claude-opus-5-5" && rate.dimensions.token_kind === "input");
const offersOf = (station, snapshot) => buildComparisonRows({
  stations: [station], snapshots: [snapshot], references: { models: [] }, usage: { input: 1_000_000, output: 1_000_000 }
}).flatMap(row => row.offers);

async function collectFixture(source = structuredClone(SOURCE), overrides = {}, responseFor) {
  const plugin = await loadSitePlugin("leaflow");
  const collection = resolveStationCollection({ ...plugin.preset, ...overrides });
  const { __aux, ...models } = source;
  const requests = [];
  const snapshot = await collectStation(collection.station, {
    collection, retries: 1,
    fetchImpl: async () => assert.fail("Leaflow 必须通过页面登录态 GET，不得直连或换 token"),
    capturePage: async () => assert.fail("不得把页面精选模型或捕获响应当成完整目录"),
    pageFetch: async request => {
      requests.push(request);
      if (responseFor) return responseFor(request, models, __aux);
      return { ok: true, status: 200, body: request.url.includes("/billing/") ? __aux.prices : models };
    }
  });
  return { plugin, station: collection.station, snapshot, requests };
}

test.beforeEach(() => resetSitePluginLoader());
test.afterEach(() => resetSitePluginLoader());

test("Leaflow 精确匹配项目模型页，安装预设幂等，登录采集主目录后关联计费 API", async () => {
  const plugin = await loadSitePlugin("leaflow");
  const stations = addProviderStationPresets([], [plugin]);
  assert.equal(addProviderStationPresets(stations, [plugin]), stations);
  assert.equal(sitePluginForStation(stations[0]).id, "leaflow");
  const url = new URL(plugin.preset.baseUrl);
  assert.equal(plugin.matches({ hostname: url.hostname, path: url.pathname }), true);
  for (const path of ["/", "/billing", "/pricing", "/products/canopy", "/products/canopy/models/extra"]) {
    assert.equal(plugin.matches({ hostname: url.hostname, path }), false, path);
  }
  assert.equal(plugin.matches({ hostname: "console.leaflow.net", path: url.pathname }), false);
  const { station, snapshot, requests } = await collectFixture(SOURCE, { auth: { type: "bearer", token: "must-not-leak" } });
  assert.equal(station.mode, "page");
  assert.equal(station.auth.type, "none");
  assert.equal(station.auth.token, "");
  assert.equal(station.priceCurrency, "CREDITS");
  assert.equal(station.priceCurrencyVerified, true);
  assert.deepEqual(requests.map(request => [new URL(request.url).pathname, request.method, request.credentials]), [
    ["/api/products/canopy/api/v1/models", "GET", "include"],
    ["/api/billing/api/v1/prices", "GET", "include"]
  ]);
  assert.ok(requests.every(request => !JSON.stringify(request.headers).includes("must-not-leak")));
  assert.equal(new URL(requests[1].url).search, "?currency=USD&product_id=canopy&page_size=200");
  assert.equal(snapshot.status, "partial");
  assert.equal(snapshot.source, "leaflow-billing");
  assert.equal(snapshot.normalized.data.length, 35);
  assert.equal(new Set(snapshot.normalized.data.map(row => row.model_name)).size, 18);
  assert.deepEqual(snapshot.rawMeta.unpricedModels.slice().sort(), UNPRICED.slice().sort());
  assert.equal(new Set([...snapshot.normalized.data.map(row => row.model_name), ...snapshot.rawMeta.unpricedModels]).size, 28);
  assert.equal(snapshot.normalized.data.some(row => ["deepseek-v4-flash", "glm-5.2"].includes(row.model_name)), false, "历史计费行不能冒充当前模型目录");
  assert.ok(snapshot.normalized.data.every(row => row.price_currency === "CREDITS" && row.group_ratio === 1));
});

test("Leaflow 按 unit_quantity 折算文本与缓存，只展开实际图片规格和视频秒价", async () => {
  const { station, snapshot } = await collectFixture();
  const rows = snapshot.normalized.data;
  const opus = rows.find(row => row.model_name === "claude-opus-5-5");
  assert.deepEqual([opus.input_price, opus.output_price, opus.cache_read_price, opus.cache_write_price], [4, 20, 0.2, 5]);
  const images = rows.filter(row => row.model_name === "gpt-image-2");
  assert.equal(images.length, 9);
  assert.equal(images.find(row => row.size_tier === "size=1024x1024 · quality=low").image_price, 0.006);
  assert.equal(images.find(row => row.size_tier === "size=1024x1024 · quality=high").image_price, 0.211);
  assert.ok(images.every(row => row.media_type === "image" && row.input_price === null && row.request_price === null));
  const qwenImage = rows.filter(row => row.model_name === "qwen-image-2.1-turbo");
  assert.equal(qwenImage.length, 1, "两种尺寸同价，沿用核心合并规则");
  assert.equal(qwenImage[0].image_price, 0.014133);
  const video = rows.filter(row => row.media_type === "video");
  assert.ok(video.length > 0);
  assert.ok(video.every(row => row.request_unit === "second" && row.image_price === null && row.input_price === null));
  const expected = SOURCE.__aux.prices.items[0].rates.find(rate => rate.dimensions.model === "seedance-2-5" && rate.dimensions.resolution === "720p");
  const seedance = video.find(row => row.model_name === "seedance-2-5" && row.size_tier === "resolution=720p");
  assert.equal(seedance.request_price, Number(expected.unit_amount) / Number(expected.unit_quantity));
  assert.deepEqual(seedance.media_specs.resolution.enum, ["720p"]);
  const offer = offersOf(station, snapshot).find(offer => offer.modelName === "seedance-2-5" && offer.mediaSpecs.resolution.enum.includes("720p"));
  assert.deepEqual(offer.mediaSpecs.resolution.enum, ["720p"]);
});

test("Leaflow 美元充值面值与人民币比例分开保存，保留系统未验证1:1回退和用户确认值", async () => {
  const { station, snapshot } = await collectFixture();
  assert.equal(station.rechargeCurrency, RECHARGE.accountCurrency);
  assert.equal(station.rechargeRateVerified, false);
  assert.equal(station.rechargeAuto, false);
  assert.equal(station.rechargePlansVerified, true);
  assert.deepEqual(station.rechargePlans.map(plan => [plan.amount, plan.credits, plan.currency]), RECHARGE.quickAmounts.map(amount => [amount, amount, RECHARGE.accountCurrency]));
  assert.equal(RECHARGE.cnyExchangeRate, null);
  assert.equal(RECHARGE.ordersCreated, false);
  assert.equal(RECHARGE.paymentsMade, false);
  assert.deepEqual(station.rechargePayments, []);
  assert.equal(station.rechargePaymentsVerified, false);
  assert.match(station.rechargeRateNote, /最低 1 USD/);
  assert.match(station.rechargeRateNote, /尚未创建订单/);
  assert.equal(snapshot.recharge, undefined);
  const fallback = offersOf(station, snapshot).find(offer => offer.modelName === "claude-opus-5-5");
  assert.equal(fallback.costPrices.input, 4, "项目既有未确认比例回退为1，不把此值当实付证据");
  const custom = resolveStationCollection({ ...station, rechargeRmb: 7.2, rechargeCredits: 1, rechargeRate: 7.2, rechargeRateVerified: true,
    rechargeRateNote: "用户已确认比例", rechargePlans: [], rechargePlansVerified: false }).station;
  assert.equal(custom.rechargeRateVerified, true);
  assert.equal(custom.rechargeRateNote, "用户已确认比例");
  assert.deepEqual(custom.rechargePlans, []);
  const converted = offersOf(custom, snapshot).find(offer => offer.modelName === "claude-opus-5-5");
  assert.equal(converted.quotedPrices.input, 4);
  assert.ok(Math.abs(converted.costPrices.input - 4 * 7.2) < 1e-10);
  assert.ok(Math.abs(converted.costPrices.output - 20 * 7.2) < 1e-10);
});

test("Leaflow 缺失缓存留空，音频、受限模型、推理异价与未知维度不伪装文本价格", async () => {
  const source = structuredClone(SOURCE);
  model(source).billing.meters = model(source).billing.meters.filter(meter => !["cache_read", "cache_write"].includes(meter.kind));
  const { snapshot } = await collectFixture(source);
  const opus = snapshot.normalized.data.find(row => row.model_name === "claude-opus-5-5");
  assert.equal(opus.cache_read_price, null);
  assert.equal(opus.cache_write_price, null);
  for (const mode of ["reasoning", "dimension", "media-unit"]) {
    const changed = structuredClone(SOURCE);
    let name = "claude-opus-5-5";
    if (mode === "reasoning") changed.__aux.prices.items[0].rates.find(rate => rate.dimensions.model === name && rate.dimensions.token_kind === "reasoning").unit_amount = "21";
    if (mode === "dimension") model(changed).billing.meters[0].dimension_keys.push("future_tier");
    if (mode === "media-unit") { name = "gpt-image-2"; model(changed, name).billing.meters[0].unit = "pixel"; }
    const result = await collectFixture(changed);
    assert.ok(result.snapshot.rawMeta.unpricedModels.includes(name), mode);
    assert.equal(result.snapshot.normalized.data.some(row => row.model_name === name), false, mode);
  }
});

test("Leaflow 价格异常、币种变化、计划重复、分页缺失一律报错，不回退公开精选或旧价格", async () => {
  const plugin = await loadSitePlugin("leaflow");
  const cases = [
    ["empty models", source => { source.items = []; }],
    ["no prices", source => { source.__aux = {}; }],
    ["plan currency", source => { source.__aux.prices.items[0].currency = "EUR"; }],
    ["duplicate plan", source => { source.__aux.prices.items.push(structuredClone(source.__aux.prices.items[0])); }],
    ["zero quantity", source => { inputRate(source).unit_quantity = "0"; }],
    ["negative amount", source => { inputRate(source).unit_amount = "-1"; }],
    ["missing amount", source => { inputRate(source).unit_amount = null; }],
    ["blank amount", source => { inputRate(source).unit_amount = " "; }],
    ["infinite amount", source => { inputRate(source).unit_amount = "Infinity"; }],
    ["boolean amount", source => { inputRate(source).unit_amount = true; }],
    ["rate currency", source => { inputRate(source).currency = "EUR"; }],
    ["rate scheme", source => { inputRate(source).billing_scheme = "tiered"; }],
    ["new rate dimension", source => { inputRate(source).dimensions.future_tier = "premium"; }],
    ["duplicate rate", source => { source.__aux.prices.items[0].rates.push(structuredClone(inputRate(source))); }],
    ["price pagination", source => { source.__aux.prices.pagination.total_count = 2; }],
    ["model pagination", source => { source.pagination = { total_count: 29 }; }]
  ];
  for (const [label, mutate] of cases) {
    const source = structuredClone(SOURCE);
    mutate(source);
    assert.throws(() => plugin.request.decodeResponse(source), /Leaflow/, label);
  }
});

test("Leaflow 主接口401与辅助计费接口401均停止采集，不返回静态默认目录", async () => {
  for (const failingPath of ["/api/products/canopy/api/v1/models", "/api/billing/api/v1/prices"]) {
    await assert.rejects(collectFixture(SOURCE, {}, (request, models, aux) => new URL(request.url).pathname === failingPath
      ? { ok: false, status: 401, body: { error: "Authentication required" } }
      : { ok: true, status: 200, body: request.url.includes("/billing/") ? aux.prices : models }), /登录|会话|身份|权限|认证|401/);
  }
});
