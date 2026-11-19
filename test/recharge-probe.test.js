import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  channelFor,
  parseArgs,
  mergePayments,
  readNewApiTopupInfo,
  readNewApiTopupOrders,
  readSub2Checkout,
  readSub2Orders
} from "../scripts/recharge-probe.mjs";


test("recharge probe CLI requires explicit developer and target scope", () => {
  assert.deepEqual(parseArgs([]), { developer: false, all: false, hosts: [], ids: [], help: false });
  assert.deepEqual(parseArgs(["--developer", "--id", "openlux"]), {
    developer: true, all: false, hosts: [], ids: ["openlux"], help: false
  });
  assert.deepEqual(parseArgs(["--developer", "--from-plugins"]), {
    developer: true, all: true, hosts: [], ids: [], help: false
  });
});

test("recharge probe CLI refuses normal-user and unscoped invocation", () => {
  const script = fileURLToPath(new URL("../scripts/recharge-probe.mjs", import.meta.url));
  const normalUser = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(normalUser.status, 2);
  assert.match(normalUser.stderr, /开发者维护操作/);

  const unscopedDeveloper = spawnSync(process.execPath, [script, "--developer"], { encoding: "utf8" });
  assert.equal(unscopedDeveloper.status, 2);
  assert.match(unscopedDeveloper.stderr, /--id.*--host/);
});
// 以下响应体取自 2026-11-19 的实测（stelleaisle / jiji），字段名不要美化。

const stellaisleInfo = {
  data: {
    amount_bonus: { 100: 2, 200: 5, 500: 12, 1000: 25, 2000: 50 },
    amount_options: [10, 20, 50, 100, 200, 500],
    cny_per_usd: 7.3,
    min_topup: 10,
    pay_methods: [
      { type: "alipay", name: "支付宝（推荐）", min_topup: "10" },
      { type: "wxpay", name: "微信充值", fee_rate: "1" }
    ],
    enable_online_topup: true,
    recharge_notice: "充 {{amount}} 元到账 {{credited}} 元，已含活动优惠。"
  }
};

const stellaisleOrders = {
  data: {
    items: [
      {
        id: 587,
        amount: 1000,
        money: 1010,
        expected_payment_amount_minor: 101000,
        expected_payment_currency: "CNY",
        payment_method: "wxpay",
        payment_fee: 10,
        status: "pending",
        create_time: 1763596800
      },
      {
        id: 589,
        amount: 1000,
        money: 1000,
        expected_payment_amount_minor: 100000,
        expected_payment_currency: "CNY",
        payment_method: "alipay",
        payment_fee: 0,
        status: "pending",
        create_time: 1763596800
      }
    ]
  }
};

const jijiCheckout = {
  data: {
    methods: {
      alipay: { label: "支付宝", currency: "CNY", fee_rate: 0, single_min: 5, single_max: 2000 },
      stripe: { label: "Stripe", currency: "CNY", fee_rate: 0, single_min: 50, single_max: 5000 },
      wxpay: { label: "微信支付", currency: "CNY", fee_rate: 0, single_min: 5, single_max: 1000 }
    },
    recharge_fee_rate: 0,
    global_min: 5,
    help_text: "充值最低 ¥5 起，Stripe ¥50 起"
  }
};

const jijiOrders = {
  data: {
    items: [
      {
        id: "94feed89",
        amount: 100,
        pay_amount: 100,
        currency: "CNY",
        payment_type: "alipay",
        status: "EXPIRED",
        created_at: "2026-11-18T12:00:00Z"
      }
    ]
  }
};

test("reads the new-api topup info: bonus tiers, channels, and the percent fee rate", () => {
  const topup = readNewApiTopupInfo(stellaisleInfo);
  assert.equal(topup.backend, "new-api");
  assert.deepEqual(topup.bonusTiers, [
    { amount: 100, bonus: 2 },
    { amount: 200, bonus: 5 },
    { amount: 500, bonus: 12 },
    { amount: 1000, bonus: 25 },
    { amount: 2000, bonus: 50 }
  ]);
  const wxpay = topup.channels.find(channel => channel.type === "wxpay");
  // fee_rate 是百分比："1" 是 1%，不能当 100%。
  assert.equal(wxpay.feeRate, 0.01);
  const alipay = topup.channels.find(channel => channel.type === "alipay");
  assert.equal(alipay.feeRate, undefined);
  assert.equal(alipay.minAmount, 10);
  assert.equal(topup.minAmount, 10);
  assert.equal(topup.notice, "充 {{amount}} 元到账 {{credited}} 元，已含活动优惠。");
});

