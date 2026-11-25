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
import { resolvePriceMap } from "../src/core/price-maps/index.js";
import { sitePlugin as token91Plugin } from "../src/site-plugins/providers/91token.js";
import { sitePlugin as spideraiPlugin } from "../src/site-plugins/providers/spiderai.js";
import { sitePlugin as poloaiPlugin } from "../src/site-plugins/providers/poloai.js";
import { sitePlugin as leaflowPlugin } from "../src/site-plugins/providers/leaflow.js";
import { stellaislePlazaRows } from "../src/core/price-maps/stellaisle.js";
import { sitePlugin as eapiPlugin } from "../src/site-plugins/providers/eapi.js";

const FIXTURES = new URL("../test/fixtures/", import.meta.url);
const GOLDEN_DIR = new URL("../test/golden/", import.meta.url);

// fixture 的文件名和 base 名对不上是常态（早先按站点起的），所以显式列出来。
export const GOLDEN_CASES = Object.freeze([
  { base: "tokenflux", fixture: "tokenflux-pricing.json" },
  {
    name: "spiderai", base: "tokenflux", fixture: "spiderai-pricing-page.html",
    priceMap: spideraiPlugin.preset.adapter.priceMap,
    decode: spideraiPlugin.request.decodeResponse,
    note: "2026-11-21 匿名完整 PX_DATA；77 模型、20 分组，文本/缓存/长度/峰谷/图片/视频秒价"
  },
  // 同形状不同站点：base 都是 tokenflux，但报文各一份，快照分开存（name 才是文件名）。
  { name: "centos", base: "tokenflux", fixture: "centos-pricing.json", note: "ai.centos.hk 2026-11-19 实测，页面标 ¥" },
  { name: "maolaoapi", base: "tokenflux", fixture: "maolaoapi-pricing.json", note: "maolaoapi.com 2026-11-19 实测，页面标 $" },
  { name: "juziai", base: "tokenflux", fixture: "juziai-pricing.json", note: "api.juziai.cc 匿名报文抽样；全量实测 173 个模型、14 个分组，含按 token 与按次报价" },
  {
    name: "91token", base: "tokenflux", fixture: "91token-pricing.json",
    priceMap: token91Plugin.preset.adapter.priceMap,
    note: "91token.com 63 个模型全量匿名报文；54 个文本/图片/简单按秒模型出价，9 个复杂计费表达式明确不支持",
    expectedUnresolved: [
      "MiniMax-H3", "doubao-seedance-2-0", "doubao-seedance-2-0-fast", "doubao-seedance-2-0-mini",
      "doubao-seedance-2-5", "viduq3-ad", "viduq3-pro", "viduq3-turbo", "viduq4-preview",
      
    ]
  },
  {
    name: "poloai", base: "tokenflux", fixture: "poloai-pricing-sample.json",
    priceMap: poloaiPlugin.preset.adapter.priceMap,
    note: "2026-11-21 匿名报价样本；token/缓存/长度/图片/秒价与8个明确不支持的复杂计费模型",
    expectedUnresolved: [
      "doubao-seedance-2-0-260128", "doubao-seedance-2-0-fast-260128", "doubao-seedance-2-0-mini-260615",
      "gemini-3-pro-image-preview", "gpt-6.1-terra", "qwen-plus", "suno_lyrics", "suno_music"
    ]
  },
  {
    name: "leaflow", base: "tokenflux", fixture: "leaflow-pricing.json",
    priceMap: leaflowPlugin.preset.adapter.priceMap,
    extraFields: ["size_tier", "request_unit"],
    decode: text => leaflowPlugin.request.decodeResponse(JSON.parse(text)),
    note: "2026-11-21 登录完整目录28模型 + 277计费行；文本/缓存/图片规格/视频秒价，8音频与2受限模型明确未解析",
    expectedUnresolved: [
      "cosyvoice-v3-flash", "cosyvoice-v3-plus", "cosyvoice-v3.5-flash", "cosyvoice-v3.5-plus",
      "cyber/deepseek-v4.1-flash", "cyber/wan3.0-video",
      "qwen-audio-3.1-asr-flash-message", "qwen-audio-3.1-asr-flash-streaming", "qwen-audio-3.1-realtime-flash", "speech-2.8-turbo"
    ]
  },
{
    name: "eapi", base: "tokenflux", fixture: "eapi-pricing.json",
    priceMap: eapiPlugin.preset.adapter.priceMap,
    note: "2026-11-23 匿名 /api/pricing 全量 41 模型；per_token 33 走 token 规则、fixed 8 按张计；报文无 enable_groups，走 unlisted 基准分组；cache_*_price_micros 是坏字段不读"
  },
  { base: "allrouter", fixture: "allrouter-pricing.json" },
  { base: "relayrouter", fixture: "relayrouter-pricing.json" },
  { name: "openlux", base: "relayrouter", fixture: "openlux-pricing.json", note: "www.openlux.ai 2026-11-20 实测，9 行：token + 分档 + 按次（图/视频）+ 两种缓存放法" },
  { base: "cheaprouter", fixture: "cheaprouter-pricing.json" },
  { base: "true-sota", fixture: "true-sota-pricing.json" },
  // 广场的报文不拿来直接求值：先解包成「一行一个模型」，和采集时走同一个函数。
  // 这层解包以前住在策略类里，快照摸不到，漏解一层只能等线上退回基准价才发现。
  { base: "stellaisle-plaza", fixture: "stellaisle-plaza.json", expand: stellaislePlazaRows, note: "分组广场 3 个分组 + 1 个不可用分组，覆盖 tiered / token / per_call / unconfigured" },
  { base: "stellaisle", fixture: "stellaisle-pricing.json", note: "站内基准价 26 行样本（按次 8 + 表达式 + token），站点当日共 154 行；model_pricing_source 只留样本内的键" },
  { base: "sidrune", fixture: "sidrune-pricing.json", note: "20 行：6 个按张（带 1K/2K/4K 档）+ 14 个按 token" },
  // 2026-11-23 批次：9 家 new-api 中文转站的匿名全量报文。
  {
    name: "kuaipao", base: "tokenflux", fixture: "kuaipao-pricing.json",
    note: "kuaipao.pro/.ai 同后端，123 模型 19 分组；expr 51、按次 6；¥0.4 = $1 额度",
    expectedUnresolved: [
      "doubao-seedance-2.0", "doubao-seedance-2.0-fast", "doubao-seedance-2.0-fast-官转",
      "doubao-seedance-2.0-mini", "doubao-seedance-2.0-mini-官转", "doubao-seedance-2.0-官转",
      "doubao-seedance-2.0-特价", "doubao-seedance-2.5", "doubao-seedance-2.5-flash-官转",
      "doubao-seedance-2.5-官转", "doubao-seedance-2.5-特价",
      "grok-imagine-video-1.5-preview", "minimax-h3", "muse-video",
      "seedance-2.0-按次", "seedance-2.5-按次", "wan3.0-video", "wan3.0-video-prime"
    ]
  },
  {
    name: "pqh", base: "tokenflux", fixture: "pqh-pricing.json",
    note: "pqh.ai 108 模型 53 分组；expr 64、按次 4，带 billing_usage_schema；$1 额度 = ¥7.3",
    expectedUnresolved: ["doubao-seedance-2-0-260128", "doubao-seedance-2-5-260628"]
  },
  {
    name: "0ait", base: "tokenflux", fixture: "0ait-pricing.json",
    note: "0ait.com 72 模型 37 分组，与 pqh 同运营不同部署；expr 53、按次 4",
    expectedUnresolved: ["grok-imagine-video-1.5"]
  },
  { name: "xkrelay", base: "tokenflux", fixture: "xkrelay-pricing.json", note: "xkrelay.com 71 模型 26 分组；expr 52、按次 7；peak_offpeak 峰谷字段基座不消费，采基础档" },
  { name: "zerocat", base: "tokenflux", fixture: "zerocat-pricing.json", note: "zero.cat 67 模型 11 分组、无按次；expr 47 含 hour(\"UTC\") 时段加价，采基础档" },
  { name: "corecode", base: "tokenflux", fixture: "corecode-pricing.json", note: "corecode.live 28 模型 7 分组；expr 14、按次 7" },
  { name: "coderelay", base: "tokenflux", fixture: "coderelay-pricing.json", note: "coderelay.cn 54 模型 16 分组；expr 21、按次 3" },
  { name: "packycode", base: "tokenflux", fixture: "packycode-pricing.json", note: "packycode.com/.com 同后端 78 模型 25 分组；无 expr、按次 13；tiers 长上下文档（15 个模型）基座不读" },
  {
    name: "4zapi", base: "relayrouter", fixture: "4zapi-pricing.json",
    note: "4zapi.com 与 openlux 同部署；323 模型抽 67 条覆盖 token/step/按次三形态与 80 个分组倍率；无 expr",
    expectedUnresolved: ["mj_custom_zoom", "mj_inpaint"]
  },
  { name: "undying", base: "tokenflux", fixture: "undying-pricing.json", note: "undyapi.com 88 模型 75 分组 40 档倍率；expr 54（含 len 分支长上下文档）、按次 4（gemini 出图 $0.15–0.33/张）；报文多 vendors + supported_endpoint" },
  {
    name: "relayo", base: "direct", fixture: "relayo-pricing.json",
    note: "acombcom.cn（站名 Relayo）2026-11-25 全量匿名报文；30 个模型 2 个分组，billing_mode=direct 给人民币每百万直价；17 条按 token、13 条按次（9 个出图按张）；2 个免费模型按 0 计费不参与比价",
    expectedUnresolved: ["hungerg-free", "gpt-6-luna-free"]
  }
]);

