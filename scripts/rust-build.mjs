// 构建 wasm 单元，产物落到 extension/rust-dist/<unit>/
// 用法：npm run rust:build [-- <unit>...]
// 产物是「导入即可调」的 ESM shim：调用方 import 后直接调导出，不需要自己 await init()。
// Node 与浏览器共用同一份产物：浏览器走 fetch 拿 .wasm，Node 用 fs 读同一个文件。
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "rust-dist");
const TOOLCHAIN = "stable";
const TARGET = "wasm32-unknown-unknown";

// 单元清单：crate 目录 → 产物名。新增 wasm 单元就在这里登记一行。
const UNITS = [
  { name: "smoke-rs", crate: "rust/smoke-rs" },
  { name: "shared-rs", crate: "rust/shared-rs", prepare: "scripts/gen-shared-data.mjs" },
  { name: "price-fields-rs", crate: "rust/price-fields-rs" },
  { name: "exchange-rate-rs", crate: "rust/exchange-rate-rs" }
];

function libName(name) {
  return name.replace(/-/g, "_");
}

function shim(name, lib) {
  return `// 由 scripts/rust-build.mjs 生成，不要手改。
import init, * as wasm from "./${lib}.js";

const wasmSource = globalThis.process?.versions?.node
  ? await (await import("node:fs/promises")).readFile(new URL("./${lib}_bg.wasm", import.meta.url))
  : undefined;
await init({ module_or_path: wasmSource });

export * from "./${lib}.js";
export default wasm;
`;
}

function buildUnit(unit) {
  const crateDir = join(ROOT, unit.crate);
  if (!existsSync(crateDir)) throw new Error(`crate 不存在：${unit.crate}`);
  execFileSync("cargo", ["+" + TOOLCHAIN, "build", "--release", "--target", TARGET], {
    cwd: crateDir,
    stdio: "inherit"
  });
  // 纯数据表要从 src/shared 同步进 crate，否则 wasm 里带的是旧表。
  if (unit.prepare) execFileSync("node", [join(ROOT, unit.prepare)], { stdio: "inherit" });
  const lib = libName(unit.name);
  const wasm = join(crateDir, "target", TARGET, "release", `${lib.replace(/-/g, "_")}.wasm`);
  if (!existsSync(wasm)) throw new Error(`没有产出 wasm：${wasm}`);
  const outDir = join(DIST, unit.name);
  execFileSync(
    "wasm-bindgen",
    ["--target", "web", "--out-dir", outDir, "--no-typescript", wasm],
    { stdio: "inherit" }
  );
  return { outDir, lib };
}

async function main() {
  const only = process.argv.slice(2);
  const units = only.length === 0 ? UNITS : UNITS.filter((unit) => only.includes(unit.name));
  if (units.length === 0) throw new Error(`没有匹配的单元：${only.join(", ")}`);
  for (const unit of units) {
    const { outDir, lib } = buildUnit(unit);
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "index.js"), shim(unit.name, lib), "utf8");
    console.log(`built rust-dist/${unit.name}/index.js`);
  }
}

await main();