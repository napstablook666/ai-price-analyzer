#!/usr/bin/env node
// 规范模型表生成器：拉 models.dev 与 OpenRouter，收敛出统一模型身份。
//
// 用法：
//   node canonical/build.mjs            在线拉取后生成
//   node canonical/build.mjs --offline  只用 canonical/.cache/ 里的原始响应
//
// 产物：canonical/models.json
//
// 归一规则（与 extension/src/core/canonical.js 必须保持一致）：
//   1. 取 id 的最后一段，丢掉 openrouter / fireworks/models / @cf/qwen 这类路径前缀
//   2. 去掉装饰后缀 :free :thinking :official @eu @default -v1 -YYYYMMDD
//   3. 小写，`.` `_` 一律当作 `-`
//   4. 不做任何版本数字合并，v4.1 与 v4 是两个模型

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(HERE, "..", "extension", "src", "core", "canonical-table.js");
const CACHE_DIR = path.join(HERE, ".cache");
const MODELS_DEV_URL = "https://models.dev/api.json";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";
const OFFLINE = process.argv.includes("--offline");

const DECORATIONS = [
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
    for (const pattern of DECORATIONS) current = current.replace(pattern, "");
    if (current === before) break;
  }
  return current;
}

export function bareSpelling(id) {
  const segments = String(id || "").toLowerCase().trim().split("/").filter(Boolean);
  return stripDecoration(segments[segments.length - 1] || "");
}

