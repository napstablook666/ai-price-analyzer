// 生成发版用的 update.json：文件表、包摘要、签名。
// 签名口径与 src/core/self-update.js 共用同一份实现，改口径只改那一处。
//
// 用法：
//   node scripts/build-update-manifest.mjs --source dist/source --zip dist/xxx.zip \
//     --version v0.9.0 --url https://github.com/<owner>/<repo>/releases/download/v0.9.0/xxx.zip
// minShell 默认取 package.json 的 updateMinShell，--min-shell 可临时覆盖。
// 私钥从环境变量 SIGNING_KEY（PEM 全文）读，或 --key-file 指定路径。

import { createHash, sign, createPrivateKey } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { manifestSigningPayload, parseUpdateManifest } from "../src/core/self-update.js";
import { resolveMinShell } from "./lib/update-version.mjs";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));

// zip 里实际打进去的顶层条目，多一个少一个都会让文件表和包内容对不上。
const RUNTIME_ENTRIES = ["manifest.json", "dashboard.html", "options.html", "styles.css", "styles", "icons", "src"];
// 更新器本体不进文件表：扩展不该去写自己，它们的升级由自己负责。
const EXCLUDED_BASENAMES = new Set(["update.bat", "update.ps1", "update-marker.json"]);

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) fail(`无法识别的参数：${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) fail(`参数 ${token} 缺少值`);
    args[key] = value;
    index += 1;
  }
  return args;
}

async function sha256File(path) {
  const buffer = await readFile(path);
  return { hash: createHash("sha256").update(buffer).digest("hex"), size: buffer.length };
}

async function walkFiles(baseDir, entryPath) {
  const absolute = join(baseDir, entryPath);
  const info = await stat(absolute);
  if (info.isFile()) return [entryPath];
  const out = [];
  for (const name of await readdir(absolute)) {
    const child = `${entryPath}/${name}`;
    if (EXCLUDED_BASENAMES.has(name)) continue;
    out.push(...(await walkFiles(baseDir, child)));
  }
  return out;
}

function toPosix(value) {
  return value.split(sep).join("/");
}

const args = parseArgs(process.argv.slice(2));
const sourceDir = resolve(rootDir, args.source || "dist/source");
const zipPath = resolve(rootDir, args.zip || "");
const version = String(args.version || "").replace(/^v/, "");
const zipUrl = String(args["zip-url"] || args.url || "");
const outPath = resolve(rootDir, args.out || "dist/update.json");
if (!version) fail("缺少 --version");

// minShell 取 package.json 的 updateMinShell（协议最低兼容版本），不是本版版本号。
// 理由与取值规则见 scripts/lib/update-version.mjs。
const packageJson = JSON.parse(await readFile(resolve(rootDir, "package.json"), "utf8"));
const { minShell, warnings } = resolveMinShell({
  cliValue: args["min-shell"],
  packageJson,
  version
});
for (const warning of warnings) console.warn(`警告：${warning}`);
if (!zipUrl) fail("缺少 --url");
if (!existsSync(sourceDir)) fail(`找不到打包目录：${sourceDir}`);
if (!existsSync(zipPath)) fail(`找不到更新包：${zipPath}`);

const files = {};
for (const entry of RUNTIME_ENTRIES) {
  const paths = await walkFiles(sourceDir, entry);
  for (const path of paths) {
    files[path] = (await sha256File(join(sourceDir, path))).hash;
  }
}

const sortedFiles = {};
for (const key of Object.keys(files).sort()) sortedFiles[key] = files[key];

const zipInfo = await sha256File(zipPath);

const manifest = {
  version,
  minShell,
  publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  zip: { url: zipUrl, size: zipInfo.size, sha256: zipInfo.hash },
  files: sortedFiles,
  deleted: [],
  signature: ""
};

const keyPem = args["key-file"] ? await readFile(resolve(rootDir, args["key-file"]), "utf8") : process.env.SIGNING_KEY;
if (!keyPem) fail("缺少签名私钥：设置环境变量 SIGNING_KEY 或传 --key-file");

const payload = await manifestSigningPayload(manifest);
// WebCrypto 的 ECDSA 校验认 R||S 定长拼接，Node 默认出 DER，这里必须显式指定格式。
const signature = sign("sha256", Buffer.from(payload, "utf8"), {
  key: createPrivateKey(keyPem),
  dsaEncoding: "ieee-p1363"
});
manifest.signature = signature.toString("base64");

// 自检：产出的清单必须能被消费端的解析规则接受，否则发出去也是废纸。
parseUpdateManifest(manifest);

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

console.log(`update.json 已生成：${toPosix(relative(rootDir, outPath))}`);
console.log(`版本 ${version}，文件 ${Object.keys(sortedFiles).length} 个，包 ${zipInfo.size} 字节`);
console.log(`minShell ${minShell}`);
console.log(`zip sha256 ${zipInfo.hash}`);
