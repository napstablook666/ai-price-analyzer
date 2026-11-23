import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packagePath = resolve(rootDir, "package.json");
const manifestPath = resolve(rootDir, "manifest.json");
const installDocPath = resolve(rootDir, "docs/guide/install.md");
const mode = process.argv[2] || "--check";
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const BUMP_PARTS = ["major", "minor", "patch"];

function fail(message) {
  throw new Error(message);
}

function bumpVersion(version, part) {
  const match = version.match(VERSION_PATTERN);
  if (!match) fail(`Invalid semantic version: ${version}`);
  const values = version.split(".").map(Number);
  const index = { major: 0, minor: 1, patch: 2 }[part];
  values[index] += 1;
  for (let i = index + 1; i < values.length; i += 1) values[i] = 0;
  return values.join(".");
}

if (mode !== "--check" && !BUMP_PARTS.includes(mode)) {
  fail("Usage: node scripts/sync-version.mjs [major|minor|patch|--check]");
}

const packageSource = await readFile(packagePath, "utf8");
const manifestSource = await readFile(manifestPath, "utf8");
const packageJson = JSON.parse(packageSource);
const manifest = JSON.parse(manifestSource);
const currentVersion = packageJson.version;
if (!VERSION_PATTERN.test(currentVersion)) fail(`Invalid project version: ${currentVersion}`);
if (manifest.version !== currentVersion) {
  fail(`manifest.json: ${manifest.version} (expected ${currentVersion})`);
}

// 安装文档里写死的版本号跟着一起走，之前漂过两个大版本没人发现。
const INSTALL_DOC_PATTERN = /^(\| 扩展版本 \| `)(\d+\.\d+\.\d+)(`（见 `manifest\.json`） \|)$/m;
const installDocSource = await readFile(installDocPath, "utf8");
const installDocVersion = installDocSource.match(INSTALL_DOC_PATTERN)?.[2];
if (!installDocVersion) fail("docs/guide/install.md: 找不到「扩展版本」那一行的版本号");
if (installDocVersion !== currentVersion) {
  fail(`docs/guide/install.md: ${installDocVersion} (expected ${currentVersion})`);
}

if (mode === "--check") {
  console.log(`Version check passed: ${currentVersion}`);
} else {
  const nextVersion = bumpVersion(currentVersion, mode);
  const updatedManifest = manifestSource.replace(
    /^(\s*"version"\s*:\s*)"[^"]+"(.*)$/m,
    `$1"${nextVersion}"$2`
  );
  if (updatedManifest === manifestSource) fail("Could not update manifest.json version");
  packageJson.version = nextVersion;
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  await writeFile(manifestPath, updatedManifest);
  await writeFile(installDocPath, installDocSource.replace(INSTALL_DOC_PATTERN, `$1${nextVersion}$3`));
  console.log(`Version updated: ${currentVersion} -> ${nextVersion}`);
}
