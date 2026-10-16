export function formatSourcePrice(value, currency = "UNKNOWN", precision = 4) {
  const number = Number(value);
  if (value === null || value === undefined || !Number.isFinite(number)) return "—";
  const code = String(currency || "UNKNOWN").toUpperCase();
  const symbol = code === "USD" ? "$" : code === "CNY" ? "¥" : `${code} `;
  const rounded = Number(number.toFixed(precision));
  return `${symbol}${rounded}`;
}

export function dashboardPriceLines(prices = {}, row = {}, official = false) {
  const readEstimated = official ? prices.cacheRead === null || prices.cacheRead === undefined : row.cacheReadEstimated;
  const writeEstimated = official ? prices.cacheWrite === null || prices.cacheWrite === undefined : row.cacheWriteEstimated;
  return [
    ["输入", prices.input, false],
    ...(prices.imageInput === null || prices.imageInput === undefined ? [] : [["图像输入 token", prices.imageInput, true]]),
    ["输出", prices.output, false],
    [`缓存读${readEstimated ? "（估算）" : ""}`, prices.cacheRead ?? prices.input, false],
    [`缓存写${writeEstimated ? "（估算）" : ""}`, prices.cacheWrite ?? prices.input, false],
    ...(prices.cacheWrite1h === null || prices.cacheWrite1h === undefined ? [] : [["缓存写入（1h）", prices.cacheWrite1h, false]]),
    ...(prices.request === null || prices.request === undefined ? [] : [["按次", prices.request, false]]),
    ...(prices.imageOutput === null || prices.imageOutput === undefined ? [] : [["图 token", prices.imageOutput, true]]),
    ...(prices.imagePrice === null || prices.imagePrice === undefined ? [] : [["图 / 张", prices.imagePrice, true]])
  ];
}
