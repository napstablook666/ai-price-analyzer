import test from "node:test";
import assert from "node:assert/strict";

import { buildModelMatchIndex, matchModel, matchModelWithOverrides } from "../src/core/matching.js";
import { registerSiteProvider, resetProviderRegistry, modelAliasesForStation } from "../src/core/provider-registry.js";

const official = [
  { id: "glm-5-3", name: "GLM-5.3", canonicalSlug: "glm-5-3" },
  { id: "claude-sonnet-4-5", name: "Claude Sonnet 4.5" }
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
  assert.equal(results[0].match.id, "claude-sonnet-4-5");
  const aliased = matchModel("claude-4-5-sonnet", official, undefined, index);
  assert.equal(aliased[0].match.id, "claude-sonnet-4-5");
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