import test from "node:test";
import assert from "node:assert/strict";
import {
  READ_ENDPOINTS,
  auditRechargeEntry,
  classifyEvidence,
  exitCodeForEvidence,
  summarizeEvidence
} from "../scripts/direct-recharge-audit.mjs";

function entryWithPreset(preset = {}) {
  return {
    id: "recharge-audit-test",
    name: "Recharge audit test",
    host: "audit.example",
    load: () => ({ sitePlugin: { id: "recharge-audit-test", preset } })
  };
}

function jsonResponse(body, status = 200) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => "application/json" },
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

test("read-only recharge audit sends only allowlisted GET requests without bodies", async () => {
  const calls = [];
  const result = await auditRechargeEntry(entryWithPreset(), {
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ message: "not found" }, 404);
    },
    now: new Date("2026-11-27T12:00:00.000Z")
  });

  assert.equal(calls.length, READ_ENDPOINTS.length);
  assert.deepEqual(calls.map(call => call.init.method), READ_ENDPOINTS.map(() => "GET"));
  assert.equal(calls.every(call => call.init.body === undefined), true);
  assert.equal(calls.every(call => READ_ENDPOINTS.some(endpoint => call.url.endsWith(endpoint.path))), true);
  assert.equal(calls.some(call => /create|submit|checkout\/create|order\/create/i.test(call.url)), false);
  // 不带任何凭据或会话：审计只用公开 GET，报告里的请求记录也不留 header / body。
  const headerKeys = calls.flatMap(call => Object.keys(call.init.headers || {}).map(key => key.toLowerCase()));
  assert.equal(headerKeys.some(key => key === "authorization" || key === "cookie" || key === "x-api-key"), false);
  assert.equal(result.requests.every(request => request.body === null && request.method === "GET"), true);
  assert.equal(result.evidenceLevel, "unverified");
  assert.equal(result.state, "WARN");
});
test("a baseUrl carrying a page path and query still audits its origin", async () => {
  // 插件可以把页面地址写进 baseUrl（如模型广场的 /model-plaza?embedded=1）；
  // 审计只用 origin，带查询串不该把站点判成 FAIL。
  const calls = [];
  const entry = entryWithPreset({ baseUrl: "https://audit.example/model-plaza?embedded=1" });
  const result = await auditRechargeEntry(entry, {
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ data: { price: 7.3 } });
    },
    now: new Date("2026-11-27T12:00:00.000Z")
  });

  assert.notEqual(result.state, "FAIL");
  assert.equal(calls.length, READ_ENDPOINTS.length);
  assert.equal(calls.every(call => !call.url.includes("embedded")), true);
  assert.equal(calls.every(call => new URL(call.url).origin === "https://audit.example"), true);
});

test("a baseUrl carrying credentials is still rejected", async () => {
  let called = false;
  // 凭据拼出来写，避免把真实口令样式的字面量留在仓库里。
  const credential = ["p", "w"].join("");
  const result = await auditRechargeEntry(entryWithPreset({ baseUrl: `https://u:${credential}@audit.example` }), {
    fetchImpl: async () => { called = true; return jsonResponse({}); }
  });

  assert.equal(result.state, "FAIL");
  assert.match(result.reason, /凭据/);
  assert.equal(called, false);
});

test("a baseUrl whose userinfo has an empty username is still rejected", async () => {
  let called = false;
  // 空用户名 + 密码的写法：只看 url.username 会漏掉，必须按 authority 里的 @ 判定。
  const credential = ["p", "w"].join("");
  const result = await auditRechargeEntry(entryWithPreset({ baseUrl: `https://:${credential}@audit.example` }), {
    fetchImpl: async () => { called = true; return jsonResponse({}); }
  });

  assert.equal(result.state, "FAIL");
  assert.match(result.reason, /凭据/);
  assert.equal(called, false);
  assert.equal(result.requests.length, 0);
});


test("a live status report is probable, never confirmed from verification flags", async () => {
  const calls = [];
  const entry = entryWithPreset({
    baseUrl: "https://audit.example/pricing",
    rechargeRmb: 7.3,
    rechargeRateVerified: true,
    rechargePaymentsVerified: true,
    rechargePayments: [{ channel: "alipay", faceAmount: 10, payAmount: 10, currency: "CNY", at: "2026-11-26", note: "redacted" }]
  });
  const result = await auditRechargeEntry(entry, {
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/api/status")) {
        return jsonResponse({ data: { price: 7.3, quota_per_unit: 500000, pay_methods: [{ type: "alipay", name: "支付宝" }] } });
      }
      return jsonResponse({}, 404);
    },
    now: new Date("2026-11-27T12:00:00.000Z")
  });

  assert.equal(result.evidenceLevel, "probable");
  assert.equal(result.state, "WARN");
  assert.deepEqual(result.rateSource, { kind: "live-status", endpoint: "/api/status", rate: 7.3 });
  assert.deepEqual(result.codeFlags, { rechargeRateVerified: true, rechargePaymentsVerified: true });
  assert.equal(result.payments[0].note, undefined);
  assert.deepEqual(result.payments[0], {
    channel: "alipay",
    faceAmount: 10,
    payAmount: 10,
    currency: "CNY",
    at: "2026-11-26"
  });
  assert.equal(calls.every(call => call.init.body === undefined), true);
});

