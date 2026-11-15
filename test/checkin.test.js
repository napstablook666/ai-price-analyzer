import test from "node:test";
import assert from "node:assert/strict";
import { checkinPresetFromSpec, checkinPresetsFromSpecs, matchCheckinPreset, normalizeCheckinRecord, normalizeCheckinSession, performCheckin } from "../src/core/checkin.js";
import { normalizePluginSpec } from "../src/core/declarative-plugin.js";
import { PLUGIN_REGISTRY_SNAPSHOT } from "../src/site-plugins/registry-snapshot.js";

const vyceaiStation = { id: "s1", name: "Vyce AI", baseUrl: "https://vyceai.com/dashboard-v2" };
// 签到适配来自插件仓库里的签到插件，测试直接吃随扩展发布的那份 JSON 规格
const CHECKIN_SPEC = normalizePluginSpec(PLUGIN_REGISTRY_SNAPSHOT.plugins.find(entry => entry.kind === "checkin"));
const CHECKIN_PRESETS = checkinPresetsFromSpecs([CHECKIN_SPEC]);
const PRESET = CHECKIN_PRESETS[0];

const jsonResponse = body => ({
  ok: true,
  status: 200,
  headers: { get: () => "application/json" },
  json: async () => body
});

test("matches check-in presets by host", () => {
  assert.equal(matchCheckinPreset(vyceaiStation, CHECKIN_PRESETS)?.id, "site-checkin");
  assert.equal(matchCheckinPreset({ baseUrl: "https://www.vyceai.com/" }, CHECKIN_PRESETS)?.id, "site-checkin");
  assert.equal(matchCheckinPreset({ baseUrl: "https://api.vyceai.com/x" }, CHECKIN_PRESETS)?.id, "site-checkin");
  assert.equal(matchCheckinPreset({ baseUrl: "https://vyceai.com.evil.example/" }, CHECKIN_PRESETS), null);
  assert.equal(matchCheckinPreset({ baseUrl: "https://example.com/" }, CHECKIN_PRESETS), null);
  assert.equal(matchCheckinPreset({}, CHECKIN_PRESETS), null);
  assert.equal(matchCheckinPreset({ baseUrl: "not-a-url" }, CHECKIN_PRESETS), null);
});

test("normalizes check-in records", () => {
  const record = normalizeCheckinRecord({ lastClaimedAt: "100", streak: "3", rewardAmount: "0.5", autoEnabled: 1 });
  assert.equal(record.lastClaimedAt, 100);
  assert.equal(record.streak, 3);
  assert.equal(record.rewardAmount, 0.5);
  assert.equal(record.autoEnabled, true);
  const empty = normalizeCheckinRecord({});
  assert.equal(empty.lastStatus, "idle");
  assert.equal(empty.streak, 0);
  assert.equal(empty.rewardAmount, null);
});

