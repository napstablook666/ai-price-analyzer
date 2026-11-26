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
test("非字符串与空表达式都退化成空档位，不抛", () => {
  assert.deepEqual(parseBillingTiers(null), []);
  assert.deepEqual(parseBillingTiers("p * 2 + c * 8"), []);
});