// 暂时拿不到 fixture 的 base，理由必须写清楚。
// 这不是「允许不管」的名单：加一项要说清缺的是什么、什么时候能补。
// 测试与 scripts/guard-coverage.mjs 都读这一份，别在别处另抄一个名单。
export const NO_FIXTURE_YET = Object.freeze({
  "stellaisle-carpool":
    "/api/carpool-market 未登录直接 401（要 New-Api-User 头），只能在用户站内登录态下采；" +
    "补快照的时机是下一次带登录态实测拼车页。当前形状由 test/price-map.test.js 与 core.test.js 的站内用例守着。"
});

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

// expand 是「报文 → 映射认得的形状」那一步，和采集时用同一个函数；
// 有了它，解包写错这类问题会在快照里现形，而不是等线上退回基准价。
export function renderGolden(caseItem) {
  const { base, fixture, expand } = caseItem;
  const label = caseName(caseItem);
  const { map, error } = resolvePriceMap(caseItem.priceMap || { base });
  if (error) throw new Error(`无效的 price-map 声明：${error}`);
  const text = readFileSync(new URL(fixture, FIXTURES), "utf8");
  const raw = caseItem.decode ? caseItem.decode(text) : JSON.parse(text);
  const payload = expand ? { data: expand(raw) } : raw;
  const { rows, unresolved } = applyPriceMap(map, payload, { parseTiers: parseBillingTiers });

  const fields = [...FIELDS, ...(caseItem.extraFields || [])];
  const lines = rows.map(row => fields.map(field => cell(row[field])).join("|")).sort();
  // unresolved 是「这条模型没解析出价」的清单，它变了同样说明映射漏了东西。
  const misses = unresolved
    .map(entry => `${cell(entry.model)}=${cell(entry.reason)}`)
    .sort();

  return [
    `# base: ${base}`,
    ...(label === base ? [] : [`# case: ${label}`]),
    `# fixture: ${fixture}`,
    `# rows: ${lines.length} · unresolved: ${misses.length}`,
    `# 更新：node scripts/price-map-golden.mjs --update`,
    `# 字段：${fields.join("|")}`,
    "",
    ...lines,
    ...(misses.length ? ["", "# unresolved", ...misses] : [])
  ].join("\n") + "\n";
}

export function goldenPath(name) {
  return new URL(`${name}.txt`, GOLDEN_DIR);
}

export function caseName(item) {
  return item.name || item.base;
}

export function allGoldens() {
  return GOLDEN_CASES.map(item => ({ ...item, text: renderGolden(item) }));
}

async function main() {
  const update = process.argv.includes("--update");
  const results = allGoldens();
  let drifted = 0;

  for (const item of results) {
    const target = goldenPath(caseName(item));
    let current = null;
    try {
      // 比的是字节内容，不是磁盘上的换行风格。Windows 下 core.autocrlf=true 时
      // 签出来的快照是 CRLF，而这里写出去的是 LF，不归一化就会永远「有漂移」。
      current = readFileSync(target, "utf8").replace(/\r\n/g, "\n");
    } catch {
      current = null;
    }

    if (current === item.text) continue;

    if (update) {
      mkdirSync(fileURLToPath(GOLDEN_DIR), { recursive: true });
      writeFileSync(target, item.text, "utf8");
      console.log(`${caseName(item).padEnd(12)} 已写入`);
      continue;
    }

    drifted += 1;
    console.log(`${caseName(item).padEnd(12)} 与快照不一致`);
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
