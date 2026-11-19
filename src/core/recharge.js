import { normalizeRechargeTiers } from "../shared/recharge-tiers.js";

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

// bulk_topup_discounts 可能是 {面值: 折扣} 对象，也可能是 [{amount, discount}] 数组。
function parseBulkTopupDiscounts(raw) {
  if (Array.isArray(raw)) return normalizeRechargeTiers(raw);
  if (!raw || typeof raw !== "object") return [];
  return normalizeRechargeTiers(
    Object.entries(raw).map(([amount, discount]) => ({ amount: Number(amount), discount: Number(discount) }))
  );
}

// pay_methods 的 type 各家不同（antom / antom_wechat / sunrate / stripe…），
// 统一靠 name+type 的关键字归一，认不出的落 other，不猜。
function channelOfMethod(name, type) {
  const text = `${name} ${type}`.toLowerCase();
  if (text.includes("wechat") || text.includes("微信")) return "wechat";
  if (text.includes("alipay") || text.includes("支付宝")) return "alipay";
  if (text.includes("stripe")) return "stripe";
  if (text.includes("card") || text.includes("visa") || text.includes("union")) return "card";
  if (text.includes("usdt") || text.includes("crypto") || text.includes("trc20") || text.includes("erc20")) return "crypto";
  return "other";
}

function parsePayMethods(raw) {
  if (!Array.isArray(raw)) return [];
  const channels = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const type = String(item.type || "").trim().slice(0, 32);
    const name = String(item.name || "").trim().slice(0, 48);
    if (!type && !name) continue;
    const maxAmount = positiveNumber(item.max_amount);
    channels.push({
      channel: channelOfMethod(name, type),
      type,
      name,
      ...(maxAmount === null ? {} : { maxAmount })
    });
  }
  return channels;
}

// 只从 price 取倍率，original_price 是原价标签，拿它折算会得到「打折前」的假低价。
export function parseRechargeStatus(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const data = body.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : body;
  const rate = plausibleRate(positiveNumber(data.price));
  const tiers = parseBulkTopupDiscounts(data.bulk_topup_discounts);
  const channels = parsePayMethods(data.pay_methods);
  // 没有 price 但带档位/渠道报文时也留证据，rate 留 null 由调用方回退手填值。
  if (rate === null && tiers.length === 0 && channels.length === 0) return null;
  return {
    rate,
    price: rate,
    originalPrice: plausibleRate(positiveNumber(data.original_price)),
    quotaPerUnit: positiveNumber(data.quota_per_unit),
    exchangeRate: positiveNumber(data.usd_exchange_rate),
    tiers,
    channels
  };
}

// 折算率优先级：站点关掉自动采集就是手填值，否则采集值优先，没有采集值才回落到手填值。
// 采集值一定带 source="auto"，因为它是站点自己公布的现价，不需要用户再核验一次。
export function effectiveRecharge(station, snapshot) {
  const manualRate = positiveNumber(station?.rechargeRate);
  const manual = {
    rate: manualRate === null ? 1 : manualRate,
    // 手填值只有被显式核验过才拿来换算；未核验按 1:1，和采集值无关。
    verified: (station?.rechargeRateVerified ?? snapshot?.rechargeRateVerified) === true,
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
    ...(Array.isArray(collected.tiers) && collected.tiers.length ? { tiers: collected.tiers } : {}),
    ...(Array.isArray(collected.channels) && collected.channels.length ? { channels: collected.channels } : {}),
    collectedAt: Number.isFinite(Number(collected.collectedAt)) ? Number(collected.collectedAt) : null
  };
}