test("performs check-in when the API reports canClaim", async () => {
  const calls = [];
  let statusCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: String(options.method || "GET"), headers: options.headers });
    if (String(url).endsWith("/user/daily-reward")) {
      const status = statusCalls++ === 0
        ? { canClaim: true, streak: 4, streakBonusPercent: 10, rewardAmount: 0.2, totalClaimed: 12, lastClaim: "2026-09-30" }
        : { canClaim: false, streak: 5, streakBonusPercent: 10, rewardAmount: 0.2, totalClaimed: 12, lastClaim: "2026-09-30" };
      return jsonResponse(status);
    }
    if (String(url).endsWith("/user/daily-reward/claim")) return jsonResponse({ amount: 0.22, streak: 5 });
    return jsonResponse({ error: { message: "unexpected" } });
  };
  try {
    const result = await performCheckin({ station: vyceaiStation, preset: PRESET, claim: true, token: "tok-1" });
    assert.equal(result.ok, true);
    assert.equal(result.claimed, true);
    assert.equal(result.canClaim, false);
    assert.equal(result.streak, 5);
    assert.equal(result.message.includes("0.22"), true);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[1].method, "POST");
    assert.equal(calls[2].method, "GET");
    assert.equal(calls[0].headers.Authorization, "Bearer tok-1");
    assert.equal(calls[0].url, "https://vyceai.com/user/daily-reward");
    assert.equal(result.lastClaimDate, "2026-09-30");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects business-level claim failures returned with HTTP 200", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).endsWith("/user/daily-reward")) return jsonResponse({ canClaim: true });
    return jsonResponse({ message: "Already claimed today" });
  };
  try {
    await assert.rejects(
      () => performCheckin({ station: vyceaiStation, preset: PRESET, claim: true, token: "tok-1" }),
      error => error.code === "CHECKIN_REJECTED" && error.message === "Already claimed today"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rejects when the claim is not reflected by the status endpoint", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (String(url).endsWith("/user/daily-reward")) return jsonResponse({ canClaim: true });
    return jsonResponse({ amount: 0.22 });
  };
  try {
    await assert.rejects(
      () => performCheckin({ station: vyceaiStation, preset: PRESET, claim: true, token: "tok-1" }),
      error => error.code === "CHECKIN_NOT_CONFIRMED" && error.message.includes("未确认到账")
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("skips claim when already claimed and reports status", async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: String(options.method || "GET") });
    return jsonResponse({ canClaim: false, streak: 2, rewardAmount: 0.2 });
  };
  try {
    const result = await performCheckin({ station: vyceaiStation, preset: PRESET, claim: true, token: "tok-1" });
    assert.equal(result.claimed, false);
    assert.equal(result.canClaim, false);
    assert.equal(result.streak, 2);
    assert.equal(result.message, "今日已签到");
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("surfaces API errors with status", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    headers: { get: () => "application/json" },
    json: async () => ({ error: { message: "未登录" } })
  });
  try {
    await assert.rejects(
      () => performCheckin({ station: vyceaiStation, preset: PRESET, claim: false, token: "tok-1" }),
      error => error.status === 401 && error.message.includes("未登录")
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("check-in plugin JSON carries the endpoint spec", () => {
  assert.equal(CHECKIN_SPEC.kind, "checkin");
  assert.equal(CHECKIN_SPEC.id, "site-checkin");
  assert.deepEqual(PRESET.matchHosts, ["vyceai.com"]);
  assert.equal(PRESET.statusPath, "/user/daily-reward");
  assert.equal(PRESET.claimPath, "/user/daily-reward/claim");
  assert.equal(PRESET.claimMethod, "POST");
  assert.equal(typeof PRESET.tokenStorageKey, "string");
  assert.ok(PRESET.tokenStorageKey.length > 0);
  assert.equal(PRESET.tokenCookieName, "session");
  assert.equal(PRESET.cooldownHours, 24);
  assert.equal(PRESET.loginPath, "/login");
  assert.equal(typeof PRESET.tokenHint, "string");
  assert.ok(PRESET.tokenHint.length > 0);
  assert.equal(checkinPresetFromSpec({ id: "plain", version: "1.0.0" }), null);
});

test("check-in plugins stay out of the price plugin pipeline", () => {
  assert.equal(CHECKIN_SPEC.request, null);
  assert.equal(CHECKIN_SPEC.addable, false);
});
test("classifies 401 and 403 as needs-login", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [401, 403]) {
      globalThis.fetch = async () => ({
        ok: false,
        status,
        headers: { get: () => "application/json" },
        json: async () => ({ message: "请先登录" })
      });
      await assert.rejects(
        () => performCheckin({ station: vyceaiStation, preset: PRESET, claim: false, token: "tok-1" }),
        error => error.code === "CHECKIN_NEEDS_LOGIN" && error.status === status && error.message === "请先登录"
      );
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("restores snapshot cookies once when the live login is gone", async () => {
  const originalFetch = globalThis.fetch;
  const restored = [];
  let authenticated = false;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (!authenticated) {
      return { ok: false, status: 401, headers: { get: () => "application/json" }, json: async () => ({ message: "未登录" }) };
    }
    return jsonResponse({ canClaim: false, streak: 2 });
  };
  try {
    const result = await performCheckin({
      station: vyceaiStation,
      preset: PRESET,
      claim: false,
      session: { cookies: [{ name: "session", value: "snap-1", domain: "vyceai.com", path: "/" }] },
      restoreCookies: async cookies => {
        restored.push(cookies);
        authenticated = true;
      }
    });
    assert.equal(result.ok, true);
    assert.equal(result.streak, 2);
    assert.equal(calls, 2);
    assert.equal(restored.length, 1);
    assert.equal(restored[0][0].name, "session");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("restores once and stays needs-login when the snapshot is stale", async () => {
  const originalFetch = globalThis.fetch;
  let restoreCalls = 0;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { ok: false, status: 401, headers: { get: () => "application/json" }, json: async () => ({}) };
  };
  try {
    await assert.rejects(
      () => performCheckin({
        station: vyceaiStation,
        preset: PRESET,
        claim: true,
        session: { cookies: [{ name: "session", value: "snap-1" }] },
        restoreCookies: async () => { restoreCalls += 1; }
      }),
      error => error.code === "CHECKIN_NEEDS_LOGIN"
    );
    assert.equal(restoreCalls, 1);
    assert.equal(fetchCalls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not restore when there is no snapshot", async () => {
  const originalFetch = globalThis.fetch;
  let restoreCalls = 0;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return { ok: false, status: 401, headers: { get: () => "application/json" }, json: async () => ({}) };
  };
  try {
    await assert.rejects(
      () => performCheckin({
        station: vyceaiStation,
        preset: PRESET,
        claim: true,
        restoreCookies: async () => { restoreCalls += 1; }
      }),
      error => error.code === "CHECKIN_NEEDS_LOGIN"
    );
    assert.equal(restoreCalls, 0);
    assert.equal(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("falls back to the snapshot token when the page has none", async () => {
  const originalFetch = globalThis.fetch;
  let authorization = "";
  globalThis.fetch = async (url, options = {}) => {
    authorization = options.headers?.Authorization || "";
    return jsonResponse({ canClaim: false, streak: 1 });
  };
  try {
    await performCheckin({ station: vyceaiStation, preset: PRESET, claim: false, session: { token: "snap-token" } });
    assert.equal(authorization, "Bearer snap-token");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("normalizes login-state snapshots", () => {
  const session = normalizeCheckinSession({
    token: " t ",
    origin: "https://vyceai.com",
    capturedAt: "123",
    cookies: [
      { name: "session", value: "v", domain: "VyceAI.com", sameSite: "weird" },
      { name: "", value: "ignored" }
    ]
  });
  assert.equal(session.token, "t");
  assert.equal(session.origin, "https://vyceai.com");
  assert.equal(session.capturedAt, 123);
  assert.equal(session.cookies.length, 1);
  assert.equal(session.cookies[0].domain, "vyceai.com");
  assert.equal(session.cookies[0].sameSite, "lax");
  assert.equal(normalizeCheckinSession({}), null);
  assert.equal(normalizeCheckinSession({ token: "  " }), null);
});

test("keeps snapshots and needs-login marks in check-in records", () => {
  const record = normalizeCheckinRecord({ needsLoginAt: "99", session: { token: "snap-token" } });
  assert.equal(record.needsLoginAt, 99);
  assert.equal(record.session.token, "snap-token");
  assert.equal(normalizeCheckinRecord({ session: {} }).session, null);
});

test("rejects a check-in spec whose loginPath is not a site path", () => {
  const raw = PLUGIN_REGISTRY_SNAPSHOT.plugins.find(entry => entry.kind === "checkin");
  assert.throws(() => normalizePluginSpec({ ...raw, checkin: { ...raw.checkin, loginPath: "login" } }), /loginPath/);
});
