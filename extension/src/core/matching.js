import { DEFAULT_MATCHING_RULES } from "../shared/schema.js";

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

export function matchModel(proxyName, officialList = [], rules = DEFAULT_MATCHING_RULES) {
  const rawName = String(proxyName || "").trim().toLowerCase();
  const normalized = normalizeProxyModelName(rawName);
  for (const rule of rules?.length ? rules : DEFAULT_MATCHING_RULES) {
    if (!rule?.enabled) continue;
    let matches = [];
    if (rule.id === "exact") {
      const names = exactNames(rawName);
      matches = officialList.filter(model => getOfficialNames(model).some(name => names.includes(name)));
    } else if (rule.id === "suffix") {
      const cleanProxy = cleanModelName(normalized);
      matches = officialList.filter(model => getOfficialNames(model).some(name => {
        const cleanOfficial = cleanModelName(name);
        return cleanProxy === cleanOfficial || normalized.endsWith(name) || name.endsWith(cleanProxy);
      }));
    } else if (rule.id === "ignore_version") {
      const baseProxy = removeVersion(normalized);
      matches = officialList.filter(model => getOfficialNames(model).some(name => removeVersion(name) === baseProxy));
    } else if (rule.id === "fuzzy") {
      let best;
      let bestScore = 0;
      for (const model of officialList) {
        for (const name of getOfficialNames(model)) {
          if (!normalized.includes(name) && !name.includes(normalized)) continue;
          const score = Math.min(normalized.length, name.length) / Math.max(normalized.length, name.length);
          if (score > 0.6 && score > bestScore) {
            best = model;
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

export function matchOne(proxyName, officialList, rules) {
  return matchModel(proxyName, officialList, rules)[0] || null;
}
