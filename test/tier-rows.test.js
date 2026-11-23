import test from "node:test";
import assert from "node:assert/strict";
import { buildComparisonRows } from "../src/core/pricing.js";
import { normalizePricingPayload } from "../src/core/normalizers.js";
import { getResponseFormatHandler } from "../src/core/response-formats.js";

// 用量分档的输入项：同一个 model_name，两条 item 只差 min_tokens / max_tokens。
const TIERED_ITEMS = [
  { model_name: "grok-4.5", quota_type: 0, model_ratio: 1, completion_ratio: 4, model_price: 0, enable_groups: ["default"], min_tokens: 0, max_tokens: 200000, tier_name: "<200K" },
  { model_name: "grok-4.5", quota_type: 0, model_ratio: 2, completion_ratio: 4, model_price: 0, enable_groups: ["default"], min_tokens: 200001, tier_name: "≥200K" }
];

function comparisonsFor(usage, stationOverrides = {}) {
  const station = { id: "tiered", name: "分档站", rechargeRate: 1, rechargeRateVerified: true, priceCurrencyVerified: true, ...stationOverrides };
  // 直接给已归一的行：`auto` 归一不会保留 min_tokens，这里要测的是 pricing 层的选档。
  const snapshot = {
    data: TIERED_ITEMS.map(item => ({ ...item, price_currency: "USD", group_ratio: 1, evidence: "exact" }))
  };
  return buildComparisonRows({
    stations: [station],
    snapshots: [{ stationId: station.id, collectedAt: 1, status: "success", normalized: snapshot }],
    references: { models: [{ name: "grok-4.5", provider: "xai", input: 3, output: 15, cacheRead: null }] },
    usage
  });
}

test("上下文长度分档按单次请求长度选一档，不并列成两行", () => {
  const short = comparisonsFor({ input: 100000, output: 0, requests: 1 });
  const long = comparisonsFor({ input: 300000, output: 0, requests: 1 });

  const shortOffers = short.flatMap(comparison => comparison.offers.filter(offer => offer.modelName === "grok-4.5"));
  const longOffers = long.flatMap(comparison => comparison.offers.filter(offer => offer.modelName === "grok-4.5"));

  assert.equal(shortOffers.length, 1, "短上下文下同一个模型只应有一行");
  assert.equal(longOffers.length, 1, "长上下文下同一个模型只应有一行");

  // 长档的 model_ratio 是短档的两倍，价也应是两倍；绝对值交给别的用例，这里只验选档
  assert.equal(longOffers[0].prices.input, shortOffers[0].prices.input * 2);
});

test("站点画像给了单次请求长度时以画像为准，盖过用量均值", () => {
  const comparisons = comparisonsFor({ input: 100000, output: 0, requests: 1 }, { billingProfile: { tokensPerRequest: 400000, source: "manual" } });
  const offers = comparisons.flatMap(comparison => comparison.offers.filter(offer => offer.modelName === "grok-4.5"));
  assert.equal(offers.length, 1);
  assert.equal(offers[0].prices.input, comparisonsFor({ input: 300000, output: 0, requests: 1 }).flatMap(comparison => comparison.offers.filter(offer => offer.modelName === "grok-4.5"))[0].prices.input);
});

const SUB2API_RAW = {
  data: {
    groups: [{
      id: 1,
      name: "default",
      ratio: 1,
      models: [{
        name: "deepseek-v4-pro-0813",
        pricing: { input_price: 0.000001, output_price: 0.000002 },
        time_pricing: {
          timezone: "Asia/Shanghai",
          weekdays_only: true,
          periods: [
            { start_time: "09:00:00", end_time: "12:00:00", multiplier: 1.2 },
            { start_time: "14:00:00", end_time: "18:00:00", multiplier: 1.5 }
          ]
        }
      }]
    }]
  }
};

test("时段分档每段各出一行，基准价那一行保留", () => {
  const handler = getResponseFormatHandler("model-plaza");
  const strategy = handler({ profile: "sub2api" });
  const rows = strategy.parse(SUB2API_RAW).data;
  assert.equal(rows.length, 3, "1 行基准价 + 2 行时段价");

  const byTier = new Map(rows.map(row => [row.tier_name || "(基准)", row]));
  assert.ok(byTier.has("(基准)"));
  assert.equal(byTier.get("(基准)").input_price, 1);

  const peak = rows.find(row => /09:00–12:00/.test(row.tier_name));
  assert.ok(peak, "时段行要带可读的时段名");
  assert.match(peak.tier_name, /^工作日 09:00–12:00 ×1\.2$/);
  assert.equal(peak.input_price, 1.2);
  assert.equal(peak.output_price, 2.4);
});
