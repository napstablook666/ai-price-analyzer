// 在 HEAD 的干净签出里跑 rust-anything 的三步验证：record → diff → gate。
// 为什么要这样：单元接进 JS 之后，src/ 里的实现已经转发到 wasm，直接 record 采到的是 Rust 自己的输出，
// diff 就等于自己跟自己比。干净签出里跑的是接之前的原实现，这才是真对照。
// 用法：node scripts/rust-verify.mjs [unit...]（默认全部）
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WORKTREE = join(ROOT, "out", "rust-verify", "head");

function git(args, options = {}) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8", ...options }).trim();
}

/** HEAD 的干净签出，已存在就对齐到当前 HEAD。 */
function ensureWorktree() {
  const head = git(["rev-parse", "HEAD"]);
  if (!existsSync(WORKTREE)) {
    execFileSync("git", ["worktree", "add", "--detach", WORKTREE, head], { cwd: ROOT, stdio: "inherit" });
  } else {
    execFileSync("git", ["-C", WORKTREE, "checkout", "--detach", head], { stdio: "inherit" });
  }
  return head;
}

/** 把工作区里的 crate 源码搬进签出，并让 rust-anything 对着签出的源码跑。 */
function stageCrate(unit) {
  const source = join(ROOT, "rust", unit);
  const target = join(WORKTREE, "rust", unit);
  rmSync(target, { recursive: true, force: true });
  cpSync(source, target, {
    recursive: true,
    filter: (path) => !/[/\\](target|pkg)([/\\]|$)/.test(path)
  });
  const metaFile = join(target, "rust-anything.json");
  const meta = JSON.parse(readFileSync(metaFile, "utf8"));
  meta.root = WORKTREE;
  writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  return join("rust", unit);
}

const units = process.argv.slice(2);
const all = units.length > 0 ? units : ["shared-rs"];
const head = ensureWorktree();
console.log(`验证基准：HEAD ${head.slice(0, 8)} → ${WORKTREE}`);

let failed = false;
for (const unit of all) {
  const crate = stageCrate(unit);
  console.log(`\n== ${unit}`);
  // 先 build：diff 走的是 wasm-bindgen 产出的 pkg/，不能拿工作区的旧件凑。
  for (const step of ["record", "build", "diff", "gate"]) {
    try {
      execFileSync("rust-anything", [step, crate], { cwd: WORKTREE, stdio: "inherit" });
      // 采到的用例要留在仓库里，否则下次 diff 没得比。
      if (step === "record") {
        for (const name of ["cases.jsonl", "recorded-from.json"]) {
          const from = join(WORKTREE, crate, name);
          if (existsSync(from)) cpSync(from, join(ROOT, "rust", unit, name));
        }
      }
    } catch {
      console.error(`rust-anything ${step} ${unit} 失败`);
      failed = true;
      break;
    }
  }
}

if (failed) process.exitCode = 1;