test("three independent sources are required for confirmed evidence", () => {
  assert.equal(classifyEvidence({ rawReport: true, page: true, statement: true }).level, "confirmed");
  assert.equal(classifyEvidence({ rawReport: true, page: true, statement: false }).level, "probable");
  assert.equal(classifyEvidence({ rawReport: false, page: false, statement: false, blocked: true }).level, "blocked");
  assert.deepEqual(classifyEvidence({ rawReport: false, page: false, statement: false }).missing, [
    "原始充值报文",
    "页面渲染结果",
    "站点自述/文档",
    "已完成支付记录（不影响三证等级）"
  ]);
});

test("plugin-declared page and statement never count as observed evidence", async () => {
  const entry = entryWithPreset({
    baseUrl: "https://audit.example/pricing",
    rechargeRateVerified: true,
    rechargePaymentsVerified: true,
    rechargeEvidence: { page: true, statement: { url: "https://audit.example/docs", at: "2026-11-20" }, completedPayment: true, date: "2026-11-20" }
  });
  const result = await auditRechargeEntry(entry, {
    fetchImpl: async url => String(url).endsWith("/api/status")
      ? jsonResponse({ data: { price: 7.3 } })
      : jsonResponse({}, 404),
    now: new Date("2026-11-27T12:00:00.000Z")
  });

  assert.equal(result.evidenceLevel, "probable");
  assert.equal(result.state, "WARN");
  assert.deepEqual(result.evidenceSources, { rawReport: true, page: false, statement: false, completedPayment: false });
  assert.deepEqual(result.declaredSources, { page: true, statement: true, completedPayment: true });
  assert.ok(result.missingEvidence.includes("页面渲染结果"));
  assert.ok(result.missingEvidence.includes("站点自述/文档"));
});

test("declared evidence cannot relabel an auth-blocked station as probable", async () => {
  const entry = entryWithPreset({ rechargeEvidence: { page: true, statement: true }, rechargeRateVerified: true });
  const result = await auditRechargeEntry(entry, {
    fetchImpl: async () => jsonResponse({ message: "login required" }, 401),
    now: new Date("2026-11-27T12:00:00.000Z")
  });
  const summary = summarizeEvidence([result]);

  assert.equal(result.evidenceLevel, "blocked");
  assert.equal(result.state, "BLOCKED");
  assert.equal(exitCodeForEvidence(summary), 2);
});

test("all auth or network failures remain blocked and do not look like coverage", async () => {
  const result = await auditRechargeEntry(entryWithPreset({ rechargeRateVerified: true }), {
    fetchImpl: async () => { throw new Error("offline"); },
    timeoutMs: 1
  });
  const summary = summarizeEvidence([result]);
  assert.equal(result.evidenceLevel, "blocked");
  assert.equal(result.state, "BLOCKED");
  assert.equal(summary.blocked, 1);
  assert.equal(exitCodeForEvidence(summary), 2);
  assert.equal(summary.confirmed, 0);
});


test("a redirect off the allowlisted endpoint is recorded and never counted as success", async () => {
  const result = await auditRechargeEntry(entryWithPreset(), {
    fetchImpl: async () => ({
      ...jsonResponse({ data: { price: 7.3 } }),
      url: "https://cdn.example.net/api/status"
    })
  });

  assert.equal(result.requests.every(request => request.classification === "cross-origin"), true);
  assert.equal(result.requests[0].finalUrl, "https://cdn.example.net/api/status");
  assert.equal(result.evidenceSources.rawReport, false);
  assert.equal(result.evidenceLevel, "unverified");
  assert.equal(result.state, "WARN");
});

test("a same-endpoint redirect that only reorders the query is not an escape", async () => {
  // 两个分页端点带 page=1&page_size=20；顺序换一下不该算跳出 allowlist。
  const result = await auditRechargeEntry(entryWithPreset(), {
    fetchImpl: async url => ({
      ...jsonResponse({ data: { price: 7.3 } }),
      url: String(url).replace("page=1&page_size=20", "page_size=20&page=1")
    })
  });

  assert.equal(result.requests.every(request => request.classification === "success"), true);
  assert.equal(result.requests.some(request => request.finalUrl), false);
  assert.equal(result.evidenceSources.rawReport, true);
  assert.notEqual(result.state, "FAIL");
});

test("a same-endpoint redirect that changes a query value is still an escape", async () => {
  const result = await auditRechargeEntry(entryWithPreset(), {
    fetchImpl: async url => ({
      ...jsonResponse({ data: { price: 7.3 } }),
      url: String(url).replace("page=1", "page=2")
    })
  });

  const redirected = result.requests.filter(request => request.finalUrl);
  assert.equal(redirected.length, 2);
  assert.equal(redirected.every(request => request.classification === "cross-origin"), true);
  assert.equal(result.requests.filter(request => !request.finalUrl).every(request => request.classification === "success"), true);
  assert.equal(result.state, "WARN");
});
