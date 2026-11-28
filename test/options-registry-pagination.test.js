import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import assert from "node:assert/strict";
import { paginateRows } from "../src/dashboard-index.js";
import { escapeHtml, icon } from "../src/shared/ui.js";

const source = readFileSync(new URL("../src/options.js", import.meta.url), "utf8");

function registryHarness(count = 45) {
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      value: "", textContent: "", innerHTML: "", disabled: false, checked: false,
      indeterminate: false, hidden: false, dataset: {}, listeners: new Map(),
      addEventListener(type, handler) {
        if (!this.listeners.has(type)) this.listeners.set(type, []);
        this.listeners.get(type).push(handler);
      },
      setAttribute(name, value) { this[name] = value; },
      querySelector() { return this.label ||= { textContent: "" }; }
    });
    return nodes.get(selector);
  };
  const filters = ["all", "available", "installed", "update"].map(filter => {
    const button = node(`[data-registry-filter="${filter}"]`);
    button.dataset.registryFilter = filter;
    return button;
  });
  const entries = Array.from({ length: count }, (_, index) => ({
    id: `plugin-${index}`, name: `Plugin ${index}`, version: "1.0.0",
    hosts: [`plugin-${index}.example`], installed: false
  }));
  const state = {
    pluginWorkspace: { registry: { entries, fetchedAt: 0 } },
    registryPage: 0, registryPageSize: 20, registryFilter: "all",
    registrySelected: new Set(), registryAnchorId: "", expandedRegistryId: ""
  };
  const context = {
    state, $: node, document: { querySelectorAll: () => filters },
    paginateRows, escapeHtml, icon, hydrateIcons() {}, formatPluginTime: () => "",
    renderPluginInstalled() {}, pluginDetailBlocks: () => "<p>详情</p>"
  };
  const blocks = [
    source.slice(source.indexOf("function pluginInitial("), source.indexOf("function pluginDetailGrid(")),
    source.slice(source.indexOf("function registryEntryBadges("), source.indexOf("function updateInstalledSelection(")),
    source.slice(source.indexOf("function updateRegistrySelection("), source.indexOf("function renderLocalPlugins(")),
    source.slice(source.indexOf('$("#plugin-registry-list").addEventListener'), source.indexOf("// 同上：click 才带 shiftKey。"))
  ];
  runInNewContext(blocks.join("\n"), context);
  const fire = (selector, type, properties = {}) => {
    const target = node(selector);
    const event = { currentTarget: target, target, ...properties };
    for (const listener of target.listeners.get(type) || []) listener(event);
  };
  const rows = () => [...node("#plugin-registry-list").innerHTML.matchAll(/data-registry-row="([^"]+)"/g)].map(match => match[1]);
  return { state, entries, node, fire, rows, render: context.renderPluginRegistry };
}

test("repository renders only the current page, clamps boundaries, and hides an empty pager", () => {
  const h = registryHarness(1003);
  h.render();
  assert.equal(h.rows().length, 20);
  assert.equal(h.rows()[0], "plugin-0");
  assert.equal(h.node("#registry-previous").disabled, true);
  assert.equal(h.node("#registry-page").textContent, "第 1 / 51 页 · 共 1003 个");
  h.fire("#registry-next", "click");
  assert.equal(h.rows()[0], "plugin-20");
  assert.equal(h.rows().length, 20);
  h.state.registryPage = 999;
  h.render();
  assert.deepEqual(h.rows(), ["plugin-1000", "plugin-1001", "plugin-1002"]);
  assert.equal(h.node("#registry-next").disabled, true);
  h.fire("#registry-previous", "click");
  assert.equal(h.rows()[0], "plugin-980");
  h.entries.splice(21);
  h.render();
  assert.deepEqual(h.rows(), ["plugin-20"]);
  assert.equal(h.state.registryPage, 1);
  h.entries.length = 0;
  h.render();
  assert.equal(h.state.registryPage, 0);
  assert.equal(h.node("#registry-pagination").hidden, true);
  assert.equal(h.node("#registry-page").textContent, "");
  assert.match(h.node("#plugin-registry-list").innerHTML, /仓库里还没有条目/);
});

