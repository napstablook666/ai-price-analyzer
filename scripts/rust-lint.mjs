// Rust 侧的 fmt + clippy 闸门。
//
// 为什么单独一个脚本：`npm run verify` 里原本没有 clippy，于是 `-D warnings` 的红灯
// 只会在有人手动敲 cargo 时才出现。2026-11-25 U12 就是这么漏的——QA 跑到 clippy
// 才发现 `needless_borrow`，而 verify 一直是绿的。guard-coverage 的头注释写过同一件事：
// 检查写好了但没挂进脚本，等于没写。
//
// 用法：node scripts/rust-lint.mjs [unit...]（默认 rust/ 下所有带 Cargo.toml 的目录）
// 环境变量 RUST_LINT_SKIP=1 时直接跳过并说明理由（给没有 cargo 的机器用，CI 上不设）。

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUST = join(ROOT, "rust");

if (process.env.RUST_LINT_SKIP === "1") {
  console.log("rust:lint 已按 RUST_LINT_SKIP=1 跳过（本机没有 cargo 时才允许）");
  process.exit(0);
}

function hasCargo() {
  try {
    execFileSync("cargo", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

if (!hasCargo()) {
  console.error("rust:lint 需要 cargo，但 PATH 上没有。装 Rust 工具链，或显式设 RUST_LINT_SKIP=1 跳过。");
  process.exit(1);
}

/** rust/ 下所有带 Cargo.toml 的单元目录名。 */
function allUnits() {
  return readdirSync(RUST)
    .filter(name => existsSync(join(RUST, name, "Cargo.toml")))
    .sort();
}

const requested = process.argv.slice(2).filter(arg => !arg.startsWith("-"));
const units = requested.length > 0 ? requested : allUnits();

// 单元名可以是目录名，也可以省掉 -rs 后缀；两种都认，认不出来直接报错，不要静默跳过。
const known = new Set(allUnits());
const resolved = units.map(name => {
  const candidate = known.has(name) ? name : known.has(`${name}-rs`) ? `${name}-rs` : null;
  if (candidate === null) {
    console.error(`rust:lint 不认识的单元：${name}（rust/ 下有：${[...known].join(", ")}）`);
    process.exit(1);
  }
  return candidate;
});

const failures = [];

for (const unit of resolved) {
  const manifest = join(RUST, unit, "Cargo.toml");
  const label = unit;

  // 1. 格式：fmt 有 diff 就说明有人手改了排版，和 rustfmt 打起来只是时间问题。
  try {
    execFileSync("cargo", ["fmt", "--check", "--manifest-path", manifest], { stdio: "pipe", encoding: "utf8" });
    console.log(`fmt    ok   ${label}`);
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    failures.push({ label, step: "fmt", output });
    console.error(`fmt    FAIL ${label}`);
  }

  // 2. clippy：警告当错误。--all-targets 让 #[cfg(test)] 里的代码也进闸门。
  try {
    execFileSync("cargo", ["clippy", "--manifest-path", manifest, "--all-targets", "--quiet", "--", "-D", "warnings"], {
      stdio: "pipe",
      encoding: "utf8"
    });
    console.log(`clippy ok   ${label}`);
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    failures.push({ label, step: "clippy", output });
    console.error(`clippy FAIL ${label}`);
  }
}

if (failures.length > 0) {
  console.error(`\nrust:lint 失败 ${failures.length} 处：`);
  for (const failure of failures) {
    console.error(`\n── ${failure.label} · ${failure.step}`);
    console.error(failure.output.split("\n").slice(0, 40).join("\n"));
  }
  process.exit(1);
}

console.log(`rust:lint 通过：${resolved.length} 个 crate 的 fmt 与 clippy 都干净`);