test("reads new-api orders as counter payments, minor units divided by 100", () => {
  const payments = readNewApiTopupOrders(stellaisleOrders);
  assert.equal(payments.length, 2);
  const wxpay = payments.find(payment => payment.channel === "wechat");
  assert.equal(wxpay.faceAmount, 1000);
  assert.equal(wxpay.payAmount, 1010);
  assert.equal(wxpay.currency, "CNY");
  assert.equal(wxpay.feeRate, 0.0099); // 10 / 1010 四舍五入到四位
  assert.equal(wxpay.at, "2025-11-20");
  assert.match(wxpay.note, /订单 587/);
  const alipay = payments.find(payment => payment.channel === "alipay");
  assert.equal(alipay.payAmount, 1000);
  assert.equal(alipay.feeRate, undefined);
});

test("returns null instead of guessing when the topup payload has no data", () => {
  assert.equal(readNewApiTopupInfo({ success: false, message: "未登录" }), null);
  assert.equal(readSub2Checkout({ code: 401 }), null);
});

test("reads the sub2api checkout info: currencies, minimums, and bonus tiers", () => {
  const topup = readSub2Checkout(jijiCheckout);
  assert.equal(topup.backend, "sub2api");
  assert.equal(topup.channels.length, 3);
  const stripe = topup.channels.find(channel => channel.type === "stripe");
  assert.equal(stripe.channel, "stripe");
  assert.equal(stripe.currency, "CNY");
  assert.equal(stripe.minAmount, 50);
  assert.equal(topup.helpText, "充值最低 ¥5 起，Stripe ¥50 起");
});

test("reads sub2api bonus tiers declared as an array of single-key objects", () => {
  const topup = readSub2Checkout({
    data: { methods: {}, recharge_bonus_tiers: [{ 50: 0.1 }, { 200: 0.15 }, { 500: 0.2 }] }
  });
  assert.deepEqual(topup.bonusTiers, [
    { amount: 50, bonusRate: 0.1 },
    { amount: 200, bonusRate: 0.15 },
    { amount: 500, bonusRate: 0.2 }
  ]);
});

test("reads sub2api orders, keeping pay_amount as the counter amount", () => {
  const [payment] = readSub2Orders(jijiOrders);
  assert.equal(payment.channel, "alipay");
  assert.equal(payment.faceAmount, 100);
  assert.equal(payment.payAmount, 100);
  assert.equal(payment.currency, "CNY");
  assert.equal(payment.at, "2026-11-18");
});

test("merges auto payments under a manual entry with the same channel and face value", () => {
  const manual = [{ channel: "alipay", faceAmount: 1000, payAmount: 1000, currency: "CNY", note: "手填" }];
  const auto = [
    { channel: "alipay", faceAmount: 1000, payAmount: 1010, currency: "CNY", note: "订单 587 wxpay" },
    { channel: "wechat", faceAmount: 10, payAmount: 10.1, currency: "CNY", note: "订单 586 wxpay" }
  ];
  const merged = mergePayments(manual, auto);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].note, "手填");
  assert.equal(merged[1].channel, "wechat");
});

test("refreshes a previous order entry instead of keeping the stale amount", () => {
  const previous = [
    { channel: "alipay", faceAmount: 300, payAmount: 291, currency: "USD", note: "订单 9001 antom pending" },
    { channel: "card", faceAmount: 300, payAmount: 291, currency: "USD", note: "用户截图" }
  ];
  const fresh = [
    { channel: "alipay", faceAmount: 300, payAmount: 288, currency: "USD", note: "订单 9002 antom paid" },
    { channel: "card", faceAmount: 300, payAmount: 297, currency: "USD", note: "订单 9003 antom paid" }
  ];
  const merged = mergePayments(previous, fresh);
  assert.equal(merged.length, 2);
  // 上一轮脚本写的订单条目让新数据顶掉
  assert.equal(merged[0].payAmount, 288);
  // 手抄的截图优先于订单接口
  assert.equal(merged[1].payAmount, 291);
  assert.equal(merged[1].note, "用户截图");
});

test("keeps every previous entry when this run has no fresh payments", () => {
  const previous = [
    { channel: "alipay", faceAmount: 10, payAmount: 10, currency: "CNY", note: "订单 585 alipay paid" },
    { channel: "wechat", faceAmount: 10, payAmount: 10.1, currency: "CNY", note: "订单 586 wxpay paid" }
  ];
  assert.deepEqual(mergePayments(previous, []), previous);
});

test("maps provider type names onto the six payment channels", () => {
  assert.equal(channelFor("antom_wechat"), "wechat");
  assert.equal(channelFor("wxpay"), "wechat");
  assert.equal(channelFor("alipay"), "alipay");
  assert.equal(channelFor("antom"), "card");
  assert.equal(channelFor("stripe"), "stripe");
  assert.equal(channelFor("ccpayment"), "crypto");
  assert.equal(channelFor("paypal"), "other");
  assert.equal(channelFor(""), "other");
});
