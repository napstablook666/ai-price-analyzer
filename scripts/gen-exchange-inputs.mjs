// 给 exchange-rate-rs 生成真实输入用例：设置模式 × 缓存状态 × 日期新鲜度。
// 用法：node scripts/gen-exchange-inputs.mjs && rust-anything record rust/exchange-rate-rs --inputs rust/exchange-rate-rs/cases-inputs.jsonl
import { writeFileSync } from "node:fs";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-11-24T12:00:00Z");
const today = new Date(NOW).toISOString().slice(0, 10);
const fresh = (extra = {}) => ({ exchangeRate: 6.69198, exchangeRateSource: "ExchangeRate-API", exchangeRateDate: today, exchangeRateFetchedAt: NOW - 60 * 60 * 1000, ...extra });
const cases = [
  [{ exchangeRateMode: "auto" }, fresh()],
  [{ exchangeRateMode: "auto" }, fresh({ warnings: [] })],
  [{ exchangeRateMode: "auto" }, fresh({ warnings: ["其他警告"] })],
  [{ exchangeRateMode: "auto" }, fresh({ warnings: ["汇率缓存超过 7 天，已刷新"] })],
  [{ exchangeRateMode: "auto" }, fresh({ exchangeRateFetchedAt: NOW - 3 * DAY })],
  [{ exchangeRateMode: "auto" }, fresh({ exchangeRateFetchedAt: 0 })],
  [{ exchangeRateMode: "auto" }, fresh({ exchangeRateDate: "2026-11-10" })],
  [{ exchangeRateMode: "auto" }, fresh({ exchangeRateDate: "" })],
  [{ exchangeRateMode: "auto" }, fresh({ exchangeRateDate: "abc" })],
  [{ exchangeRateMode: "auto" }, fresh({ exchangeRateDate: "2026-13-40" })],
  [{ exchangeRateMode: "auto" }, fresh({ exchangeRateSource: "" })],
  [{ exchangeRateMode: "auto" }, fresh({ exchangeRate: 0 })],
  [{ exchangeRateMode: "auto" }, fresh({ exchangeRate: -1 })],
  [{ exchangeRateMode: "auto" }, fresh({ exchangeRate: "7.3" })],
  [{ exchangeRateMode: "auto" }, fresh({ exchangeRate: null })],
  [{ exchangeRateMode: "manual", exchangeRate: 6.71849 }, fresh()],
  [{ exchangeRateMode: "manual", exchangeRate: 0 }, fresh()],
  [{ exchangeRateMode: "manual", exchangeRate: "6.7" }, fresh()],
  [{ exchangeRateMode: "manual" }, {}],
  [{ exchangeRateMode: "auto" }, {}],
  [{ exchangeRateMode: "auto", exchangeRate: 6.5 }, {}],
  [{}, {}],
  [null, fresh()],
  [{ exchangeRateMode: "auto" }, null],
  [{ exchangeRateMode: "auto" }, fresh({ warnings: "not-an-array" })],
  [{ exchangeRateMode: "auto" }, fresh({ exchangeRateFetchedAt: NOW - 2 * DAY })],
  [{ exchangeRateMode: "auto" }, fresh({ exchangeRateFetchedAt: NOW - 2 * DAY - 1 })],
  [{ exchangeRateMode: "auto" }, fresh({ exchangeRateDate: "2026-11-17" })],
  [{ exchangeRateMode: "auto" }, fresh({ exchangeRateDate: "2026-11-16" })]
];
const rows = cases.map(([settings, references]) => ({ fn: "exchangeRateInfo", args: [settings, references, NOW] }));
// now 省略 / undefined：默认值走 Date.now()，两边都用当前时间，只要差值落在同一档。
rows.push({ fn: "exchangeRateInfo", args: [{ exchangeRateMode: "auto" }, fresh({ exchangeRateDate: "2000-01-01", exchangeRateFetchedAt: 1 }), null] });
writeFileSync(new URL("../rust/exchange-rate-rs/cases-inputs.jsonl", import.meta.url), rows.map(row => JSON.stringify(row)).join("\n") + "\n");
console.log(`rows ${rows.length}`);
