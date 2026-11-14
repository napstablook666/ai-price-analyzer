import { DEFAULT_MATCHING_RULES } from "../shared/schema.js";
import { canonicalKeysForModel, getCanonicalIndex, resolveCanonicalModel } from "./canonical.js";


const MODEL_ALIASES = {
  "deepseek-v4.1-flash": ["deepseek-v4-flash", "deepseek-flash"]
};

export function normalizeProxyModelName(name) {
  return String(name || "").trim().toLowerCase()
    .replace(/^(?:\[[^\]]*\]\s*)+/, "")
    .replace(/-expires-on-\d{4}(?:-\d{2}-\d{2})?$/, "");
}

function cleanModelName(name) {
  const value = String(name || "").toLowerCase();
  for (const prefix of ["openai/", "anthropic/", "google/", "meta/", "deepseek/", "qwen/", "azure/"]) {
    if (value.startsWith(prefix)) return value.slice(prefix.length);
  }
  return value;
}

function removeVersion(name) {
  return String(name || "")
    .replace(/-expires-on-\d{4}(?:-\d{2}-\d{2})?$/, "")
    .replace(/-\d{8}$/, "")
    .replace(/-v\d+(?:\.\d+)*$/, "")
    .replace(/\s+/g, "");
}

function getOfficialNames(model) {
  return [...new Set([model?.name, ...(model?.aliases || [])].filter(Boolean).map(value => String(value).toLowerCase()))];
}

function exactNames(name) {
  const raw = String(name || "").trim().toLowerCase();
  const normalized = normalizeProxyModelName(raw);
  return [...new Set([raw, normalized, ...(MODEL_ALIASES[raw] || []), ...(MODEL_ALIASES[normalized] || [])])];
}

function addIndexedModel(index, key, modelIndex) {
  let values = index.get(key);
  if (!values) index.set(key, values = new Set());
  values.add(modelIndex);
}


function modelsForIndexes(indexes, index) {
  return [...indexes].sort((left, right) => left - right).map(modelIndex => index.models[modelIndex]);
}

export function buildModelMatchIndex(officialList = [], overrides = [], { canonicalIndex = getCanonicalIndex(), modelAliases = {}, llmMatches = {} } = {}) {
  const index = {
    models: officialList,
    namesByModel: [],
    byName: new Map(),
    byVersionlessName: new Map(),
    byCanonical: new Map(),
    canonicalIndex,
    modelById: new Map(),
    overridesByStation: new Map(),
    aliasesByStation: new Map(),
    llmByStation: new Map()
  };
  officialList.forEach((model, modelIndex) => {
    const names = getOfficialNames(model);
    index.namesByModel.push(names);
    const id = model.id || model.name;
    if (!index.modelById.has(id)) index.modelById.set(id, model);
    for (const name of names) {
      addIndexedModel(index.byName, name, modelIndex);
      addIndexedModel(index.byVersionlessName, removeVersion(name), modelIndex);
    }
    if (canonicalIndex) {
      const canonicalKeys = canonicalKeysForModel(model);
      for (const key of canonicalKeys) addIndexedModel(index.byCanonical, key, modelIndex);
      // 同一规范模型下的不同官方条目（-1017、:batch 等别名）也要能按 canonical id 一起取出。
      for (const key of canonicalKeys) {
        const owner = canonicalIndex.byKey.get(key);
        if (owner?.id) addIndexedModel(index.byCanonical, owner.id, modelIndex);
      }
    }
  });
  for (const [stationId, aliases] of Object.entries(modelAliases || {})) {
    const normalized = new Map();
    for (const item of aliases || []) {
      const alias = normalizeProxyModelName(item?.alias ?? item?.modelName ?? "");
      const target = String(item?.canonicalId ?? item?.officialModelId ?? "").trim();
      if (alias && target && !normalized.has(alias)) normalized.set(alias, target);
    }
    if (normalized.size) index.aliasesByStation.set(stationId, normalized);
  }
  for (const [stationId, matches] of Object.entries(llmMatches || {})) {
    const normalized = new Map();
    for (const [name, target] of Object.entries(matches || {})) {
      const alias = normalizeProxyModelName(name);
      const value = String(target || "").trim();
      if (alias && value && !normalized.has(alias)) normalized.set(alias, value);
    }
    if (normalized.size) index.llmByStation.set(stationId, normalized);
  }
  for (const override of overrides) {
    let stationOverrides = index.overridesByStation.get(override.stationId);
    if (!stationOverrides) index.overridesByStation.set(override.stationId, stationOverrides = new Map());
    const modelName = normalizeProxyModelName(override.modelName);
    if (!stationOverrides.has(modelName)) stationOverrides.set(modelName, override.officialModelId);
  }
  return index;
}

