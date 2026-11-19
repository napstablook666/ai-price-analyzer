import test from "node:test";
import assert from "node:assert/strict";
import { normalizePricingPayload } from "../src/core/normalizers.js";
import { buildComparisonRows } from "../src/core/pricing.js";
import { collectStation, probeRechargeRate } from "../src/core/collectors.js";
import { resolveStationCollection } from "../src/core/request-strategy.js";
import { effectiveRecharge, parseRechargeStatus } from "../src/core/recharge.js";
import { normalizeStation } from "../src/shared/schema.js";

const jsonResponse = body => ({
  ok: true,
  status: 200,
  headers: { get: () => "application/json" },
  json: async () => body,
  text: async () => JSON.stringify(body)
});

const statusResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => "application/json" },
  json: async () => body,
  text: async () => JSON.stringify(body)
});

test("reads the recharge rate out of the two /api/status shapes", () => {
  // new-api 标准形状把参数包在 data 里。
  assert.deepEqual(
    parseRechargeStatus({ success: true, data: { price: 0.85, quota_per_unit: 500_000, usd_exchange_rate: 7.2 } }),
    { rate: 0.85, price: 0.85, originalPrice: null, quotaPerUnit: 500_000, exchangeRate: 7.2, tiers: [], channels: [] }
  );
  // 老站直接把参数摊在顶层。
  assert.equal(parseRechargeStatus({ price: 1 }).rate, 1);
  // 字符串数字也认。
  assert.equal(parseRechargeStatus({ data: { price: "1.25" } }).rate, 1.25);
});

test("ignores original_price instead of quoting the pre-discount rate", () => {
  const parsed = parseRechargeStatus({ data: { price: 0.8, original_price: 1 } });
  assert.equal(parsed.rate, 0.8);
  assert.equal(parsed.originalPrice, 1);
});

test("drops rates that cannot be a real price", () => {
  assert.equal(parseRechargeStatus(null), null);
  assert.equal(parseRechargeStatus([]), null);
  assert.equal(parseRechargeStatus({ data: { price: 0 } }), null);
  assert.equal(parseRechargeStatus({ data: { price: -1 } }), null);
  assert.equal(parseRechargeStatus({ data: { price: 500 } }), null);
  assert.equal(parseRechargeStatus({ data: { price: true } }), null);
  assert.equal(parseRechargeStatus({ data: { price: { nested: 1 } } }), null);
  assert.equal(parseRechargeStatus({ message: "ok" }), null);
});

test("prefers the collected rate over the hand-typed one", () => {
  const station = { rechargeRate: 0.5, rechargeRateVerified: true };
  const snapshot = { recharge: { rate: 0.25, source: "auto", collectedAt: 1_700_000_000_000 } };
  assert.deepEqual(effectiveRecharge(station, snapshot), { rate: 0.25, verified: true, source: "auto", collectedAt: 1_700_000_000_000 });
  // 没有采集值就退回手填值。
  assert.deepEqual(effectiveRecharge(station, {}), { rate: 0.5, verified: true, source: "manual" });
  // 手填值本身没核验过时，倍率照旧不给用。
  assert.deepEqual(effectiveRecharge({ rechargeRate: 0.5, rechargeRateVerified: false }, {}), { rate: 0.5, verified: false, source: "manual" });
});

test("locks the hand-typed rate when auto collection is off", () => {
  const station = { rechargeRate: 0.5, rechargeRateVerified: true, rechargeAuto: false };
  const snapshot = { recharge: { rate: 0.25, source: "auto" } };
  assert.equal(effectiveRecharge(station, snapshot).rate, 0.5);
  assert.equal(effectiveRecharge(station, snapshot).source, "manual");
});


const GEMINI_ITEM = { model_name: "[次]gemini-3.1-pro-preview", quota_type: 1, model_ratio: 0, completion_ratio: 1, model_price: 0.08, enable_groups: ["default"] };
const USAGE = { input: 347_382, output: 34_421, cacheRead: 0, cacheWrite: 0, requests: 188, images: 0 };

