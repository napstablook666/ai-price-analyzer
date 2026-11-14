import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { addRecommendationStatus, blendedMixOf, blendedUnitPrice, buildComparisonRows, buildStationIndexes, mixLabel, tokenTotalOf } from "../src/core/pricing.js";

const MIXED_USAGE = { input: 1_000_000, output: 1_000_000 };

function comparisonsFor({ station = {}, models, usage = MIXED_USAGE, references = { models: [] } }) {
  const base = { id: "std", name: "标准站", rechargeRate: 1, rechargeRateVerified: true, priceCurrencyVerified: true, ...station };
  return buildComparisonRows({
    stations: [base],
    snapshots: [{ stationId: base.id, collectedAt: 1, status: "success", normalized: { data: models } }],
    references,
    usage
  });
}

function comparisonFor(options) {
  return comparisonsFor(options)[0];
}

test("spreads the workload cost over the tokens actually billed", () => {
  assert.equal(tokenTotalOf({ input: 1_000_000, output: 500_000, cacheRead: 2_000_000, requests: 900, images: 10 }), 3_500_000);
  assert.equal(blendedUnitPrice(7, { input: 1_000_000, output: 1_000_000 }), 3.5);
  assert.equal(blendedUnitPrice(7, { requests: 100 }), null);
  assert.equal(blendedUnitPrice(null, { input: 1 }), null);
  const mix = blendedMixOf({ input: 1_000_000, cacheRead: 3_000_000 });
  assert.equal(mix.input, 0.25);
  assert.equal(mix.cacheRead, 0.75);
  assert.equal(mix.output, 0);
  assert.equal(mixLabel(mix), "75:25:0");
  assert.equal(mixLabel(null), "");
});

test("exposes a blended unit price next to the monthly cost and the official benchmark", () => {
  const comparison = comparisonFor({
    models: [{ model_name: "m1", input_price: 2, output_price: 4, price_currency: "CREDITS" }],
    references: { models: [{ name: "m1", provider: "openai", input: 2, output: 4 }] }
  });
  const offer = comparison.offers[0];
  assert.equal(offer.pricingUnavailable, false);
  assert.equal(offer.monthlyCost, 6);
  assert.equal(offer.blendedUnitPrice, 3);
  assert.deepEqual(offer.blendedMix, blendedMixOf(MIXED_USAGE));
  assert.equal(offer.officialBlendedUnitPrice, 3);
  assert.deepEqual(offer.estimatedFields, ["cacheRead", "cacheWrite"]);
});

test("keeps public stations out of the blended price comparison", () => {
  const comparison = comparisonFor({
    station: { category: "public" },
    models: [{ model_name: "m1", input_price: 2, output_price: 4, price_currency: "CREDITS" }]
  });
  const offer = comparison.offers[0];
  assert.equal(offer.blendedUnitPrice, null);
  assert.equal(offer.officialBlendedUnitPrice, null);
});

test("summarizes each station by the median of its blended price ratio", () => {
  const comparisons = [];
  for (const [index, multiplier] of [1, 0.5, 0.25].entries()) {
    comparisons.push(comparisonFor({
      station: { id: `station-${index}`, name: `站点${index}`, priceCurrency: "CREDITS" },
      models: [{ model_name: `model-${index}`, input_price: 2 * multiplier, output_price: 4 * multiplier, price_currency: "CREDITS" }],
      references: { models: [{ name: `model-${index}`, provider: "openai", input: 2, output: 4 }] }
    }));
  }
  assert.equal(buildStationIndexes(comparisons).length, 0);

  const wide = comparisonsFor({
    station: { id: "wide", name: "宽站" },
    models: [0.25, 1, 0.5].map((multiplier, index) => ({ model_name: `w-${index}`, input_price: 2 * multiplier, output_price: 4 * multiplier, price_currency: "CREDITS" })),
    references: { models: [0, 1, 2].map(index => ({ name: `w-${index}`, provider: "openai", input: 2, output: 4 })) }
  });
  assert.equal(wide.length, 3);
  const [row] = buildStationIndexes(wide);
  assert.equal(row.stationId, "wide");
  assert.equal(row.median, 0.5);
  assert.equal(row.p25, 0.5);
  assert.equal(row.p75, 1);
  assert.equal(row.sampleSize, 3);
});

test("gates the recommendation badge on the evidence threshold instead of a weighted score", () => {
  const comparisons = [{
    comparisonGroup: "paid",
    offers: [
      { pricingUnavailable: false, matchRuleId: "exact", officialMonthlyCost: 10, monthlyCost: 3, confidenceScore: 40 },
      { pricingUnavailable: false, matchRuleId: "exact", officialMonthlyCost: 10, monthlyCost: 8, confidenceScore: 90 }
    ]
  }];
  addRecommendationStatus(comparisons, { evidenceThreshold: 60 });
  const [weak, strong] = comparisons[0].offers;
  assert.equal(weak.recommendationEligible, false);
  assert.equal(weak.recommended, false);
  assert.equal(weak.recommendationLabel, "需核验");
  assert.equal(strong.recommendationEligible, true);
  assert.equal(strong.recommended, true);
  assert.equal(strong.recommendationLabel, "推荐");
  assert.equal(weak.recommendationScore, undefined);
});

test("keeps the dashboard and options pages on the blended price口径", () => {
  const dashboard = fs.readFileSync(new URL("../dashboard.html", import.meta.url), "utf8");
  const dashboardScript = fs.readFileSync(new URL("../src/dashboard.js", import.meta.url), "utf8");
  const options = fs.readFileSync(new URL("../options.html", import.meta.url), "utf8");
  assert.match(dashboard, /<option value="blendedUnitPrice"[^>]*selected>混合单价<\/option>/);
  assert.match(dashboard, /data-sort-keys="diffPercent blendedUnitPrice"/);
  assert.doesNotMatch(dashboard, /recommendationScore/);
  assert.doesNotMatch(dashboardScript, /recommendationScore/);
  assert.match(options, /id="evidence-threshold"/);
  assert.doesNotMatch(options, /recommendation-profile/);
});