import test from "node:test";
import assert from "node:assert/strict";
import {
  completeChat,
  fetchModelCatalog,
  normalizeModelBaseUrl,
  parseModelCatalog,
  testModelConnection
} from "../src/core/model-api.js";

// 这几个函数的 fetchImpl 都是可注入的，所以测试不碰网络：
// 给一个记录调用的替身，返回值由每个用例自己指定。
function fakeFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { calls, impl };
}

function jsonResponse(body, url) {
  return { ok: true, url, json: async () => body, text: async () => JSON.stringify(body) };
}

test("模型地址补 /v1，已经有 /v1 的不重复补", () => {
  assert.equal(normalizeModelBaseUrl("https://api.example.com"), "https://api.example.com/v1");
  assert.equal(normalizeModelBaseUrl("https://api.example.com/v1"), "https://api.example.com/v1");
  assert.equal(normalizeModelBaseUrl("https://api.example.com/v1/"), "https://api.example.com/v1");
  assert.equal(normalizeModelBaseUrl("https://api.example.com/proxy"), "https://api.example.com/proxy/v1");
});

test("模型地址只收 HTTPS，HTTP 只放本机", () => {
  assert.equal(normalizeModelBaseUrl("http://127.0.0.1:3425/v1"), "http://127.0.0.1:3425/v1");
  assert.throws(() => normalizeModelBaseUrl("http://api.example.com"), /仅允许 HTTPS/);
});

test("模型地址拒绝查询参数、hash 和用户名密码", () => {
  assert.throws(() => normalizeModelBaseUrl("https://api.example.com/?a=1"), /查询参数/);
  assert.throws(() => normalizeModelBaseUrl("https://api.example.com/#x"), /查询参数/);
  assert.throws(() => normalizeModelBaseUrl("https://u:p@api.example.com"), /查询参数/);
});

test("空地址和不是 URL 的输入分开报错", () => {
  assert.throws(() => normalizeModelBaseUrl("   "), /请先填写模型服务地址/);
  assert.throws(() => normalizeModelBaseUrl("not a url"), /完整的 http\(s\) 地址/);
});

test("模型目录认裸数组、data、models 三种外壳", () => {
  assert.deepEqual(parseModelCatalog([{ id: "b" }, { id: "a" }]).map(model => model.id), ["a", "b"]);
  assert.deepEqual(parseModelCatalog({ data: [{ id: "x" }] }).map(model => model.id), ["x"]);
  assert.deepEqual(parseModelCatalog({ models: ["y"] }).map(model => model.id), ["y"]);
});

test("模型目录去重、丢空 id、丢 enabled:false", () => {
  const rows = [{ id: "a", name: "A" }, { id: "a", name: "A2" }, { id: "" }, { id: "b", enabled: false }];
  assert.deepEqual(parseModelCatalog(rows).map(model => model.id), ["a"]);
  assert.equal(parseModelCatalog(rows)[0].name, "A2");
});

test("模型目录的 name / owner / enabled 有兜底", () => {
  const [model] = parseModelCatalog([{ id: "gpt-x" }]);
  assert.equal(model.name, "gpt-x");
  assert.equal(model.owner, "");
  assert.equal(model.enabled, true);
});

test("拉模型列表：拼 /models、带 Bearer、按 id 排序", async () => {
  const { calls, impl } = fakeFetch(() => jsonResponse({ data: [{ id: "b" }, { id: "a" }] }, "https://api.example.com/v1/models"));
  const result = await fetchModelCatalog({ baseUrl: "https://api.example.com", apiKey: " sk-1 ", fetchImpl: impl });
  assert.equal(calls[0].url, "https://api.example.com/v1/models");
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.Authorization, "Bearer sk-1");
  assert.deepEqual(result.models.map(model => model.id), ["a", "b"]);
  assert.equal(result.endpoint, "https://api.example.com/v1/models");
});

