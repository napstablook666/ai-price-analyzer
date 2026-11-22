// 收银台报价：把「收银台看到的应付金额」落成结构化证据。
// 只做清洗，不参与 rechargeTiers 的落档。折算率由计算层用 paidRmb / faceAmount 得出。
const PAYMENT_CHANNELS = new Set(["wechat", "alipay", "card", "stripe", "crypto", "other"]);
const PAYMENT_CURRENCIES = new Set(["CNY", "USD", "CREDITS"]);
const PAYMENT_STATUSES = new Set(["pending", "paid", "expired", "cancelled", "failed"]);

export function normalizeRechargePayments(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const payments = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const faceAmount = Number(raw.faceAmount);
    if (!Number.isFinite(faceAmount) || faceAmount <= 0) continue;
    const payAmount = Number(raw.payAmount);
    if (!Number.isFinite(payAmount) || payAmount <= 0) continue;
    const channelRaw = String(raw.channel || "").trim().toLowerCase();
    if (!PAYMENT_CHANNELS.has(channelRaw)) continue;
    const currencyRaw = String(raw.currency || "").trim().toUpperCase();
    const statusRaw = String(raw.status || "").trim().toLowerCase();
    if (statusRaw && !PAYMENT_STATUSES.has(statusRaw)) continue;
    if (!PAYMENT_CURRENCIES.has(currencyRaw)) continue;
    // CNY 收银台金额本身就是人民币；USD / CREDITS 只有显式给了 paidRmb 才认，不猜汇率。
    const explicit = Number(raw.paidRmb);
    const paidRmb = statusRaw && statusRaw !== "paid"
      ? null
      : Number.isFinite(explicit) && explicit > 0
        ? explicit
        : currencyRaw === "CNY" ? payAmount : null;
    const key = `${channelRaw}:${faceAmount.toFixed(6)}:${currencyRaw}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const feeRate = Number(raw.feeRate);
    const at = String(raw.at || "").trim().slice(0, 32);
    const note = String(raw.note || "").trim().slice(0, 240);
    payments.push({
      channel: channelRaw,
      faceAmount,
      payAmount,
      currency: currencyRaw,
      paidRmb: paidRmb === null ? null : Math.round(paidRmb * 100) / 100,
      ...(statusRaw ? { status: statusRaw } : {}),
      ...(Number.isFinite(feeRate) && feeRate >= 0 && feeRate < 1 ? { feeRate } : {}),
      ...(at ? { at } : {}),
      ...(note ? { note } : {})
    });
  }
  return payments.sort((left, right) => left.channel.localeCompare(right.channel) || left.faceAmount - right.faceAmount);
}

// 每 1 额度实付多少人民币。拿不到 paidRmb 的条目（USD/CREDITS 且没显式折算）不参与。
export function rechargePaymentRate(payment) {
  const faceAmount = Number(payment?.faceAmount);
  const status = String(payment?.status || "").trim().toLowerCase();
  if (status && status !== "paid") return null;
  const paidRmb = Number(payment?.paidRmb);
  if (!Number.isFinite(faceAmount) || faceAmount <= 0) return null;
  if (!Number.isFinite(paidRmb) || paidRmb <= 0) return null;
  return paidRmb / faceAmount;
}

// 取折算率最低的一条：用户会挑最便宜的渠道充。并列时按 normalize 后的顺序取第一条。
export function cheapestRechargePayment(payments) {
  if (!Array.isArray(payments)) return null;
  let best = null;
  let bestRate = Infinity;
  for (const payment of payments) {
    const rate = rechargePaymentRate(payment);
    if (rate === null || rate >= bestRate) continue;
    best = payment;
    bestRate = rate;
  }
  return best;
}

// 展示用：有可折算条目就按「你实际会买的那一档」取一条，没有就取面值最大的一条当证据。
// 档位按「不高于月消耗的最大面值」挑，和 resolveRechargeTier 的「买覆盖消耗的那档」同向。
// 面值都比月消耗大时取最小面值：宁可高估成本，也不拿大额档的低价冒充日常价。
// 后者不参与排序，只让「已经点过收银台」这件事在界面上看得见。
export function representativeRechargePayment(payments, faceSpend = null) {
  if (!Array.isArray(payments)) return null;
  const spend = Number(faceSpend);
  const payable = spend > 0 ? payableAtSpend(payments, spend) : cheapestRechargePayment(payments);
  if (payable) return payable;
  let best = null;
  for (const payment of payments) {
    if (!best || payment.faceAmount > best.faceAmount) best = payment;
  }
  return best;
}

// 月消耗对应哪个面值的收银台证据：取不高于它的最大面值，全比它大就退回最小面值。
function payableAtSpend(payments, spend) {
  const payable = payments.filter(payment => rechargePaymentRate(payment) !== null);
  if (!payable.length) return null;
  const faces = payable.map(payment => Number(payment.faceAmount));
  const affordable = payable.filter(payment => Number(payment.faceAmount) <= spend);
  const target = affordable.length
    ? Math.max(...affordable.map(payment => Number(payment.faceAmount)))
    : Math.min(...faces);
  return cheapestRechargePayment(payable.filter(payment => Number(payment.faceAmount) === target));
}
