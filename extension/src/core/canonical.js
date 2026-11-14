import CANONICAL_TABLE from "./canonical-table.js";

// 规范模型层：把各家各站的不同写法收敛到同一个模型身份。
//
// 表由 canonical/build.mjs 从 models.dev + OpenRouter 生成，归一规则必须与生成器一致：
//   1. 取 id 最后一段，丢掉 openrouter / fireworks/models / @cf/qwen 这类路径前缀
//   2. 去掉装饰后缀 :free :thinking :batch @eu -v1 -YYYYMMDD
//   3. 小写，空格 `.` `_` 一律当作 `-`
//   4. 不做任何版本数字合并，v4.1 与 v4 是两个模型

const DECORATION_PATTERNS = [
  /:(?:free|thinking|official|fast|online|extended|beta|none|auto|batch)$/,
  /:peft:\d+$/,
  /@(?:eu|us|global|jp|au|in|cn|default|\d+)$/,
  /-v\d+(?::\d+)?$/,
  /-(?:19|20)\d{2}(?:0\d|1[0-2])?(?:[0-3]\d)?$/
];

export function stripDecoration(value) {
  let current = String(value || "").toLowerCase().trim();
  for (let round = 0; round < 3; round += 1) {
    const before = current;
    for (const pattern of DECORATION_PATTERNS) current = current.replace(pattern, "");
    if (current === before) break;
  }
  return current;
}

export function bareSpelling(id) {
  const segments = String(id || "").toLowerCase().trim().split("/").filter(Boolean);
  return stripDecoration(segments[segments.length - 1] || "");
}

export function canonicalKey(value) {
  const base = stripBracketPrefix(String(value || "").trim());
  return bareSpelling(base).replace(/[\s._]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

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

export function compareCanonical(left, right) {
  const leftModel = resolveCanonicalModel(left);
  const rightModel = resolveCanonicalModel(right);
  if (!leftModel || !rightModel) return leftModel === rightModel ? 0 : 1;
  return leftModel.id === rightModel.id ? 0 : 1;
}
