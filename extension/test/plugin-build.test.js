import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
const { build, checkOutputs, rewriteImports } = await import(pathToFileURL(path.join(root, "scripts", "plugin-build.mjs")).href);
const { SITE_PLUGIN_CATALOG } = await import(pathToFileURL(path.join(here, "..", "src", "site-plugins", "catalog.js")).href);
const { SITE_PLUGIN_ORDER } = await import(pathToFileURL(path.join(here, "..", "src", "shared", "plugin-order.js")).href);

test("插件产物与 plugins/ 源保持同步", () => {
  const drift = checkOutputs(build().files);
  assert.deepEqual(drift, []);
});

test("catalog 与插件目录一一对应，且顺序来自 manifest.order", () => {
  const { plugins } = build();
  const ids = plugins.map(plugin => plugin.id).sort();
  assert.deepEqual(SITE_PLUGIN_CATALOG.map(entry => entry.id).sort(), ids);
  assert.deepEqual([...SITE_PLUGIN_ORDER].sort(), ids);
  for (const entry of SITE_PLUGIN_CATALOG) {
    const manifest = plugins.find(plugin => plugin.id === entry.id).manifest;
    assert.equal(entry.host, manifest.host);
    assert.equal(entry.mode, manifest.mode || "direct");
  }
});

test("每个生成的插件都暴露 modelAliases 数组", async () => {
  for (const entry of SITE_PLUGIN_CATALOG) {
    const module = entry.load();
    assert.equal(module.sitePlugin.id, entry.id);
    assert.ok(Array.isArray(module.sitePlugin.modelAliases), `${entry.id} 缺少 modelAliases`);
    for (const alias of module.sitePlugin.modelAliases) {
      assert.equal(typeof alias.alias, "string");
      assert.equal(typeof alias.canonicalId, "string");
    }
  }
});

test("models.json 的别名进入生成的插件", () => {
  const { plugins } = build();
  for (const plugin of plugins) {
    for (const [alias, canonicalId] of Object.entries(plugin.aliases)) {
      assert.ok(alias && canonicalId, `plugins/${plugin.id}/models.json 别名不完整`);
    }
  }
});

test("插件源码只能用 @app/ 前缀引用扩展核心", () => {
  const { plugins } = build();
  for (const plugin of plugins) {
    assert.equal(plugin.source.includes("../../"), false, `plugins/${plugin.id}/plugin.js 不能写相对扩展路径`);
    assert.equal(rewriteImports('import { a } from "@app/core/x.js";'), 'import { a } from "../../core/x.js";');
  }
});

test("每个插件目录都有可直接阅读的 manifest", () => {
  const dir = path.join(root, "plugins");
  for (const id of fs.readdirSync(dir).filter(name => fs.statSync(path.join(dir, name)).isDirectory())) {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, id, "manifest.json"), "utf8"));
    assert.equal(manifest.id, id);
    assert.ok(manifest.name && manifest.host);
  }
});