export function formatSourcePrice(value, currency = "UNKNOWN", precision = 4) {
  const number = Number(value);
  if (value === null || value === undefined || !Number.isFinite(number)) return "—";
  const code = String(currency || "UNKNOWN").toUpperCase();
  const symbol = code === "USD" ? "$" : code === "CNY" ? "¥" : code === "CREDITS" ? "" : `${code} `;
  const rounded = Number(number.toFixed(precision));
  return `${symbol}${rounded}`;
}

// 官方价和中转价已折算到同一口径，同项直接比大小就能判断贵贱。
// 用 0.5% 的相对容差吸收四舍五入，避免 0.0700 与 0.0701 被判成涨了。
const PRICE_TONE_TOLERANCE = 0.005;
function priceTone(relayValue, officialValue) {
  if (relayValue === null || relayValue === undefined || officialValue === null || officialValue === undefined) return "neutral";
  const relay = Number(relayValue);
  const official = Number(officialValue);
  if (!Number.isFinite(relay) || !Number.isFinite(official) || official <= 0) return "neutral";
  const ratio = relay / official;
  if (Math.abs(ratio - 1) <= PRICE_TONE_TOLERANCE) return "neutral";
  return ratio > 1 ? "up" : "down";
}
// 估算值是拿输入价兜底出来的，拿它和官方价比没有意义，一律不上色。
export function priceEntryTone(entry) {
  if (!entry.official || !entry.relay || entry.official.estimated || entry.relay.estimated) return "neutral";
  return priceTone(entry.relay.value, entry.official.value);
}
export function dashboardPriceLines(prices = {}, row = {}, official = false) {
  const readEstimated = official ? prices.cacheRead === null || prices.cacheRead === undefined : row.cacheReadEstimated;
  const writeEstimated = official ? prices.cacheWrite === null || prices.cacheWrite === undefined : row.cacheWriteEstimated;
  return [
    ["输入", prices.input, false],
    ["输出", prices.output, false],
    [`缓存读${readEstimated ? "（估算）" : ""}`, prices.cacheRead ?? prices.input, false],
    [`缓存写${writeEstimated ? "（估算）" : ""}`, prices.cacheWrite ?? prices.input, false],
    ...(prices.cacheWrite1h === null || prices.cacheWrite1h === undefined ? [] : [["缓存写入（1h）", prices.cacheWrite1h, false]]),
    ...(prices.request === null || prices.request === undefined ? [] : [["按次", prices.request, false]])
  ];
}