test("search and filter paginate their full results and reset the page and shift anchor", () => {
  const h = registryHarness();
  for (const entry of h.entries.slice(20)) entry.installed = true;
  h.state.registryPage = 2;
  h.state.registryAnchorId = "plugin-40";
  h.state.expandedRegistryId = "plugin-40";
  h.node("#plugin-registry-search").value = "plugin-1";
  h.fire("#plugin-registry-search", "input");
  assert.equal(h.state.registryPage, 0);
  assert.equal(h.state.registryAnchorId, "");
  assert.equal(h.state.expandedRegistryId, "");
  assert.equal(h.rows().length, 11);
  assert.ok(h.rows().includes("plugin-19"));
  h.node("#plugin-registry-search").value = "";
  h.fire('[data-registry-filter="installed"]', "click");
  assert.equal(h.rows()[0], "plugin-20");
  assert.equal(h.node("#registry-page").textContent, "第 1 / 2 页 · 共 25 个");
  h.fire("#registry-next", "click");
  assert.equal(h.rows().length, 5);
  h.fire('[data-registry-filter="available"]', "click");
  assert.equal(h.rows()[0], "plugin-0");
  assert.equal(h.state.registryPage, 0);
  h.fire('[data-registry-filter="update"]', "click");
  assert.equal(h.node("#registry-pagination").hidden, true);
  assert.match(h.node("#plugin-registry-list").innerHTML, /没有匹配的插件/);
});

test("page size changes reset to the first page without losing selections", () => {
  const h = registryHarness(103);
  h.state.registryPage = 4;
  h.state.registrySelected.add("plugin-90");
  h.node("#registry-page-size").value = "50";
  h.fire("#registry-page-size", "change");
  assert.equal(h.state.registryPage, 0);
  assert.equal(h.rows().length, 50);
  assert.equal(h.node("#registry-page").textContent, "第 1 / 3 页 · 共 103 个");
  assert.equal(h.state.registrySelected.has("plugin-90"), true);
  h.node("#registry-page-size").value = "100";
  h.fire("#registry-page-size", "change");
  assert.equal(h.rows().length, 100);
  assert.equal(h.node("#registry-page").textContent, "第 1 / 2 页 · 共 103 个");
});

test("select-all affects only selectable rows on this page, preserving other pages", () => {
  const h = registryHarness();
  h.entries[0].installed = true;
  h.entries[1].needsCode = true;
  h.render();
  h.node("#registry-select-all").checked = true;
  h.fire("#registry-select-all", "change");
  assert.equal(h.state.registrySelected.size, 18);
  assert.equal(h.state.registrySelected.has("plugin-0"), false);
  assert.equal(h.state.registrySelected.has("plugin-1"), false);
  assert.equal(h.node("#registry-select-all").checked, true);
  h.fire("#registry-next", "click");
  assert.equal(h.node("#registry-select-all").checked, false);
  assert.equal(h.node("#registry-select-all").indeterminate, false);
  h.node("#registry-select-all").checked = true;
  h.fire("#registry-select-all", "change");
  assert.equal(h.state.registrySelected.size, 38);
  assert.equal(h.node("#registry-selected-count").textContent, "已选 38 项");
  h.node("#registry-select-all").checked = false;
  h.fire("#registry-select-all", "change");
  assert.equal(h.state.registrySelected.size, 18);
  h.fire("#registry-previous", "click");
  assert.match(h.node("#plugin-registry-list").innerHTML, /data-registry-check="plugin-2" checked/);
  assert.equal(h.node("#registry-select-all").checked, true);
  h.entries[2].installed = true;
  h.render();
  assert.equal(h.state.registrySelected.has("plugin-2"), false);
  assert.doesNotMatch(h.node("#plugin-registry-list").innerHTML, /data-registry-check="plugin-2" checked/);
  assert.equal(h.node("#registry-selected-count").textContent, "已选 17 项");
});

test("shift selection remains within the current page and updates its mixed state", () => {
  const h = registryHarness();
  const clickRow = (id, shiftKey = false) => {
    const check = { dataset: { registryCheck: id }, checked: true };
    h.fire("#plugin-registry-list", "click", {
      shiftKey, target: { closest: selector => selector === "[data-registry-check]" ? check : null }
    });
  };
  h.render();
  clickRow("plugin-2");
  clickRow("plugin-5", true);
  assert.deepEqual([...h.state.registrySelected], ["plugin-2", "plugin-3", "plugin-4", "plugin-5"]);
  assert.equal(h.node("#registry-select-all").indeterminate, true);
  h.fire("#registry-next", "click");
  clickRow("plugin-22", true);
  assert.equal(h.state.registrySelected.size, 5);
  assert.equal(h.state.registrySelected.has("plugin-20"), false);
  assert.equal(h.state.registrySelected.has("plugin-22"), true);
});
