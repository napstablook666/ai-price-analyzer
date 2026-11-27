import test from "node:test";
import assert from "node:assert/strict";
import {
  auditEntry,
  directEntries,
  exitCodeForSummary,
  inventory,
  summarize
} from "../scripts/direct-audit.mjs";

function response(body, { status = 200, contentType = "application/json" } = {}) {
  return {
    ok: status >= 200 && status < 400,
    status,
    headers: { get: name => name.toLowerCase() === "content-type" ? contentType : "" },
    body,
    clone: () => ({ json: async () => {
      if (typeof body === "string") throw new Error("not json");
      return body;
    } }),
    json: async () => body,
    text: async () => typeof body === "string" ? body : JSON.stringify(body)
  };
}

function fakeEntry(body, options = {}) {
  const provider = {
    id: "direct-audit-test",
    host: "audit.example",
    matches: ({ hostname }) => hostname === "audit.example",
    preset: {
      id: "direct-audit-test",
      name: "Audit test",
      baseUrl: "https://audit.example",
      mode: "direct",
      auth: { type: "none" },
      adapter: { endpoint: "/api/pricing", method: "GET", responseFormat: options.responseFormat || "auto", priceKeys: new Set() }
    },
    request: { endpoint: "/api/pricing", credentials: "omit", pageHeaders: [], headers: {}, priceKeys: new Set() }
  };
  return {
    id: provider.id,
    name: provider.preset.name,
    host: provider.host,
    mode: "direct",
    addable: true,
    load: () => ({ sitePlugin: provider }),
    response: response(body, options)
  };
}

function fetchFor(entry) {
  return async () => entry.response;
}

test("inventory uses 104/90/14/89 and excludes public-pricing", () => {
  const result = inventory();
  assert.equal(result.manifests, 104);
  assert.equal(result.direct, 90);
  assert.equal(result.page, 14);
  assert.equal(result.directSitePlugins, 89);
  assert.deepEqual(result.excludedGeneric, ["public-pricing"]);
  assert.equal(directEntries().some(entry => entry.mode === "page"), false);
  assert.equal(directEntries().some(entry => entry.id === "public-pricing"), false);
});

test("audit reports raw/priced models, rows, currency and token/request/image/video modes", async () => {
  const entry = fakeEntry({ data: [
    { model_name: "token-model", input_price: 1, output_price: 2, price_currency: "USD" },
    { model_name: "request-model", request_price: 0.2, price_currency: "USD" },
    { model_name: "image-model", image_price: 0.3, media_type: "image", price_currency: "USD" },
    { model_name: "video-model", request_price: 0.4, media_type: "video", price_currency: "USD" }
  ] });

  const result = await auditEntry(entry, { fetchImpl: fetchFor(entry), retries: 1, retryDelayMs: 0 });

  assert.equal(result.state, "OK");
  assert.equal(result.httpStatus, 200);
  assert.equal(result.rawModels, 4);
  assert.equal(result.pricedModels, 4);
  assert.equal(result.rows, 4);
  assert.deepEqual(result.billingModes, { image: 1, request: 1, token: 1, video: 1 });
  assert.deepEqual(result.currency, ["CREDITS"]);
  assert.equal(result.unpriced.length, 0);
  assert.equal(result.unsupported.length, 0);
  assert.equal(result.invalid.length, 0);
  assert.match(result.endpoint, /audit\.example\/api\/pricing$/);
  assert.equal(result.rawModelsUnknown, false);
});

test("audit keeps unpriced, unsupported and invalid parser diagnostics", async () => {
  const entry = fakeEntry({
    code: 0,
    data: { groups: [{
      name: "Text",
      rate_multiplier: 1,
      models: [
        { name: "priced", pricing: { billing_mode: "token", input_price: 1, output_price: 2 } },
        { name: "missing", pricing: { billing_mode: "token" } },
        { name: "unsupported", pricing: { billing_mode: "per_second", input_price: 1 } },
        { name: "invalid", pricing: { billing_mode: "per_request", per_request_price: "bad" } }
      ]
    }] }
  }, { responseFormat: "fuck-everyone-model-plaza" });

  const result = await auditEntry(entry, { fetchImpl: fetchFor(entry), retries: 1, retryDelayMs: 0 });

  assert.equal(result.state, "WARN");
  assert.deepEqual(result.unpriced, ["Text:missing:default"]);
  assert.deepEqual(result.unsupported, ["per_second"]);
  assert.deepEqual(result.invalid, ["invalid"]);
});

