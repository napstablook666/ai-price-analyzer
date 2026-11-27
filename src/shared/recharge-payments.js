import * as rust from "./rust-shim.js";

// 收银台报价：把「收银台看到的应付金额」落成结构化证据。
// 只做清洗，不参与 rechargeTiers 的落档。折算率由计算层用 paidRmb / faceAmount 得出。
export function normalizeRechargePayments(input) {
  return rust.normalizeRechargePayments(input);
}

// 每 1 额度实付多少人民币。拿不到 paidRmb 的条目（USD/CREDITS 且没显式折算）不参与。
export function rechargePaymentRate(payment) {
  return rust.rechargePaymentRate(payment);
}

// 取折算率最低的一条：用户会挑最便宜的渠道充。并列时按 normalize 后的顺序取第一条。
export function cheapestRechargePayment(payments) {
  return rust.cheapestRechargePayment(payments);
}

// 展示用：有可折算条目就按「你实际会买的那一档」取一条，没有就取面值最大的一条当证据。
// 档位按「不高于月消耗的最大面值」挑，和 resolveRechargeTier 的「买覆盖消耗的那档」同向。
// 面值都比月消耗大时取最小面值：宁可高估成本，也不拿大额档的低价冒充日常价。
// 后者不参与排序，只让「已经点过收银台」这件事在界面上看得见。
export function representativeRechargePayment(payments, faceSpend = null) {
  return rust.representativeRechargePayment(payments, faceSpend);
}
