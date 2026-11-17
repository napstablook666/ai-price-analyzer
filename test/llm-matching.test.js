import test from "node:test";
import assert from "node:assert/strict";

import {
  ASSIST_MAX_ATTEMPTS,
  applyAssistResults,
  assistFailureLabel,
  assistMaxTokens,
  assistFingerprint,
  buildAssistEntries,
  buildAssistPrompt,
  cacheKey,
  collapseAssistEntries,
  collectUnmatchedModels,
  llmMatchesFromCache,
  overrideFromAssist,
  parseAssistResponse,
  assistPoolOf,
  buildAssistPool,
  poolSummaryLabel,
  selectPendingEntries,
  spreadAssistResults,
  summarizePool,
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
  const parsed = parseAssistResponse("```\n1 => gpt-5-5 92\n2 => none\n```", { entries });
  assert.equal(parsed.accepted.length, 2);
  assert.equal(parsed.accepted[0].status, "accepted");
  assert.equal(parsed.accepted[0].targetId, "gpt-5-5");
  assert.equal(parsed.accepted[0].confidence, 0.92);
  assert.equal(parsed.accepted[1].status, "none");
  // 不写分数的模型按 80 算，老习惯照样能用。
  assert.equal(parseAssistResponse("1 => gpt-5-5", { entries }).accepted[0].status, "accepted");
  // 分数不到线就是「不是」，id 对得上也不收。
  const lowScore = parseAssistResponse("1 => gpt-5-5 40", { entries });
  assert.equal(lowScore.accepted[0].status, "none");
  assert.equal(lowScore.accepted[0].targetId, "");

  // 编造的 id 候选里没有，同样记「不是」，结论不再分裂出第三种。
  const invented = parseAssistResponse("1 => gpt-9-ultra", { entries });
  assert.equal(invented.accepted.length, 1);
  assert.equal(invented.accepted[0].status, "none");
  assert.equal(invented.invalid.length, 0);
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

test("超时失败不占用重试上限，下次还能再问", () => {
  const entry = entriesFor(["gpt5.5-turbo"])[0];
  const cache = {
    [entry.key]: { stationId: "s1", modelName: "gpt5.5-turbo", targetId: "", status: "failed", confidence: 0, attempts: ASSIST_MAX_ATTEMPTS, reason: "timeout", fingerprint: "旧指纹", referencesFetchedAt: 100 }
  };
  const { pending } = selectPendingEntries({ cache, entries: [entry], referencesFetchedAt: 100 });
  assert.equal(pending.length, 1);
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
test("同写法同候选的站点条目合并成一次请求，答案摊回各站点", () => {
  const [left, right] = buildAssistEntries({
    unmatched: [
      { stationId: "s1", stationName: "中转 A", modelName: "claude4.5sonnet", count: 1 },
      { stationId: "s2", stationName: "中转 B", modelName: "claude4.5sonnet", count: 1 }
    ],
    officialList: official,
    referencesFetchedAt: 100
  });
  const { primary, followers } = collapseAssistEntries([left, right]);
  assert.equal(primary.length, 1);
  assert.equal(primary[0].key, left.key);
  assert.deepEqual(followers.get(left.key).map(entry => entry.stationId), ["s2"]);

  const spread = spreadAssistResults([
    { key: left.key, stationId: "s1", modelName: "claude4.5sonnet", targetId: "claude-sonnet-4-5", status: "accepted", confidence: 0.8 }
  ], followers);
  assert.equal(spread.length, 2);
  assert.equal(spread[1].key, right.key);
  assert.equal(spread[1].stationId, "s2");
  assert.equal(spread[1].targetId, "claude-sonnet-4-5");
  assert.equal(spread[1].modelName, "claude4.5sonnet");
});

test("候选不同的写法不合并，各问各的", () => {
  const entries = entriesFor(["gpt5.5-turbo", "gemini-3.8-flash-2025-01"]).map((entry, index) => ({ ...entry, stationId: `s${index + 1}` }));
  const { primary, followers } = collapseAssistEntries(entries);
  assert.equal(primary.length, 2);
  assert.equal([...followers.values()].flat().length, 0);
});

test("输出上限随批大小放大，空值退回默认批大小", () => {
  assert.equal(assistMaxTokens(1), 1064);
  assert.equal(assistMaxTokens(5), 1224);
  assert.ok(assistMaxTokens(20) > assistMaxTokens(5));
  assert.equal(assistMaxTokens(0), 1224);
  assert.deepEqual(spreadAssistResults([{ key: "a" }], new Map()), [{ key: "a" }]);
});

test("失败原因写进缓存，超时和漏答分得开", () => {
  const entry = entriesFor(["gpt5.5-turbo"])[0];
  const timedOut = applyAssistResults({}, [], { notAsked: [{ ...entry, reason: "timeout", error: "模型请求超时（180 秒）" }] });
  assert.equal(timedOut[entry.key].reason, "timeout");
  assert.equal(assistFailureLabel(timedOut[entry.key]), "请求超时：模型请求超时（180 秒）");

  const missing = applyAssistResults({}, [], { notAsked: [entry] });
  assert.equal(missing[entry.key].reason, "unanswered");
  assert.equal(assistFailureLabel(missing[entry.key]), "模型没答这条");
  assert.equal(assistFailureLabel({ status: "accepted" }), "");
});

test("已生效的判定留在池里，不会因为匹配成功就从列表里消失", () => {
  // 这是「已接受 37 但筛选一片空」那个 bug 的回归：accepted 条目已不在 unmatched 里，
  // 池子必须从缓存补回来，否则转人工确认按钮永远 0 条。
  const cache = {
    [cacheKey("s1", "gemini-3.8-flash")]: { stationId: "s1", modelName: "gemini-3.8-flash", targetId: "gemini-3-8-flash", status: "accepted", confidence: 0.8, attempts: 1, at: 1 },
    [cacheKey("s1", "完全无关的模型")]: { stationId: "s1", modelName: "完全无关的模型", targetId: "", status: "none", attempts: 1, at: 2 }
  };
  const rows = [
    { key: cacheKey("s1", "全新写法"), stationId: "s1", stationName: "中转 A", modelName: "全新写法", count: 3, candidates: 2, status: "pending" },
    { key: cacheKey("s1", "另一个怪名"), stationId: "s1", stationName: "中转 A", modelName: "另一个怪名", count: 1, candidates: 0, status: "none", reason: "no-candidates" }
  ];
  const { pool } = buildAssistPool({
    cache,
    rows,
    stationNameById: new Map([["s1", "中转 A"]]),
    unmatchedKeys: new Set(rows.map(row => row.key))
  });
  assert.equal(pool.length, 4);
  const active = pool.filter(entry => entry.pool === "matched");
  assert.equal(active.length, 1);
  assert.equal(active[0].targetId, "gemini-3-8-flash");
  // 站点名从 stationNameById 补：已生效条目已经不在 unmatched 里，拿不到行的站点名。
  assert.equal(active[0].stationName, "中转 A");
  assert.deepEqual(summarizePool(pool).counts, { matched: 1, unmatched: 1, confirm: 2 });
});

test("失败按原因进待确认：超时和漏答分开计数，重试到顶单独标出来", () => {
  const key = name => cacheKey("s1", name);
  const cache = {
    [key("超时的")]: { stationId: "s1", modelName: "超时的", status: "failed", reason: "timeout", attempts: 9 },
    [key("漏答一次")]: { stationId: "s1", modelName: "漏答一次", status: "failed", reason: "unanswered", attempts: 1 },
    [key("漏答到顶")]: { stationId: "s1", modelName: "漏答到顶", status: "failed", reason: "unanswered", attempts: ASSIST_MAX_ATTEMPTS }
  };
  // 报价还在的条目才有 count，没有 rows 会被当成下架出池。
  const rows = Object.entries(cache).map(([key, entry]) => ({ key, stationId: entry.stationId, modelName: entry.modelName, count: 1, candidates: 1 }));
  const { pool } = buildAssistPool({ cache, rows });
  const byName = Object.fromEntries(pool.map(entry => [entry.modelName, entry.pool]));
  // 报错的一律进待确认：超时是环境问题，但也算「问过了没成」。
  assert.equal(byName["超时的"], "confirm");
  assert.equal(byName["漏答一次"], "confirm");
  assert.equal(byName["漏答到顶"], "confirm");
  const summary = summarizePool(pool);
  assert.deepEqual(summary.failures, { timeout: 1, error: 0, unanswered: 2 });
  assert.equal(summary.settled.exhausted, 1);
  assert.match(poolSummaryLabel(summary), /待确认 3/);
});

test("已生效的写法又出现在未匹配里，标成失效而不是静默重复", () => {
  const key = cacheKey("s1", "gemini-3.8-flash");
  const cache = { [key]: { stationId: "s1", modelName: "gemini-3.8-flash", targetId: "已下架的id", status: "accepted", attempts: 1 } };
  const rows = [{ key, stationId: "s1", stationName: "中转 A", modelName: "gemini-3.8-flash", count: 2, candidates: 3, status: "pending" }];
  const { pool } = buildAssistPool({ cache, rows, unmatchedKeys: new Set([key]) });
  assert.equal(pool.length, 1);
  assert.equal(pool[0].pool, "matched");
  assert.equal(pool[0].stale, true);
  assert.equal(summarizePool(pool).stale, 1);
});

test("超时进入冷却期，冷却没到不再重发，到期自动回来", () => {
  const entry = entriesFor(["gpt5.5-turbo"])[0];
  const cooling = {
    [entry.key]: { stationId: "s1", modelName: "gpt5.5-turbo", status: "failed", reason: "timeout", attempts: 1, nextRetryAt: Date.now() + 60_000, fingerprint: "旧指纹", referencesFetchedAt: 100 }
  };
  assert.equal(selectPendingEntries({ cache: cooling, entries: [entry], referencesFetchedAt: 100 }).pending.length, 0);
  const rows = Object.entries(cooling).map(([key, entry]) => ({ key, stationId: entry.stationId, modelName: entry.modelName, count: 1, candidates: 1 }));
  const { pool } = buildAssistPool({ cache: cooling, rows });
  assert.equal(pool[0].cooling, true);
  assert.equal(summarizePool(pool).cooling, 1);

  const expired = {
    [entry.key]: { ...cooling[entry.key], nextRetryAt: Date.now() - 1000 }
  };
  assert.equal(selectPendingEntries({ cache: expired, entries: [entry], referencesFetchedAt: 100 }).pending.length, 1);
});

test("超时记下冷却到期时间，漏答不记", () => {
  const entry = entriesFor(["gpt5.5-turbo"])[0];
  const timedOut = applyAssistResults({}, [], { notAsked: [{ ...entry, reason: "timeout" }] });
  assert.ok(timedOut[entry.key].nextRetryAt > Date.now());
  const missed = applyAssistResults({}, [], { notAsked: [{ ...entry, reason: "unanswered" }] });
  assert.equal(missed[entry.key].nextRetryAt, 0);
});

test("报价里消失的待判条目出池，定过论的不出", () => {
  const key = name => cacheKey("s1", name);
  const cache = {
    [key("下架的")]: { stationId: "s1", modelName: "下架的", status: "none", targetId: "" },
    [key("放弃的")]: { stationId: "s1", modelName: "放弃的", status: "failed", reason: "unanswered", attempts: 9 },
    [key("接受过的")]: { stationId: "s1", modelName: "接受过的", status: "accepted", targetId: "gpt-5-5" }
  };
  const { pool, orphans } = buildAssistPool({ cache });
  assert.deepEqual(orphans.map(item => item.modelName), ["放弃的"]);
  assert.deepEqual(pool.map(item => item.modelName).sort(), ["下架的", "接受过的"].sort());
  assert.equal(summarizePool(pool, orphans).orphans, 1);
});

test("三区分法：没问过是未匹配，试过没成是待确认，归位了是已匹配", () => {
  assert.equal(assistPoolOf({}), "unmatched");
  assert.equal(assistPoolOf({ status: "pending", attempts: 0 }), "unmatched");
  assert.equal(assistPoolOf({ status: "none" }), "confirm");
  assert.equal(assistPoolOf({ status: "failed", reason: "error", attempts: 1 }), "confirm");
  assert.equal(assistPoolOf({ status: "failed", reason: "timeout", attempts: 9 }), "confirm");
  assert.equal(assistPoolOf({ status: "ignored" }), "confirm");
  assert.equal(assistPoolOf({ status: "invalid" }), "confirm");
  assert.equal(assistPoolOf({ status: "accepted", targetId: "gpt-5-5" }), "matched");
  // 人工指定压过一切：哪怕 AI 判了「不是」，写过覆盖就算已匹配。
  assert.equal(assistPoolOf({ status: "none", manual: true, targetId: "gpt-5-5" }), "matched");
});

test("人工指定的写法进池，目标以覆盖为准，AI 结论不再挡路", () => {
  const key = cacheKey("s1", "gemini-3.8-flash");
  const cache = { [key]: { stationId: "s1", modelName: "gemini-3.8-flash", targetId: "", status: "none", attempts: 2 } };
  const rows = [{ key, stationId: "s1", stationName: "中转 A", modelName: "gemini-3.8-flash", count: 4, candidates: 3, status: "none" }];
  const { pool } = buildAssistPool({ cache, rows, overrides: [{ stationId: "s1", modelName: "gemini-3.8-flash", officialModelId: "gemini-3-8-flash" }] });
  assert.equal(pool.length, 1);
  assert.equal(pool[0].pool, "matched");
  assert.equal(pool[0].manual, true);
  assert.equal(pool[0].targetId, "gemini-3-8-flash");
  assert.equal(summarizePool(pool).counts.matched, 1);
});

test("只有人工指定、没有 AI 结论、报价也下架的写法照样留在队列里", () => {
  const { pool, orphans } = buildAssistPool({
    cache: {},
    rows: [],
    stationNameById: new Map([["s2", "中转 B"]]),
    overrides: [{ stationId: "s2", modelName: "claude 3.5 sonnet", officialModelId: "claude-sonnet-4-5" }]
  });
  assert.equal(orphans.length, 0);
  assert.equal(pool.length, 1);
  assert.equal(pool[0].pool, "matched");
  assert.equal(pool[0].stationName, "中转 B");
  assert.equal(pool[0].status, "manual");
  assert.equal(pool[0].targetId, "claude-sonnet-4-5");
});

test("人工指定过的写法即使报价下架也不出池，撤销才有地方点", () => {
  const key = cacheKey("s1", "怪名字");
  const cache = { [key]: { stationId: "s1", modelName: "怪名字", status: "failed", reason: "error", attempts: 1 } };
  const { pool, orphans } = buildAssistPool({ cache, overrides: [{ stationId: "s1", modelName: "怪名字", officialModelId: "gpt-5-5" }] });
  assert.equal(orphans.length, 0);
  assert.equal(pool.length, 1);
  assert.equal(pool[0].manual, true);
});

test("忽略的写法留在定论里，清单刷新也不复活", () => {
  const entry = entriesFor(["gpt5.5-turbo"])[0];
  const cache = { [entry.key]: { stationId: "s1", modelName: "gpt5.5-turbo", status: "ignored", fingerprint: "完全不同的指纹" } };
  assert.equal(selectPendingEntries({ cache, entries: [entry], referencesFetchedAt: 100 }).pending.length, 0);
  const { pool, orphans } = buildAssistPool({ cache });
  assert.equal(orphans.length, 0);
  assert.equal(pool[0].pool, "confirm");
  const summary = summarizePool(pool, orphans);
  assert.equal(summary.settled.ignored, 1);
  assert.match(poolSummaryLabel(summary), /待确认 1/);
});
