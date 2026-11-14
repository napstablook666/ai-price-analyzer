// 查规范模型 id：给插件写 models.json 时用来确认站内写法该归到哪个模型。
//
//   node scripts/model-lookup.mjs glm-5.3
//   node scripts/model-lookup.mjs claude sonnet       多个词按 AND 过滤

import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { canonicalKey, getCanonicalIndex, resolveCanonicalModel, stripVendorPrefix, stripBracketPrefix } = await import(
  pathToFileURL(path.join(root, "extension", "src", "core", "canonical.js")).href
);

const terms = process.argv.slice(2).map(term => term.toLowerCase()).filter(Boolean);
if (!terms.length) {
  console.error("用法：node scripts/model-lookup.mjs <模型写法> [更多词]");
  process.exit(1);
}

const query = terms.join(" ");
const index = getCanonicalIndex();
const exact = resolveCanonicalModel(query, index);

if (exact) {
  console.log(`命中：${exact.id}`);
  console.log(`  名称：${exact.name || exact.spelling}`);
  console.log(`  写法：${[exact.spelling, ...(exact.aliases || [])].join(" | ")}`);
  console.log(`  来源数：${exact.providers || 1}`);
} else {
  const hits = index.models.filter(model => {
    const haystack = [model.id, model.spelling, model.name, ...(model.aliases || [])].join(" ").toLowerCase();
    return terms.every(term => haystack.includes(term));
  });
  if (!hits.length) {
    console.log(`没有匹配：${query}`);
    console.log("自动归一失败时，在插件 models.json 里把它写成 \"站内写法\": \"规范模型 id\"。");
    process.exit(2);
  }
  for (const model of hits.slice(0, 25)) {
    const aliases = (model.aliases || []).length ? `  (别名 ${model.aliases.slice(0, 3).join(", ")})` : "";
    console.log(`${model.id.padEnd(34)} ${String(model.name || "").padEnd(28)} 来源 ${model.providers || 1}${aliases}`);
  }
  if (hits.length > 25) console.log(`……还有 ${hits.length - 25} 条，缩小关键词再查`);
}

// 调试用：把输入按归一规则拆开，看它到底变成了什么 key
if (process.env.MODEL_LOOKUP_DEBUG) {
  console.log(`key: ${canonicalKey(stripVendorPrefix(stripBracketPrefix(query)))}`);
}
