import test from "node:test";
import assert from "node:assert/strict";
import {
  classify,
  environmentVerdict,
  exitCodeForHealth,
  nextLevel,
  renderStatus,
  samplesMap,
  summarizeHealth
} from "../scripts/health-check.mjs";

test("网络层大批阻断时标记出口可疑，不把它当成站点变化", () => {
  const healthy = Array.from({ length: 10 }, (_, index) => result({ id: `ok-${index}`, reasonCategory: "none" }));
  assert.equal(environmentVerdict(healthy).suspect, false);

  const noisy = Array.from({ length: 10 }, (_, index) => result({
    id: `net-${index}`,
    state: "BLOCKED",
    reasonCategory: index < 1 ? "network" : "none"
  }));
  assert.equal(environmentVerdict(noisy).suspect, false);

  const offline = Array.from({ length: 10 }, (_, index) => result({
    id: `net-${index}`,
    state: "BLOCKED",
    reasonCategory: index < 4 ? "network" : "none"
  }));
  const verdict = environmentVerdict(offline);
  assert.equal(verdict.suspect, true);
  assert.equal(verdict.network, 4);
  assert.match(verdict.note, /4\/10/);

  assert.equal(environmentVerdict(offline.slice(0, 4)).suspect, false, "样本太小时不下判断");
});

function result(overrides = {}) {
  return {
    id: "demo",
    name: "Demo",
    endpoint: "https://demo.example.com/api/pricing",
    state: "OK",
    reason: "",
    reasonCategory: "",
    httpStatus: 200,
    responseFormat: "openai-models",
    pricedModels: 20,
    rows: 20,
    billingModes: { tokens: 20 },
    currency: ["CNY"],
    ratioBase: 0.5,
    priceSamples: [],
    ...overrides
  };
}

function baselineOf(overrides = {}) {
  return {
    host: "demo.example.com",
    httpStatus: 200,
    responseFormat: "openai-models",
    models: 20,
    rows: 20,
    modes: ["tokens"],
    currency: ["CNY"],
    ratioBase: 0.5,
    ...overrides
  };
}

test("没基线时报 ok 并标记首次登记", () => {
  const verdict = classify({ result: result(), baseline: null });
  assert.equal(verdict.klass, "ok");
  assert.equal(verdict.isNew, true);
  assert.deepEqual(verdict.evidence, ["首次登记"]);
});

test("认证阻断归 auth-wall，不进失败桶", () => {
  const verdict = classify({
    result: result({ state: "BLOCKED", reason: "HTTP 401", reasonCategory: "auth", httpStatus: 401 }),
    baseline: baselineOf()
  });
  assert.equal(verdict.klass, "auth-wall");
  assert.match(verdict.evidence[0], /401/);
});

test("超时归 timeout", () => {
  const verdict = classify({
    result: result({ state: "BLOCKED", reason: "request timeout after 15000ms", reasonCategory: "network" }),
    baseline: baselineOf()
  });
  assert.equal(verdict.klass, "timeout");
});

test("域名解析失败归 domain-moved", () => {
  const verdict = classify({
    result: result({ state: "BLOCKED", reason: "getaddrinfo ENOTFOUND demo.example.com", reasonCategory: "network" }),
    baseline: baselineOf()
  });
  assert.equal(verdict.klass, "domain-moved");
});

test("解析失败归 structure-changed，5xx 归 http-error", () => {
  const parse = classify({
    result: result({ state: "FAIL", reason: "no price rows", reasonCategory: "parse" }),
    baseline: baselineOf()
  });
  assert.equal(parse.klass, "structure-changed");

  const server = classify({
    result: result({ state: "FAIL", reason: "HTTP 502", reasonCategory: "http", httpStatus: 502 }),
    baseline: baselineOf()
  });
  assert.equal(server.klass, "http-error");
});

test("端点换域名优先于数据比较", () => {
  const verdict = classify({
    result: result({ endpoint: "https://demo2.example.com/api/pricing" }),
    baseline: baselineOf()
  });
  assert.equal(verdict.klass, "domain-moved");
  assert.match(verdict.evidence[0], /demo\.example\.com → demo2\.example\.com/);
});

test("计费模式变化归 structure-changed", () => {
  const verdict = classify({
    result: result({ billingModes: { tokens: 10, calls: 10 } }),
    baseline: baselineOf()
  });
  assert.equal(verdict.klass, "structure-changed");
});

test("模型数跌破七成归 catalog-shrunk", () => {
  const verdict = classify({ result: result({ pricedModels: 10, rows: 10 }), baseline: baselineOf() });
  assert.equal(verdict.klass, "catalog-shrunk");
  assert.match(verdict.evidence[0], /20 → 10/);
});

