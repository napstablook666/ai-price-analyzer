import test from "node:test";
import assert from "node:assert/strict";
import { normalizePricingPayload } from "../src/core/normalizers.js";
import { buildComparisonRows, requestUnitPriceOf, resolveRechargeTier } from "../src/core/pricing.js";

import { normalizeRechargePlans } from "../src/shared/recharge-tiers.js";
import { parseBillingTiers } from "../src/core/normalizers.js";
// 橘子站 2026-11-16 实测的 11 档（/api/user/aff → data.amount_options + data.discount）。
const JUZIAI_TIERS = [
  { amount: 1, discount: 0.75 },
  { amount: 5, discount: 0.73 },
  { amount: 10, discount: 0.72 },
  { amount: 30, discount: 0.7 },
  { amount: 50, discount: 0.69 },
  { amount: 100, discount: 0.68 },
  { amount: 200, discount: 0.67 },
  { amount: 300, discount: 0.66 },
  { amount: 500, discount: 0.65 },
  { amount: 1000, discount: 0.62 },
  { amount: 2000, discount: 0.6 }
];

// 用户真实用量：188 次请求，347,382 input + 34,421 output，单次平均 2,031 字。
const JUZIAI_USAGE = { input: 347_382, output: 34_421, cacheRead: 0, cacheWrite: 0, requests: 188, images: 0 };

function juziaiSnapshot(items) {
  return normalizePricingPayload({
    success: true,
    usable_group: { default: "默认" },
    group_ratio: { default: 1 },
    data: items
  }, "auto", {});
}

// 按次模型 quota_type=1 时 model_ratio 为 0，金额全在 model_price 上。
const REQUEST_ITEM = { model_name: "[次1]glm-5.2", quota_type: 1, model_ratio: 0, completion_ratio: 1, model_price: 0.02, enable_groups: ["default"] };
const REQUEST_TWIN = { model_name: "[次]gemini-3.1-pro-preview", quota_type: 1, model_ratio: 0, completion_ratio: 1, model_price: 0.08, enable_groups: ["default"] };
const TOKEN_TWIN = { model_name: "[V按量]gemini-3.1-pro-preview", quota_type: 0, model_ratio: 1, completion_ratio: 6, model_price: 0, enable_groups: ["default"] };

function comparisonsFor({ station = {}, items = [REQUEST_ITEM, REQUEST_TWIN, TOKEN_TWIN], usage = JUZIAI_USAGE } = {}) {
  const base = {
    id: "jz",
    name: "橘子站",
    rechargeRate: 1,
    rechargeRateVerified: false,
    priceCurrencyVerified: true,
    rechargeTiers: JUZIAI_TIERS,
    billingProfile: { tokensPerRequest: 2031, source: "manual" },
    ...station
  };
  return buildComparisonRows({
    stations: [base],
    snapshots: [{ stationId: base.id, collectedAt: 1, status: "success", normalized: juziaiSnapshot(items) }],
    references: { models: [{ name: "gemini-3.1-pro-preview", provider: "google", input: 2, output: 12, cacheRead: null }] },
    usage
  });
}

function offerNamed(comparisons, modelName) {
  for (const comparison of comparisons) {
    const offer = comparison.offers.find(entry => entry.modelName === modelName);
    if (offer) return offer;
  }
  return null;
}

test("normalizes recharge plans without turning subscriptions into top-up tiers", () => {
  assert.deepEqual(normalizeRechargePlans([
    { kind: "subscription", amount: 98, credits: 120, currency: "CNY", period: "week", accumulates: false, verified: true },
    { kind: "topup", amount: 500, credits: 500, currency: "USD", discount: 0.88, availability: "manual" },
    { kind: "topup", amount: 0, credits: 10 },
    { kind: "topup", amount: 10, discount: 2 }
  ]), [
    { kind: "subscription", amount: 98, credits: 120, currency: "CNY", availability: "unknown", period: "week", recurring: false, accumulates: false, verified: true },
    { kind: "topup", amount: 500, credits: 500, discount: 0.88, currency: "USD", availability: "manual", recurring: false, accumulates: false, verified: false }
  ]);
});

test("preserves a time condition as a verifiable billing rule", () => {
  const [tier] = parseBillingTiers('(tier("night", p * 3 + c * 9)) * (hour("Asia/Shanghai") >= 22 || hour("Asia/Shanghai") < 8 ? 0.5 : 1)');
  assert.equal(tier.input, 3);
  assert.equal(tier.timeDiscount, 0.5);
  assert.equal(tier.billingConditions[0].type, "time");
  assert.equal(tier.billingConditions[0].fallback_multiplier, 1);
  assert.match(tier.billingConditions[0].expression, /hour\("Asia\/Shanghai"\) >= 22/);
});

test("picks the cheapest single recharge tier that covers the spend", () => {
  assert.equal(resolveRechargeTier([], 100), null);
  assert.equal(resolveRechargeTier(JUZIAI_TIERS, 0), null);
  assert.equal(resolveRechargeTier(JUZIAI_TIERS, -5), null);

  assert.deepEqual(resolveRechargeTier(JUZIAI_TIERS, 1), { amount: 1, discount: 0.75, faceValue: 1, payRmb: 0.75 });
  assert.equal(resolveRechargeTier(JUZIAI_TIERS, 100).amount, 100);
  assert.equal(resolveRechargeTier(JUZIAI_TIERS, 100).payRmb, 68);
  // 需求刚好等于档位边界时落这一档，不往上跳。
  assert.equal(resolveRechargeTier(JUZIAI_TIERS, 200).amount, 200);
  // 需求略超一档时落下一档。
  assert.equal(resolveRechargeTier(JUZIAI_TIERS, 200.01).amount, 300);
  // 超过最大档按最大档折扣，不返回 null。
  const overflow = resolveRechargeTier(JUZIAI_TIERS, 5000);
  assert.equal(overflow.amount, 2000);
  assert.equal(overflow.discount, 0.6);
  assert.equal(overflow.payRmb, 3000);
});

