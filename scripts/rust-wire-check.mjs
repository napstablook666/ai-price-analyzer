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
import { FINGERPRINT_NAME, sourceFingerprint } from "./lib/rust-build-inputs.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 指纹优先，提交时间只是没有指纹时的退路（老产物、新加的 crate）。
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
  },
  {
    name: "billing-tiers-rs",
    crate: "rust/billing-tiers-rs",
    shim: "src/core/rust-billing-shim.js",
    async probe() {
      const { parseBillingTiers } = await import(new URL("../src/core/billing-tiers.js", import.meta.url));
      // 期望值是移植前 JS 实现录下来的那条用例，逐字段对齐才能证明解析真的在 Rust 侧跑。
      assert.deepEqual(
        parseBillingTiers('len < 200000 ? tier("short_context", p * 2 + c * 6 + cr * 0.5) : tier("long_context", p * 4 + c * 12 + cr * 1)'),
        [
          { name: "short_context", input: 2, output: 6, ratio: 1, completion: 3, billing: { cacheRead: 0.5, cacheWrite: 0, cacheWrite1h: 0 }, unit: "token", fixed: null, minTokens: 0, maxTokens: 200000, maxInclusive: false },
          { name: "long_context", input: 4, output: 12, ratio: 2, completion: 3, billing: { cacheRead: 1, cacheWrite: 0, cacheWrite1h: 0 }, unit: "token", fixed: null, minTokens: 200000, maxTokens: null, maxInclusive: true }
        ]
      );
      assert.deepEqual(parseBillingTiers("nothing here"), []);
      assert.deepEqual(parseBillingTiers(null), []);
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
function artifactOlderThanSource(unit, built) {
  // napi 单元的产物落在 rust/<unit>/ 下，wasm 单元落在 rust-dist/<unit>/ 下，两边都要按实际路径查。
  const distDir = relative(ROOT, built).replace(/\\/g, "/").replace(/\/[^/]+$/, "");

  // 首选：比构建输入的指纹。构建时 rust-build.mjs 把「照着哪些文件编的」哈希写进
  // 产物目录的 build-inputs.json，这里按当前文件重算一次。源码改动不影响 codegen 时
  // （例如删掉一个多余的取址）wasm 字节完全一致，`rust-dist/` 不会产出新提交，
  // 早先那套「比提交时间」就会永久判旧；指纹只看输入，不看字节变没变。
  const stampPath = join(ROOT, distDir, FINGERPRINT_NAME);
  if (existsSync(stampPath)) {
    let stamp = null;
    try {
      stamp = JSON.parse(readFileSync(stampPath, "utf8"));
    } catch {
      return true; // 指纹文件读不出来，按旧处理，让调用方重建
    }
    if (stamp?.source !== sourceFingerprint(join(ROOT, unit.crate))) return true;
    // 指纹对得上，再确认产物文件本身还在原地（被手删过就还得重建）。
    return !existsSync(built);
  }

  // 没有指纹：老产物或新加的 crate，退回提交时间。产物有未提交改动说明刚重新编译，直接放过。
  if (gitOut(["status", "--porcelain", "--untracked-files=all", "--", distDir])) return false;
  const sourceAt = lastCommitMs([`${unit.crate}/src`]);
  const artifactAt = lastCommitMs([distDir]);
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