test("audit distinguishes authentication blocking from HTTP failure", async () => {
  const blocked = fakeEntry({ message: "login required" }, { status: 401 });
  const blockedResult = await auditEntry(blocked, { fetchImpl: fetchFor(blocked), retries: 1, retryDelayMs: 0 });
  assert.equal(blockedResult.state, "BLOCKED");
  assert.equal(blockedResult.reasonCategory, "auth");
  assert.equal(blockedResult.httpStatus, 401);

  const failed = fakeEntry({ message: "upstream" }, { status: 500 });
  const failedResult = await auditEntry(failed, { fetchImpl: fetchFor(failed), retries: 1, retryDelayMs: 0 });
  assert.equal(failedResult.state, "FAIL");
  assert.equal(failedResult.reasonCategory, "http");
  assert.equal(failedResult.httpStatus, 500);
});

test("audit reports non-JSON and network blocking without recording response secrets", async () => {
  const html = fakeEntry("<html>login</html>", { contentType: "text/html" });
  const htmlResult = await auditEntry(html, { fetchImpl: fetchFor(html), retries: 1, retryDelayMs: 0 });
  assert.equal(htmlResult.state, "FAIL");
  assert.equal(htmlResult.reasonCategory, "non-json");

  const network = fakeEntry({});
  const networkResult = await auditEntry(network, {
    fetchImpl: async () => { throw new TypeError("Failed to fetch"); },
    retries: 1,
    retryDelayMs: 0
  });
  assert.equal(networkResult.state, "BLOCKED");
  assert.equal(networkResult.reasonCategory, "network");
  assert.equal(Object.hasOwn(networkResult, "payload"), false);
  assert.equal(Object.hasOwn(networkResult, "headers"), false);
});

test("a parseable page is not failed just because the raw body is not JSON", async () => {
  const payload = { data: [
    { model_name: "page-model", input_price: 1, output_price: 2, price_currency: "USD" }
  ] };
  const entry = fakeEntry(payload, { contentType: "text/html" });
  // 插件的 decodeResponse 自己把页面解析成报价；克隆体读不出 JSON 不代表解析失败。
  entry.load().sitePlugin.request.decodeResponse = raw => typeof raw === "string" ? JSON.parse(raw) : raw;
  entry.response.clone = () => ({ json: async () => { throw new Error("not json"); } });

  const result = await auditEntry(entry, { fetchImpl: fetchFor(entry), retries: 1, retryDelayMs: 0 });

  assert.equal(result.state, "OK");
  assert.equal(result.reasonCategory, "complete");
  assert.equal(result.rows, 1);
  assert.equal(result.pricedModels, 1);
});

test("HTTP 5xx is classified as http failure, not non-json", async () => {
  const entry = fakeEntry("<html>bad gateway</html>", { status: 502, contentType: "text/html" });
  const result = await auditEntry(entry, { fetchImpl: fetchFor(entry), retries: 1, retryDelayMs: 0 });

  assert.equal(result.state, "FAIL");
  assert.equal(result.reasonCategory, "http");
  assert.equal(result.httpStatus, 502);
});

test("summary and exit codes keep blocked distinct from failed coverage", () => {
  const allBlocked = summarize([{ state: "BLOCKED" }, { state: "BLOCKED" }]);
  assert.deepEqual(allBlocked, {
    total: 2,
    ok: 0,
    warn: 0,
    fail: 0,
    blocked: 2,
    coverageComplete: false,
    inventory: null
  });
  assert.equal(exitCodeForSummary(allBlocked), 2);
  assert.equal(exitCodeForSummary({ ok: 1, warn: 0, fail: 0, blocked: 1 }), 0);
  assert.equal(exitCodeForSummary({ ok: 0, warn: 0, fail: 1, blocked: 0 }), 1);
  assert.equal(exitCodeForSummary({ total: 0, ok: 0, warn: 0, fail: 0, blocked: 0 }), 2);
});

test("summary preserves parser diagnostics fields rather than collapsing them into rows", () => {
  const result = {
    state: "WARN",
    unpriced: ["model:default"],
    unsupported: ["per_second"],
    invalid: ["group:multiplier"],
    unsupportedPriceItems: ["video"],
    unpricedChannels: ["channel:model"]
  };
  const summary = summarize([result]);
  assert.equal(summary.warn, 1);
  assert.equal(summary.coverageComplete, false);
  assert.deepEqual(result.unpriced, ["model:default"]);
  assert.deepEqual(result.unsupported, ["per_second"]);
  assert.deepEqual(result.invalid, ["group:multiplier"]);
});
