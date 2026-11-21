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

test("Leaflow 美元面值与支付宝人民币报价分开保存，按 67.18/10 折算一次", async () => {
  const { station, snapshot } = await collectFixture();
  assert.equal(RECHARGE.accountCurrency, "USD");
  assert.equal(station.rechargeCurrency, "CNY", "配置展示人民币实付，方案仍保留美元面值");
  assert.equal(station.rechargeRmb, RECHARGE.checkoutQuote.paidRmb);
  assert.equal(station.rechargeCredits, RECHARGE.checkoutQuote.faceAmount);
  assert.ok(Math.abs(station.rechargeRate - RECHARGE.cnyExchangeRate) < 1e-10);
  assert.equal(station.rechargeRateVerified, true);
  assert.equal(station.rechargeAuto, false);
  assert.equal(station.rechargePlansVerified, true);
  assert.deepEqual(station.rechargePlans.map(plan => [plan.amount, plan.credits, plan.currency]), RECHARGE.quickAmounts.map(amount => [amount, amount, RECHARGE.accountCurrency]));
  assert.deepEqual(station.rechargeTiers, [], "条件赠额不生成通用折扣档位");
  assert.equal(station.rechargePayments.length, 1, "不得推算其他面值或银行卡的人民币支付证据");
  const { paymentCompleted, ...quote } = RECHARGE.checkoutQuote;
  const { note, ...payment } = station.rechargePayments[0];
  assert.deepEqual(payment, quote);
  assert.equal(station.rechargePaymentsVerified, true);
  assert.equal(paymentCompleted, false);
  assert.equal(RECHARGE.ordersCreated, false);
  assert.equal(RECHARGE.paymentsMade, false);
  assert.equal(RECHARGE.existingOrder.status, "failed");
  assert.equal(RECHARGE.existingOrder.failure_reason, "payment_intent_payment_attempt_expired");
  assert.equal(RECHARGE.fees.feeRate, null);
  assert.equal(Object.hasOwn(payment, "feeRate"), false, "未知费率不能被填成0");
  assert.match(note, /待支付报价.*截图未证明付款.*同额支付宝订单超时失败/);
  assert.match(station.rechargeRateNote, /最低 1 USD/);
  assert.match(station.rechargeRateNote, /非实时汇率/);
  assert.match(station.rechargeRateNote, /银行卡人民币结算未核验/);
  assert.equal(snapshot.recharge, undefined);
  const offer = offersOf(station, snapshot).find(offer => offer.modelName === "claude-opus-5-5");
  assert.equal(offer.quotedPrices.input, 4);
  assert.ok(Math.abs(offer.costPrices.input - 4 * RECHARGE.cnyExchangeRate) < 1e-10);
  assert.ok(Math.abs(offer.costPrices.output - 20 * RECHARGE.cnyExchangeRate) < 1e-10);
  assert.ok(Math.abs(offer.monthlyCost - 24 * RECHARGE.cnyExchangeRate) < 1e-10, "渠道报价与比例相同，不得叠乘两遍或再加未知手续费");
});

test("Leaflow 首版未核实默认值迁移到渠道报价，用户改动完整保留", async () => {
  const plugin = await loadSitePlugin("leaflow");
  const legacy = {
    ...plugin.preset, rechargeCurrency: "USD", rechargeRmb: 1, rechargeCredits: 1, rechargeRate: 1,
    rechargeRateVerified: false,
    rechargeRateNote: "2026-11-21 登录核验：结算账户和充值表单均为 USD，最低 1 USD，Stripe 银行卡/支付宝。尚未创建订单或核验人民币实付汇率、手续费与赠额，不能认定 1 USD 额度 = 1 元。",
    rechargePayments: [], rechargePaymentsVerified: false,
    rechargePlans: RECHARGE.quickAmounts.map(amount => ({ kind: "topup", amount, credits: amount, currency: "USD", availability: "self_service", verified: true,
      note: "登录充值页快捷美元面值；不是人民币实付、赠额或阶梯折扣，第三方支付未核验。" }))
  };
  const migrated = resolveStationCollection(legacy).station;
  assert.ok(Math.abs(migrated.rechargeRate - RECHARGE.cnyExchangeRate) < 1e-10);
  assert.equal(migrated.rechargeRateVerified, true);
  assert.equal(migrated.rechargeCurrency, "CNY");
  assert.deepEqual(migrated.rechargePayments, resolveStationCollection(plugin.preset).station.rechargePayments);
  assert.deepEqual(resolveStationCollection(migrated).station, migrated, "迁移幂等");
  const blank = resolveStationCollection({ baseUrl: plugin.preset.baseUrl }).station;
  assert.ok(Math.abs(blank.rechargeRate - RECHARGE.cnyExchangeRate) < 1e-10);
  assert.equal(blank.rechargePayments.length, 1);

  const changes = [
    { rechargeRmb: 7.2, rechargeCredits: 1, rechargeRate: 7.2, rechargeRateVerified: true },
    { rechargeRateNote: "用户自定义说明" },
    { rechargeRateVerified: true },
    { rechargePlans: [{ kind: "topup", amount: 20, credits: 30, currency: "USD", note: "人工方案" }] },
    { rechargePlans: legacy.rechargePlans.map(plan => ({ ...plan, discount: 0.9 })) },
    { rechargePlans: legacy.rechargePlans.map(plan => ({ ...plan, recurring: true })) },
    { rechargeTiers: [{ amount: 100, discount: 0.9 }] },
    { rechargePayments: [{ channel: "card", faceAmount: 10, payAmount: 70, currency: "CNY", paidRmb: 70 }] }
  ];
  for (const change of changes) {
    const original = resolveStationCollection({ ...legacy, ...change }).station;
    assert.equal(original.rechargeRate, change.rechargeRate ?? 1, JSON.stringify(change));
    assert.equal(original.rechargeRateVerified, change.rechargeRateVerified ?? false);
    assert.equal(original.rechargeRateNote, change.rechargeRateNote ?? legacy.rechargeRateNote);
    assert.equal(original.rechargePayments.length, change.rechargePayments?.length ?? 0);
    assert.equal(original.rechargePlans[0].note, change.rechargePlans?.[0].note ?? legacy.rechargePlans[0].note);
  }
  const rateOnly = { ...legacy, rechargeRate: 7.2, rechargeRateVerified: true };
  delete rateOnly.rechargeRmb;
  delete rateOnly.rechargeCredits;
  assert.equal(resolveStationCollection(rateOnly).station.rechargeRate, 7.2, "不得给仅保存比例的记录补写默认金额");
});

test("Leaflow 条件赠额保留适用范围和期限，不冒充充值折扣或成功到账", () => {
  assert.equal(RECHARGE.bonus.currentAccountCreditGrants, 0);
  assert.equal(RECHARGE.bonus.generalTopupBonusVerified, false);
  assert.deepEqual(RECHARGE.bonus.topupBonusTiers, []);
  const onboarding = RECHARGE.bonus.conditionalPrograms.find(program => program.kind === "onboarding");
  assert.equal(onboarding.usdCredit, 1);
  assert.equal(onboarding.validDays, 7);
  assert.match(onboarding.condition, /tasks.*deepseek-v4.1-flash/);
  const rebate = RECHARGE.bonus.conditionalPrograms.find(program => program.kind === "shipping-rebate");
  assert.equal(rebate.validHours, 24);
  assert.deepEqual(rebate.rebateRange, [0.5, 0.9]);
  assert.match(rebate.condition, /Shipping AI.*next day/);
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
