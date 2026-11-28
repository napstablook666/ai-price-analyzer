import test from "node:test";
import assert from "node:assert/strict";
import {
  KEEPALIVE_DEFAULTS,
  applyKeepaliveResult,
  authConfirmedFromRenewal,
  dueStationIds,
  keepaliveAlarmName,
  keepaliveSlotOffset,
  planKeepalive,
  planKeepaliveSweeps,
  resolveSweepStationIds
} from "../src/core/auth-keepalive.js";

const HOUR = 60 * 60 * 1000;
const NOW = 1800000000000;

test("按 expiresAt 提前 margin 排期，不是按采集轮次", () => {
  const plans = planKeepalive(["cun", "dstopology", "yuki"].map(stationId => ({ stationId, expiresAt: NOW + 6 * HOUR })), NOW);
  // 动手点只能落在「到期前 margin」到「到期」之间：早于 margin 是白叫醒，晚于到期是续死令牌。
  const marginStart = NOW + 6 * HOUR - KEEPALIVE_DEFAULTS.marginMs;
  for (const plan of plans) {
    assert.ok(plan.when >= marginStart, `${plan.stationId} 早了 ${Math.round((marginStart - plan.when) / 60000)} 分钟`);
    assert.ok(plan.when < NOW + 6 * HOUR, `${plan.stationId} 排到过期之后`);
    assert.equal(plan.delayMs, plan.when - NOW);
    assert.equal(plan.attempt, 0);
  }
  // 同刻到期的站不落在同一秒，错峰还在。
  assert.ok(new Set(plans.map(plan => plan.when)).size >= 2, "同刻到期的站全挤在同一秒");
});

test("续期一圈回来不会再退化成每分钟一次", () => {
  // 真跑出来过的 bug：目标点是「expiresAt - margin」这种绝对时间戳，令牌续上之后下一拍
  // 算出来还停在过去，被钳成 now+1min，于是 60 秒一圈，永远不收敛。
  for (const [stationId, ttlMs] of [["cun", 30 * 60 * 1000], ["yuki", 11 * 60 * 1000], ["dstopology", 6 * HOUR]]) {
    let now = NOW;
    let expiresAt = NOW + ttlMs;
    let lastCheckedAt = null;
    for (let round = 0; round < 6; round += 1) {
      const plan = planKeepalive([{ stationId, expiresAt, status: "ok", lastCheckedAt }], now)[0];
      assert.ok(plan.delayMs >= KEEPALIVE_DEFAULTS.minDelayMs, `${stationId} 第 ${round + 1} 圈只隔了 ${Math.round(plan.delayMs / 1000)} 秒`);
      if (round > 0) {
        // 刚查过的站不许比去重窗口更早醒：这就是「每分钟续一次」的防线。
        assert.ok(
          plan.delayMs >= KEEPALIVE_DEFAULTS.checkWindowMs,
          `${stationId} 第 ${round + 1} 圈只隔了 ${Math.round(plan.delayMs / 1000)} 秒`
        );
      }
      now = plan.when;
      lastCheckedAt = now;
      // 执行器的行为：剩余寿命进 margin 就真续一次，续完又是一条完整 TTL。
      if (expiresAt - now <= KEEPALIVE_DEFAULTS.marginMs) expiresAt = now + ttlMs;
    }
  }
});

