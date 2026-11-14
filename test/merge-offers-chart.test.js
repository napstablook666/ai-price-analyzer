import test from "node:test";
import assert from "node:assert/strict";
import { buildComparisonRows, pickPrimaryOfficial } from "../src/core/pricing.js";
import { buildChartGroups } from "../src/dashboard-index.js";

const USAGE = { input: 1_000_000, output: 1_000_000 };

function buildOffers({ references, models = [], station = {} }) {
  const base = { id: "tf", name: "TokenFlux", rechargeRate: 1, rechargeRateVerified: true, priceCurrencyVerified: true, ...station };
  const comparisons = buildComparisonRows({
    stations: [base],
    snapshots: [{ stationId: base.id, collectedAt: 1, status: "success", normalized: { data: models } }],
    references,
    usage: USAGE
  });
  return comparisons.flatMap(comparison => comparison.offers);
}

const FLASH_ITEM = { model_name: "deepseek-v4.1-flash", input_price: 0.07, output_price: 0.14, price_currency: "CREDITS" };

test("collapses several official candidates of one quote into a single offer", () => {
  const offers = buildOffers({
    models: [FLASH_ITEM],
    references: {
      models: [
        { name: "deepseek/deepseek-v4.1-flash-1017", provider: "deepseek", input: 0.0434, output: 0.3 },
        { name: "deepseek-v4.1-flash", provider: "deepseek", input: 0.09, output: 0.18 },
        { name: "deepseek/deepseek-v4.1-flash-1017:batch", provider: "deepseek", input: 0.048, output: 0.144 }
      ]
    }
  });

  assert.equal(offers.length, 1);
  const offer = offers[0];
  assert.equal(offer.officialCandidateCount, 3);
  assert.equal(offer.matchCandidateCount, 3);
  assert.equal(offer.officialName, "deepseek-v4.1-flash");
  assert.equal(offer.officialCandidates.length, 3);
  assert.equal(offer.officialCandidates[0].name, "deepseek-v4.1-flash");
  assert.equal(offer.diffPercent, offer.officialCandidates[0].diffPercent);
  assert.equal(offer.officialMonthlyCost, offer.officialCandidates[0].monthlyCost);
  assert.equal(offer.officialBlendedUnitPrice, offer.officialCandidates[0].officialBlendedUnitPrice);
  // 中转侧数值只累加一次，不应随候选数翻倍。
  assert.equal(offer.quotedPrices.input, 0.07);
});

test("keeps a single offer when the same model only matches one official entry", () => {
  const offers = buildOffers({
    models: [FLASH_ITEM],
    references: { models: [{ name: "deepseek-v4.1-flash", provider: "deepseek", input: 0.09, output: 0.18 }] }
  });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].officialCandidateCount, 1);
});

test("pickPrimaryOfficial prefers the undecorated exact name, then the cheapest official", () => {
  const candidates = [
    { name: "m:batch", provider: "p", monthlyCost: 1 },
    { name: "m@eu", provider: "p", monthlyCost: 2 },
    { name: "m", provider: "p", monthlyCost: 3 }
  ];
  assert.equal(pickPrimaryOfficial(candidates, "m").name, "m");

  assert.equal(pickPrimaryOfficial([{ name: "m:batch", monthlyCost: 1 }, { name: "m-v2", monthlyCost: 9 }], "m").name, "m:batch");

  assert.equal(pickPrimaryOfficial([{ name: "m-1017", monthlyCost: 1 }, { name: "m-1018", monthlyCost: 9 }], "m").name, "m-1017");

  // 全部带装饰时退化到官方月成本最低的那条。
  assert.equal(pickPrimaryOfficial([{ name: "m:batch", monthlyCost: 9 }, { name: "m@eu", monthlyCost: 1 }], "m").name, "m@eu");

  assert.equal(pickPrimaryOfficial([], "m"), null);
});

test("buildChartGroups groups by canonical model, normalizes bars and excludes public stations", () => {
  const row = (overrides) => ({
    canonicalModel: "m1",
    displayName: "M1",
    provider: "openai",
    stationId: "a",
    stationName: "A",
    stationCategory: "paid",
    blendedUnitPrice: 1,
    officialBlendedUnitPrice: 4,
    diffPercent: -75,
    category: "excellent",
    pricingUnavailable: false,
    ...overrides
  });
  const rows = [
    row({}),
    row({ stationId: "b", stationName: "B", blendedUnitPrice: 2 }),
    row({ stationId: "c", stationName: "C", blendedUnitPrice: 8 }),
    row({ stationId: "p", stationName: "P", stationCategory: "public", blendedUnitPrice: 0.5 }),
    row({ stationId: "u", stationName: "U", pricingUnavailable: true, blendedUnitPrice: null }),
    row({ canonicalModel: "m2", displayName: "M2", stationId: "a", blendedUnitPrice: 3, officialBlendedUnitPrice: 3, diffPercent: 0 })
  ];

  const { groups, totalGroups } = buildChartGroups(rows);
  assert.equal(totalGroups, 2);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].canonicalModel, "m1");
  assert.deepEqual(groups[0].bars.map(bar => bar.stationId), ["a", "b", "c"]);
  assert.deepEqual(groups[0].bars.map(bar => bar.widthPercent), [12.5, 25, 100]);
  assert.equal(groups[0].officialLeftPercent, 50);
  assert.equal(groups[0].officialBlendedUnitPrice, 4);

  const truncated = buildChartGroups(rows, { maxGroups: 1 });
  assert.equal(truncated.groups.length, 1);
  assert.equal(truncated.totalGroups, 2);
});