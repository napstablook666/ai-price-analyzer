#!/usr/bin/env node
// 校验 HTML 的 id 与 JS 的引用是否对得上。
//
// 抓的问题：改版删了 DOM 节点，JS 还在 $("...") / getElementById("...")，
// 运行时拿到 null，静默不生效。这类 bug 单测抓不到，只能靠肉眼点或者这个脚本。
//
// 查两个方向：
//   缺失   JS 用字面量选择器引用了一个 HTML 里不存在的 id  → 报错，退出码 1
//   死节点 HTML 里的 id 在整页脚本里一次都没出现           → 提示，多半是改版漏删
//
// 脚本范围从 HTML 的 <script src> 出发，顺着相对 import 递归收集，不手写清单。
// `document.getElementById("x")` 后紧跟 `el.id = "x"` 的是 get-or-create，不算缺失。
// 动态拼接的选择器（$(`#${key}-filters`)）静态求不了，按前后缀排除并打印覆盖率。
//
// 用法：node scripts/check-html-ids.mjs [--json]
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PAGES = ["dashboard.html", "options.html"];

const ID_ATTR = /\sid\s*=\s*["']([^"']+)["']/g;
const SCRIPT_SRC = /<script[^>]*\ssrc\s*=\s*["']([^"']+)["']/g;
const IMPORT = /import\s+(?:[^"']*?from\s+)?["'](\.{1,2}\/[^"']+)["']/g;

const REF_PATTERNS = [
  /\$\(\s*["']#([A-Za-z0-9_-]+)["']/g, // $("#x") / $("#x .y")
  /getElementById\(\s*["']([A-Za-z0-9_-]+)["']\s*\)/g,
  /querySelector(?:All)?\(\s*["']#([A-Za-z0-9_-]+)["']/g,
];

// $(`#KEY-filters`) / $(`#prefix-${x}`)
const DYNAMIC_PATTERNS = [
  /\$\(\s*`#([A-Za-z0-9_-]*)\$\{[^}]*\}([A-Za-z0-9_-]*)`/g,
  /getElementById\(\s*`([A-Za-z0-9_-]*)\$\{[^}]*\}([A-Za-z0-9_-]*)`\s*\)/g,
];

const SELF_DEFINED = /\.id\s*=\s*["']([A-Za-z0-9_-]+)["']/g;

const idsIn = (text) => new Set([...text.matchAll(ID_ATTR)].map((m) => m[1]));
const refsIn = (text) =>
  new Set(REF_PATTERNS.flatMap((re) => [...text.matchAll(re)].map((m) => m[1])));

function dynamicShapes(text) {
  const prefixes = new Set();
  const suffixes = new Set();
  let wildcard = false;
  let count = 0;
  for (const re of DYNAMIC_PATTERNS) {
    for (const m of text.matchAll(re)) {
      count++;
      const [, pre, suf] = m;
      if (!pre && !suf) wildcard = true;
      else {
        if (pre) prefixes.add(pre);
        if (suf) suffixes.add(suf);
      }
    }
  }
  return { prefixes, suffixes, wildcard, count };
}

// 从 HTML 的 script src 出发，顺着相对 import 收集整页脚本
function collectScripts(htmlPath, html) {
  const seen = new Set();
  const queue = [...html.matchAll(SCRIPT_SRC)].map((m) => resolve(dirname(htmlPath), m[1]));
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const code = readFileSync(file, "utf8");
    for (const m of code.matchAll(IMPORT)) queue.push(resolve(dirname(file), m[1]));
  }
  return [...seen];
}

const report = [];
let failed = 0;

for (const page of PAGES) {
  const pagePath = resolve(root, page);
  if (!existsSync(pagePath)) {
    report.push({ page, level: "warn", msg: `${page} 不存在，跳过` });
    continue;
  }
  const html = readFileSync(pagePath, "utf8");
  const defined = idsIn(html);
  const scripts = collectScripts(pagePath, html);
  if (!scripts.length) {
    report.push({ page, level: "warn", msg: "没找到任何脚本，检查 <script src> 是否写对" });
    continue;
  }
  const code = scripts.map((f) => readFileSync(f, "utf8")).join("\n");

  const referenced = refsIn(code);
  const selfDefined = new Set([...code.matchAll(SELF_DEFINED)].map((m) => m[1]));
  const { prefixes, suffixes, wildcard, count: dynCount } = dynamicShapes(code);
  const isDynamic = (id) =>
    wildcard ||
    [...prefixes].some((p) => id.startsWith(p)) ||
    [...suffixes].some((s) => id.endsWith(s));

  const missing = [...referenced]
    .filter((id) => !defined.has(id) && !selfDefined.has(id) && !isDynamic(id))
    .sort();
  const unused = [...defined].filter((id) => !code.includes(id)).sort();

  for (const id of missing) {
    failed++;
    report.push({ page, level: "error", msg: `JS 引用了不存在的 id: #${id}` });
  }
  for (const id of unused) {
    report.push({ page, level: "info", msg: `HTML 里的 id 全页无人引用: #${id}` });
  }

  const staticOk = [...referenced].filter((id) => !isDynamic(id) && !selfDefined.has(id)).length;
  report.push({
    page,
    level: wildcard ? "warn" : "info",
    msg:
      `${scripts.length} 个脚本 / ${defined.size} 个 id / ${referenced.size} 处引用` +
      ` / 缺失 ${missing.length} / 死节点 ${unused.length}` +
      ` / 可静态验证 ${staticOk} 处，动态拼接 ${dynCount} 处，自建节点 ${selfDefined.size} 个` +
      (wildcard ? " —— 存在全通配选择器，本页静态检查失效，只能真机验" : ""),
  });
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const r of report) {
    const tag = r.level === "error" ? "✗" : r.level === "warn" ? "!" : " ";
    console.log(`${tag} [${r.page}] ${r.msg}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} 处 id 引用找不到对应节点`);
  process.exit(1);
}
