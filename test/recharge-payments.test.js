import test from "node:test";
import assert from "node:assert/strict";
import { cheapestRechargePayment, normalizeRechargePayments, rechargePaymentRate, representativeRechargePayment } from "../src/shared/recharge-payments.js";
import { renderBlock, upsertBlock } from "../scripts/recharge-apply.mjs";

test("derives the rmb amount for CNY payments and leaves foreign currency alone", () => {
  const payments = normalizeRechargePayments([
    { channel: "alipay", faceAmount: 300, payAmount: 2083, currency: "CNY" },
    { channel: "card", faceAmount: 300, payAmount: 291, currency: "USD" }
  ]);
  assert.equal(payments.length, 2);
  const alipay = payments.find(payment => payment.channel === "alipay");
  const card = payments.find(payment => payment.channel === "card");
  assert.equal(alipay.paidRmb, 2083);
  assert.equal(card.paidRmb, null);
  assert.equal(rechargePaymentRate(alipay), 2083 / 300);
  assert.equal(rechargePaymentRate(card), null);
});

test("ignores a pending checkout quote when deriving the recharge rate", () => {
  const [payment] = normalizeRechargePayments([
    { channel: "alipay", faceAmount: 1, payAmount: 0.75, currency: "CNY", status: "pending", paidRmb: 0.75 }
  ]);
  assert.equal(payment.status, "pending");
  assert.equal(payment.paidRmb, null);
  assert.equal(rechargePaymentRate(payment), null);
  assert.equal(cheapestRechargePayment([payment]), null);
});

test("keeps an explicit conversion for foreign currency payments", () => {
  const [payment] = normalizeRechargePayments([
    { channel: "card", faceAmount: 300, payAmount: 291, currency: "USD", paidRmb: 1946 }
  ]);
  assert.equal(payment.paidRmb, 1946);
  assert.equal(rechargePaymentRate(payment), 1946 / 300);
});

test("drops entries with an unknown channel, currency, or non-positive amount", () => {
  assert.deepEqual(normalizeRechargePayments([
    { channel: "paypal", faceAmount: 10, payAmount: 10, currency: "USD" },
    { channel: "alipay", faceAmount: 10, payAmount: 10, currency: "EUR" },
    { channel: "alipay", faceAmount: 0, payAmount: 10, currency: "CNY" },
    { channel: "alipay", faceAmount: 10, payAmount: -1, currency: "CNY" }
  ]), []);
  assert.deepEqual(normalizeRechargePayments("nope"), []);
  assert.deepEqual(normalizeRechargePayments([null, [], 1]), []);
});

test("keeps one row per channel and face value", () => {
  const payments = normalizeRechargePayments([
    { channel: "alipay", faceAmount: 10, payAmount: 9.9, currency: "USD" },
    { channel: "alipay", faceAmount: 10, payAmount: 9.8, currency: "USD" }
  ]);
  assert.equal(payments.length, 1);
  assert.equal(payments[0].payAmount, 9.9);
});

test("cheapestRechargePayment skips rows without an rmb amount", () => {
  const payments = normalizeRechargePayments([
    { channel: "card", faceAmount: 300, payAmount: 291, currency: "USD" },
    { channel: "alipay", faceAmount: 300, payAmount: 2083, currency: "CNY" },
    { channel: "wechat", faceAmount: 100, payAmount: 660, currency: "CNY" }
  ]);
  assert.equal(cheapestRechargePayment(payments).channel, "wechat");
  assert.equal(cheapestRechargePayment([]), null);
  assert.equal(cheapestRechargePayment(null), null);
});

test("renders a marker block that survives a second run", () => {
  const record = {
    collectedAt: "2026-11-19T06:01:12.861Z",
    payments: [{ channel: "alipay", faceAmount: 300, payAmount: 291, currency: "USD", paidRmb: 1946.13, note: "收银台 $291.00" }]
  };
  const block = renderBlock(record);
  assert.ok(block.startsWith("  // >>> recharge-probe"), block);
  assert.ok(block.includes('channel: "alipay"'), block);
  assert.ok(block.includes("paidRmb: 1946.13"), block);
  assert.ok(block.includes('at: "2026-11-19"'), block);
  assert.ok(block.includes('note: "收银台 $291.00"'), block);

  const source = 'const preset = {\n  id: "openlux",\n};\n';
  const once = upsertBlock(source, block);
  assert.ok(once.startsWith('const preset = {\n  // >>> recharge-probe'), once);
  assert.ok(once.includes('  // <<< recharge-probe\n  id: "openlux"'), once);
  assert.equal(upsertBlock(once, block), once);
});

test("skips a record without payments and a file without a preset", () => {
  assert.equal(renderBlock({ payments: [] }), null);
  assert.equal(renderBlock({}), null);
  const block = renderBlock({ payments: [{ channel: "alipay", faceAmount: 10, payAmount: 10, currency: "CNY" }] });
  assert.equal(upsertBlock("export const x = 1;\n", block), null);
});

test("picks the face value you would actually buy instead of the cheapest large face", () => {
  const payments = normalizeRechargePayments([
    { channel: "card", faceAmount: 300, payAmount: 291, currency: "USD", paidRmb: 1946.07 },
    { channel: "alipay", faceAmount: 10, payAmount: 9.9, currency: "USD", paidRmb: 66.21 }
  ]);
  // 月消耗不到最小面值时按最小面值算：$300 档的 0.97 不能拿来冒充日常价。
  assert.equal(representativeRechargePayment(payments, 5).faceAmount, 10);
  assert.equal(representativeRechargePayment(payments, 10).faceAmount, 10);
  // 消耗跨过 300 才用大额档。
  assert.equal(representativeRechargePayment(payments, 320).faceAmount, 300);
  // 不给消耗时退回最便宜的一条。
  assert.equal(representativeRechargePayment(payments).faceAmount, 300);
});

test("fills paidRmb from the station's usd rate and keeps an explicit value", () => {
  const block = renderBlock({
    collectedAt: "2026-11-19T06:00:00.000Z",
    status: { parsed: { exchangeRate: 6.68752 } },
    payments: [
      { channel: "alipay", faceAmount: 10, payAmount: 9.9, currency: "USD" },
      { channel: "card", faceAmount: 300, payAmount: 291, currency: "USD", paidRmb: 1900 }
    ]
  });
  assert.ok(block.includes("paidRmb: 66.21"), block);
  assert.ok(block.includes("paidRmb: 1900"), block);
  // 站点没报汇率就不折，宁可这条不参与折算。
  const bare = renderBlock({ payments: [{ channel: "card", faceAmount: 10, payAmount: 9, currency: "USD" }] });
  assert.ok(!bare.includes("paidRmb"), bare);
});
