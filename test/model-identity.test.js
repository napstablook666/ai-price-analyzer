import test from "node:test";
import assert from "node:assert/strict";

import { buildModelMatchIndex, matchModel, matchModelWithOverrides } from "../src/core/matching.js";
import { registerSiteProvider, resetProviderRegistry, modelAliasesForStation } from "../src/core/provider-registry.js";
import { buildCanonicalTable } from "../canonical/build.mjs";
import { sitePlugin as spideraiPlugin } from "../src/site-plugins/providers/spiderai.js";

const official = [
  { id: "glm-5-3", name: "GLM-5.3", canonicalSlug: "glm-5-3" },
  { id: "claude-4-5-sonnet", name: "Claude Sonnet 4.5" }
];

test("不同站的不同写法归到同一个规范模型", () => {
  const index = buildModelMatchIndex(official);
  for (const spelling of ["GLM-5.3", "z-ai/glm-5.3", "glm-5.3:thinking", "[限时] glm-5.3", "glm_5.3"]) {
    const results = matchModel(spelling, official, undefined, index);
    assert.equal(results.length, 1, spelling);
    assert.equal(results[0].match.id, "glm-5-3", spelling);
    assert.equal(results[0].ruleId, "canonical", spelling);
  }
});

test("模型厂商前缀与版本别名不改变身份", () => {
  const index = buildModelMatchIndex(official);
  const results = matchModel("Anthropic: Claude Sonnet 4.5", official, undefined, index);
  assert.equal(results[0].match.id, "claude-4-5-sonnet");
  const aliased = matchModel("claude-sonnet-4-5", official, undefined, index);
  assert.equal(aliased[0].match.id, "claude-4-5-sonnet");
  assert.equal(aliased[0].ruleId, "canonical");
});

test("认不出的模型不硬凑", () => {
  const index = buildModelMatchIndex(official);
  assert.deepEqual(matchModel("完全没听过的模型-9", official, undefined, index), []);
});

test("站点插件的 models.json 别名进入匹配链路", () => {
  resetProviderRegistry();
  const plugin = {
    id: "alias-demo",
    host: "alias.example",
    matches: ({ hostname }) => hostname === "alias.example",
    mode: "direct",
    modelAliases: [{ alias: "超级-模型", canonicalId: "glm-5-3" }]
  };
  registerSiteProvider(plugin);
  const station = { id: "s1", baseUrl: "https://alias.example/" };
  const aliases = modelAliasesForStation(station);
  assert.deepEqual(aliases, [{ alias: "超级-模型", canonicalId: "glm-5-3" }]);
  const index = buildModelMatchIndex(official, [], { modelAliases: { s1: aliases } });
  const results = matchModelWithOverrides("超级-模型", official, { stationId: "s1", index });
  assert.equal(results[0].ruleId, "plugin-alias");
  assert.equal(results[0].match.id, "glm-5-3");
  resetProviderRegistry();
});

test("规范模型表不给浮动别名单独的 ~ 供应商", () => {
  const { models } = buildCanonicalTable({}, { data: [
    { id: "anthropic/claude-sonnet-5.5", name: "Anthropic: Claude Sonnet 5.5", canonical_slug: "anthropic/claude-sonnet-5.5" },
    { id: "~anthropic/claude-sonnet-latest", name: "Anthropic: Claude Sonnet Latest", canonical_slug: "~anthropic/claude-sonnet-latest", alias_target: { slug: "anthropic/claude-sonnet-5.5" } }
  ] });
  assert.equal(models.length, 1);
  assert.equal(models[0].id, "claude-sonnet-5-5");
  assert.equal(models[0].vendor, "anthropic");
  assert.ok(models[0].aliases.includes("~anthropic/claude-sonnet-latest"));
  assert.ok(!models.some(model => String(model.vendor).startsWith("~")));
});

test("构建端与运行时共享同一模型名称归一规则", async () => {
  const { canonicalKey: buildCanonicalKey } = await import("../canonical/build.mjs");
  const { canonicalKey: runtimeCanonicalKey } = await import("../src/core/canonical.js");
  const cases = new Map([
    ["gpt-image-2.5-flare", "gpt-image-2-5"],
    ["gpt-image-2.5-sunburst", "gpt-image-2-5"],
    ["openrouter/anthropic/claude-sonnet-4.6:batch", "claude-sonnet-4-6"],
    ["【限时】GLM-5.3", "glm-5-3"],
    ["qwen/qwen3-235b-a22b-instruct-2507", "qwen3-235b-a22b-instruct-2507"],
    ["model:peft:42@eu", "model"]
  ]);
  for (const [name, expected] of cases) {
    assert.equal(runtimeCanonicalKey(name), expected, name);
    assert.equal(buildCanonicalKey(name), expected, name);
  }
});
// spiderai 页面上的写法带经济版后缀、日期尾巴、版本点号，靠插件别名落到规范模型；删掉任何一条这里就红。
test("spiderai 的别名把站内写法落到同一个规范模型", () => {
  const aliases = spideraiPlugin.modelAliases || [];
  const pairs = Object.fromEntries(aliases.map(entry => [entry.alias, entry.canonicalId]));
  assert.deepEqual(pairs, {
    "deepseek-flash": "deepseek-v4-1-flash",
    "deepseek-flash-economy": "deepseek-v4-1-flash",
    "gemini-3-flash": "gemini-3-flash-preview",
    "gemini-3.1-pro": "gemini-3-1-pro-preview",
    "grok-4.20-0309-reasoning": "grok-4-20",
    "grok-4.20-0309-non-reasoning": "grok-4-20",
    "grok-4.20-multi-agent-0309": "grok-4-20-multi-agent",
    "kimi-k3.1-pro-highspeed": "kimi-k3-1-pro"
  });
  const officialList = [...new Set(aliases.map(entry => entry.canonicalId))]
    .map(id => ({ id, name: id, canonicalSlug: id }));
  const index = buildModelMatchIndex(officialList, [], { modelAliases: { spiderai: aliases } });
  for (const { alias, canonicalId } of aliases) {
    const results = matchModelWithOverrides(alias, officialList, { stationId: "spiderai", index });
    assert.equal(results.length, 1, alias);
    assert.equal(results[0].ruleId, "plugin-alias", alias);
    assert.equal(results[0].canonical?.id || results[0].match.id, canonicalId, alias);
  }
});
