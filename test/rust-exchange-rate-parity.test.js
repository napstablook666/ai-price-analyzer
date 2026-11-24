// exchange-rate-rs 与 JS 侧的对照：Rust 里那份 DEFAULT_EXCHANGE_RATE 必须与 src/shared/schema.js 一致，
// 否则回落档会静默用错汇率。两份常量没法靠编译期检查，就用这里钉住。
import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_EXCHANGE_RATE } from "../src/shared/schema.js";
import { exchangeRateInfo } from "../src/core/exchange-rate.js";

test("Rust 回落档用的汇率等于 schema 里的 DEFAULT_EXCHANGE_RATE", () => {
  const fallback = exchangeRateInfo({}, {});
  assert.equal(fallback.mode, "fallback");
  assert.equal(fallback.rate, DEFAULT_EXCHANGE_RATE);
});

test("手动档优先于缓存，且不做数值校验以外的转换", () => {
  const manual = exchangeRateInfo({ exchangeRateMode: "manual", exchangeRate: 6.71849 }, { exchangeRate: 6.69 });
  assert.deepEqual(manual, { rate: 6.71849, mode: "manual", source: "手动指定", date: "", warning: "" });
});

test("缓存超过两天没更新会带出待更新提示", () => {
  const now = Date.parse("2026-11-24T12:00:00Z");
  const fresh = exchangeRateInfo(
    { exchangeRateMode: "auto" },
    { exchangeRate: 6.69198, exchangeRateSource: "ExchangeRate-API", exchangeRateDate: "2026-11-24", exchangeRateFetchedAt: now - 60 * 1000 },
    now
  );
  assert.equal(fresh.warning, "");
  const stale = exchangeRateInfo(
    { exchangeRateMode: "auto" },
    { exchangeRate: 6.69198, exchangeRateSource: "ExchangeRate-API", exchangeRateDate: "2026-11-24", exchangeRateFetchedAt: now - 3 * 86400000 },
    now
  );
  assert.equal(stale.warning, "汇率缓存待更新，当前沿用上次成功值");
});

test("显式传 null 的设置与源码一样抛 TypeError，不是退回默认值", () => {
  assert.throws(() => exchangeRateInfo(null, {}), /Cannot read properties of null \(reading 'exchangeRateMode'\)/);
  assert.throws(() => exchangeRateInfo({}, null), /Cannot read properties of null \(reading 'exchangeRate'\)/);
});