function offerFor({ station = {}, recharge } = {}) {
  const base = {
    id: "auto",
    name: "自动采集站",
    rechargeRate: 0.5,
    rechargeRateVerified: true,
    priceCurrencyVerified: true,
    rechargeTiers: [{ amount: 1000, discount: 0.6 }],
    ...station
  };
  const normalized = normalizePricingPayload({ success: true, usable_group: { default: "默认" }, group_ratio: { default: 1 }, data: [GEMINI_ITEM] }, "auto", {});
  const snapshot = { stationId: base.id, collectedAt: 1, status: "success", normalized };
  if (recharge) snapshot.recharge = recharge;
  const comparisons = buildComparisonRows({
    stations: [base],
    snapshots: [snapshot],
    references: { models: [{ name: "gemini-3.1-pro-preview", provider: "google", input: 2, output: 12, cacheRead: null }] },
    usage: USAGE
  });
  for (const comparison of comparisons) {
    const offer = comparison.offers.find(entry => entry.modelName === GEMINI_ITEM.model_name);
    if (offer) return offer;
  }
  return null;
}

test("reprices the offer from the collected rate instead of the hand-typed one", () => {
  // 手填 0.5：面值 15.04，实付 7.52。
  const manual = offerFor();
  assert.ok(Math.abs(manual.monthlyCost - 7.52) < 0.001, String(manual.monthlyCost));
  // 站点现价 0.25：同样的额度只要一半的钱。
  const collected = offerFor({ recharge: { rate: 0.25, source: "auto", collectedAt: 1 } });
  assert.ok(Math.abs(collected.monthlyCost - 3.76) < 0.001, String(collected.monthlyCost));
  // 档位折扣作用在面值上：15.04 × 0.6 = 9.024，再乘回 0.25。
  assert.equal(collected.rechargePlan.amount, 1000);
  assert.ok(Math.abs(collected.monthlyCostPaid - 2.256) < 0.001, String(collected.monthlyCostPaid));
});

test("keeps the hand-typed price when the station turns auto collection off", () => {
  const offer = offerFor({ station: { rechargeAuto: false }, recharge: { rate: 0.25, source: "auto" } });
  assert.ok(Math.abs(offer.monthlyCost - 7.52) < 0.001, String(offer.monthlyCost));
});

test("probes /api/status only when explicitly requested by a developer", async () => {
  const station = { id: "probe", name: "探测站", baseUrl: "https://probe.example", mode: "api", adapter: { responseFormat: "auto" } };
  const collection = resolveStationCollection(station);
  const seen = [];
  const snapshot = await collectStation(collection.station, {
    collection,
    probeRecharge: true,
    fetchImpl: async url => {
      seen.push(url);
      return url.endsWith("/api/status")
        ? statusResponse(200, { data: { price: 2.5, quota_per_unit: 500_000 } })
        : jsonResponse({ success: true, usable_group: { default: "默认" }, group_ratio: { default: 1 }, data: [GEMINI_ITEM] });
    }
  });
  assert.deepEqual(seen, ["https://probe.example/api/ai/pricing", "https://probe.example/api/status"]);
  assert.equal(snapshot.recharge.rate, 2.5);
  assert.equal(snapshot.recharge.source, "auto");
  assert.equal(snapshot.normalized.data.length, 1);
});

test("keeps prices when an explicit developer probe finds no /api/status", async () => {
  const station = { id: "legacy", name: "老站", baseUrl: "https://legacy.example", mode: "api", adapter: { responseFormat: "auto" } };
  const collection = resolveStationCollection(station);
  const snapshot = await collectStation(collection.station, {
    collection,
    probeRecharge: true,
    fetchImpl: async url => url.endsWith("/api/status")
      ? statusResponse(404, { error: "not found" })
      : jsonResponse({ success: true, usable_group: { default: "默认" }, group_ratio: { default: 1 }, data: [GEMINI_ITEM] })
  });
  assert.equal(snapshot.recharge, undefined);
  assert.equal(snapshot.normalized.data.length, 1);
});

test("ordinary collection uses published recharge evidence even with legacy auto enabled", async () => {
  const station = normalizeStation({
    id: "static", name: "静态充值站", baseUrl: "https://static.example", mode: "direct",
    rechargeAuto: true, rechargeRate: 1.03, rechargeRateVerified: true,
    rechargePayments: [{ channel: "alipay", faceAmount: 300, payAmount: 309, currency: "CNY" }]
  });
  assert.equal(station.rechargeAuto, false);
  const collection = resolveStationCollection(station);
  const seen = [];
  const snapshot = await collectStation(collection.station, {
    collection,
    fetchImpl: async (url, options) => {
      seen.push({ url, method: options?.method || "GET" });
      return jsonResponse({ success: true, usable_group: { default: "默认" }, group_ratio: { default: 1 }, data: [GEMINI_ITEM] });
    }
  });
  assert.deepEqual(seen, [{ url: "https://static.example/api/ai/pricing", method: "GET" }]);
  assert.equal(snapshot.recharge, undefined);
  const offer = offerFor({ station, recharge: { rate: 0.25, source: "auto" } });
  assert.equal(offer.monthlyCostPaidSource, "counter");
  assert.equal(offer.rechargePayment.payAmount, 309);
  assert.ok(Math.abs(offer.monthlyCostPaid - 15.4912) < 0.001, String(offer.monthlyCostPaid));
});

