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
  assert.match(dashboard, /<option value="blendedUnitPrice"[^>]*selected>折算单价<\/option>/);
  assert.match(dashboard, /data-sort-keys="monthlyCost blendedUnitPrice diffPercent"/);
  assert.doesNotMatch(dashboard, /recommendationScore/);
  assert.doesNotMatch(dashboardScript, /recommendationScore/);
  assert.match(options, /id="evidence-threshold"/);
  assert.doesNotMatch(options, /recommendation-profile/);
});

const IMAGE_REFERENCES = {
  models: [{ id: "openai/gpt-image-1", name: "openai/gpt-image-1", provider: "openai", input: 8, output: 8, imageOutput: 30, imagePrice: 0.04 }],
  imageQuotes: { "openai/gpt-image-1": { unit: "image", value: 0.02, provider: "openai", variant: "" } },
  exchangeRate: 7.2
};

test("只有按张价的报价不摊进按 token 的混合口径", () => {
  const comparison = comparisonFor({
    models: [{ model_name: "openai/gpt-image-1", input_price: null, output_price: null, image_price: 0.04, price_currency: "CNY" }],
    references: IMAGE_REFERENCES
  });
  const offer = comparison.offers[0];
  assert.equal(offer.billingMode, "image");
  // 没有 token 价就算不出按 token 的月成本，别再给出 0 元和「低 100%」。
  assert.equal(offer.blendedUnitPrice, null);
  assert.equal(offer.blendedMix, null);
  assert.equal(offer.diffPercent, null);
  assert.equal(offer.recommended, false);
  assert.equal(offer.imageQuote.unit, "image");
  assert.equal(offer.imagePerImage, 0.04);
  // 官方按张价来自生图接口的 output_image，按汇率折成人民币：0.02 × 7.2。
  assert.equal(offer.imageOfficialQuote.unit, "image");
  assert.ok(Math.abs(offer.imageOfficialQuote.value - 0.144) < 1e-9);
  // 站内和官方都是元/张，直比，可以给档位。
  assert.equal(offer.imageCompare.kind, "direct");
  assert.ok(Math.abs(offer.imageCompare.diffPercent - (0.04 - 0.144) / 0.144 * 100) < 1e-9);
  assert.equal(offer.category, "excellent");
  // 没填出图张数就不编月成本。
  assert.equal(offer.imageMonthlyCost, null);
  assert.ok(offer.estimatedFields.includes("imageBilled"));
});

test("填了出图张数就按折合元/张乘出月成本", () => {
  const comparison = comparisonsFor({
    models: [{ model_name: "openai/gpt-image-1", input_price: null, output_price: null, image_price: 0.04, price_currency: "CNY" }],
    references: IMAGE_REFERENCES,
    usage: { input: 0, output: 0, images: 100 }
  })[0];
  const offer = comparison.offers[0];
  assert.equal(offer.imageCount, 100);
  assert.equal(offer.imageMonthlyCost, 4);
  assert.equal(offer.imageMonthlyCostPaid, 4);
});

test("带文本 token 价的图像模型也走生图道，不再按 token 摊成 ¥0", () => {
  const comparison = comparisonFor({
    models: [{ model_name: "openai/gpt-image-1", input_price: 8, output_price: 15, image_output_price: 30, image_price: 0.04, price_currency: "CNY" }],
    references: IMAGE_REFERENCES
  });
  const offer = comparison.offers[0];
  assert.equal(offer.billingMode, "image");
  assert.equal(offer.blendedUnitPrice, null);
  // 官方报元/张而站内也报了元/张，取同口径那一条。
  assert.equal(offer.imageQuote.unit, "image");
  assert.equal(offer.imagePerImage, 0.04);
});

test("站内只报图 token 价时留在 token 道，用量里的图像输出能覆盖它", () => {
  const comparison = comparisonFor({
    models: [{ model_name: "openai/gpt-image-1", input_price: 8, output_price: 15, image_output_price: 30, price_currency: "CNY" }],
    references: IMAGE_REFERENCES,
    usage: { input: 1_000_000, output: 1_000_000, imageOutputTokens: 1_000_000 }
  });
  const offer = comparison.offers[0];
  assert.equal(offer.billingMode, "token");
  assert.ok(Number.isFinite(offer.monthlyCost));
  // 8 + 15 + 30 = 53 元。
  assert.equal(offer.monthlyCost, 53);
  assert.equal(offer.imageQuote, null);
});

test("站内 元/张 和 图 token 价都报时，按官方口径取那一条并跨单位折算", () => {
  const references = {
    ...IMAGE_REFERENCES,
    imageQuotes: { "openai/gpt-image-1": { unit: "token", value: 0.00003, provider: "openai", variant: "" } }
  };
  const comparison = comparisonFor({
    models: [{ model_name: "openai/gpt-image-1", input_price: 8, output_price: 15, image_output_price: 30, image_price: 0.04, price_currency: "CNY" }],
    references
  });
  const offer = comparison.offers[0];
  assert.equal(offer.billingMode, "image");
  // 官方是元/1M 图 token，站内同口径那一条优先。
  assert.equal(offer.imageQuote.unit, "token");
  assert.equal(offer.imageQuote.value, 30);
  assert.ok(Math.abs(offer.imageOfficialQuote.value - 0.00003 * 7.2) < 1e-12);
  assert.equal(offer.imageCompare.kind, "same-unit");
  // 30 vs 0.000216 元/1M：站内贵得多。
  assert.ok(offer.imageCompare.diffPercent > 100000);
});

test("官方没有出图价时不给对比，也不编折扣", () => {
  const comparison = comparisonFor({
    models: [{ model_name: "some-unknown-image", input_price: null, output_price: null, image_price: 0.5, price_currency: "CNY" }],
    references: { models: [], imageQuotes: {}, exchangeRate: 7.2 }
  });
  const offer = comparison.offers[0];
  assert.equal(offer.billingMode, "image");
  assert.equal(offer.imagePerImage, 0.5);
  assert.equal(offer.imageOfficialQuote, null);
  assert.equal(offer.imageCompare.kind, "none");
  assert.equal(offer.imageCompare.diffPercent, null);
  assert.equal(offer.category, "");
});