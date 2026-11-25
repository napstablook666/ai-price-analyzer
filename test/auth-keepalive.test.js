import test from "node:test";
import assert from "node:assert/strict";
import {
  KEEPALIVE_DEFAULTS,
  applyKeepaliveResult,
  authConfirmedFromRenewal,
  keepaliveAlarmName,
  keepaliveSlotOffset,
  planKeepalive,
  planKeepaliveSweeps,
  resolveSweepStationIds
} from "../src/core/auth-keepalive.js";

const HOUR = 60 * 60 * 1000;
const NOW = 1800000000000;

test("按 expiresAt 提前 margin 排期，不是按采集轮次", () => {
  const plans = planKeepalive([{ stationId: "cun", expiresAt: NOW + 6 * HOUR }], NOW);
  assert.equal(plans.length, 1);
  // 槽位最大 23h55m，比「令牌还剩多久」还长，所以窗口更窄时按窗口取模，
  // 排期只能落在「现在」到「临期前 margin」之间。
  const window = NOW + 6 * HOUR - KEEPALIVE_DEFAULTS.marginMs - (NOW + KEEPALIVE_DEFAULTS.minDelayMs);
  const expected = NOW + 6 * HOUR - KEEPALIVE_DEFAULTS.marginMs - (keepaliveSlotOffset("cun") % window);
  assert.equal(plans[0].when, expected);
  assert.equal(plans[0].delayMs, expected - NOW);
  assert.equal(plans[0].attempt, 0);
});

test("短命令牌不会被错峰推到过期之后", () => {
  // 这是改前的真 bug：cun 的槽位 9.42h，令牌只活 6h 的时候排期落到过期后 3 小时，
  // 醒过来续的是一个已经死了的令牌。
  for (const stationId of ["cun", "dstopology", "yuki", "stellaisle-carpool", "fastaitoken", "clawcn", "killai", "sccx"]) {
    const expiresAt = NOW + 30 * 60 * 1000;
    const plan = planKeepalive([{ stationId, expiresAt }], NOW)[0];
    assert.ok(
      plan.when <= expiresAt - KEEPALIVE_DEFAULTS.marginMs,
      `${stationId} 排到 ${Math.round((plan.when - NOW) / 60000)} 分钟，过期点是 ${(expiresAt - NOW) / 60000} 分钟`
    );
  }
});

test("同一站点每次算到同一槽，不同站点摊开在不同槽", () => {
  assert.equal(keepaliveSlotOffset("cun"), keepaliveSlotOffset("cun"));
  const slots = new Set(["cun", "dstopology", "yuki", "stellaisle-carpool", "fastaitoken", "clawcn", "killai", "sccx"].map(id => keepaliveSlotOffset(id)));
  assert.ok(slots.size >= 4, `槽位过于集中：${[...slots].join(",")}`);
  const maxOffset = (KEEPALIVE_DEFAULTS.slotsPerDay - 1) * KEEPALIVE_DEFAULTS.slotMs;
  for (const offset of slots) assert.ok(offset >= 0 && offset <= maxOffset);
});

test("失败按次数指数退避，封顶 maxBackoffMs", () => {
  const first = planKeepalive([{ stationId: "cun", expiresAt: NOW + 6 * HOUR, renewFailures: 1 }], NOW)[0];
  const second = planKeepalive([{ stationId: "cun", expiresAt: NOW + 6 * HOUR, renewFailures: 2 }], NOW)[0];
  const many = planKeepalive([{ stationId: "cun", expiresAt: NOW + 6 * HOUR, renewFailures: 12 }], NOW)[0];
  assert.equal(first.when, NOW + KEEPALIVE_DEFAULTS.backoffBaseMs);
  assert.equal(second.when, NOW + KEEPALIVE_DEFAULTS.backoffBaseMs * 2);
  assert.equal(many.when, NOW + KEEPALIVE_DEFAULTS.maxBackoffMs);
});

test("没有过期时间的站按最长间隔排，不会立刻醒", () => {
  const plan = planKeepalive([{ stationId: "yuki", expiresAt: null }], NOW)[0];
  assert.equal(plan.when, NOW + KEEPALIVE_DEFAULTS.maxDelayMs);
});

test("已经过期的站尽快动手，且散在 15 分钟内不堆在一起", () => {
  const plans = ["cun", "yuki", "fastaitoken"].map(stationId =>
    planKeepalive([{ stationId, expiresAt: NOW - 5 * HOUR }], NOW)[0]
  );
  for (const plan of plans) {
    assert.ok(plan.when >= NOW + KEEPALIVE_DEFAULTS.minDelayMs, `${plan.stationId} 比 minDelay 还早`);
    assert.ok(plan.when <= NOW + KEEPALIVE_DEFAULTS.minDelayMs + KEEPALIVE_DEFAULTS.expiredStaggerMs, `${plan.stationId} 被推得太远`);
  }
  assert.ok(new Set(plans.map(plan => plan.when)).size >= 2, "过期站全挤在同一刻");
});

test("manual-token 与空 id 不进排期", () => {
  const plans = planKeepalive(
    [
      { stationId: "fastaitoken", expiresAt: NOW + HOUR, renewalKind: "manual-token" },
      { stationId: "", expiresAt: NOW + HOUR },
      { stationId: "cun", expiresAt: NOW + HOUR, renewalKind: "cookie" }
    ],
    NOW
  );
  assert.deepEqual(plans.map(plan => plan.stationId), ["cun"]);
});

test("多站按时间排序，同刻按站点名排序，结果稳定", () => {
  const entries = [
    { stationId: "b", expiresAt: NOW + 3 * HOUR },
    { stationId: "a", expiresAt: NOW + 3 * HOUR },
    { stationId: "c", expiresAt: NOW + HOUR }
  ];
  const plans = planKeepalive(entries, NOW);
  const times = plans.map(plan => plan.when);
  assert.deepEqual(times, [...times].sort((left, right) => left - right));
  assert.deepEqual(planKeepalive(entries, NOW), plans);
});

