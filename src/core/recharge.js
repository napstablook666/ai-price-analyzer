// 站点公开的 /api/status 里有 New API 的充值口径：price 是「1 美元面值卖多少人民币」。
// relayrouter 已核实过：price=1 表示 1 美元额度 = 1 元；同报文里的 usd_exchange_rate
// 只用于把人民币金额显示成美元，不参与扣费折算，所以折算只认 price。
export const RECHARGE_STATUS_ENDPOINT = "/api/status";

// 免费站会写 0，异常站可能给负数或离谱值；这些都不该拿来换算人民币。
const RECHARGE_RATE_MIN = 0.05;
const RECHARGE_RATE_MAX = 100;

function positiveNumber(value) {
  if (value === null || value === undefined || typeof value === "boolean") return null;
  if (typeof value === "object") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function plausibleRate(value) {
  return value !== null && value >= RECHARGE_RATE_MIN && value <= RECHARGE_RATE_MAX ? value : null;
}

// 只从 price 取倍率，original_price 是原价标签，拿它折算会得到「打折前」的假低价。
export function parseRechargeStatus(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : body;
  const rate = plausibleRate(positiveNumber(data.price));
  if (rate === null) return null;
  return {
    rate,
    price: rate,
    originalPrice: plausibleRate(positiveNumber(data.original_price)),
    quotaPerUnit: positiveNumber(data.quota_per_unit),
    exchangeRate: positiveNumber(data.usd_exchange_rate)
  };
}

// 折算率优先级：站点关掉自动采集就是手填值，否则采集值优先，没有采集值才回落到手填值。
// 采集值一定带 source="auto"，因为它是站点自己公布的现价，不需要用户再核验一次。
export function effectiveRecharge(station, snapshot) {
  const manualRate = positiveNumber(station?.rechargeRate);
  const manual = {
    rate: manualRate === null ? 1 : manualRate,
    verified: station?.rechargeRateVerified !== false,
    source: "manual"
  };
  if (station?.rechargeAuto === false) return manual;
  const collected = snapshot?.recharge;
  const collectedRate = positiveNumber(collected?.rate);
  if (collected?.source !== "auto" || collectedRate === null) return manual;
  return {
    rate: collectedRate,
    verified: true,
    source: "auto",
    collectedAt: Number.isFinite(Number(collected.collectedAt)) ? Number(collected.collectedAt) : null
  };
}

export function rechargeSourceLabel(recharge) {
  if (recharge?.source === "auto") {
    const at = Number(recharge.collectedAt);
    return Number.isFinite(at) && at > 0 ? `自动采集（${new Date(at).toLocaleString("zh-CN", { hour12: false })}）` : "自动采集";
  }
  return recharge?.verified === false ? "手填（未核验）" : "手填";
}