test("拉模型列表：缺地址或密钥直接报错，一个请求都不发", async () => {
  const { calls, impl } = fakeFetch(() => jsonResponse({}));
  await assert.rejects(() => fetchModelCatalog({ apiKey: "k", fetchImpl: impl }), /请先填写模型服务地址/);
  await assert.rejects(() => fetchModelCatalog({ baseUrl: "https://a.com", fetchImpl: impl }), /请先填写模型服务密钥/);
  assert.equal(calls.length, 0);
});

test("非 2xx 把状态码和响应体前 160 字带出来", async () => {
  const { impl } = fakeFetch(() => ({ ok: false, status: 401, text: async () => "x".repeat(200) }));
  await assert.rejects(() => fetchModelCatalog({ baseUrl: "https://a.com", apiKey: "k", fetchImpl: impl }), error => {
    assert.match(error.message, /^HTTP 401: x{160}$/);
    return true;
  });
});

test("超时报自己的话，不把 AbortError 冒出去", async () => {
  const impl = (url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  await assert.rejects(
    () => fetchModelCatalog({ baseUrl: "https://a.com", apiKey: "k", fetchImpl: impl, timeoutMs: 10 }),
    /模型请求超时（1 秒）/
  );
});

test("连通性测试发 chat/completions，参数按约定固定", async () => {
  const { calls, impl } = fakeFetch(() => jsonResponse({ choices: [{ message: { content: "连接正常" } }], model: "m-1" }));
  const result = await testModelConnection({ baseUrl: "https://a.com", apiKey: "k", model: "m", fetchImpl: impl });
  assert.equal(calls[0].url, "https://a.com/v1/chat/completions");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "m");
  assert.equal(body.temperature, 0);
  assert.equal(body.max_tokens, 32);
  assert.equal(result.model, "m-1");
});

test("连通性测试缺 choices 就报错", async () => {
  const { impl } = fakeFetch(() => jsonResponse({}));
  await assert.rejects(() => testModelConnection({ baseUrl: "https://a.com", apiKey: "k", model: "m", fetchImpl: impl }), /缺少 choices/);
});

test("补全返回正文，温度夹到 0..1", async () => {
  const { calls, impl } = fakeFetch(() => jsonResponse({ choices: [{ message: { content: " ok " } }], usage: { total_tokens: 3 } }));
  const result = await completeChat({
    baseUrl: "https://a.com",
    apiKey: "k",
    model: "m",
    messages: [{ role: "user", content: "hi" }],
    maxTokens: 12,
    temperature: 2,
    fetchImpl: impl
  });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.max_tokens, 12);
  assert.equal(body.temperature, 1);
  assert.equal(result.content, " ok ");
  assert.deepEqual(result.usage, { total_tokens: 3 });
});

test("补全未指定上限时不写 max_tokens 字段", async () => {
  const { calls, impl } = fakeFetch(() => jsonResponse({ choices: [{ message: { content: "x" } }] }));
  await completeChat({ baseUrl: "https://a.com", apiKey: "k", model: "m", messages: [], fetchImpl: impl });
  assert.equal("max_tokens" in JSON.parse(calls[0].init.body), false);
});

test("正文为空时区分「推理吃满预算」和「真没正文」", async () => {
  const { impl } = fakeFetch(() => jsonResponse({ choices: [{ message: { content: "" }, finish_reason: "length" }] }));
  await assert.rejects(
    () => completeChat({ baseUrl: "https://a.com", apiKey: "k", model: "m", messages: [], fetchImpl: impl }),
    /推理过程占满/
  );

  const { impl: blank } = fakeFetch(() => jsonResponse({ choices: [{ message: { content: "   " }, finish_reason: "stop" }] }));
  await assert.rejects(
    () => completeChat({ baseUrl: "https://a.com", apiKey: "k", model: "m", messages: [], fetchImpl: blank }),
    /缺少正文/
  );
});
