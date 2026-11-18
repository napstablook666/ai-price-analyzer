import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { resolveMinShell } from "../scripts/lib/update-version.mjs";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("minShell 取 package.json 的 updateMinShell，不取本版版本号", () => {
  const { minShell } = resolveMinShell({ packageJson: { updateMinShell: "0.9.0" }, version: "0.11.2" });
  assert.equal(minShell, "0.9.0");
});

test("--min-shell 覆盖 package.json，并说明覆盖了什么", () => {
  const { minShell, warnings } = resolveMinShell({
    cliValue: "0.9.0",
    packageJson: { updateMinShell: "0.10.0" },
    version: "0.11.2"
  });
  assert.equal(minShell, "0.9.0");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /0\.9\.0.*0\.10\.0/);
});

test("两边都没给时报错，不回落到本版版本号", () => {
  assert.throws(
    () => resolveMinShell({ packageJson: {}, version: "0.11.2" }),
    /缺少 updateMinShell/
  );
});

test("minShell 不是语义化版本时报错", () => {
  assert.throws(
    () => resolveMinShell({ packageJson: { updateMinShell: "0.9" }, version: "0.11.2" }),
    /不是语义化版本/
  );
});

test("minShell 高于本版版本时报错：那一版自己都不满足下限", () => {
  assert.throws(
    () => resolveMinShell({ packageJson: { updateMinShell: "0.12.0" }, version: "0.11.2" }),
    /高于本版版本/
  );
});

test("minShell 等于本版版本时放行但警告：自更新只对本版生效", () => {
  const { minShell, warnings } = resolveMinShell({
    packageJson: { updateMinShell: "0.11.2" },
    version: "0.11.2"
  });
  assert.equal(minShell, "0.11.2");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /只有装这一版的人能自更新/);
});

test("带 v 前缀的写法归一成裸版本号", () => {
  const { minShell } = resolveMinShell({ packageJson: { updateMinShell: "v0.9.0" }, version: "v0.11.2" });
  assert.equal(minShell, "0.9.0");
});

// 守住仓库现状：这条红了说明 package.json 的 updateMinShell 被删或写坏。
test("仓库的 package.json 带着合法的 updateMinShell，且不高于当前版本", () => {
  assert.equal(typeof packageJson.updateMinShell, "string");
  const { minShell, warnings } = resolveMinShell({ packageJson, version: packageJson.version });
  assert.match(minShell, /^\d+\.\d+\.\d+$/);
  assert.deepEqual(warnings, []);
});

// 回归：曾经默认取本版版本号，导致装旧版的人一律被 canSelfUpdate 挡住。
test("仓库现状不会退回「minShell 等于本版版本号」", () => {
  const { minShell } = resolveMinShell({ packageJson, version: packageJson.version });
  assert.notEqual(minShell, packageJson.version);
});
