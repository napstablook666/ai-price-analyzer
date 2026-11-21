import test from "node:test";
import assert from "node:assert/strict";
import { compileTimeWindow, isUsageTimeProfile, shareOfTiers, shareOfWindow, timeSelectorOf } from "../src/core/time-window.js";
import { getTierShares } from "../src/core/pricing.js";
import { normalizeSettings } from "../src/shared/schema.js";

// spiderai 的时段窗口：工作日 9-12、14-18，一周 35 小时。
const SPIDERAI_PEAK = 'weekday("Asia/Shanghai") >= 1 && weekday("Asia/Shanghai") <= 5 && ((hour("Asia/Shanghai") >= 9 && hour("Asia/Shanghai") < 12) || (hour("Asia/Shanghai") >= 14 && hour("Asia/Shanghai") < 18))';
const WEEK = 168;

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);

test("窗口表达式按周表求值：工作日窗口均匀负荷是 35/168", () => {
  close(shareOfWindow(SPIDERAI_PEAK, "uniform"), 35 / WEEK);
});

test("换负荷曲线，同一个窗口的占比跟着变", () => {
  // 只在工作日 9-18 用：窗口外只有 12-14 这两小时，一周 45 个使用小时里占 35。
  close(shareOfWindow(SPIDERAI_PEAK, "workday"), 35 / 45);
  // 夜里跑批：整周都不在窗口内。
  close(shareOfWindow(SPIDERAI_PEAK, "night"), 0);
});

test("取反的窗口与正窗口互补", () => {
  const peak = shareOfWindow(SPIDERAI_PEAK, "uniform");
  const off = shareOfWindow(`!(${SPIDERAI_PEAK})`, "uniform");
  close(peak + off, 1);
});

test("超出解析范围或写坏的表达式返回 null，不猜语义", () => {
  assert.equal(compileTimeWindow('minute("Asia/Shanghai") > 5'), null);
  assert.equal(compileTimeWindow('hour("Asia/Shanghai") * 2 > 3'), null);
  assert.equal(compileTimeWindow('hour("Asia/Shanghai"'), null);
  assert.equal(compileTimeWindow('month("Asia/Shanghai") == 1'), null);
  assert.equal(shareOfWindow(""), null);
});

test("只有不带倍率的时段条件算选档，带倍率的是打折条件", () => {
  assert.equal(timeSelectorOf({ billing_conditions: [{ type: "time", expression: SPIDERAI_PEAK }] }), SPIDERAI_PEAK);
  assert.equal(timeSelectorOf({ billing_conditions: [{ type: "time", expression: SPIDERAI_PEAK, multiplier: 2 }] }), null);
  assert.equal(timeSelectorOf({ billing_conditions: [{ type: "context", expression: "len > 100" }] }), null);
});

test("两档报价按窗口重叠加权，加回 1", () => {
  const shares = shareOfTiers([
    { tier_name: "高峰时段", billing_conditions: [{ type: "time", expression: SPIDERAI_PEAK }] },
    { tier_name: "空闲时段", billing_conditions: [{ type: "time", expression: `!(${SPIDERAI_PEAK})` }] }
  ], "uniform");
  close(shares[0], 35 / WEEK);
  close(shares[1], 133 / WEEK);
});

test("缺一档窗口时整组不算，别用半组数据凑比例", () => {
  assert.equal(shareOfTiers([
    { tier_name: "高峰时段", billing_conditions: [{ type: "time", expression: SPIDERAI_PEAK }] },
    { tier_name: "空闲时段" }
  ], "uniform"), null);
});

test("getTierShares：有窗口按窗口算，没窗口按档位名 + 标量", () => {
  const tiered = [
    { tier_name: "高峰时段", billing_conditions: [{ type: "time", expression: SPIDERAI_PEAK }] },
    { tier_name: "空闲时段", billing_conditions: [{ type: "time", expression: `!(${SPIDERAI_PEAK})` }] }
  ];
  // 标量给 0.5 也不影响：窗口算得出来就不用手填。
  close(getTierShares(tiered, { peakShare: 0.5, profile: "uniform" })[0], 35 / WEEK);
  const named = [{ tier_name: "高峰时段 2倍" }, { tier_name: "空闲时段" }];
  assert.deepEqual(getTierShares(named, { peakShare: 0.25 }), [0.25, 0.75]);
  assert.deepEqual(getTierShares(named, 0.4), [0.4, 0.6]);
  assert.deepEqual(getTierShares([{ tier_name: "单档" }]), [1]);
});

test("设置里只接受已知的负荷曲线", () => {
  assert.equal(normalizeSettings({ usage: { timeProfile: "workday", input: 1 } }).usage.timeProfile, "workday");
  assert.equal(normalizeSettings({ usage: { timeProfile: "bogus" } }).usage.timeProfile, "uniform");
  assert.equal(normalizeSettings({}).usage.timeProfile, "uniform");
  assert.equal(isUsageTimeProfile("night"), true);
  assert.equal(isUsageTimeProfile("Night"), false);
});