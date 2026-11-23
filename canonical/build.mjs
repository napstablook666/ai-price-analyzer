#!/usr/bin/env node
// 规范模型表生成器：直接靠齐 OpenRouter 的模型列表，models.dev 只补厂商原生写法别名。
//
// 用法：
//   node canonical/build.mjs            在线拉取后生成
//   node canonical/build.mjs --offline  只用 canonical/.cache/ 里的原始响应
//
// 产物：src/core/canonical-table.js
//
// 归一规则（与 src/core/canonical.js 必须保持一致）：
//   1. 取 id 的最后一段，丢掉 openrouter / fireworks/models / @cf/qwen 这类路径前缀
//   2. 去掉装饰后缀 :free :thinking :official @eu @default -v1 -YYYYMMDD
//   3. 小写，`.` `_` 一律当作 `-`
//   4. 不做任何版本数字合并，v4.1 与 v4 是两个模型
//   5. 入口集合只收 OpenRouter 收录的身份；models.dev 独有的身份不进表，仅以别名并入相邻组
//      例外：SUPPLEMENT_IDENTITIES 白名单里的身份（OpenRouter 未收录的图像模型）允许进场

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bareModelSpelling, canonicalModelKey, stripModelDecoration } from "../src/shared/model-name.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(HERE, "..", "src", "core", "canonical-table.js");
const CACHE_DIR = path.join(HERE, ".cache");
const MODELS_DEV_URL = "https://models.dev/api.json";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/models";
const OFFLINE = process.argv.includes("--offline");

// models.dev 已收录、OpenRouter 尚未收录的图像模型身份。
// 这类 id 只靠 OpenRouter 入口集合会被整组丢弃，站内写法匹配不到规范身份，跨站比价在这些模型上断链；
// 白名单里缺源的 key 会被跳过，不影响其它身份。
const SUPPLEMENT_IDENTITIES = new Set([
  "gpt-image-2-5",
  "gpt-image-2-6"
]);

export const stripDecoration = stripModelDecoration;
export const bareSpelling = bareModelSpelling;
export const canonicalKey = canonicalModelKey;

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
      group = { spellings: new Map(), names: new Map(), vendors: new Map(), providers: new Set(), limits: [], modalities: new Map(), raw: new Map(), openrouter: false, orName: "", orSpelling: "" };
      groups.set(key, group);
    }
    return group;
  };

  // models.dev 补别名与佐证；它独有的身份在出口处统一丢弃。
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

  // OpenRouter 定规范身份：入口集合只认它的模型列表，名称与拼写以它为准。
  for (const model of openRouter?.data || []) {
    const rawId = String(model?.id || "");
    if (!rawId) continue;
    const slug = String(model?.canonical_slug || "");
    // 浮动别名（~vendor/x-latest）不另立身份：归到 alias_target 指向的正式模型，供应商取目标的厂商。
    const aliasTarget = String(model?.alias_target?.slug || "").trim();
    const identity = aliasTarget || slug || rawId;
    const group = groupOf(canonicalKey(identity));
    group.openrouter = true;
    if (!group.orSpelling) group.orSpelling = bareSpelling(identity);
    // 浮动条目只写「Latest」这类名字，正式名字留给目标条目。
    if (!group.orName && !aliasTarget) group.orName = String(model?.name || "").replace(/^[^:]+:\s*/, "");
    bump(group.spellings, bareSpelling(rawId));
    if (slug) bump(group.spellings, bareSpelling(slug));
    bump(group.raw, rawId);
    if (model?.name && !aliasTarget) bump(group.names, String(model.name).replace(/^[^:]+:\s*/, ""));
    const vendor = vendorOf(identity);
    if (vendor) bump(group.vendors, vendor);
    group.providers.add("openrouter");
    if (Number.isFinite(Number(model?.context_length))) group.limits.push({ context: Number(model.context_length), output: 0 });
  }
  // 白名单身份即使 OpenRouter 没收录也允许进场（来源仍只有 models.dev 的行）。
  for (const key of SUPPLEMENT_IDENTITIES) {
    const group = groups.get(key);
    if (group) group.openrouter = true;
  }


  const models = [];
  for (const [key, group] of groups) {
    const spelling = group.orSpelling || pickWinner(group.spellings) || key;
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
      name: group.orName || pickWinner(group.names) || spelling,
      vendor: pickWinner(group.vendors) || "",
      providers: group.providers.size,
      openrouter: group.openrouter,
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
      // 合并方向永远让 OpenRouter 收录的那个活下来。
      const [survivor, victim] = model.openrouter === other.openrouter
        ? (model.providers >= other.providers ? [model, other] : [other, model])
        : (model.openrouter ? [model, other] : [other, model]);
      absorbed.set(victim.id, survivor.id);
      const merged = new Set([...(survivor.aliases || []), victim.id, ...(victim.aliases || [])]);
      merged.delete(survivor.id);
      merged.delete(survivor.spelling);
      survivor.aliases = [...merged].sort().slice(0, 32);
    }
  }
  // 入口集合只收 OpenRouter 收录的身份；models.dev 独有的组丢弃，其拼写只以别名形式留在被并入的组里。
  const merged = models.filter(model => !absorbed.has(model.id) && model.openrouter);
  const droppedCount = models.filter(model => !absorbed.has(model.id) && !model.openrouter).length;
  for (const model of merged) delete model.openrouter;
  merged.sort((left, right) => right.providers - left.providers || left.id.localeCompare(right.id));
  return { sourceRows, models: merged, droppedCount };
}

async function main() {
  const modelsDev = await readJson(MODELS_DEV_URL, "models.dev.json");
  const openRouter = await readJson(OPENROUTER_URL, "openrouter.json");
  const { sourceRows, models, droppedCount } = buildCanonicalTable(modelsDev, openRouter);
  const table = {
    version: 2,
    generatedAt: new Date().toISOString(),
    sources: {
      "models.dev": { url: MODELS_DEV_URL, providers: Object.keys(modelsDev || {}).length, rows: sourceRows },
      openrouter: { url: OPENROUTER_URL, rows: (openRouter?.data || []).length }
    },
    models
  };
  fs.writeFileSync(OUT_FILE, `// 由 canonical/build.mjs 生成，不要手改。重新生成：node canonical/build.mjs\nconst CANONICAL_TABLE = ${JSON.stringify(table)};\n\nexport default CANONICAL_TABLE;\n`);
  const multi = models.filter(model => model.providers > 1).length;
  console.log(`src/core/canonical-table.js  ${models.length} 个模型（OpenRouter 收录），${multi} 个有 models.dev 佐证，丢弃 ${droppedCount} 个 models.dev 独有身份，源数据 ${sourceRows} 行，${(fs.statSync(OUT_FILE).size / 1024).toFixed(0)} KB`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
