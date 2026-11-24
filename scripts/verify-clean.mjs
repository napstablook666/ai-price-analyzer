#!/usr/bin/env node
// 在干净签出上跑一遍验收，证明「说的是 HEAD 绿，不是脏工作树绿」。
//
// 由来：11-14 那次说「HEAD 绿」，其实只在脏工作树里绿过一遍，
// 干净签出跑是 267/268 —— 有个用例的更新还压在别人没提交的改动里。
//
// 规则：工作区必须干净，否则直接拒绝（先提交或 stash）。
// 做的事：git worktree add --detach 到临时目录 → 跑全套 → 拆掉 worktree。
//
// 用法：node scripts/verify-clean.mjs [--keep] [--dirty-ok]
import { execFileSync, execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(root, "..");
const pluginsDir = resolve(repo, "plugins");
const keep = process.argv.includes("--keep");
const worktree = resolve(root, ".tmp", `verify-${Date.now().toString(36)}`);


const git = (args, cwd = root) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

const allowDirty = process.argv.includes("--dirty-ok");
const dirty = git(["status", "--porcelain", "--untracked-files=no"]);
if (dirty && !allowDirty) {
  console.error("工作区有未提交改动。先 commit 或 stash；如果那是别的会话在改，加 --dirty-ok 表示「我知道，验的是 HEAD」：\n");
  console.error(dirty);
  process.exit(1);
}
if (dirty) console.warn(`注意：这些未提交改动不在验证范围内，验的是 HEAD：\n${dirty}\n`);

const head = git(["rev-parse", "--short", "HEAD"]);
console.log(`在干净签出 ${head} 上验证\n`);

if (!existsSync(pluginsDir)) {
  console.error(`找不到插件仓库：${pluginsDir}`);
  process.exit(1);
}

// worktree 的父目录不是工作区根，插件仓要显式指过去
const env = { ...process.env, PLUGIN_DIR: pluginsDir };
// 每步写成完整命令行字符串：Windows 上 npm 是 .cmd，参数直传会触发 DEP0190
const steps = [
  ["id 引用校验", "node scripts/check-html-ids.mjs"],
  ["Rust 接线探针", "node scripts/rust-wire-check.mjs"],
  ["全量测试", "npm test"],
  ["插件产物漂移", "npm run plugins:check"],
  ["版本号一致", "npm run version:check"],
];

let failed = null;
try {
  git(["worktree", "add", "--detach", worktree, "HEAD"]);
  for (const [label, command] of steps) {
    console.log(`\n── ${label}`);
    try {
      execSync(command, { cwd: worktree, stdio: "inherit", env });
    } catch {
      failed = label;
      break;
    }
  }
} finally {
  if (keep && failed === null) {
    console.log(`\n保留验证目录：${worktree}`);
  } else {
    try {
      git(["worktree", "remove", "--force", worktree]);
    } catch {
      rmSync(worktree, { recursive: true, force: true });
    }
  }
}

if (failed) {
  console.error(`\n✗ 干净签出 ${head} 上「${failed}」没过 —— 这个结果才算数`);
  process.exit(1);
}
console.log(`\n✓ 干净签出 ${head} 全套验收通过`);
