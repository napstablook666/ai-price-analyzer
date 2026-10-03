import test from "node:test";
import assert from "node:assert/strict";
import { matchCheckinPreset, normalizeCheckinRecord, performCheckin, CHECKIN_PRESETS } from "../src/core/checkin.js";

const vyceaiStation = { id: "s1", name: "Vyce AI", baseUrl: "https://vyceai.com/dashboard-v2" };

const jsonResponse = body => ({
  ok: true,
  status: 200,
  headers: { get: () => "application/json" },
  json: async () => body
});

test("matches check-in presets by host", () => {
  assert.equal(matchCheckinPreset(vyceaiStation)?.id, "vyceai");
  assert.equal(matchCheckinPreset({ baseUrl: "https://www.vyceai.com/" })?.id, "vyceai");
  assert.equal(matchCheckinPreset({ baseUrl: "https://api.vyceai.com/x" })?.id, "vyceai");
  assert.equal(matchCheckinPreset({ baseUrl: "https://vyceai.com.evil.example/" }), null);
  assert.equal(matchCheckinPreset({ baseUrl: "https://example.com/" }), null);
  assert.equal(matchCheckinPreset({}), null);
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
    const result = await performCheckin({ station: vyceaiStation, claim: true, token: "tok-1" });
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
      () => performCheckin({ station: vyceaiStation, claim: true, token: "tok-1" }),
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
      () => performCheckin({ station: vyceaiStation, claim: true, token: "tok-1" }),
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
    const result = await performCheckin({ station: vyceaiStation, claim: true, token: "tok-1" });
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
      () => performCheckin({ station: vyceaiStation, claim: false, token: "tok-1" }),
      error => error.status === 401 && error.message.includes("未登录")
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("presets carry status and claim endpoints", () => {
  const [vyceai] = CHECKIN_PRESETS;
  assert.equal(vyceai.statusPath, "/user/daily-reward");
  assert.equal(vyceai.claimPath, "/user/daily-reward/claim");
  assert.equal(vyceai.claimMethod, "POST");
  assert.equal(vyceai.tokenStorageKey, "vyce_session");
  assert.equal(vyceai.tokenCookieName, "session");
});
