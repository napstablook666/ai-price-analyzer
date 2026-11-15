import test from "node:test";
import assert from "node:assert/strict";

import {
  ASSIST_MAX_ATTEMPTS,
  applyAssistResults,
  assistFingerprint,
  buildAssistEntries,
  buildAssistPrompt,
  cacheKey,
  collectUnmatchedModels,
  llmMatchesFromCache,
  overrideFromAssist,
  parseAssistResponse,
  selectPendingEntries,
  suggestModelCandidates,
  summarizeCache
} from "../src/core/llm-matching.js";
import { buildModelMatchIndex, matchModelWithOverrides } from "../src/core/matching.js";

const official = [
  { id: "gemini-3-pro", name: "Gemini 3 Pro" },
  { id: "gemini-3-flash", name: "Gemini 3 Flash" },
  { id: "gemini-3-8-flash", name: "Gemini 3.8 Flash" },
  { id: "gpt-5-5", name: "GPT-5.5" },
  { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" }
];

const unmatched = [
  { stationId: "s1", stationName: "中转 A", modelName: "gemini-3.8-flash-2025-01", count: 2 },
  { stationId: "s1", stationName: "中转 A", modelName: "完全无关的模型", count: 1 }
];

const zero = String.fromCharCode(0);

function entriesFor(modelNames, referencesFetchedAt = 100) {
  return buildAssistEntries({
    unmatched: modelNames.map(modelName => ({ stationId: "s1", stationName: "中转 A", modelName, count: 1 })),
    officialList: official,
    referencesFetchedAt
  });
}

test("候选按名字相似度排序，给判定一个短名单", () => {
  assert.deepEqual(suggestModelCandidates("gemini-3.8-flash-2025-01", official).slice(0, 2).map(model => model.id), ["gemini-3-8-flash", "gemini-3-flash"]);
  assert.deepEqual(suggestModelCandidates("gpt5.5-turbo", official).map(model => model.id), ["gpt-5-5"]);
  assert.deepEqual(suggestModelCandidates("claude4.5sonnet", official).map(model => model.id), ["claude-sonnet-4-5"]);
});

test("完全不沾边的写法没有候选，不进判定队列", () => {
  assert.deepEqual(suggestModelCandidates("完全无关的模型", official), []);
  assert.equal(entriesFor(["完全无关的模型"]).length, 0);
});
test("官方条目缺 id 时按 name 兜底，判定队列不会整池丢空", () => {
  const withoutId = [{ name: "anthropic/claude-sonnet-4", aliases: ["claude-sonnet-4"] }];
  const [entry] = buildAssistEntries({
    unmatched: [{ stationId: "s1", stationName: "中转 A", modelName: "claude-sonnet-4", count: 1 }],
    officialList: withoutId,
    referencesFetchedAt: 100
  });
  assert.equal(entry.candidates[0].id, "anthropic/claude-sonnet-4");
  const [manual] = matchModelWithOverrides("claude-sonnet-4", withoutId, {
    stationId: "s1",
    overrides: [{ stationId: "s1", modelName: "claude-sonnet-4", officialModelId: "anthropic/claude-sonnet-4" }]
  });
  assert.equal(manual.ruleId, "manual");
});

test("缓存键与人工覆盖用同一套归一写法", () => {
  assert.equal(cacheKey("s1", "GPT-5.5"), ["s1", "gpt-5.5"].join(zero));
  assert.equal(cacheKey(" s1 ", "[限时] GLM-5.3"), ["s1", "glm-5.3"].join(zero));
});

test("识别池按站点与写法去重，只收规则落空的模型", () => {
  const rows = [
    { stationId: "s1", stationName: "中转 A", modelName: "gemini-3.8-flash", matchRuleId: "unmatched" },
    { stationId: "s1", stationName: "中转 A", modelName: "gemini-3.8-flash", matchRuleId: "unmatched" },
    { stationId: "s1", stationName: "中转 A", modelName: "gpt-5.5", matchRuleId: "exact" }
  ];
  const pool = collectUnmatchedModels(rows);
  assert.equal(pool.length, 1);
  assert.equal(pool[0].count, 2);
  assert.equal(pool[0].stationId, "s1");
});

test("指纹随候选集合与官方清单时间变化", () => {
  const base = assistFingerprint({ candidateIds: ["a"], referencesFetchedAt: 100 });
  assert.equal(base, assistFingerprint({ candidateIds: ["a"], referencesFetchedAt: 100 }));
  assert.notEqual(base, assistFingerprint({ candidateIds: ["a", "b"], referencesFetchedAt: 100 }));
  assert.notEqual(base, assistFingerprint({ candidateIds: ["a"], referencesFetchedAt: 200 }));
});

test("提示词带候选清单，也带输出协议", () => {
  const entries = entriesFor(["gpt5.5-turbo"]);
  const prompt = buildAssistPrompt(entries);
  assert.match(prompt, /gpt5\.5-turbo/);
  assert.match(prompt, /候选：gpt-5-5/);
  assert.match(prompt, /=> id/);
});

test("解析接受、拒答与编造的 id", () => {
  const entries = entriesFor(["gpt5.5-turbo", "gemini-3.8-flash-2025-01"]);
  const parsed = parseAssistResponse("```\n1 => gpt-5-5\n2 => none\n```", { entries });
  assert.equal(parsed.accepted.length, 2);
  assert.equal(parsed.accepted[0].status, "accepted");
  assert.equal(parsed.accepted[0].targetId, "gpt-5-5");
  assert.equal(parsed.accepted[1].status, "none");

  const invented = parseAssistResponse("1 => gpt-9-ultra", { entries });
  assert.equal(invented.accepted.length, 0);
  assert.equal(invented.invalid[0].status, "invalid");
});

test("同一指纹的结论不重复问模型", () => {
  const entries = entriesFor(["gpt5.5-turbo"]);
  const entry = entries[0];
  const cache = applyAssistResults(
    {},
    [{ key: entry.key, stationId: entry.stationId, modelName: entry.modelName, targetId: "gpt-5-5", status: "accepted", confidence: 0.8 }],
    { fingerprintByKey: { [entry.key]: entry.fingerprint } }
  );
  const { pending, reused } = selectPendingEntries({ cache, entries, referencesFetchedAt: 100 });
  assert.equal(pending.length, 0);
  assert.equal(reused.length, 1);
});

test("官方清单更新后，判过「没有」的写法重新问一次", () => {
  const before = entriesFor(["gpt5.5-turbo"], 100)[0];
  const cache = {
    [before.key]: { stationId: "s1", modelName: "gpt5.5-turbo", targetId: "", status: "none", confidence: 0, attempts: 1, fingerprint: before.fingerprint, referencesFetchedAt: 100 }
  };
  const after = entriesFor(["gpt5.5-turbo"], 200)[0];
  const { pending } = selectPendingEntries({ cache, entries: [after], referencesFetchedAt: 200 });
  assert.equal(pending.length, 1);
  assert.equal(pending[0].fingerprint, after.fingerprint);
});

test("反复失败到上限就停手，不再消耗请求", () => {
  const entry = entriesFor(["gpt5.5-turbo"])[0];
  const cache = {
    [entry.key]: { stationId: "s1", modelName: "gpt5.5-turbo", targetId: "", status: "failed", confidence: 0, attempts: ASSIST_MAX_ATTEMPTS, fingerprint: "旧指纹", referencesFetchedAt: 100 }
  };
  const { pending } = selectPendingEntries({ cache, entries: [entry], referencesFetchedAt: 100 });
  assert.equal(pending.length, 0);
});

test("强制重算忽略已有缓存", () => {
  const entry = entriesFor(["gpt5.5-turbo"])[0];
  const cache = {
    [entry.key]: { stationId: "s1", modelName: "gpt5.5-turbo", targetId: "gpt-5-5", status: "accepted", confidence: 0.8, attempts: 1, fingerprint: entry.fingerprint, referencesFetchedAt: 100 }
  };
  const { pending } = selectPendingEntries({ cache, entries: [entry], referencesFetchedAt: 100, force: true });
  assert.equal(pending.length, 1);
});

test("没被应答的条目记失败，次数累加", () => {
  const entry = entriesFor(["gpt5.5-turbo"])[0];
  const first = applyAssistResults({}, [], { notAsked: [entry] });
  assert.equal(first[entry.key].status, "failed");
  assert.equal(first[entry.key].attempts, 1);
  const second = applyAssistResults(first, [], { notAsked: [entry] });
  assert.equal(second[entry.key].attempts, 2);
});

test("只有接受的结果才进匹配，统计按状态分开", () => {
  const cache = {
    a: { stationId: "s1", modelName: "GPT-5.5", targetId: "gpt-5-5", status: "accepted" },
    b: { stationId: "s1", modelName: "另一个", targetId: "", status: "none" },
    c: { stationId: "s1", modelName: "又一个", targetId: "", status: "invalid" }
  };
  assert.deepEqual(llmMatchesFromCache(cache), { s1: { "gpt-5.5": "gpt-5-5" } });
  assert.deepEqual(summarizeCache(cache), { accepted: 1, none: 1, invalid: 1, failed: 0, total: 3 });
});

test("AI 判定排在插件拼写之后，人工确认压过一切", () => {
  const llmMatches = { s1: { "gpt5.5-turbo": "gpt-5-5" } };
  const llmIndex = buildModelMatchIndex(official, [], { llmMatches });
  const fromAi = matchModelWithOverrides("gpt5.5-turbo", official, { stationId: "s1", index: llmIndex });
  assert.equal(fromAi[0].ruleId, "llm");
  assert.equal(fromAi[0].match.id, "gpt-5-5");

  const overrides = [{ stationId: "s1", modelName: "gpt5.5-turbo", officialModelId: "gemini-3-pro" }];
  const manualIndex = buildModelMatchIndex(official, overrides, { llmMatches });
  const fromHuman = matchModelWithOverrides("gpt5.5-turbo", official, { stationId: "s1", index: manualIndex });
  assert.equal(fromHuman[0].ruleId, "manual");
  assert.equal(fromHuman[0].match.id, "gemini-3-pro");
});

test("接受的结果可以一键转成人工确认", () => {
  assert.deepEqual(overrideFromAssist({ status: "accepted", stationId: "s1", modelName: "GPT-5.5", targetId: "gpt-5-5" }), {
    stationId: "s1",
    modelName: "GPT-5.5",
    officialModelId: "gpt-5-5"
  });
  assert.equal(overrideFromAssist({ status: "none", stationId: "s1", modelName: "x", targetId: "" }), null);
  assert.equal(overrideFromAssist({ status: "invalid", stationId: "s1", modelName: "x", targetId: "y" }), null);
});