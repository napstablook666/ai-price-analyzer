// 构建 wasm 单元，产物落到 extension/rust-dist/<unit>/
// 用法：npm run rust:build [-- <unit>...] / node scripts/rust-build.mjs --shims-only [<unit>...]
// 产物是「导入即可调」的 ESM shim：调用方 import 后直接调导出，不需要自己 await init()。
// MV3 的 module service worker 不允许顶层 await，所以 wasm 字节以 base64 内联、走 initSync 同步实例化；
// 用异步 init() 会让 service worker 注册失败（Service worker registration failed. Status code: 3），
// 表现就是工具栏图标点了没有任何反应。
// --shims-only：不重编 Rust，只按现有 .wasm 重写 index.js 与内联字节，改 shim 生成逻辑时用它。
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fingerprintPayload, FINGERPRINT_NAME } from "./lib/rust-build-inputs.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  { name: "exchange-rate-rs", crate: "rust/exchange-rate-rs" },
  { name: "billing-tiers-rs", crate: "rust/billing-tiers-rs" }
];

function libName(name) {
  return name.replace(/-/g, "_");
}

// 所有单元共用一份解码器：atob 在浏览器和 Node 18+ 都是全局的。
const DECODER = `// 由 scripts/rust-build.mjs 生成，不要手改。base64 → Uint8Array，给内联的 wasm 字节用。
export function decodeBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
`;

function shim(lib) {
  return `// 由 scripts/rust-build.mjs 生成，不要手改。
// MV3 的 module service worker 不允许顶层 await：wasm 必须同步实例化，字节以 base64 内联在本目录。
import * as wasm from "./${lib}.js";
import { wasmBase64 } from "./${lib}_wasm.js";
import { decodeBase64 } from "../decode-base64.js";

// initSync 是命名导出，默认导出是异步的 __wbg_init：service worker 里只认前者。
wasm.initSync({ module: decodeBase64(wasmBase64) });

export * from "./${lib}.js";
export default wasm;
`;
}

function wasmBytesModule(lib, base64) {
  return `// 由 scripts/rust-build.mjs 生成，不要手改。${lib}_bg.wasm 的 base64，供 index.js 同步实例化。
export const wasmBase64 = "${base64}";
`;
}

function buildUnit(unit) {
  const crateDir = join(ROOT, unit.crate);
  if (!existsSync(crateDir)) throw new Error(`crate 不存在：${unit.crate}`);
  // 纯数据表要先从 src/shared 同步进 crate，再编译：port.rs 用 include_str!("data.json") 把它
  // 烧进 wasm，顺序反了就会带着上一版表编译，改表也不报错。
  if (unit.prepare) execFileSync("node", [join(ROOT, unit.prepare)], { stdio: "inherit" });
  execFileSync("cargo", ["+" + TOOLCHAIN, "build", "--release", "--target", TARGET], {
    cwd: crateDir,
    stdio: "inherit"
  });
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

async function writeShims(outDir, lib) {
  const wasmFile = join(outDir, `${lib}_bg.wasm`);
  if (!existsSync(wasmFile)) throw new Error(`没有 wasm 可内联：${wasmFile}`);
  const base64 = (await readFile(wasmFile)).toString("base64");
  await writeFile(join(outDir, `${lib}_wasm.js`), wasmBytesModule(lib, base64), "utf8");
  await writeFile(join(outDir, "index.js"), shim(lib), "utf8");
}

async function main() {
  const args = process.argv.slice(2);
  const shimsOnly = args.includes("--shims-only");
  const only = args.filter((arg) => !arg.startsWith("--"));
  const units = only.length === 0 ? UNITS : UNITS.filter((unit) => only.includes(unit.name));
  if (units.length === 0) throw new Error(`没有匹配的单元：${only.join(", ")}`);
  await mkdir(DIST, { recursive: true });
  await writeFile(join(DIST, "decode-base64.js"), DECODER, "utf8");
  for (const unit of units) {
    let outDir;
    let lib;
    if (shimsOnly) {
      outDir = join(DIST, unit.name);
      lib = libName(unit.name);
    } else {
      ({ outDir, lib } = buildUnit(unit));
    }
    await writeShims(outDir, lib);
    // 存一份「照着哪些输入编出来」的指纹，rust:wire 拿它判断产物新不新。比提交时间可靠：
    // 源码改动不影响 codegen 时产物字节不变，提交时间那套会永久判旧。
    await writeFile(
      join(outDir, FINGERPRINT_NAME),
      `${JSON.stringify(fingerprintPayload(unit.name, join(ROOT, unit.crate)), null, 2)}\n`,
      "utf8"
    );
    console.log(`built rust-dist/${unit.name}/index.js`);
  }
}

await main();
