import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installedPluginSpecs, normalizeLocalPlugins, normalizePluginSpec, normalizeRegistryPayload, providerFromSpec } from "../src/core/declarative-plugin.js";
import { sitePluginCatalogForStations } from "../src/site-plugins/catalog.js";
import { PLUGIN_REGISTRY_SNAPSHOT } from "../src/site-plugins/registry-snapshot.js";

const SPEC = {
  id: "demo-plugin",
  version: "1.2.0",
  name: "Demo Plugin",
  description: "演示用声明式插件",
  hosts: ["demo.example"],
  mode: "direct",
  category: "paid",
  request: { endpoint: "/api/pricing" },
  responseFormat: "auto",
  preset: { baseUrl: "https://demo.example/pricing" }
};

test("声明式插件规格只接受站内相对端点", () => {
  const spec = normalizePluginSpec(SPEC);
  assert.equal(spec.id, "demo-plugin");
  assert.deepEqual(spec.hosts, ["demo.example"]);
  assert.equal(spec.request.endpoint, "/api/pricing");
  assert.throws(() => normalizePluginSpec({ ...SPEC, id: "Demo Plugin" }), /插件 id/);
  assert.throws(() => normalizePluginSpec({ ...SPEC, version: "v1" }), /版本号/);
  assert.throws(() => normalizePluginSpec({ ...SPEC, request: { endpoint: "https://evil.example/x" } }), /相对路径/);
  assert.throws(() => normalizePluginSpec({ ...SPEC, hosts: ["not a host"] }), /域名/);
  assert.throws(() => normalizePluginSpec({ ...SPEC, responseFormat: "nope" }), /responseFormat/);
  assert.throws(() => normalizePluginSpec({ ...SPEC, hosts: [] }), /域名/);
});

test("仓库索引区分声明式插件与需要内置代码的插件", () => {
  const declarative = normalizeRegistryPayload({ schemaVersion: 1, plugins: [SPEC] });
  assert.equal(declarative.entries.length, 1);
  assert.equal(declarative.entries[0].needsCode, false);
  assert.equal(declarative.entries[0].spec.id, "demo-plugin");

  const payload = normalizeRegistryPayload([
    { id: "code-only", name: "Code Only", version: "2.0.0", hosts: ["code.example"], needsCode: true },
    { id: "bad id", version: "1.0.0", needsCode: true }
  ]);
  assert.equal(payload.entries.length, 1);
  assert.equal(payload.entries[0].needsCode, true);
  assert.equal(payload.rejected.length, 1);
  assert.match(payload.rejected[0].error, /插件 id/);
});

test("仓库插件需显式安装，本地插件只在开发模式下生效", () => {
  const registry = {
    entries: [{ id: "demo-plugin", name: "Demo", version: "1.2.0", needsCode: false, spec: normalizePluginSpec(SPEC) }],
    installed: { "demo-plugin": { version: "1.2.0" } }
  };
  const withRegistry = installedPluginSpecs({ devMode: false, localPlugins: [], pluginRegistry: registry });
  assert.deepEqual(withRegistry.map(spec => [spec.id, spec.source]), [["demo-plugin", "registry"]]);

  const withLocal = installedPluginSpecs({ devMode: true, localPlugins: [SPEC], pluginRegistry: registry });
  assert.deepEqual(withLocal.map(spec => [spec.id, spec.source]), [["demo-plugin", "local"]]);

  const devModeOff = installedPluginSpecs({ devMode: false, localPlugins: [SPEC], pluginRegistry: registry });
  assert.deepEqual(devModeOff.map(spec => spec.source), ["registry"]);

  const uninstalled = installedPluginSpecs({ devMode: false, localPlugins: [], pluginRegistry: { ...registry, installed: {} } });
  assert.deepEqual(uninstalled, []);
});

test("本地插件同样走规格校验，坏数据被拒绝", () => {
  const result = normalizeLocalPlugins([SPEC, { id: "no-host", version: "1.0.0", hosts: [], request: { endpoint: "/x" } }]);
  assert.equal(result.specs.length, 1);
  assert.equal(result.rejected.length, 1);
});

test("声明式插件 provider 保留来源，并按域名匹配", () => {
  const provider = providerFromSpec({ ...normalizePluginSpec(SPEC), source: "local" });
  assert.equal(provider.source, "local");
  assert.equal(provider.kind, "declarative");
  assert.equal(provider.matches({ hostname: "demo.example", path: "/pricing" }), true);
  assert.equal(provider.matches({ hostname: "other.example", path: "/pricing" }), false);
  assert.equal(provider.prepare({ mode: "page" }, { url: new URL("https://demo.example/x") }).mode, "direct");
});

test("内置插件带来源与版本，未拉取仓库时也能列出", () => {
  const catalog = sitePluginCatalogForStations([], { bundledVersion: "9.9.9" });
  assert.ok(catalog.length >= 20);
  for (const entry of catalog) {
    assert.equal(entry.source, "bundled");
    assert.equal(entry.version, "9.9.9");
  }
  assert.ok(PLUGIN_REGISTRY_SNAPSHOT.plugins.length >= 20);
  for (const entry of PLUGIN_REGISTRY_SNAPSHOT.plugins) {
    if (entry.kind === "checkin") {
      assert.equal(entry.needsCode, false);
      assert.ok(entry.checkin && entry.checkin.statusPath);
      continue;
    }
    assert.equal(entry.needsCode, true);
    assert.ok(entry.hosts.length);
    assert.match(entry.version, /^\d+\.\d+\.\d+$/);
  }
});

test("插件仓库发布的 plugins.json 与内置快照一致", () => {
  // 与 scripts/plugin-build.mjs 用同一套源目录解析：默认 ../plugins，CI 用 PLUGIN_DIR 指到仓库内的 plugins/。
  const here = path.dirname(fileURLToPath(import.meta.url));
  const registryFile = path.resolve(process.env.PLUGIN_DIR || path.join(here, "..", "..", "plugins"), "plugins.json");
  if (!existsSync(registryFile)) return;
  const published = JSON.parse(readFileSync(registryFile, "utf8"));
  assert.equal(published.schemaVersion, PLUGIN_REGISTRY_SNAPSHOT.schemaVersion);
  assert.deepEqual(published.plugins, PLUGIN_REGISTRY_SNAPSHOT.plugins);
});