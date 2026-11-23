import test from "node:test";
import assert from "node:assert/strict";
import { buildComparisonRows, flattenComparisonRows } from "../src/core/pricing.js";
import { mediaTypeForPricing } from "../src/core/media.js";
import { normalizePricingPayload } from "../src/core/normalizers.js";

// 采集侧保留媒体类型识别，是为了知道「这一条不该进比价表」，而不是为了再把它展示出来。
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

test("buildComparisonRows 只出文本模型，生图、视频、认不出类型的整条不进比价表", () => {
  const normalized = normalizePricingPayload({ data: [
    { model_name: "gpt-5.2", input_price: 2, output_price: 8, price_currency: "CNY" },
    { model_name: "gpt-image-1", image_price: 0.4, price_currency: "CNY" },
    { model_name: "sora-2", request_price: 1.2, media_type: "video", price_currency: "CNY" }
  ] });

  const comparisons = buildComparisonRows({
    stations: [{ id: "s1", name: "站一", rechargeRate: 1, priceCurrencyVerified: true }],
    snapshots: [{ stationId: "s1", collectedAt: 1, status: "success", normalized }],
    references: { models: [] },
    usage: {}
  });
  const rows = flattenComparisonRows(comparisons);

  assert.deepEqual(rows.map(row => row.modelName).sort(), ["gpt-5.2"]);
  assert.equal(rows.every(row => row.billingMode === "token"), true);
});
