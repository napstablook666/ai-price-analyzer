import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installedPluginSpecs, normalizeLocalPlugins, normalizePluginSpec, normalizeRegistryPayload, normalizeRegistryState, pluginUpdateState, providerFromSpec, registryStateAfterRefresh } from "../src/core/declarative-plugin.js";
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
    assert.equal(entry.needsCode, true);
    assert.ok(entry.hosts.length);
    assert.match(entry.version, /^\d+\.\d+\.\d+$/);
  }
});
test("刷新仓库保留全部安装记录，needsCode 插件不会变回未安装", () => {
  const { entries } = normalizeRegistryPayload([
    { id: "code-only", name: "Code Only", version: "2.0.0", hosts: ["code.example"], needsCode: true },
    SPEC
  ]);
  const current = {
    url: "https://plugins.example/plugins.json",
    entries: [],
    installed: {
      "code-only": { version: "1.0.0", installedAt: 111 },
      "demo-plugin": { version: "1.2.0", installedAt: 222 },
      "gone-from-index": { version: "0.9.0", installedAt: 333 }
    }
  };
  const next = registryStateAfterRefresh(current, { url: current.url, entries, fetchedAt: 444 });
  // needsCode 插件的记录必须留下，且保留已装版本，仓库的新版本只用于提示有更新。
  assert.deepEqual(next.installed["code-only"], { version: "1.0.0", installedAt: 111 });
  assert.deepEqual(next.installed["demo-plugin"], { version: "1.2.0", installedAt: 222 });
  // 仓库暂时少了条目也不卸载，与 normalizeRegistryState 的保留语义一致。
  assert.deepEqual(next.installed["gone-from-index"], { version: "0.9.0", installedAt: 333 });
  assert.equal(next.entries.length, 2);
  assert.equal(next.fetchedAt, 444);
  assert.equal(next.error, "");
});

test("内置采集代码的插件不按扩展版本号报更新", () => {
  // 仓库里的 plugins.json 版本号由 plugin-build 从扩展 manifest 取，扩展每发一版就会整体跳号。
  // 采集代码随扩展打包的插件装不装都是同一份代码，不能因此显示「有更新」。
  const record = { version: "0.4.0", installedAt: 1 };
  const entry = { version: "0.5.0" };
  assert.deepEqual(
    pluginUpdateState({ record, entry, codeBundled: true, bundledVersion: "0.5.0" }),
    { installed: true, installedVersion: "0.5.0", updateAvailable: false }
  );
  // 声明式插件（代码从仓库装）没有内置代码，仍然按版本号判断。
  assert.equal(pluginUpdateState({ record, entry }).updateAvailable, true);
  assert.equal(pluginUpdateState({ record: { version: "0.5.0" }, entry }).updateAvailable, false);
  assert.deepEqual(pluginUpdateState({}), { installed: false, installedVersion: "", updateAvailable: false });
});

test("已安装列表里的内置插件可以勾选移除，不按 bundled 来源禁用", () => {
  // 内置代码插件也是按仓库安装管理的，标成 removable: false 会让勾选框和全选一起失效。
  const source = readFileSync(new URL("../src/options.js", import.meta.url), "utf8");
  assert.ok(!source.includes('removable: plugin.source !== "bundled"'), "catalog 插件不能再按 bundled 来源禁止移除");
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

test("老 registry 里的 checkin 条目在归一化时被丢掉，不报错", () => {
  const state = normalizeRegistryState({
    url: "https://example.com/plugins.json",
    entries: [
      { id: "site-checkin", name: "站点签到插件", version: "1.1.0", hosts: ["vyceai.com"], kind: "checkin", needsCode: false, checkin: { statusPath: "/user/daily-reward" } },
      { id: "demo-plugin", name: "Demo", version: "1.0.0", hosts: ["demo.example"], needsCode: false, spec: { ...SPEC } }
    ],
    installed: { "site-checkin": { version: "1.1.0", installedAt: 1730000000000 } }
  });
  assert.deepEqual(state.entries.map(entry => entry.id), ["demo-plugin"]);
  // 安装记录独立于条目清单存在，仓库里没了这一条也不该把它抹掉。
  assert.ok(state.installed["site-checkin"]);
});