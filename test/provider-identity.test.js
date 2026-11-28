import test from "node:test";
import assert from "node:assert/strict";
import { flattenComparisonRows, buildStationIndexes, summarizeComparisons } from "../src/core/pricing.js";
import { normalizeProvider, normalizeProviderSelection, providerLabel, providerSearchText } from "../src/shared/provider-identity.js";

const aliasGroups = [
  ["meta", "meta-llama", "~META-LLAMA"],
  ["zai", "z-ai", "ZAI-Org", " Z.AI "],
  ["bytedance", "bytedance-seed", "ByteDance"],
  ["tencent", "tencentqq", "Tencent"],
  ["deepseek", "deepseek-ai", "~~DeepSeek"],
  ["xai", "x-ai", "xAI"],
  ["ibm", "ibm-granite", "IBM"]
];

function comparisonsFor(providers) {
  return providers.map((provider, index) => ({
    canonicalModel: `model-${index}`,
    provider,
    comparisonGroup: "standard",
    offers: [{ provider, stationId: "one", modelName: `model-${index}`, officialName: `official-${index}`, monthlyCost: index + 1, blendedUnitPrice: 2, officialBlendedUnitPrice: 4, prices: { input: index, output: null } }]
  }));
}

test("旧报价经生产展开接口合并品牌，保留报价、价格、模型与原数据", () => {
  const input = comparisonsFor(aliasGroups.flat());
  const original = structuredClone(input);
  const rows = flattenComparisonRows(input);
  assert.equal(rows.length, input.length);
  assert.equal(new Set(rows.map(row => row.provider)).size, aliasGroups.length);
  rows.forEach((row, index) => {
    assert.equal(row.provider, normalizeProvider(original[index].provider));
    assert.equal(row.canonicalModel, original[index].canonicalModel);
    assert.deepEqual({ ...row, provider: original[index].provider }, { ...original[index].offers[0], canonicalModel: original[index].canonicalModel });
  });
  assert.deepEqual(input, original);
  assert.equal(summarizeComparisons(input).offerCount, input.length);
  assert.equal(buildStationIndexes(input)[0].median, 0.5);
});

test("旧勾选与常用名单用同一身份去重，仍然命中所有别名报价", () => {
  const rows = flattenComparisonRows(comparisonsFor(aliasGroups.flat()));
  for (const [id, ...aliases] of aliasGroups) {
    const selected = normalizeProviderSelection(aliases);
    assert.deepEqual(selected, [id]);
    assert.equal(rows.filter(row => selected.includes(row.provider)).length, aliases.length + 1);
  }
});

test("保留全选、清空、非法存储和未知供应商的语义", () => {
  assert.equal(normalizeProviderSelection(null), null);
  assert.equal(normalizeProviderSelection({ provider: "meta" }), null);
  assert.deepEqual(normalizeProviderSelection([]), []);
  assert.deepEqual(normalizeProviderSelection([null, 12, {}, false, " "]), []);
  assert.deepEqual(normalizeProviderSelection(["~New-Author", "new-author", "meta-llama", "Meta"]), ["new-author", "meta"]);
  assert.equal(normalizeProvider(null), "");
});

test("独立作者、托管平台和相近名称不误合并", () => {
  const independent = ["anthracite-org", "anthropic", "azure", "azure-cognitive-services", "microsoft", "openai", "qwen", "alibabacloud", "fireworks", "openrouter", "nousresearch", "sao10k", "undi95", "thedrummer", "cohere", "cohereai-other"];
  const rows = flattenComparisonRows(comparisonsFor(independent));
  assert.deepEqual(rows.map(row => row.provider), independent);
});

test("显示名称与搜索兼容品牌名、旧别名和未知作者", () => {
  assert.equal(providerLabel("meta-llama"), "Meta");
  assert.equal(providerLabel("zai-org"), "Z.AI");
  assert.equal(providerLabel("  New-Author  "), "New-Author");
  assert.match(providerSearchText("meta").toLowerCase(), /meta-llama/);
  assert.match(providerSearchText("zai").toLowerCase(), /z-ai.*zai-org/);
  assert.match(providerSearchText("bytedance").toLowerCase(), /bytedance-seed/);
});

test("缺少报价供应商时仅回退到该 comparison 的供应商", () => {
  const comparisons = [{ canonicalModel: "same", provider: "meta-llama", offers: [{ monthlyCost: 0 }, { provider: "", monthlyCost: null }] }];
  assert.deepEqual(flattenComparisonRows(comparisons).map(row => row.provider), ["meta", ""]);
});
