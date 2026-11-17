import test from "node:test";
import assert from "node:assert/strict";
import { normalizePricingPayload } from "../src/core/normalizers.js";
import { buildComparisonRows } from "../src/core/pricing.js";
import { collectStation, probeRechargeRate } from "../src/core/collectors.js";
import { resolveStationCollection } from "../src/core/request-strategy.js";
import { effectiveRecharge, parseRechargeStatus } from "../src/core/recharge.js";

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
    { rate: 0.85, price: 0.85, originalPrice: null, quotaPerUnit: 500_000, exchangeRate: 7.2 }
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

test("probes /api/status once per collection and hangs the rate on the snapshot", async () => {
  const station = { id: "probe", name: "探测站", baseUrl: "https://probe.example", mode: "api", adapter: { responseFormat: "auto" } };
  const collection = resolveStationCollection(station);
  const seen = [];
  const snapshot = await collectStation(collection.station, {
    collection,
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

test("keeps the prices when the station has no /api/status", async () => {
  const station = { id: "legacy", name: "老站", baseUrl: "https://legacy.example", mode: "api", adapter: { responseFormat: "auto" } };
  const collection = resolveStationCollection(station);
  const snapshot = await collectStation(collection.station, {
    collection,
    fetchImpl: async url => url.endsWith("/api/status")
      ? statusResponse(404, { error: "not found" })
      : jsonResponse({ success: true, usable_group: { default: "默认" }, group_ratio: { default: 1 }, data: [GEMINI_ITEM] })
  });
  assert.equal(snapshot.recharge, undefined);
  assert.equal(snapshot.normalized.data.length, 1);
});

test("skips the probe when the station opts out or the collector is told to", async () => {
  const seen = [];
  const fetchImpl = async url => {
    seen.push(url);
    return jsonResponse({ data: { price: 2 } });
  };
  const station = { id: "off", name: "锁定站", baseUrl: "https://off.example", mode: "api", rechargeAuto: false, adapter: { responseFormat: "auto" } };
  const collection = resolveStationCollection(station);
  await collectStation(collection.station, {
    collection,
    probeRecharge: false,
    fetchImpl: async url => (url.endsWith("/api/status") ? fetchImpl(url) : jsonResponse({ success: true, usable_group: { default: "默认" }, group_ratio: { default: 1 }, data: [GEMINI_ITEM] }))
  });
  assert.deepEqual(seen, []);
});

test("treats a broken /api/status as missing, not as a failed collection", async () => {
  const station = { id: "broken", name: "坏接口站", baseUrl: "https://broken.example" };
  assert.equal(await probeRechargeRate(station, { fetchImpl: async () => { throw new TypeError("Failed to fetch"); } }), null);
  assert.equal(await probeRechargeRate(station, { fetchImpl: async () => statusResponse(500, {}) }), null);
  assert.equal(await probeRechargeRate(station, { fetchImpl: async () => jsonResponse("<html>首页</html>") }), null);
});