test("treats a broken /api/status as missing, not as a failed collection", async () => {
  const station = { id: "broken", name: "坏接口站", baseUrl: "https://broken.example" };
  assert.equal(await probeRechargeRate(station, { fetchImpl: async () => { throw new TypeError("Failed to fetch"); } }), null);
  assert.equal(await probeRechargeRate(station, { fetchImpl: async () => statusResponse(500, {}) }), null);
  assert.equal(await probeRechargeRate(station, { fetchImpl: async () => jsonResponse("<html>首页</html>") }), null);
});

test("reads bulk_topup_discounts and pay_methods off /api/status", () => {
  const parsed = parseRechargeStatus({
    data: {
      price: 1,
      bulk_topup_discounts: { 300: 0.97, 10: 0.99 },
      pay_methods: [
        { id: "5", name: "Alipay", type: "antom", max_amount: "40000" },
        { id: "8", name: "Credit Card", type: "antom_card", max_amount: "40000" },
        { id: "1", name: "Crypto Pay", type: "usdt" }
      ]
    }
  });
  assert.deepEqual(parsed.tiers, [{ amount: 10, discount: 0.99 }, { amount: 300, discount: 0.97 }]);
  assert.deepEqual(parsed.channels, [
    { channel: "alipay", type: "antom", name: "Alipay", maxAmount: 40000 },
    { channel: "card", type: "antom_card", name: "Credit Card", maxAmount: 40000 },
    { channel: "crypto", type: "usdt", name: "Crypto Pay" }
  ]);
});

test("keeps a status row that has tiers or channels but no price", () => {
  const tiersOnly = parseRechargeStatus({ data: { bulk_topup_discounts: [{ amount: 10, discount: 0.9 }] } });
  assert.equal(tiersOnly.rate, null);
  assert.deepEqual(tiersOnly.tiers, [{ amount: 10, discount: 0.9 }]);
  const channelsOnly = parseRechargeStatus({ data: { pay_methods: [{ name: "Alipay", type: "alipay" }] } });
  assert.equal(channelsOnly.rate, null);
  assert.equal(channelsOnly.channels.length, 1);
});

test("prices the month off the counter payment when the station has one", () => {
  const derived = offerFor();
  assert.equal(derived.monthlyCostPaidSource, "derived");
  assert.ok(Math.abs(derived.monthlyCostPaid - 4.512) < 0.001, String(derived.monthlyCostPaid));

  // 收银台：充 1000 额度实付 400 元 → 0.4 元/额度，面值 15.04 × 0.4。
  const counter = offerFor({
    station: { rechargePayments: [{ channel: "alipay", faceAmount: 1000, payAmount: 400, currency: "CNY", paidRmb: 400 }] }
  });
  assert.equal(counter.monthlyCostPaidSource, "counter");
  assert.ok(Math.abs(counter.monthlyCostPaid - 6.016) < 0.001, String(counter.monthlyCostPaid));
  assert.equal(counter.rechargePayment.channel, "alipay");
});

test("falls back to the face cost when there is neither a tier nor a payment", () => {
  const offer = offerFor({ station: { rechargeTiers: [], rechargePayments: [] } });
  assert.equal(offer.monthlyCostPaidSource, "derived");
  assert.ok(Math.abs(offer.monthlyCostPaid - offer.monthlyCost) < 1e-9);
});

test("keeps a payment row without an rmb amount as evidence but does not rank by it", () => {
  const offer = offerFor({
    station: { rechargePayments: [{ channel: "card", faceAmount: 300, payAmount: 291, currency: "USD", paidRmb: null }] }
  });
  assert.equal(offer.monthlyCostPaidSource, "derived");
  assert.ok(Math.abs(offer.monthlyCostPaid - 4.512) < 0.001, String(offer.monthlyCostPaid));
  // 界面要能显示「已点过收银台」，但这条不参与排序。
  assert.equal(offer.rechargePayment.channel, "card");
  assert.equal(offer.rechargePayment.paidRmb, null);
  assert.equal(offer.rechargePayment.payAmount, 291);
});
