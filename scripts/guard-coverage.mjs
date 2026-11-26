// 护栏覆盖率检查：确认每个护栏都真的会在必经路径上跑。
//
// 为什么要有：2026-11-08 到 11-19 的 41 个 fix 里，同一类问题反复出现——
// 检查写好了、测试写好了，但没挂进 npm 脚本或没进 verify，于是它从来没跑过。
// `test/photo` 这类幽灵条目反过来也存在：清单里写着，文件早删了。
// 这个脚本不检查代码质量，只检查「闸门有没有接在水路上」。
//
// 用法：node scripts/guard-coverage.mjs      有问题时退出码非 0

import { existsSync, readFileSync, readdirSync } from "node:fs";

const ROOT = new URL("../", import.meta.url);
const pkg = JSON.parse(readFileSync(new URL("package.json", ROOT), "utf8"));
const problems = [];

// 1. 测试文件与 package.json 的 test 清单必须双向对齐。
//    少登记 = 这个测试永远不跑；多登记 = 有人删了文件却没删清单。
const testDir = new URL("test/", ROOT);
const onDisk = readdirSync(testDir)
  .filter(name => name.endsWith(".test.js"))
  .map(name => `test/${name}`)
  .sort();
const listed = (pkg.scripts?.test || "")
  .split(/\s+/)
  .filter(token => token.startsWith("test/") && token.endsWith(".js"))
  .sort();

for (const file of onDisk) {
  if (!listed.includes(file)) problems.push(`测试没接进 npm test：${file}`);
}
for (const file of listed) {
  if (!existsSync(new URL(file, ROOT))) problems.push(`npm test 里的幽灵条目：${file}`);
}

// 2. 价格映射的每个基座都要有 golden 快照。
//    没有快照的基座，改映射时它的产出变化没有人会发现——stellaisle-carpool 就这么漏了两周。
const { PRICE_MAP_BASES } = await import(new URL("src/core/price-maps/index.js", ROOT));
const { GOLDEN_CASES, NO_FIXTURE_YET } = await import(new URL("scripts/price-map-golden.mjs", ROOT));
const covered = new Set(GOLDEN_CASES.map(item => item.base));
const pending = Object.keys(NO_FIXTURE_YET);

for (const base of Object.keys(PRICE_MAP_BASES)) {
  if (covered.has(base) || base in NO_FIXTURE_YET) continue;
  problems.push(`价格映射没有 golden 快照：${base}（拿不到报文就在 price-map-golden.mjs 的 NO_FIXTURE_YET 里写清理由）`);
}
for (const item of GOLDEN_CASES) {
  if (!(item.base in PRICE_MAP_BASES)) problems.push(`golden 用例指向不存在的基座：${item.name || item.base}`);
  if (!existsSync(new URL(`test/fixtures/${item.fixture}`, ROOT))) {
    problems.push(`golden 用例缺 fixture：${item.fixture}`);
  }
}

// 3. AGENTS.md 里让人跑的 npm 命令必须真的存在。
//    文档写了 `npm run xxx` 而脚本不存在，下一个人会以为跑过了。
const agents = readFileSync(new URL("../AGENTS.md", ROOT), "utf8");
const mentioned = new Set([...agents.matchAll(/npm run ([a-z][a-z0-9:-]*)/g)].map(match => match[1]));
for (const name of mentioned) {
  if (!(name in (pkg.scripts || {}))) problems.push(`AGENTS.md 提到不存在的命令：npm run ${name}`);
}
// 4. Rust 的三道闸必须有脚本，且 lint 与 wire 必须在 verify 链上。
//    2026-11-25 U12 的教训：rust 的 fmt/clippy 从来没挂进任何脚本，QA 手动跑才暴露
//    `needless_borrow`，而 verify 一直是绿的。把「必须挂上」写死在这里。
for (const name of ["rust:lint", "rust:build", "rust:wire"]) {
  if (!(name in (pkg.scripts || {}))) problems.push(`缺少 Rust 脚本：npm run ${name}`);
}
const verifyChain = pkg.scripts?.verify || "";
for (const name of ["rust:lint", "rust:wire"]) {
  if (name in (pkg.scripts || {}) && !verifyChain.includes(`npm run ${name}`)) {
    problems.push(`npm run verify 没有包含 npm run ${name}`);
  }
}

if (problems.length > 0) {
  console.error(`护栏覆盖率检查失败，${problems.length} 处：`);
  for (const line of problems) console.error(`  ${line}`);
  process.exit(1);
}

const baseCount = Object.keys(PRICE_MAP_BASES).length;
const snapshot = baseCount - pending.length;
console.log(
  `护栏覆盖率检查通过：${onDisk.length} 个测试全部接线，价格映射 ${baseCount} 个基座里 ${snapshot} 个有快照` +
    `（${pending.length} 个待补：${pending.join(", ") || "无"}），AGENTS.md 里的 ${mentioned.size} 条命令都存在。`
);
