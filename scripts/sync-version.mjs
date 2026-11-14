import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const packagePath = resolve(rootDir, "package.json");
const manifestPath = resolve(rootDir, "manifest.json");
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
  console.log(`Version updated: ${currentVersion} -> ${nextVersion}`);
}
