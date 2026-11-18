// price-map 的 golden 快照。
//
// 为什么要有：映射改了以后，哪个站的产出会跟着变、变成什么样，现在只能靠人推。
// 一份 fixture 走一遍映射，把结果落成一行一行的文本提交进仓库，改完之后
// 测试会把差异直接摆出来，看一眼就知道是修好了还是改坏了。
//
// 用法：
//   node scripts/price-map-golden.mjs            比对，不一致时退出码非 0
//   node scripts/price-map-golden.mjs --update   重新生成
//
// 新增映射或补了 fixture 之后记得 --update，并在提交里带上 golden 的变化。

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { applyPriceMap } from "../src/core/price-map.js";
import { parseBillingTiers } from "../src/core/normalizers.js";
import { PRICE_MAP_BASES } from "../src/core/price-maps/index.js";

const FIXTURES = new URL("../test/fixtures/", import.meta.url);
const GOLDEN_DIR = new URL("../test/golden/", import.meta.url);

// fixture 的文件名和 base 名对不上是常态（早先按站点起的），所以显式列出来。
export const GOLDEN_CASES = Object.freeze([
  { base: "tokenflux", fixture: "tokenflux-pricing.json" },
  { base: "allrouter", fixture: "allrouter-pricing.json" },
  { base: "relayrouter", fixture: "relayrouter-pricing.json" },
  { base: "cheaprouter", fixture: "cheaprouter-pricing.json" },
  { base: "true-sota", fixture: "true-sota-pricing.json" }
]);

// 只看决定价格结论的字段。enable_groups、evidence、model_ratio 这些是中间产物，
// 它们变了但最终价没变的情况不该让快照失败。
const FIELDS = [
  "model_name",
  "proxy_group_name",
  "tier_name",
  "input_price",
  "output_price",
  "cache_read_price",
  "cache_write_price",
  "request_price",
  "image_price",
  "media_type",
  "price_currency",
  "group_ratio",
  "completion_ratio"
];

const cell = value => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "-";
  return String(value);
};

export function renderGolden(base, fixtureName) {
  const map = PRICE_MAP_BASES[base];
  if (!map) throw new Error(`未知的 price-map base：${base}`);
  const payload = JSON.parse(readFileSync(new URL(fixtureName, FIXTURES), "utf8"));
  const { rows, unresolved } = applyPriceMap(map, payload, { parseTiers: parseBillingTiers });

  const lines = rows.map(row => FIELDS.map(field => cell(row[field])).join("|")).sort();
  // unresolved 是「这条模型没解析出价」的清单，它变了同样说明映射漏了东西。
  const misses = unresolved
    .map(entry => `${cell(entry.model)}=${cell(entry.reason)}`)
    .sort();

  return [
    `# base: ${base}`,
    `# fixture: ${fixtureName}`,
    `# rows: ${lines.length} · unresolved: ${misses.length}`,
    `# 更新：node scripts/price-map-golden.mjs --update`,
    `# 字段：${FIELDS.join("|")}`,
    "",
    ...lines,
    ...(misses.length ? ["", "# unresolved", ...misses] : [])
  ].join("\n") + "\n";
}

export function goldenPath(base) {
  return new URL(`${base}.txt`, GOLDEN_DIR);
}

export function allGoldens() {
  return GOLDEN_CASES.map(item => ({ ...item, text: renderGolden(item.base, item.fixture) }));
}

async function main() {
  const update = process.argv.includes("--update");
  const results = allGoldens();
  let drifted = 0;

  for (const item of results) {
    const target = goldenPath(item.base);
    let current = null;
    try {
      current = readFileSync(target, "utf8");
    } catch {
      current = null;
    }

    if (current === item.text) continue;

    if (update) {
      mkdirSync(fileURLToPath(GOLDEN_DIR), { recursive: true });
      writeFileSync(target, item.text, "utf8");
      console.log(`${item.base.padEnd(12)} 已写入`);
      continue;
    }

    drifted += 1;
    console.log(`${item.base.padEnd(12)} 与快照不一致`);
    if (current === null) {
      console.log("  文件不存在，先跑 --update");
      continue;
    }
    const before = new Set(current.split("\n"));
    const after = new Set(item.text.split("\n"));
    const removed = [...before].filter(line => !after.has(line) && !line.startsWith("#")).slice(0, 5);
    const added = [...after].filter(line => !before.has(line) && !line.startsWith("#")).slice(0, 5);
    removed.forEach(line => console.log(`  - ${line}`));
    added.forEach(line => console.log(`  + ${line}`));
    if (removed.length === 5 || added.length === 5) console.log("  ……只显示前 5 行");
  }

  if (drifted && !update) {
    console.log(`\n${drifted} 份快照有漂移。确认是新行为就 node scripts/price-map-golden.mjs --update`);
    process.exitCode = 1;
    return;
  }
  console.log(update ? "快照已更新" : `${results.length} 份快照全部一致`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  main();
}