test("排期落在一天之内，不会无限推远", () => {
  const plan = planKeepalive([{ stationId: "cun", expiresAt: NOW + 30 * 24 * HOUR }], NOW)[0];
  assert.equal(plan.when, NOW + KEEPALIVE_DEFAULTS.maxDelayMs);
});

test("alarm 名字带上站点，互不覆盖", () => {
  assert.equal(keepaliveAlarmName("cun"), "auth-keepalive:cun");
  assert.notEqual(keepaliveAlarmName("cun"), keepaliveAlarmName("yuki"));
});

test("成功清零退避并记续期时间", () => {
  const patch = applyKeepaliveResult({ renewFailures: 5, status: "needsLogin" }, true, NOW);
  assert.deepEqual(patch, { status: "ok", renewFailures: 0, lastRenewedAt: NOW });
});

test("失败没到阈值只是 unknown，够次数才转 needsLogin", () => {
  assert.deepEqual(applyKeepaliveResult({ renewFailures: 0 }, false, NOW), { status: "unknown", renewFailures: 1 });
  assert.deepEqual(applyKeepaliveResult({ renewFailures: 1 }, false, NOW), { status: "unknown", renewFailures: 2 });
  assert.deepEqual(applyKeepaliveResult({ renewFailures: 2 }, false, NOW), { status: "needsLogin", renewFailures: 3 });
});
test("批次的名单在排期当时就定下来，站点掉出排期也不会把别的站挤进这一批", () => {
  const plans = Array.from({ length: 505 }, (_, index) => ({
    stationId: `site-${String(index).padStart(3, "0")}`,
    when: NOW + index * 60 * 1000
  }));
  const sweeps = planKeepaliveSweeps(plans, { alarmLimit: 480, sweepSize: 20 });
  assert.deepEqual(sweeps.map(sweep => sweep.name), ["auth-keepalive:sweep:0", "auth-keepalive:sweep:1"]);
  assert.deepEqual(sweeps[0].stationIds, plans.slice(480, 500).map(plan => plan.stationId));
  assert.deepEqual(sweeps[1].stationIds, plans.slice(500, 505).map(plan => plan.stationId));
  assert.equal(sweeps[0].when, plans[480].when);

  // 掉一个站之后重排，第二批整体前移一格；名单如果跟着现算，被推出尾巴的 site-504 就再也醒不过来。
  const shrunk = planKeepaliveSweeps(plans.slice(0, 504), { alarmLimit: 480, sweepSize: 20 });
  assert.deepEqual(shrunk[1].stationIds, plans.slice(500, 504).map(plan => plan.stationId));
  assert.ok(!shrunk[1].stationIds.includes("site-504"));
  // 这正是当初存名单的理由：alarm 上挂的是排期那一刻的站点，不是「第几批」。
  assert.ok(sweeps[1].stationIds.includes("site-504"));
  assert.equal(shrunk[1].stationIds.length, 4);
});

test("没有过期时间的 ok 不算「登录态还活着」，除非是用户自己粘的长效令牌", () => {
  assert.equal(authConfirmedFromRenewal({ status: "ok", expiresAt: null }, "", NOW), false);
  assert.equal(authConfirmedFromRenewal({ status: "ok", expiresAt: null }, "cookie", NOW), false);
  assert.equal(authConfirmedFromRenewal({ status: "ok", expiresAt: null }, "session-probe", NOW), false);
  assert.equal(authConfirmedFromRenewal({ status: "ok", expiresAt: null }, "manual-token", NOW), true);
  assert.equal(authConfirmedFromRenewal({ status: "ok", expiresAt: NOW + HOUR }, "cookie", NOW), true);
  assert.equal(authConfirmedFromRenewal({ status: "ok", expiresAt: NOW - 1 }, "cookie", NOW), false);
  assert.equal(authConfirmedFromRenewal({ status: "needsLogin", expiresAt: NOW + HOUR }, "cookie", NOW), false);
  assert.equal(authConfirmedFromRenewal({ status: "unknown", expiresAt: NOW + HOUR }, "manual-token", NOW), false);
});

test("批次按名单叫醒，不按「第几批」现算：排期挪动不会漏站也不会提前叫醒", () => {
  const plans = Array.from({ length: 505 }, (_, index) => ({
    stationId: `site-${String(index).padStart(3, "0")}`,
    when: NOW + index * 60 * 1000
  }));
  const roster = {};
  for (const sweep of planKeepaliveSweeps(plans, { alarmLimit: 480, sweepSize: 20 })) roster[sweep.name] = sweep.stationIds;

  // 排期变了：site-490 掉了，后面全体前移一格。
  const drifted = plans.filter(plan => plan.stationId !== "site-490");
  const name = "auth-keepalive:sweep:1";
  const ids = resolveSweepStationIds(roster, name, drifted, { alarmLimit: 480, sweepSize: 20 });
  // 名单里原本是 500..504，按现算应该是 499..503。
  assert.deepEqual(ids, plans.slice(500, 505).map(plan => plan.stationId));
  assert.ok(ids.includes("site-504"), "被推到尾巴的站不能丢");
  assert.ok(!ids.includes("site-499"), "没到点的站不能被提前叫醒");

  // 名单丢了就退回当前排期，不能因为读不到存储就不续期。
  assert.deepEqual(
    resolveSweepStationIds({}, name, drifted, { alarmLimit: 480, sweepSize: 20 }),
    drifted.slice(500, 505).map(plan => plan.stationId)
  );
});
