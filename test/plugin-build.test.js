import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const { build, checkOutputs, rewriteImports } = await import(pathToFileURL(path.join(root, "scripts", "plugin-build.mjs")).href);
const { SITE_PLUGIN_CATALOG } = await import(pathToFileURL(path.join(here, "..", "src", "site-plugins", "catalog.js")).href);
const { SITE_PLUGIN_ORDER } = await import(pathToFileURL(path.join(here, "..", "src", "shared", "plugin-order.js")).href);
const { SITE_LOGOS, siteLogoFor } = await import(pathToFileURL(path.join(here, "..", "src", "shared", "site-logos.js")).href);
const { resolvePriceMap } = await import(pathToFileURL(path.join(here, "..", "src", "core", "price-maps", "index.js")).href);

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

test("数字开头的插件 ID 生成后仍是合法的 ES 模块", () => {
  const { files } = build();
  const catalog = files.get(path.join(root, "src", "site-plugins", "catalog.js"));
  assert.doesNotThrow(() => execFileSync(process.execPath, ["--input-type=module", "--check"], {
    input: catalog, stdio: ["pipe", "pipe", "pipe"]
  }));
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
// 插件源默认并排签出在 ../plugins；CI 把插件仓签出到仓库内的 plugins/ 时用 PLUGIN_DIR 指过来。
  const dir = path.resolve(process.env.PLUGIN_DIR || path.join(root, "..", "plugins"));
  // 只扫带 manifest.json 的目录，plugins/assets 这类放 README 图标的目录不算插件。
  const isPluginDir = name => !name.startsWith(".") && fs.statSync(path.join(dir, name)).isDirectory() && fs.existsSync(path.join(dir, name, "manifest.json"));
  for (const id of fs.readdirSync(dir).filter(isPluginDir)) {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, id, "manifest.json"), "utf8"));
    assert.equal(manifest.id, id);
    assert.ok(manifest.name && manifest.host);
  }
});

test("每个插件都带站点图标，site-logos 映射与插件目录一致", () => {
  const { plugins } = build();
  for (const plugin of plugins) {
    assert.ok(plugin.icon, `plugins/${plugin.id} 缺少 icon.svg 或 icon.png`);
    const rel = `icons/sites/${plugin.id}.${plugin.icon.ext}`;
    const file = path.join(root, "icons", "sites", `${plugin.id}.${plugin.icon.ext}`);
    assert.ok(fs.existsSync(file), `${rel} 没有生成`);
    assert.ok(fs.statSync(file).size > 0, `${rel} 是空文件`);
    assert.equal(siteLogoFor(plugin.id), rel);
  }
  assert.deepEqual(Object.keys(SITE_LOGOS).sort(), plugins.map(plugin => plugin.id).sort());
  assert.equal(siteLogoFor("no-such-plugin"), "");
});

// priceMap 里写错 base 名，采集时才炸，而且只炸一个站点，很容易当成站点改版。
// 这里在构建期就解析一遍：声明指向的 base 必须存在，解析出来的映射必须有规则。
test("每个插件声明的 priceMap 都能解析", async () => {
  for (const entry of SITE_PLUGIN_CATALOG) {
    const { sitePlugin } = entry.load();
    const prepared = typeof sitePlugin.prepare === "function"
      ? sitePlugin.prepare({ adapter: {} }, { url: new URL(`https://${sitePlugin.host}/pricing`) })
      : null;
    const spec = prepared?.adapter?.priceMap || sitePlugin.preset?.adapter?.priceMap;
    if (!spec) continue;
    const resolved = resolvePriceMap(spec);
    assert.equal(resolved.error, undefined, `${entry.id} 的 priceMap 解不出来：${resolved.error}`);
    assert.ok(Array.isArray(resolved.map.rules) && resolved.map.rules.length > 0, `${entry.id} 的映射没有规则`);
  }
});
