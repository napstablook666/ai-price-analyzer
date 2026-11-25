// 证明「已经接线的 wasm/napi 单元真的还在跑 Rust」，而不是悄悄退回 JS 或用到过期产物。
// 用法：node scripts/rust-wire-check.mjs [unit...]
// 每个单元查四件事：
//   1. 产物在（wasm 的 index.js + *_bg.wasm，napi 的 .node）；
//   2. 产物不比 crate/src 里的源码旧（旧了说明忘了 npm run rust:build）；
//   3. 接线处确实指向该产物（wasm shim 的 import，napi 的 index.cjs 标记块）；
//   4. 通过公开模块调一次，返回值与 Rust 侧的已知结果逐字节一致（导入即可调，不需要 init）。
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const UNITS = [
  {
    name: "shared-rs",
    crate: "rust/shared-rs",
    shim: "src/shared/rust-shim.js",
    async probe() {
      const { escapeHtml } = await import(new URL("../src/shared/ui.js", import.meta.url));
      assert.equal(escapeHtml('<b>&"x'), "&lt;b&gt;&amp;&quot;x");
    }
  },
  {
    name: "price-fields-rs",
    crate: "rust/price-fields-rs",
    shim: "src/core/rust-price-shim.js",
    async probe() {
      const { rawPriceValue, PRICE_FIELD_DEFINITIONS } = await import(new URL("../src/core/price-fields.js", import.meta.url));
      const input = PRICE_FIELD_DEFINITIONS.find((field) => field.standard === "input");
      assert.equal(rawPriceValue({ inputPrice: 3, price: 9 }, input), 3);
      assert.equal(rawPriceValue({}, input), undefined);
    }
  },
  {
    name: "exchange-rate-rs",
    crate: "rust/exchange-rate-rs",
    shim: "src/core/rust-exchange-shim.js",
    async probe() {
      const [{ exchangeRateInfo }, { DEFAULT_EXCHANGE_RATE }] = await Promise.all([
        import(new URL("../src/core/exchange-rate.js", import.meta.url)),
        import(new URL("../src/shared/schema.js", import.meta.url))
      ]);
      const fallback = exchangeRateInfo({}, {});
      assert.equal(fallback.mode, "fallback");
      assert.equal(fallback.rate, DEFAULT_EXCHANGE_RATE);
    }
  },
  {
    name: "scripts-lib-rs",
    crate: "rust/scripts-lib-rs",
    // 这一只是 rust-anything enable 接的线：标记块 + index.cjs，加载失败会静默退回 JS，
    // 所以探针强制 RUST_ANYTHING_MODE=new，让失败直接抛出来。
    shim: "scripts/lib/update-version.mjs",
    marker: "rust/scripts-lib-rs/index.cjs",
    async probe() {
      process.env.RUST_ANYTHING_MODE = "new";
      const { resolveMinShell } = await import(new URL("../scripts/lib/update-version.mjs", import.meta.url));
      assert.deepEqual(resolveMinShell({ packageJson: { updateMinShell: "0.9.0" }, version: "1.2.3" }), {
        minShell: "0.9.0",
        warnings: []
      });
    }
  }
];

function newestSource(crateDir) {
  let newestAt = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "target") continue;
        walk(full);
      } else {
        newestAt = Math.max(newestAt, statSync(full).mtimeMs);
      }
    }
  };
  walk(join(ROOT, crateDir, "src"));
  return newestAt;
}

// 时间戳比不了先后：git 按索引顺序落盘，rust-dist/ 排在 rust/ 之前，
// 所以任何干净签出里都是「源码比产物新」，这条检查会把 verify:clean 永远判成失败。
// 拿得到 git 信息时以「最后一次改动各自路径的提交」为准；产物还有未提交改动时说明刚重新编译，直接放过。
const gitOut = args => {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};
const lastCommitMs = paths => {
  const stamp = gitOut(["log", "-1", "--format=%ct", "--", ...paths]);
  return stamp ? Number(stamp) * 1000 : 0;
};
function artifactOlderThanSource(unit, built) {
  // napi 单元的产物落在 rust/<unit>/ 下，wasm 单元落在 rust-dist/<unit>/ 下，两边都要按实际路径查提交。
  const distPaths = [relative(ROOT, built).replace(/\\/g, "/").replace(/\/[^/]+$/, "")];
  if (gitOut(["status", "--porcelain", "--untracked-files=all", "--", ...distPaths])) return false;
  const sourceAt = lastCommitMs([`${unit.crate}/src`]);
  const artifactAt = lastCommitMs(distPaths);
  if (sourceAt && artifactAt) return sourceAt > artifactAt;
  return newestSource(unit.crate) > statSync(built).mtimeMs;
}

function builtArtifact(unit) {
  const dist = join(ROOT, "rust-dist", unit.name);
  if (unit.marker) {
    const native = join(ROOT, "rust", unit.name, `${unit.name.replace(/-/g, "_")}.node`);
    return existsSync(native) ? native : null;
  }
  if (!existsSync(join(dist, "index.js"))) return null;
  const wasm = readdirSync(dist).find((entry) => entry.endsWith("_bg.wasm"));
  return wasm ? join(dist, wasm) : null;
}

const wanted = process.argv.slice(2);
const selected = wanted.length ? UNITS.filter((unit) => wanted.includes(unit.name)) : UNITS;
if (!selected.length) throw new Error(`没有匹配的单元：${wanted.join(", ")}`);

for (const unit of selected) {
  const built = builtArtifact(unit);
  if (!built) throw new Error(`${unit.name}: 产物缺失，先跑 npm run rust:build ${unit.name}`);
  if (artifactOlderThanSource(unit, built)) {
    throw new Error(`${unit.name}: 产物比 ${unit.crate}/src 旧，先跑 npm run rust:build ${unit.name}`);
  }
  const wiring = readFileSync(join(ROOT, unit.shim), "utf8");
  const expected = unit.marker ?? `rust-dist/${unit.name}/index.js`;
  if (!wiring.includes(expected)) throw new Error(`${unit.name}: ${unit.shim} 没有指向 ${expected}`);
  await unit.probe();
  console.log(`wired: ${unit.name}`);
}