test("倍率基准和币种变化归 price-drift", () => {
  const ratio = classify({ result: result({ ratioBase: 1 }), baseline: baselineOf() });
  assert.equal(ratio.klass, "price-drift");

  const currency = classify({ result: result({ currency: ["USD"] }), baseline: baselineOf() });
  assert.equal(currency.klass, "price-drift");
});

test("单模型三倍以上变动会被点名", () => {
  const verdict = classify({
    result: result({ priceSamples: [["gpt-4o", 30, 60], ["gpt-4o-mini", 1, 2]] }),
    baseline: baselineOf(),
    lastSamples: samplesMap([["gpt-4o", 10, 20], ["gpt-4o-mini", 1, 2]])
  });
  assert.equal(verdict.klass, "price-drift");
  assert.ok(verdict.evidence.some(text => text.includes("gpt-4o") && text.includes("3x")));
});

test("中位价整体偏移归 price-drift", () => {
  const verdict = classify({
    result: result({ priceSamples: [["a", 12, 24], ["b", 15, 30], ["c", 20, 40]] }),
    baseline: baselineOf(),
    lastSamples: samplesMap([["a", 10, 20], ["b", 10, 20], ["c", 10, 20]])
  });
  assert.equal(verdict.klass, "price-drift");
  assert.ok(verdict.evidence.some(text => text.includes("中位价")));
});

test("价格没动就报 ok", () => {
  const verdict = classify({
    result: result({ priceSamples: [["a", 10, 20], ["b", 10, 20]] }),
    baseline: baselineOf(),
    lastSamples: samplesMap([["a", 10, 20], ["b", 10, 20]])
  });
  assert.equal(verdict.klass, "ok");
  assert.deepEqual(verdict.evidence, []);
});

test("状态机：green → yellow → red → obsolete → 恢复", () => {
  assert.equal(nextLevel("green", "structure-changed"), "yellow");
  assert.equal(nextLevel("yellow", "structure-changed"), "red");
  assert.equal(nextLevel("red", "structure-changed"), "obsolete");
  assert.equal(nextLevel("obsolete", "structure-changed"), "obsolete");
  assert.equal(nextLevel("obsolete", "ok"), "green");
  assert.equal(nextLevel("green", "ok"), "green");
});

test("认证墙冻结退役计时", () => {
  assert.equal(nextLevel("green", "auth-wall"), "green");
  assert.equal(nextLevel("yellow", "auth-wall"), "yellow");
  assert.equal(nextLevel("red", "auth-wall"), "red");
});

test("限流不算坏，不推进计时", () => {
  assert.equal(nextLevel("green", "timeout"), "yellow");
});

test("汇总统计出新增待处理与恢复名单", () => {
  const items = [
    { id: "a", klass: "structure-changed", level: "red" },
    { id: "b", klass: "ok", level: "green" },
    { id: "c", klass: "price-drift", level: "green" }
  ];
  const counts = summarizeHealth(items, { a: "yellow", b: "red", c: "green" });
  assert.equal(counts.total, 3);
  assert.deepEqual(counts.escalated, ["a"]);
  assert.deepEqual(counts.recovered, ["b"]);
  assert.equal(counts.byClass["structure-changed"], 1);
});

test("状态文件按修法分组，坏站不会串到补丁组", () => {
  const items = [
    { id: "broken", name: "Broken", klass: "structure-changed", level: "red", evidence: ["parse：无价格行 | 带竖线"] },
    { id: "drift", name: "Drift", klass: "price-drift", level: "green", evidence: ["中位价 1.4x"] },
    { id: "dead", name: "Dead", klass: "http-error", level: "obsolete", evidence: ["HTTP 503"] }
  ];
  const counts = summarizeHealth(items, {});
  const markdown = renderStatus({ items, counts, generatedAt: "2026-01-01T00:00:00.000Z" });
  assert.match(markdown, /## 需要发版处理/);
  assert.match(markdown, /## 报价变化，可走补丁/);
  assert.match(markdown, /## 退役候选/);
  assert.match(markdown, /无价格行 ／ 带竖线/);
  const fixGroup = markdown.split("## 报价变化，可走补丁")[1].split("##")[0];
  assert.doesNotMatch(fixGroup, /broken/);
});

test("退出码：有新增待处理为 1，空跑为 2", () => {
  assert.equal(exitCodeForHealth({ total: 0, escalated: [] }), 2);
  assert.equal(exitCodeForHealth({ total: 3, escalated: [] }), 0);
  assert.equal(exitCodeForHealth({ total: 3, escalated: ["a"] }), 1);
});
