import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { directEntries } from "../scripts/direct-audit.mjs";
import { auditRechargeEntry } from "../scripts/direct-recharge-audit.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(ROOT, "..", ".omt3", "evidence", "direct-recharge-audit.json");
// 审计报告是 npm run audit:recharge 产出的时点产物，不进仓库；缺失时跳过这些断言，
// 让 npm test / verify:clean 不依赖一次真实在线审计的落盘结果。
const reportExists = existsSync(reportPath);

function loadReport(t) {
  if (!reportExists) {
    t.skip("审计报告未生成（npm run audit:recharge）；跳过时点断言");
    return null;
  }
  return JSON.parse(readFileSync(reportPath, "utf8"));
}
test("U3 does not change plugin pricing without confirmed evidence", t => {
  const report = loadReport(t);
  if (!report) return;
  assert.equal(report.total, 89);
  assert.equal(report.confirmed, 0);
  assert.equal(report.states.fail, 0);
  assert.deepEqual(
    report.results.filter(result => result.evidenceLevel === "confirmed"),
    []
  );
});

test("public-pricing stays excluded while the three shared-adapter stations have independent findings", t => {
  const report = loadReport(t);
  if (!report) return;
  assert.equal(report.results.some(result => result.id === "public-pricing"), false);
  for (const id of ["dddai", "liuguang", "soleapi"]) {
    const result = report.results.find(item => item.id === id);
    assert.ok(result, `${id} must have an independent result`);
    assert.equal(result.id, id);
    assert.ok(["WARN", "BLOCKED", "FAIL"].includes(result.state));
  }
});
test("audit report contains no credentials or payment secrets", t => {
  if (!reportExists) {
    t.skip("审计报告未生成（npm run audit:recharge）；跳过时点断言");
    return;
  }
  const reportText = readFileSync(reportPath, "utf8");
  assert.doesNotMatch(reportText, /(?:token|cookie|authorization|password|secret)\s*[:=]\s*[^,}\n]{12,}/i);
  assert.doesNotMatch(reportText, /(?:BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,})/);
});


test("every addable direct station gets its own recharge result without an online report", async () => {
  // 上面几条断言读的是 audit:recharge 的落盘报告，干净签出里没有那个文件就会跳过。
  // 这里不碰磁盘：直接按 directEntries() 驱动一次离线审计，保证覆盖与独立性在任何环境都成立。
  const entries = directEntries();
  assert.equal(entries.length, 87);
  assert.equal(entries.some(entry => entry.id === "public-pricing"), false);

  const shared = entries.filter(entry => ["dddai", "liuguang", "soleapi"].includes(entry.id));
  assert.equal(shared.length, 3);
  assert.equal(new Set(shared.map(entry => entry.host)).size, 3);

  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => ({ data: null })
  });
  const results = await Promise.all(shared.map(entry => auditRechargeEntry(entry, { fetchImpl })));

  assert.deepEqual(results.map(result => result.id).sort(), ["dddai", "liuguang", "soleapi"]);
  for (const result of results) {
    const entry = shared.find(item => item.id === result.id);
    assert.equal(result.host, entry.host);
    assert.ok(result.requests.length > 0, result.id);
    for (const request of result.requests) {
      assert.equal(request.method, "GET");
      assert.equal(request.body, null);
    }
    // 每个站只打自己那一个 origin（www 前缀允许），不跨站、不带查询串污染。
    const origins = new Set(result.requests.map(request => new URL(request.url).origin));
    assert.equal(origins.size, 1, result.id);
    assert.ok(new URL([...origins][0]).hostname.endsWith(entry.host), `${result.id} origin`);
  }
});

test("U3 keeps the recharge audit scope read-only", () => {
  const source = readFileSync(path.join(ROOT, "scripts", "direct-recharge-audit.mjs"), "utf8");
  assert.match(source, /method:\s*["']GET["']/);
  assert.match(source, /body:\s*null/);
  assert.doesNotMatch(source, /recharge-apply/);
  assert.doesNotMatch(source, /method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
});


test("the generated audit report remains in evidence, not a plugin or source directory", () => {
  assert.match(path.relative(ROOT, reportPath).replaceAll(path.sep, "/"), /^\.\.[\/]\.omt3\/evidence\/direct-recharge-audit\.json$/);
});


test("source and generated plugin trees remain separate for U3", () => {
  const pluginBuild = readFileSync(path.join(ROOT, "scripts", "plugin-build.mjs"), "utf8");
  assert.match(pluginBuild, /plugins/);
  assert.ok(!readFileSync(path.join(ROOT, "scripts", "direct-recharge-audit.mjs"), "utf8").includes("writeFileSync(path.join(ROOT, \"src\""));
});


test("the audit report records evidence dates and missing evidence per station", t => {
  const report = loadReport(t);
  if (!report) return;
  for (const result of report.results) {
    assert.ok(Object.hasOwn(result, "evidenceDate"), result.id);
    assert.ok(Array.isArray(result.missingEvidence), result.id);
    assert.ok(Object.hasOwn(result, "rateSource"), result.id);
    assert.ok(Array.isArray(result.tiers), result.id);
    assert.ok(Array.isArray(result.payments), result.id);
  }
});
