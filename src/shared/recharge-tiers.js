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
