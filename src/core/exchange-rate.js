import { DEFAULT_EXCHANGE_RATE } from "../shared/schema.js";
import { withReferenceDeadline } from "./reference-request.js";

const DAY = 24 * 60 * 60 * 1000;
const SOURCES = [
  {
    name: "ExchangeRate-API",
    url: "https://open.er-api.com/v6/latest/USD",
    parse: json => ({
      valid: json?.result === "success" && json.base_code === "USD",
      rate: json?.rates?.CNY,
      date: Number.isFinite(json?.time_last_update_unix) ? new Date(json.time_last_update_unix * 1000).toISOString().slice(0, 10) : ""
    })
  },
  {
    name: "Frankfurter / ECB",
    url: "https://api.frankfurter.dev/v1/latest?base=USD&symbols=CNY",
    parse: json => ({ valid: json?.base === "USD" && json.amount === 1, rate: json?.rates?.CNY, date: json?.date })
  }
];

function positiveRate(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export async function fetchExchangeRate({ fetchImpl = fetch, signal, now = Date.now(), timeoutMs = 3500 } = {}) {
  const errors = [];
  for (const source of SOURCES) {
    try {
      return await withReferenceDeadline(source.name, timeoutMs, signal, async requestSignal => {
        const response = await fetchImpl(source.url, { signal: requestSignal, cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const quote = source.parse(await response.json());
        const dateMs = /^\d{4}-\d{2}-\d{2}$/.test(quote.date || "") ? Date.parse(`${quote.date}T00:00:00Z`) : NaN;
        if (!quote.valid || !positiveRate(quote.rate) || !Number.isFinite(dateMs) || new Date(dateMs).toISOString().slice(0, 10) !== quote.date || dateMs > now + DAY || now - dateMs > 7 * DAY) {
          throw new Error("报价币种、数值或日期无效");
        }
        return { exchangeRate: quote.rate, exchangeRateSource: source.name, exchangeRateDate: quote.date, exchangeRateFetchedAt: now };
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      errors.push(`${source.name}: ${error.message}`);
    }
  }
  throw new Error(`汇率更新失败（${errors.join("；")}）`);
}

export function exchangeRateInfo(settings = {}, references = {}, now = Date.now()) {
  if (settings.exchangeRateMode === "manual" && positiveRate(settings.exchangeRate)) {
    return { rate: settings.exchangeRate, mode: "manual", source: "手动指定", date: "", warning: "" };
  }
  const rate = references.exchangeRate;
  const source = references.exchangeRateSource || "历史缓存（来源未记录）";
  const date = references.exchangeRateDate || "";
  const rateWarning = (references.warnings || []).find(warning => warning.startsWith("汇率")) || "";
  if (!positiveRate(rate)) return { rate: DEFAULT_EXCHANGE_RATE, mode: "fallback", source: "应急估算", date: "", warning: "尚无可用参考汇率，暂用估算值，请刷新或手动指定" };
  const stale = !date || !references.exchangeRateFetchedAt || now - references.exchangeRateFetchedAt > 2 * DAY || now - Date.parse(`${date}T00:00:00Z`) > 7 * DAY;
  return { rate, mode: "auto", source, date, warning: rateWarning || (stale ? "汇率缓存待更新，当前沿用上次成功值" : "") };
}