export function canonicalKey(id) {
  const base = String(id || "").trim().replace(/^(?:[\[【][^\]】]*[\]】]\s*)+/, "");
  return bareSpelling(base).replace(/[\s._]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function vendorOf(id) {
  const segments = String(id || "").split("/").filter(Boolean);
  return segments.length > 1 ? segments[0] : "";
}

function pickWinner(counts) {
  let best = "";
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && value.length > best.length)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function bump(map, key) {
  if (!key) return;
  map.set(key, (map.get(key) || 0) + 1);
}

async function readJson(url, cacheName) {
  const cacheFile = path.join(CACHE_DIR, cacheName);
  if (OFFLINE) {
    if (!fs.existsSync(cacheFile)) throw new Error(`离线模式缺少缓存：${cacheFile}`);
    return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} 返回 ${response.status}`);
  const text = await response.text();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(cacheFile, text);
  return JSON.parse(text);
}

export function buildCanonicalTable(modelsDev, openRouter) {
  const groups = new Map();
  let sourceRows = 0;

  const groupOf = key => {
    let group = groups.get(key);
    if (!group) {
      group = { spellings: new Map(), names: new Map(), vendors: new Map(), providers: new Set(), limits: [], modalities: new Map(), raw: new Map() };
      groups.set(key, group);
    }
    return group;
  };

  for (const [providerId, provider] of Object.entries(modelsDev || {})) {
    for (const model of Object.values(provider?.models || {})) {
      const rawId = String(model?.id || model?.name || "");
      if (!rawId) continue;
      sourceRows += 1;
      const group = groupOf(canonicalKey(rawId));
      bump(group.spellings, bareSpelling(rawId));
      bump(group.raw, rawId);
      if (model?.name) bump(group.names, String(model.name));
      const vendor = vendorOf(rawId) || providerId;
      if (vendor) bump(group.vendors, vendor);
      group.providers.add(providerId);
      if (model?.limit && Number.isFinite(Number(model.limit.context))) {
        group.limits.push({ context: Number(model.limit.context), output: Number(model.limit.output) || 0 });
      }
      for (const kind of model?.modalities?.input || []) bump(group.modalities, String(kind));
    }
  }

  // OpenRouter 负责价格与官方拼写：它的 id / canonical_slug / 短名都算别名。
  for (const model of openRouter?.data || []) {
    const rawId = String(model?.id || "");
    if (!rawId) continue;
    const group = groupOf(canonicalKey(model?.canonical_slug || rawId));
    bump(group.spellings, bareSpelling(rawId));
    bump(group.spellings, bareSpelling(model?.canonical_slug || rawId));
    bump(group.raw, rawId);
    if (model?.name) bump(group.names, String(model.name).replace(/^[^:]+:\s*/, ""));
    const vendor = vendorOf(rawId);
    if (vendor) bump(group.vendors, vendor);
    group.providers.add("openrouter");
    if (Number.isFinite(Number(model?.context_length))) group.limits.push({ context: Number(model.context_length), output: 0 });
  }

  const models = [];
  for (const [key, group] of groups) {
    const spelling = pickWinner(group.spellings) || key;
    const limits = group.limits.sort((left, right) => right.context - left.context)[0] || null;
    // 只留归一后仍然指向别的 key 的拼写：运行时会先归一，同归一结果的别名没有信息量。
    const aliases = [...group.spellings.keys(), ...group.raw.keys()]
      .filter(value => value && canonicalKey(value) !== key)
      .filter((value, position, list) => list.indexOf(value) === position)
      .sort()
      .slice(0, 24);
    models.push({
      id: key,
      spelling,
      name: pickWinner(group.names) || spelling,
      vendor: pickWinner(group.vendors) || "",
      providers: group.providers.size,
      ...(limits?.context ? { limit: { context: limits.context, ...(limits.output ? { output: limits.output } : {}) } } : {}),
      ...(aliases.length ? { aliases } : {})
    });
  }
  // 同一模型可能既被当成独立 id 收集过，又被别的模型列为跨 key 别名（如 deepseek-v4.1-flash-1017）。
  // 合并：留下来源更多的那个，另一个的 id 降级为别名。
  const byId = new Map(models.map(model => [model.id, model]));
  const absorbed = new Map();
  for (const model of models) {
    for (const alias of model.aliases || []) {
      const key = canonicalKey(alias);
      if (!key || key === model.id) continue;
      const other = byId.get(key);
      if (!other || absorbed.has(other.id) || absorbed.has(model.id)) continue;
      const [survivor, victim] = model.providers >= other.providers ? [model, other] : [other, model];
      absorbed.set(victim.id, survivor.id);
      const merged = new Set([...(survivor.aliases || []), victim.id, ...(victim.aliases || [])]);
      merged.delete(survivor.id);
      merged.delete(survivor.spelling);
      survivor.aliases = [...merged].sort().slice(0, 32);
    }
  }
  const merged = models.filter(model => !absorbed.has(model.id));
  merged.sort((left, right) => right.providers - left.providers || left.id.localeCompare(right.id));
  return { sourceRows, models: merged };
}

async function main() {
  const modelsDev = await readJson(MODELS_DEV_URL, "models.dev.json");
  const openRouter = await readJson(OPENROUTER_URL, "openrouter.json");
  const { sourceRows, models } = buildCanonicalTable(modelsDev, openRouter);
  const table = {
    version: 1,
    generatedAt: new Date().toISOString(),
    sources: {
      "models.dev": { url: MODELS_DEV_URL, providers: Object.keys(modelsDev || {}).length, rows: sourceRows },
      openrouter: { url: OPENROUTER_URL, rows: (openRouter?.data || []).length }
    },
    models
  };
  fs.writeFileSync(OUT_FILE, `// 由 canonical/build.mjs 生成，不要手改。重新生成：node canonical/build.mjs\nconst CANONICAL_TABLE = ${JSON.stringify(table)};\n\nexport default CANONICAL_TABLE;\n`);
  const multi = models.filter(model => model.providers > 1).length;
  console.log(`extension/src/core/canonical-table.js  ${models.length} 个模型，其中 ${multi} 个被 2 个以上来源提供，源数据 ${sourceRows} 行，${(fs.statSync(OUT_FILE).size / 1024).toFixed(0)} KB`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
