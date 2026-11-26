// billing-tiers-rs 与 JS 侧的对照：Rust 里那份 SYSTEM_BASE_PRICE_PER_1M 必须与 src/shared/schema.js 一致，
// 否则 ratio 会整体偏移。两份常量没法靠编译期检查，就用这里钉住。
import assert from "node:assert/strict";
import test from "node:test";

import { SYSTEM_BASE_PRICE_PER_1M } from "../src/shared/schema.js";
import { parseBillingTiers } from "../src/core/billing-tiers.js";

test("Rust 里的基准价等于 schema 的 SYSTEM_BASE_PRICE_PER_1M", () => {
  const [tier] = parseBillingTiers("tier('standard', p * 1)");
  assert.equal(tier.ratio, 1 / SYSTEM_BASE_PRICE_PER_1M);
});

test("三档单位与区间都从 Rust 侧回来，按次档带 request 而不是 fixed 之外的猜测", () => {
  const tiers = parseBillingTiers(
    'len <= 100000 ? tier("short", p * 2 + c * 6) : tier("long", p * 4 + c * 12)'
  );
  assert.deepEqual(
    tiers.map(tier => [tier.name, tier.minTokens, tier.maxTokens, tier.maxInclusive]),
    [
      ["short", 0, 100000, true],
      ["long", 100001, null, true]
    ]
  );
  const perCall = parseBillingTiers('tier("image", fixed(0.05)) * image_count');
  assert.equal(perCall[0].unit, "image");
  assert.equal(perCall[0].fixed, 0.05);
  assert.equal(perCall[0].request, undefined);
});

test("单数 token 关键字与括号后空格的行为跟 JS 正则一致（40e50fe 口径）", () => {
  const bounded = parseBillingTiers(' token  >= 100000 ? tier("a", p*2) : tier("b", p)');
  assert.deepEqual(
    bounded.map(tier => [tier.name, tier.minTokens, tier.maxTokens]),
    [["b", 0, 99999], ["a", 100000, null]]
  );
  assert.equal(parseBillingTiers('tier("a", fixed( 0.05 ))')[0].fixed, 0.05);
  assert.equal(parseBillingTiers("tier(\"a\", u( 'seconds' )*2)")[0].unit, "second");
});

test("骨架趟写入 Infinity 的档位在最终排序垫底（区间重排与 JS 一致）", () => {
  const tiers = parseBillingTiers(
    'len >= 0 ? tier("s", p*1) : input_tokens <= 500000 ? tier("m", p*2) : tier("z", p*4)'
  );
  assert.deepEqual(tiers.map(tier => tier.name), ["s", "z", "m"]);
  assert.deepEqual(tiers.map(tier => tier.minTokens), [0, null, Infinity]);
});

test("负零系数被归一成 +0：JS 的 `|| 0` 吃 falsy，端口照做", () => {
  const tiers = parseBillingTiers('tier("t", p*2 - cc*0)');
  assert.equal(tiers[0].billing.cacheWrite, 0);
  assert.equal(Object.is(tiers[0].billing.cacheWrite, -0), false);
  const three = parseBillingTiers('tier("t", p*2 + -0*cc + -0*cr + -0*cc1h)');
  for (const key of ["cacheWrite", "cacheRead", "cacheWrite1h"]) {
    assert.equal(Object.is(three[0].billing[key], -0), false, key);
  }
});

test("倍率不认前导小数点，其余几处照旧认（40e50fe 的正则口径）", () => {
  const bare = parseBillingTiers('tier("t", p*2) * (hour() ? .5 : 1)');
  assert.equal(bare[0].billingConditions, undefined);
  assert.deepEqual(parseBillingTiers('tier("t", p*2) * (hour() ? 0.5 : 1)')[0].billingConditions, [
    { type: "time", expression: "hour()", multiplier: 0.5, fallback_multiplier: 1 }
  ]);
  assert.equal(parseBillingTiers('tier("t", fixed(.5))')[0].fixed, 0.5);
  assert.equal(parseBillingTiers('tier("t", u("seconds") * .5)')[0].unit, "second");
  assert.equal(parseBillingTiers('tier("t", p*.5)')[0].input, 0.5);
  // 边界与倍率同形态：`len <= .5` 两边都不认，区间留空。
  assert.deepEqual(
    parseBillingTiers('len <= .5 ? tier("a", p*2) : tier("b", p*3)').map(tier => tier.minTokens),
    [null, null]
  );
  assert.deepEqual(
    parseBillingTiers('len <= 5.5 ? tier("a", p*2) : tier("b", p*3)').map(tier => [
      tier.minTokens,
      tier.maxTokens
    ]),
    [
      [0, 5.5],
      [6.5, null]
    ]
  );
});
test("非字符串与空表达式都退化成空档位，不抛", () => {
  assert.deepEqual(parseBillingTiers(null), []);
  assert.deepEqual(parseBillingTiers("p * 2 + c * 8"), []);
});