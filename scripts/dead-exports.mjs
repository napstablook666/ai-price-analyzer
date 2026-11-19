// 孤儿回收检查：从真实入口做可达性分析，报告没人引用的模块与导出。
//
// 存在的理由：这个仓库的删除动作历来只做一半（删主逻辑，不删壳），
// 于是退役枚举、只为测试存在的工具函数、删功能留下的常量会长期存活。
// 人肉记得清是不可靠的，所以把「谁还引用它」变成每次 verify 都要跑的判定。
//
// 判定口径（对应 import 图上的入度）：
//   UNREACHABLE  从 manifest / html / npm scripts 出发走不到该模块
//   DEAD         该导出在别的文件里零引用，且本文件内除定义外也没人用
//   TEST-ONLY    只有 test/ 引用，运行时没人用（只提示，不阻断）
//
// 豁免写进 scripts/dead-exports.allow.json，键是 `相对路径::符号名`，值是理由。
// 豁免必须带理由：没有理由的豁免等于换个地方藏垃圾。

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ALLOW_FILE = join(ROOT, "scripts", "dead-exports.allow.json");
const rel = (path) => relative(ROOT, path).replace(/\\/g, "/");

const SOURCE_DIRS = ["src", "scripts", "test", "canonical"];
const SKIP_DIRS = new Set(["node_modules", ".git", "out", "dist", "coverage", "docs"]);

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path, out);
    } else if (/\.(?:js|mjs)$/.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

const files = SOURCE_DIRS.flatMap((dir) => walk(join(ROOT, dir)));
const known = new Set(files.map(rel));
const source = new Map(files.map((path) => [rel(path), readFileSync(path, "utf8")]));

// ---------- 入口 ----------

function htmlScripts(html) {
  return [...html.matchAll(/<script[^>]*\bsrc=["']([^"']+)["']/g)].map((match) => match[1]);
}

function roots() {
  const found = new Set();
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  const addHtml = (page) => {
    if (!page) return;
    const path = join(ROOT, page);
    if (!existsSync(path)) return;
    for (const src of htmlScripts(readFileSync(path, "utf8"))) found.add(src);
  };
  if (manifest.background?.service_worker) found.add(manifest.background.service_worker);
  for (const script of manifest.content_scripts || []) {
    for (const src of script.js || []) found.add(src);
  }
  found.add(manifest.options_ui?.page);
  found.add(manifest.action?.default_popup);
  addHtml(manifest.options_ui?.page);
  addHtml(manifest.action?.default_popup);
  for (const name of readdirSync(ROOT).filter((entry) => entry.endsWith(".html"))) {
    for (const src of htmlScripts(readFileSync(join(ROOT, name), "utf8"))) found.add(src);
  }
  return [...found].filter(Boolean).map((value) => value.replace(/^\.?\//, ""));
}

// ---------- 引用解析 ----------

function resolveSpec(from, spec) {
  let base;
  if (spec.startsWith(".")) base = resolve(ROOT, dirname(from), spec);
  else if (spec.startsWith("@app/")) base = join(ROOT, "src", spec.slice("@app/".length));
  else return null;
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, join(base, "index.js")]) {
    const key = rel(candidate);
    if (known.has(key)) return key;
  }
  return null;
}

function importsOf(path) {
  const text = source.get(path) || "";
  const specs = new Set();
  for (const match of text.matchAll(/(?:^|[\s;])(?:import|export)\s+(?:[^"']*?\sfrom\s+)?["']([^"']+)["']/g)) specs.add(match[1]);
  for (const match of text.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) specs.add(match[1]);
  return [...specs].map((spec) => resolveSpec(path, spec)).filter(Boolean);
}

const edges = new Map([...source.keys()].map((path) => [path, importsOf(path)]));

// ---------- 可达性 ----------

function reachableFrom(start) {
  const seen = new Set();
  const stack = [...start];
  while (stack.length) {
    const current = stack.pop();
    if (seen.has(current) || !edges.has(current)) continue;
    seen.add(current);
    stack.push(...edges.get(current));
  }
  return seen;
}

const runtime = reachableFrom(roots());

// ---------- 导出与引用计数 ----------

function exportNames(text) {
  const names = new Set();
  for (const match of text.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/g)) names.add(match[1]);
  for (const match of text.matchAll(/export\s*\{([\s\S]*?)\}/g)) {
    for (const part of match[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && name !== "default") names.add(name);
    }
  }
  return [...names];
}

const escape = (name) => name.replace(/\$/g, "\\$");
const occurrences = (name, text) => (text.match(new RegExp(`(^|[^A-Za-z0-9_$])${escape(name)}([^A-Za-z0-9_$]|$)`, "g")) || []).length;

const allow = existsSync(ALLOW_FILE) ? JSON.parse(readFileSync(ALLOW_FILE, "utf8")) : {};
const isAllowed = (path, name) => Object.prototype.hasOwnProperty.call(allow, `${path}::${name}`);

const dead = [];
const suppressed = new Set();
const testOnly = [];
for (const [path, text] of source) {
  if (!path.startsWith("src/")) continue;
  const names = exportNames(text);
  for (const name of names) {
    if (occurrences(name, text) > 1) continue; // 本文件内部还在用
    const referrers = new Set();
    for (const [other, otherText] of source) {
      if (other === path) continue;
      if (occurrences(name, otherText)) referrers.add(other);
    }
    const onlyTests = referrers.size > 0 && [...referrers].every((ref) => ref.startsWith("test/"));
    if (!referrers.size || onlyTests) {
      const key = `${path}::${name}`;
      if (isAllowed(path, name)) {
        suppressed.add(key);
      } else if (!referrers.size) {
        dead.push(`${path} :: ${name}`);
      } else {
        testOnly.push(`${path} :: ${name}  <- ${[...referrers].join(", ")}`);
      }
    }
  }
}

const orphans = [...source.keys()].filter((path) => path.startsWith("src/") && !runtime.has(path)).sort();
const usedAllow = [...suppressed].sort();

console.log(`入口 ${roots().length} 个，模块 ${source.size} 个，运行时可达 ${[...runtime].filter((path) => path.startsWith("src/")).length} 个`);
if (usedAllow.length) console.log(`生效豁免 ${usedAllow.length} 条`);

let failed = false;
if (orphans.length) {
  failed = true;
  console.log(`\nUNREACHABLE ${orphans.length} 个模块（没有任何入口能走到）：`);
  for (const path of orphans) console.log(`  ${path}`);
}

if (dead.length) {
  failed = true;
  console.log(`\nDEAD ${dead.length} 个导出（全仓库零引用）：`);
  for (const line of dead.sort()) console.log(`  ${line}`);
}

if (testOnly.length) {
  console.log(`\nTEST-ONLY ${testOnly.length} 个导出（只有测试在用，运行时没人用，建议连同用例一起删）：`);
  for (const line of testOnly.sort()) console.log(`  ${line}`);
}

const stale = Object.keys(allow).filter((key) => !usedAllow.includes(key));
if (stale.length) {
  console.log(`\nSTALE-ALLOW ${stale.length} 条豁免已经用不上了，删掉免得以后遮住真问题：`);
  for (const key of stale.sort()) console.log(`  ${key}`);
}

if (failed) {
  console.log("\n修法：删掉这些代码，或者把确有外部消费方的符号写进 scripts/dead-exports.allow.json 并写明理由。");
  process.exit(1);
}
console.log("\n孤儿检查通过。");