test("drops malformed recharge tiers instead of letting them win the sort", () => {
  const dirty = [
    { amount: 0, discount: 0.5 },
    { amount: -10, discount: 0.5 },
    { amount: 100, discount: 0 },
    { amount: 100, discount: 1.5 },
    { amount: "x", discount: 0.5 },
    null,
    { amount: 100, discount: 0.7 },
    { amount: 100, discount: 0.65 }
  ];
  // 同额度重复时保留先出现的合法项。
  assert.deepEqual(resolveRechargeTier(dirty, 100), { amount: 100, discount: 0.7, faceValue: 100, payRmb: 70 });
  assert.equal(resolveRechargeTier([{ amount: 1, discount: 2 }], 1), null);
});

test("converts a per-request price into a per-million-token price", () => {
  assert.equal(requestUnitPriceOf(0.02, 2031), 20000 / 2031);
  assert.equal(requestUnitPriceOf(0.02, 0), null);
  assert.equal(requestUnitPriceOf(0, 2031), null);
  assert.equal(requestUnitPriceOf(null, 2031), null);
});

test("splits per-request quotes from per-token quotes on juziai pricing", () => {
  const comparisons = comparisonsFor();
  assert.equal(offerNamed(comparisons, "[次1]glm-5.2").billingMode, "request");
  assert.equal(offerNamed(comparisons, "[V按量]gemini-3.1-pro-preview").billingMode, "token");
});

test("folds the per-request price with the station profile instead of the global average", () => {
  const offer = offerNamed(comparisonsFor(), "[次1]glm-5.2");
  assert.equal(offer.tokensPerRequest, 2031);
  // 只有 source === "measured" 才算实测；手填值同样标估算。
  assert.equal(offer.tokensPerRequestEstimated, true);
  assert.ok(Math.abs(offer.requestUnitPrice - 9.85) < 0.01, String(offer.requestUnitPrice));
  // 按次成本摊进 token 分母会污染口径，所以这两个字段对按次报价必须为空。
  assert.equal(offer.blendedUnitPrice, null);
  assert.equal(offer.blendedMix, null);
});

test("falls back to the estimated workload when the station has no profile", () => {
  const offer = offerNamed(comparisonsFor({ station: { billingProfile: { tokensPerRequest: 0, source: "auto" } } }), "[次1]glm-5.2");
  assert.equal(offer.tokensPerRequestEstimated, true);
  // 落到 tokenTotalOf(usage) / usage.requests = 381803 / 188
  assert.ok(Math.abs(offer.tokensPerRequest - 2030.86) < 0.01, String(offer.tokensPerRequest));
});

test("reports the token count at which a per-request model stops being cheaper", () => {
  const comparisons = comparisonsFor();
  const request = offerNamed(comparisons, "[次]gemini-3.1-pro-preview");
  const token = offerNamed(comparisons, "[V按量]gemini-3.1-pro-preview");
  const expected = 0.08 * 1_000_000 / token.blendedUnitPrice;
  assert.ok(Math.abs(request.breakEvenTokens - expected) < 1, `${request.breakEvenTokens} vs ${expected}`);
  // 用户画像 2,031 字/次远低于平衡点，所以按次比按量贵一个量级。
  assert.ok(request.requestUnitPrice / token.blendedUnitPrice > 13);
});

test("leaves the break-even point empty when the comparison has no per-token quote", () => {
  const comparisons = comparisonsFor({ items: [REQUEST_ITEM] });
  assert.equal(comparisons[0].offers[0].breakEvenTokens, null);
});

test("applies the matching recharge discount to the paid monthly cost", () => {
  const offer = offerNamed(comparisonsFor({ usage: { ...JUZIAI_USAGE, requests: 1880 } }), "[次]gemini-3.1-pro-preview");
  assert.ok(Math.abs(offer.monthlyCost - 150.4) < 0.001, String(offer.monthlyCost));
  assert.equal(offer.rechargePlan.amount, 200);
  assert.equal(offer.rechargePlan.discount, 0.67);
  assert.ok(Math.abs(offer.monthlyCostPaid - 100.768) < 0.001, String(offer.monthlyCostPaid));
});

test("keeps the paid cost equal to the monthly cost when no tiers are configured", () => {
  const offer = offerNamed(comparisonsFor({ station: { rechargeTiers: [] } }), "[次]gemini-3.1-pro-preview");
  assert.equal(offer.rechargePlan, null);
  assert.equal(offer.monthlyCostPaid, offer.monthlyCost);
});

test("does not discount twice when the station already folds in a recharge rate", () => {
  // USD 报价 + 已验证的 rechargeRate 0.5：costPrices 已经是实付人民币。
  const offer = offerNamed(comparisonsFor({
    station: { rechargeRate: 0.5, rechargeRateVerified: true, rechargeTiers: [{ amount: 1000, discount: 0.6 }] }
  }), "[次]gemini-3.1-pro-preview");
  assert.ok(Math.abs(offer.monthlyCost - 7.52) < 0.001, String(offer.monthlyCost));
  // 面值 15.04 落最小的 1000 档，折扣作用在面值上：15.04 × 0.6 = 9.024，再乘回 0.5 得人民币 4.512。
  assert.equal(offer.rechargePlan.amount, 1000);
  assert.ok(Math.abs(offer.monthlyCostPaid - 4.512) < 0.001, String(offer.monthlyCostPaid));
});
