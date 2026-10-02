import { DEFAULT_MATCHING_RULES } from "../shared/schema.js";

export const JEV_MODEL_CANDIDATE_LIMIT = 40;
const GENERIC_MODEL_TOKENS = new Set(["chat", "instruct", "latest", "model"]);

export const MODEL_ALIASES = {
  "deepseek-v4.1-flash": ["deepseek-v4-flash", "deepseek-flash"]
};

export function normalizeProxyModelName(name) {
  return String(name || "").trim().toLowerCase()
    .replace(/^(?:\[[^\]]*\]\s*)+/, "")
    .replace(/-expires-on-\d{4}(?:-\d{2}-\d{2})?$/, "");
}

export function cleanModelName(name) {
  const value = String(name || "").toLowerCase();
  for (const prefix of ["openai/", "anthropic/", "google/", "meta/", "deepseek/", "qwen/", "azure/"]) {
    if (value.startsWith(prefix)) return value.slice(prefix.length);
  }
  return value;
}

export function removeVersion(name) {
  return String(name || "")
    .replace(/-expires-on-\d{4}(?:-\d{2}-\d{2})?$/, "")
    .replace(/-\d{8}$/, "")
    .replace(/-v\d+(?:\.\d+)*$/, "")
    .replace(/\s+/g, "");
}

export function getOfficialNames(model) {
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

export function buildModelMatchIndex(officialList = [], overrides = []) {
  const index = {
    models: officialList,
    namesByModel: [],
    byName: new Map(),
    byVersionlessName: new Map(),
    modelById: new Map(),
    overridesByStation: new Map()
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
  });
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
  for (const rule of rules?.length ? rules : DEFAULT_MATCHING_RULES) {
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

export function matchModelWithOverrides(proxyName, officialList = [], { stationId = "", overrides = [], rules, index } = {}) {
  const matchingIndex = index || buildModelMatchIndex(officialList, overrides);
  const normalized = normalizeProxyModelName(proxyName);
  const overrideId = matchingIndex.overridesByStation.get(stationId)?.get(normalized);
  const match = overrideId && matchingIndex.modelById.get(overrideId);
  return match ? [{ match, rule: "人工确认", ruleId: "manual", confidence: 1 }] : matchModel(proxyName, officialList, rules, matchingIndex);
}

export function suggestModelCandidates(proxyName, officialList = [], limit = JEV_MODEL_CANDIDATE_LIMIT) {
  const tokens = new Set(cleanModelName(normalizeProxyModelName(proxyName)).split(/[^a-z0-9]+/).filter(token => token.length > 1 && !GENERIC_MODEL_TOKENS.has(token)));
  if (!tokens.size) return [];
  const count = Math.min(JEV_MODEL_CANDIDATE_LIMIT, Math.max(1, Math.trunc(Number(limit)) || JEV_MODEL_CANDIDATE_LIMIT));
  // ponytail: token overlap gives JEV a 40-model shortlist; expand only if real matches are missed.
  return officialList.map(model => {
    const score = Math.max(0, ...[...getOfficialNames(model), model?.id, model?.display_name].filter(Boolean).map(name => {
    const candidateTokens = new Set(cleanModelName(name).split(/[^a-z0-9]+/).filter(token => token.length > 1 && !GENERIC_MODEL_TOKENS.has(token)));
      const shared = [...tokens].filter(token => candidateTokens.has(token)).length;
      return shared / Math.max(tokens.size, candidateTokens.size);
    }));
    return { model, score };
  }).filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || String(a.model.id || a.model.name).localeCompare(String(b.model.id || b.model.name)))
    .slice(0, count)
    .map(({ model }) => model);
}

export function getJevModelCandidates(proxyName, officialList = [], rules = DEFAULT_MATCHING_RULES) {
  const directMatches = matchModel(proxyName, officialList, rules);
  const seen = new Set();
  const candidates = [...directMatches.map(result => result.match), ...suggestModelCandidates(proxyName, officialList)]
    .filter(model => {
      const id = String(model?.id || model?.name || "").trim();
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, JEV_MODEL_CANDIDATE_LIMIT);
  return { directMatches, candidates };
}

export function matchOne(proxyName, officialList, rules) {
  return matchModel(proxyName, officialList, rules)[0] || null;
}
