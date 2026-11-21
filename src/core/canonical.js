import { bareModelSpelling, canonicalModelKey, stripModelDecoration } from "../shared/model-name.js";
import CANONICAL_TABLE from "./canonical-table.js";

// 规范模型层：把各家各站的不同写法收敛到同一个模型身份。
// 表由 canonical/build.mjs 生成；名称归一规则集中在 shared/model-name.js。
//   1. 路径只取最后一段，例如 openrouter / fireworks/models / @cf/qwen
//   2. 去掉装饰后缀、统一大小写与分隔符
//   3. 不合并版本数字，v4.1 与 v4 是两个模型

export const stripDecoration = stripModelDecoration;
export const bareSpelling = bareModelSpelling;
export const canonicalKey = canonicalModelKey;

export function stripVendorPrefix(name) {
  return String(name || "").replace(/^[^:/\s]{1,24}:\s*/, "");
}

export function buildCanonicalIndex(table = CANONICAL_TABLE) {
  const models = Array.isArray(table?.models) ? table.models : [];
  const byKey = new Map();
  for (const model of models) {
    if (model?.id && !byKey.has(model.id)) byKey.set(model.id, model);
  }
  // 跨 key 别名只填空位，绝不覆盖真实模型 id。
  for (const model of models) {
    for (const alias of model.aliases || []) {
      const key = canonicalKey(alias);
      if (key && !byKey.has(key)) byKey.set(key, model);
    }
  }
  return { version: table?.version || 0, generatedAt: table?.generatedAt || "", models, byKey };
}

let defaultIndex = null;

export function getCanonicalIndex(table) {
  if (table) return buildCanonicalIndex(table);
  if (!defaultIndex) defaultIndex = buildCanonicalIndex(CANONICAL_TABLE);
  return defaultIndex;
}

export function stripBracketPrefix(name) {
  return String(name || "").replace(/^(?:[\[【][^\]】]*[\]】]\s*)+/, "");
}

export function canonicalCandidates(name) {
  const raw = String(name || "").trim();
  const values = new Set([raw, stripBracketPrefix(raw)]);
  for (const value of [...values]) values.add(stripVendorPrefix(value));
  const keys = new Set();
  for (const value of values) {
    const key = canonicalKey(value);
    if (key) keys.add(key);
  }
  return [...keys];
}

export function resolveCanonicalModel(name, index = getCanonicalIndex()) {
  for (const key of canonicalCandidates(name)) {
    const hit = index.byKey.get(key);
    if (hit) return hit;
  }
  return null;
}

// 官方清单（OpenRouter 等）一侧的候选写法：id / shortId / name / slug 都要参与归一。
export function canonicalKeysForModel(model) {
  const values = [model?.id, model?.shortId, model?.canonicalSlug, model?.canonical_slug, model?.name, model?.displayName, ...(Array.isArray(model?.aliases) ? model.aliases : [])];
  const keys = new Set();
  for (const value of values) {
    if (!value) continue;
    for (const candidate of [String(value), stripVendorPrefix(value)]) {
      const key = canonicalKey(candidate);
      if (key) keys.add(key);
    }
  }
  return keys;
}
