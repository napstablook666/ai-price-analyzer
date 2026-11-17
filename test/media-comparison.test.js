import test from "node:test";
import assert from "node:assert/strict";
import { buildComparisonRows, filterComparisonsByMediaMode, flattenComparisonRows } from "../src/core/pricing.js";
import { mediaModeSwitchFilters } from "../src/dashboard-index.js";
import { mediaModeMatches, mediaTypeForPricing } from "../src/core/media.js";
import { normalizePricingPayload } from "../src/core/normalizers.js";

test("normalizes explicit image and video media types without guessing model names", () => {
  const normalized = normalizePricingPayload({ data: [
    { model_name: "image-without-name-hint", image_price: 0.4, price_currency: "CNY" },
    { model_name: "video-without-name-hint", request_price: 1.2, media_type: "video", media_specs: { seconds: { unit: "second" } }, price_currency: "CNY" },
    { model_name: "legacy-token", input_price: 2, output_price: 4, price_currency: "CNY" }
  ] });

  const image = normalized.data.find(row => row.model_name === "image-without-name-hint");
  const video = normalized.data.find(row => row.model_name === "video-without-name-hint");
  const text = normalized.data.find(row => row.model_name === "legacy-token");
  assert.equal(image.media_type, "image");
  assert.equal(video.media_type, "video");
  assert.deepEqual(video.media_specs, { seconds: { unit: "second" } });
  assert.equal(text.media_type, undefined);
  assert.equal(mediaTypeForPricing({ billing_mode: "per_request", video_rate_independent: false }, { targetField: "request" }), null);
});

test("media filtering keeps legacy rows in text and never cross-fills image/video rows", () => {
  const comparisons = [{
    canonicalModel: "same-model",
    comparisonGroup: "standard",
    offers: [
      { stationId: "text", mediaType: "text" },
      { stationId: "legacy" },
      { stationId: "image", mediaType: "image" },
      { stationId: "video", mediaType: "video" },
      { stationId: "unknown", mediaType: "unknown" }
    ]
  }];

  assert.deepEqual(filterComparisonsByMediaMode(comparisons, "text")[0].offers.map(row => row.stationId), ["text", "legacy"]);
  assert.deepEqual(filterComparisonsByMediaMode(comparisons, "image")[0].offers.map(row => row.stationId), ["image"]);
  assert.deepEqual(filterComparisonsByMediaMode(comparisons, "video")[0].offers.map(row => row.stationId), ["video"]);
  assert.equal(comparisons[0].offers.length, 5);
  assert.equal(mediaModeMatches({ mediaType: "unknown" }, "text"), false);
});


test("media mode switch shows all media providers and restores text defaults", () => {
  const filters = { search: "image", provider: ["openai"], sortBy: "blendedUnitPrice", sortSecondary: "model", sortDirection: "desc" };
  assert.equal(mediaModeSwitchFilters(filters, "image", ["anthropic", "openai"]).provider, null);
  assert.deepEqual(mediaModeSwitchFilters(filters, "text", ["anthropic", "openai"]).provider, ["anthropic", "openai"]);
});

// 视频按秒报价的分辨率档是并列选项，不是上下文分档，不能被加权合并成一条。
test("keeps video per-second resolutions as separate rows with their own unit", () => {
  const normalized = normalizePricingPayload({
    code: 0,
    data: {
      list: [{
        model_id: "video-per-second",
        billing_mode: "special",
        category: "video",
        per_second_prices: { "480P": 0.3, "768P": 0.35, "2K": 0.75 }
      }]
    }
  }, "all-in-one-models");

  assert.deepEqual(normalized.data.map(row => row.request_unit), ["second", "second", "second"]);

  const comparisons = buildComparisonRows({
    stations: [{ id: "video-station", name: "视频站", category: "paid", exchangeRate: 1 }],
    snapshots: [{ stationId: "video-station", normalized, fetchedAt: "2026-01-01T00:00:00.000Z" }],
    references: {},
    usage: {}
  });
  const rows = flattenComparisonRows(filterComparisonsByMediaMode(comparisons, "video"));

  const actual = rows.map(row => [row.tierName, row.requestUnit, row.costPrices.request]).sort((a, b) => a[0].localeCompare(b[0]));
  const expected = [["2K", "second", 0.75], ["480P", "second", 0.3], ["768P", "second", 0.35]].sort((a, b) => a[0].localeCompare(b[0]));
  assert.deepEqual(actual, expected);
});

// 站点的出图档位以前一律 unstated，因为没人读它自己的档位列。
// 映射文档写 size_tier，老站点写 tier_name，两条都得能出成「1K」这种标签。
test("生图档位读站点自己的 size_tier 与 tier_name", () => {
  const normalized = normalizePricingPayload({ data: [
    { model_name: "gpt-image-tier", image_price: 0.15, size_tier: "1K", price_currency: "CNY" },
    { model_name: "gpt-image-legacy", image_price: 0.25, tier_name: "2K", price_currency: "CNY" }
  ] });

  const comparisons = buildComparisonRows({
    stations: [{ id: "s1", name: "站一", rechargeRate: 1, priceCurrencyVerified: true }],
    snapshots: [{ stationId: "s1", collectedAt: 1, status: "success", normalized }],
    references: { models: [] },
    usage: { images: 10 }
  });
  const offers = comparisons.flatMap(comparison => comparison.offers);
  const byName = name => offers.find(offer => offer.modelName === name);

  assert.equal(byName("gpt-image-tier").imageTierText, "1K");
  assert.equal(byName("gpt-image-legacy").imageTierText, "2K");
});
