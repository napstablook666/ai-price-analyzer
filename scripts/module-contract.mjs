// 模块契约：src 下每个模块要么被测试触达，要么被声明成一个带理由的例外。
//
// 为什么要有：2026-11-19 那次 taste-lint 扫描报了 16 个「模块没测试」，
// 逐个核对之后只有 3 个是真的——另外 13 个是拿一份 11-15 生成的覆盖率快照算出来的，
// 而真缺口反而漏了 12 个。结论不是「覆盖率工具不好用」，是「有没有测试」这件事
// 被外包给了一个会过期、会漂移、还得先跑一遍才有的测量。
//
// 静态可达性可以替代它：从 test/ 出发沿 import 走一遍，走不到的模块就是没测试。
// 不算覆盖率、不装依赖、跑一次几十毫秒，而且它不会过期——测试文件改了它立刻跟着改。
//
// 两件事分开管，别混成一张表：
//   有没有测试 —— BROWSER_ONLY，只收测试碰不到的浏览器入口，表只许缩小
//   是不是生成物 —— GENERATED，和有没有测试无关，永远要求带生成校验

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

// 测试碰不到的浏览器入口。依赖 window / document / chrome，node 里没有这些，
// 单测要造一整个 DOM 出来——造出来的替身反过来会把实现养肥，不如不写。
// 表只许缩小：某个入口后来被测试触达了，下面会报「豁免过时」，逼你删掉它。
const BROWSER_ONLY = {
  "src/dashboard.js": "仪表盘入口：顶层就取 DOM 节点、挂事件，整页脚本",
  "src/options.js": "设置页入口：同上，另外靠 chrome.storage 做持久化",
  "src/service-worker.js": "MV3 后台入口：只有 chrome.runtime / chrome.tabs 这些运行时 API",
  "src/content-bridge.js": "内容脚本与页面之间的桥：靠 window.postMessage 和 DOM 事件",
  "src/page-bridge.js": "注入页面上下文的那一半：只能跑在页面里，靠 window 与内容脚本通信",
  "src/theme-boot.js": "首屏防闪的同步脚本：一加载就摸 document.documentElement 和 matchMedia",
  "src/shared/menu.js": "顶栏菜单开合：入口是 document.getElementById 加 details 事件",
  "src/shared/collapse.js": "卡片折叠：对外是 init*(pageKey, root = document)，内部自己 createElement"
};

// 生成物：真值在生成器里，被测试引用与否都不影响这一条。
// 要求两件事——生成命令真的存在，文件开头真的写了「不要手改」，否则下一个人会直接改它。
const GENERATED = {
  "src/dom-contract.js": { script: "ids:build", reason: "由 check-html-ids.mjs 从 HTML 与选择器里提取，ids:check 在 verify 里守着" },
  "src/shared/provider-logos.js": { script: "icons:build", reason: "由 provider-logos.mjs 抓 models.dev 与 simple-icons，上游变了才需要重跑" },
  "src/shared/site-logos.js": { script: "plugins:build", reason: "由 plugin-build.mjs 从 plugins/ 汇总，plugins:check 守着漂移" }
};

const problems = [];

// 1. 收集 src 下所有模块。
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

const modules = walk(join(ROOT, "src")).sort();
const moduleSet = new Set(modules);

// 2. 从 test/ 出发，沿 import 语句走一遍。
//    只剥整行注释，不碰字符串——把 // 当注释剥会把 https:// 之后全吃掉。
function importsOf(file) {
  const source = readFileSync(file, "utf8")
    .split("\n")
    .filter(line => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
    })
    .join("\n");
  const found = [];
  for (const match of source.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)) found.push(match[1]);
  for (const match of source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)) found.push(match[1]);
  return found;
}

function resolveImport(spec, fromFile) {
  let base;
  if (spec.startsWith("@app/")) base = join(ROOT, "src", spec.slice("@app/".length));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const candidate of [base, `${base}.js`, `${base}.mjs`, join(base, "index.js")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const reached = new Set();
const queue = walk(join(ROOT, "test")).filter(file => file.endsWith(".js"));
queue.forEach(file => reached.add(file));
while (queue.length > 0) {
  const current = queue.pop();
  for (const spec of importsOf(current)) {
    const next = resolveImport(spec, current);
    if (next && !reached.has(next)) {
      reached.add(next);
      queue.push(next);
    }
  }
}

// 3. 逐个模块核对。
for (const file of modules) {
  const rel = relative(ROOT, file).replace(/\\/g, "/");
  const isReached = reached.has(file);
  const browserReason = BROWSER_ONLY[rel];
  const generated = GENERATED[rel];

  if (browserReason && generated) problems.push(`${rel}：不能同时算浏览器入口和生成物，选一边`);

  if (!isReached && !browserReason && !generated) {
    problems.push(`${rel}：没有测试触达它，也没在 BROWSER_ONLY 里声明为什么可以不测`);
  }
  if (browserReason && isReached) {
    problems.push(`${rel}：已经能被测试触达了，BROWSER_ONLY 里这条豁免过时，删掉它`);
  }
  if (browserReason && browserReason.trim().length < 8) {
    problems.push(`${rel}：豁免理由太短，写清楚它为什么不能单测`);
  }

  if (generated) {
    if (!(generated.script in (pkg.scripts || {}))) {
      problems.push(`${rel}：声明的生成命令 npm run ${generated.script} 不存在`);
    }
    if (!/不要手改/.test(readFileSync(file, "utf8").slice(0, 400))) {
      problems.push(`${rel}：当成生成物管，但文件开头没有「不要手改」的提示，别人会直接改它`);
    }
  }
}

// 4. 表里指向了不存在的文件，说明有人删了模块忘了删声明。
for (const rel of [...Object.keys(BROWSER_ONLY), ...Object.keys(GENERATED)]) {
  if (!moduleSet.has(join(ROOT, rel))) problems.push(`声明指向不存在的模块：${rel}`);
}

if (problems.length > 0) {
  console.error(`模块契约检查失败，${problems.length} 处：`);
  for (const line of problems) console.error(`  ${line}`);
  process.exit(1);
}

const reachedCount = modules.filter(file => reached.has(file)).length;
console.log(
  `模块契约检查通过：src ${modules.length} 个模块，${reachedCount} 个被测试触达，` +
    `${Object.keys(BROWSER_ONLY).length} 个浏览器入口声明为不单测，` +
    `${Object.keys(GENERATED).length} 个生成物的生成命令与「不要手改」头都对得上`
);
