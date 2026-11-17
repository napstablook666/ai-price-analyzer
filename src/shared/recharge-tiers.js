// 充值档位：额度升序去重，折扣必须在 (0,1]。空数组表示不建模折扣。
// 放在叶子模块里，避免 declarative-plugin 与 schema 互相 import 形成循环。
export function normalizeRechargeTiers(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const tiers = [];
  for (const raw of input) {
    const amount = Number(raw?.amount);
    const discount = Number(raw?.discount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if (!Number.isFinite(discount) || discount <= 0 || discount > 1) continue;
    const key = amount.toFixed(6);
    if (seen.has(key)) continue;
    seen.add(key);
    tiers.push({ amount, discount });
  }
  return tiers.sort((left, right) => left.amount - right.amount);
}

const PLAN_KINDS = new Set(["topup", "subscription", "carpool", "manual"]);
const PLAN_AVAILABILITIES = new Set(["self_service", "manual", "unknown"]);
const PLAN_CURRENCIES = new Set(["CNY", "USD", "CREDITS"]);

// 充值方案是展示/追溯元数据，不参与 rechargeTiers 的自动落档计算。
// 这样「需管理员处理」和「按周刷新订阅」不会被误当成永久充值折扣。
export function normalizeRechargePlans(input) {
  if (!Array.isArray(input)) return [];
  const plans = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const amount = Number(raw.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const credits = Number(raw.credits);
    const discount = raw.discount === undefined || raw.discount === null || raw.discount === ""
      ? null
      : Number(raw.discount);
    if (discount !== null && (!Number.isFinite(discount) || discount <= 0 || discount > 1)) continue;
    const currency = PLAN_CURRENCIES.has(String(raw.currency || "").trim().toUpperCase())
      ? String(raw.currency).trim().toUpperCase()
      : "CNY";
    const kind = PLAN_KINDS.has(raw.kind) ? raw.kind : "topup";
    const availability = PLAN_AVAILABILITIES.has(raw.availability) ? raw.availability : "unknown";
    const period = String(raw.period || "").trim().slice(0, 32);
    const note = String(raw.note || "").trim().slice(0, 240);
    plans.push({
      kind,
      amount,
      ...(Number.isFinite(credits) && credits > 0 ? { credits } : {}),
      ...(discount === null ? {} : { discount }),
      currency,
      availability,
      ...(period ? { period } : {}),
      recurring: raw.recurring === true,
      accumulates: raw.accumulates === true,
      verified: raw.verified === true,
      ...(note ? { note } : {})
    });
  }
  return plans;
}