test("短命令牌不会被错峰推到过期之后", () => {
  // 这是改前的真 bug：cun 的槽位 9.42h，令牌只活 6h 的时候排期落到过期后 3 小时，
  // 醒过来续的是一个已经死了的令牌。
  for (const stationId of ["cun", "dstopology", "yuki", "stellaisle-carpool", "fastaitoken", "clawcn", "killai", "sccx"]) {
    const expiresAt = NOW + 30 * 60 * 1000;
    const plan = planKeepalive([{ stationId, expiresAt }], NOW)[0];
    assert.ok(
      plan.when <= expiresAt,
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

test("没检查过的无过期时间站尽快探一次，检查过才退到慢档", () => {
  const fastRoom = KEEPALIVE_DEFAULTS.minDelayMs + KEEPALIVE_DEFAULTS.expiredStaggerMs;
  // 浏览器很少连开 23 小时：排到 maxDelayMs 的这一拍永远轮不到，站就一直是「从未续期」。
  const fresh = planKeepalive([{ stationId: "yuki", expiresAt: null }], NOW)[0];
  assert.ok(fresh.when >= NOW + KEEPALIVE_DEFAULTS.minDelayMs, "不能比 minDelay 还早");
  assert.ok(fresh.when <= NOW + fastRoom, `首次探活排到 ${Math.round((fresh.when - NOW) / 60000)} 分钟`);

  // 探过还是拿不到过期时间：退到慢档，不能每 15 分钟锤一遍。
  const checked = planKeepalive([{ stationId: "yuki", expiresAt: null, lastCheckedAt: NOW - 60 * 1000 }], NOW)[0];
  assert.ok(checked.when >= NOW + KEEPALIVE_DEFAULTS.slowPathMs, "刚检查过的站不该再来一次");
  assert.ok(checked.when <= NOW + KEEPALIVE_DEFAULTS.maxDelayMs, "慢档也不能超出一天");

  // 老仓没有 lastCheckedAt，退回 lastRenewedAt。
  const legacy = planKeepalive([{ stationId: "yuki", expiresAt: null, lastRenewedAt: NOW - 60 * 1000 }], NOW)[0];
  assert.equal(legacy.when, checked.when);

  // 距离上次检查超过慢档间隔，重新进快档。
  const aged = planKeepalive([{ stationId: "yuki", expiresAt: null, lastCheckedAt: NOW - 7 * HOUR }], NOW)[0];
  assert.ok(aged.when <= NOW + fastRoom, "隔了一天还排到慢档等于放弃这个站");
});

test("料到期的站也按上次检查时间分档，不出现每分钟一次的回环", () => {
  // 4 分钟 TTL 之类拿不到过期时间的站，若每轮都进快档，1min 就会被反复叫醒。
  const justChecked = planKeepalive([{ stationId: "hepingan", expiresAt: null, lastCheckedAt: NOW - 1000 }], NOW)[0];
  assert.ok(justChecked.delayMs >= KEEPALIVE_DEFAULTS.slowPathMs, `续期回环：${Math.round(justChecked.delayMs / 60000)} 分钟`);

  // 已经过期、但刚查过的站：令牌是死的，不能推到 6 小时后的慢档，也不能一分钟后再醒。
  const expiredButJustChecked = planKeepalive([{ stationId: "hepingan", expiresAt: NOW - HOUR, lastCheckedAt: NOW - 1000 }], NOW)[0];
  assert.ok(
    expiredButJustChecked.delayMs >= KEEPALIVE_DEFAULTS.checkWindowMs,
    `过期站回环：${Math.round(expiredButJustChecked.delayMs / 60000)} 分钟`
  );
  assert.ok(
    expiredButJustChecked.delayMs < KEEPALIVE_DEFAULTS.slowPathMs,
    `过期站被推到慢档，死令牌要等 ${Math.round(expiredButJustChecked.delayMs / 60000)} 分钟`
  );
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

test("启动只挑现在就该动手的站，退避中和刚查过的不掺和", () => {
  const base = { status: "unknown", expiresAt: null, renewFailures: 0, lastCheckedAt: null, renewalKind: "cookie" };
  const entries = [
    // 从没查过：快档，开机就试。
    { ...base, stationId: "never-checked" },
    // 状态 ok 但没有过期时间，上次检查是 7 小时前：该重新探了。
    { ...base, stationId: "probe-again", status: "ok", lastCheckedAt: NOW - 7 * HOUR },
    // 上次检查是 1 分钟前（比如刚才开机试过）：这一轮跳过。
    { ...base, stationId: "just-checked", status: "ok", lastCheckedAt: NOW - 60 * 1000 },
    // expiresAt 减去 margin 已经到点：临期，要续。
    { ...base, stationId: "expiring", status: "ok", expiresAt: NOW + 5 * 60 * 1000 },
    // 已经过期：要续。
    { ...base, stationId: "expired", status: "ok", expiresAt: NOW - HOUR },
    // 还剩 20 小时、刚查过 3 小时前：不该在开机时吵它。
    { ...base, stationId: "healthy", status: "ok", expiresAt: NOW + 20 * HOUR, lastCheckedAt: NOW - 3 * HOUR },
    // 有失败记录：退避归 alarm 管，别把退避打穿。
    { ...base, stationId: "backing-off", status: "unknown", renewFailures: 2 },
    // 用户自己粘的长效令牌：不用动。
    { ...base, stationId: "manual", renewalKind: "manual-token" },
    // 脏数据不该让整条链挂掉。
    { ...base, stationId: "" },
    null
  ];

  assert.deepEqual(dueStationIds(entries, NOW), ["never-checked", "probe-again", "expiring", "expired"]);
  // 全部刚查过的时候返回空，调用方据此跳过整轮（也就不会每 5 分钟白扫一遍）。
  assert.deepEqual(dueStationIds([{ ...base, stationId: "x", lastCheckedAt: NOW - 60 * 1000 }], NOW), []);
  // 页面刚续过（只写 lastRenewedAt，不动 lastCheckedAt）：开机这一拍不该再续一遍。
  assert.deepEqual(dueStationIds([{ ...base, stationId: "just-renewed", status: "ok", lastRenewedAt: NOW - 60 * 1000 }], NOW), []);
  assert.deepEqual(dueStationIds(undefined, NOW), []);
});