export function matchModel(proxyName, officialList = [], rules = DEFAULT_MATCHING_RULES, index = buildModelMatchIndex(officialList)) {
  const rawName = String(proxyName || "").trim().toLowerCase();
  const normalized = normalizeProxyModelName(rawName);
  const activeRules = rules?.length ? rules : DEFAULT_MATCHING_RULES;
  // 规范模型优先：中转站随便写什么名字，只要归一后命中同一模型身份就统一。
  if (index.canonicalIndex && activeRules.some(rule => rule?.enabled)) {
    const canonical = resolveCanonicalModel(rawName, index.canonicalIndex);
    const candidateIndexes = canonical && index.byCanonical.get(canonical.id);
    if (candidateIndexes?.size) {
      return modelsForIndexes(candidateIndexes, index).map(match => ({ match, rule: "规范模型", ruleId: "canonical", confidence: 1, canonical }));
    }
  }
  for (const rule of activeRules) {
    if (!rule?.enabled) continue;
    let matches = [];
    if (rule.id === "exact") {
      const candidateIndexes = new Set();
      for (const name of exactNames(rawName)) for (const modelIndex of index.byName.get(name) || []) candidateIndexes.add(modelIndex);
      matches = modelsForIndexes(candidateIndexes, index);
    } else if (rule.id === "suffix") {
      const cleanProxy = cleanModelName(normalized);
      matches = index.models.filter((model, modelIndex) => index.namesByModel[modelIndex].some(name => {
        const cleanOfficial = cleanModelName(name);
        return cleanProxy === cleanOfficial || normalized.endsWith(name) || name.endsWith(cleanProxy);
      }));
    } else if (rule.id === "ignore_version") {
      matches = modelsForIndexes(index.byVersionlessName.get(removeVersion(normalized)) || [], index);
    } else if (rule.id === "fuzzy") {
      let best;
      let bestScore = 0;
      for (let modelIndex = 0; modelIndex < index.namesByModel.length; modelIndex++) {
        for (const name of index.namesByModel[modelIndex]) {
          if (!normalized.includes(name) && !name.includes(normalized)) continue;
          const score = Math.min(normalized.length, name.length) / Math.max(normalized.length, name.length);
          if (score > 0.6 && score > bestScore) {
            best = index.models[modelIndex];
            bestScore = score;
          }
        }
      }
      if (best) matches = [best];
    }
    if (matches.length) {
      const confidence = rule.id === "exact" ? 1 : 0.75;
      return matches.map(match => ({ match, rule: rule.name, ruleId: rule.id, confidence }));
    }
  }
  return [];
}

export function matchModelWithOverrides(proxyName, officialList = [], { stationId = "", overrides = [], rules, index, canonicalIndex, llmMatches = {} } = {}) {
  const matchingIndex = index || buildModelMatchIndex(officialList, overrides, { canonicalIndex, llmMatches });
  const normalized = normalizeProxyModelName(proxyName);
  const overrideId = matchingIndex.overridesByStation.get(stationId)?.get(normalized);
  const match = overrideId && matchingIndex.modelById.get(overrideId);
  if (match) return [{ match, rule: "人工确认", ruleId: "manual", confidence: 1 }];
// 插件声明的拼写直接改写成规范 id，再走统一查表。
  const pluginTarget = matchingIndex.aliasesByStation.get(stationId)?.get(normalized);
  if (pluginTarget) {
    const aliased = matchModel(pluginTarget, officialList, rules, matchingIndex);
    if (aliased.length) return aliased.map(result => ({ ...result, rule: "插件拼写", ruleId: "plugin-alias", confidence: 0.95 }));
    const direct = matchingIndex.modelById.get(pluginTarget);
    if (direct) return [{ match: direct, rule: "插件拼写", ruleId: "plugin-alias", confidence: 0.95 }];
  }
  // AI 判定排在规则链之前：只有规则猜不中的写法才进 AI 池，命中了就不让模糊规则再改判。
  const llmTarget = matchingIndex.llmByStation.get(stationId)?.get(normalized);
  if (llmTarget) {
    const llmMatch = matchingIndex.modelById.get(llmTarget);
    if (llmMatch) return [{ match: llmMatch, rule: "AI 判定", ruleId: "llm", confidence: 0.8 }];
  }
  return matchModel(proxyName, officialList, rules, matchingIndex);
}



export function matchOne(proxyName, officialList, rules) {
  return matchModel(proxyName, officialList, rules)[0] || null;
}
