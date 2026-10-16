import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packagePath = resolve(rootDir, "package.json");
const manifestPath = resolve(rootDir, "extension/manifest.json");
const userscriptPath = resolve(rootDir, "AI中转站价格分析工具.js");
const mode = process.argv[2] || "--check";
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const BUMP_PARTS = ["major", "minor", "patch"];

function fail(message) {
  throw new Error(message);
}

function bumpVersion(version, part) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) fail(`Invalid semantic version: ${version}`);
  const values = match.slice(1).map(Number);
  const index = { major: 0, minor: 1, patch: 2 }[part];
  values[index] += 1;
  for (let i = index + 1; i < values.length; i += 1) values[i] = 0;
  return values.join(".");
}

function replaceOnce(source, pattern, replacement, label) {
  if (!pattern.test(source)) fail(`Could not update ${label}`);
  return source.replace(pattern, replacement);
}

function readVersionFromUserscript(source) {
  const metadata = source.match(/^\/\/ @version\s+([^\s]+)$/m)?.[1];
  const runtime = source.match(/^const SCRIPT_VERSION = "([^"]+)";$/m)?.[1];
  const display = source.match(/^\/\/ @name\s+.*\(v([^)]*)\)$/m)?.[1];
  if (!metadata || !runtime || !display) fail("Could not read userscript version fields");
  return { metadata, runtime, display };
}

if (mode !== "--check" && !BUMP_PARTS.includes(mode)) {
  fail("Usage: node scripts/sync-version.mjs [major|minor|patch|--check]");
}

const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const currentProjectVersion = packageJson.version;
const currentUserscriptVersion = packageJson.userscriptVersion;
if (!VERSION_PATTERN.test(currentProjectVersion)) fail(`Invalid project version: ${currentProjectVersion}`);
if (!VERSION_PATTERN.test(currentUserscriptVersion)) fail(`Invalid userscript version: ${currentUserscriptVersion}`);

const nextProjectVersion = mode === "--check" ? currentProjectVersion : bumpVersion(currentProjectVersion, mode);
const nextUserscriptVersion = mode === "--check" ? currentUserscriptVersion : bumpVersion(currentUserscriptVersion, mode);
const manifestSource = await readFile(manifestPath, "utf8");
const manifest = JSON.parse(manifestSource);
const userscript = await readFile(userscriptPath, "utf8");
const userscriptVersions = readVersionFromUserscript(userscript);

const mismatches = [
  ["extension/manifest.json", manifest.version, currentProjectVersion],
  ["AI中转站价格分析工具.js @version", userscriptVersions.metadata, currentUserscriptVersion],
  ["AI中转站价格分析工具.js SCRIPT_VERSION", userscriptVersions.runtime, currentUserscriptVersion],
  ["AI中转站价格分析工具.js @name", userscriptVersions.display, currentUserscriptVersion]
].filter(([, actual, expected]) => actual !== expected);

if (mode === "--check") {
  if (mismatches.length) {
    fail(mismatches.map(([label, actual, expected]) => `${label}: ${actual} (expected ${expected})`).join("\n"));
  }
  console.log(`Version check passed: project ${currentProjectVersion}, userscript ${currentUserscriptVersion}`);
} else {
  packageJson.version = nextProjectVersion;
  packageJson.userscriptVersion = nextUserscriptVersion;
  const updatedUserscript = replaceOnce(
    userscript,
    /^\/\/ @version\s+[^\s]+$/m,
    `// @version      ${nextUserscriptVersion}`,
    "userscript metadata version"
  );
  const updatedUserscriptWithRuntime = replaceOnce(
    updatedUserscript,
    /^const SCRIPT_VERSION = "[^"]+";$/m,
    `const SCRIPT_VERSION = "${nextUserscriptVersion}";`,
    "userscript runtime version"
  );
  const nameLine = updatedUserscriptWithRuntime.match(/^\/\/ @name(\s+)(.*)$/m);
  if (!nameLine) fail("Could not update userscript display name");
  const nameWithoutVersion = nameLine[2].replace(/\s+\(v[^)]*\)$/, "");
  const updatedName = `// @name${nameLine[1]}${nameWithoutVersion} (v${nextUserscriptVersion})`;
  const finalUserscript = replaceOnce(
    updatedUserscriptWithRuntime,
    /^\/\/ @name.*$/m,
    updatedName,
    "userscript display version"
  );
  const finalManifest = replaceOnce(
    manifestSource,
    /^(\s*"version"\s*:\s*)"[^"]+"(.*)$/m,
    `$1"${nextProjectVersion}"$2`,
    "manifest version"
  );

  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  await writeFile(manifestPath, finalManifest);
  await writeFile(userscriptPath, finalUserscript);
  console.log(`Versions updated: project ${currentProjectVersion} -> ${nextProjectVersion}; userscript ${currentUserscriptVersion} -> ${nextUserscriptVersion}`);
}
