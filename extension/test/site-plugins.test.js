import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { PROVIDER_REGISTRY, providerById } from "../src/core/provider-registry.js";
import { addProviderStationPresets } from "../src/core/station-presets.js";
import { SITE_PLUGIN_CATALOG, sitePluginCatalogForStations, sitePluginForStation } from "../src/site-plugins/catalog.js";
import { loadSitePlugin, loadSitePlugins, loadedSitePluginIds, pruneSitePlugins, resetSitePluginLoader, syncSitePlugins } from "../src/site-plugins/loader.js";

async function withCleanRegistry(callback) {
  resetSitePluginLoader();
  try { await callback(); }
  finally { resetSitePluginLoader(); }
}

test("plugin catalog exposes metadata without registering providers", async () => {
  await withCleanRegistry(async () => {
    assert.ok(SITE_PLUGIN_CATALOG.length >= 20);
    assert.equal(PROVIDER_REGISTRY.length, 0);
    const serialized = JSON.stringify(sitePluginCatalogForStations([]));
    assert.doesNotMatch(serialized, /"load"|"preset"|"prepare"|"request"/);
    const catalogSource = readFileSync(new URL("../src/site-plugins/catalog.js", import.meta.url), "utf8");
    const imports = [...catalogSource.matchAll(/import \{ sitePlugin as \w+ \} from "(\.\/providers\/[^"]+\.js)"/g)];
    assert.equal(imports.length, SITE_PLUGIN_CATALOG.length);
    for (const match of imports) {
      assert.ok(existsSync(new URL(`../src/site-plugins/${match[1].slice(2)}`, import.meta.url)), match[1]);
    }
  });
});

test("contains no dynamic imports in the extension service-worker source tree", () => {
  const visit = directory => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) visit(target);
      else if (entry.name.endsWith(".js")) {
        const source = readFileSync(target, "utf8");
        assert.doesNotMatch(source, /\bimport\s*\(/, `dynamic import found in ${target.pathname}`);
      }
    }
  };
  visit(new URL("../src/", import.meta.url));
});

test("loads only selected local plugins and deduplicates module requests", async () => {
  await withCleanRegistry(async () => {
    const [centos, repeated] = await Promise.all([loadSitePlugin("centos"), loadSitePlugin("centos")]);
    assert.equal(centos, repeated);
    assert.deepEqual(loadedSitePluginIds(), ["centos"]);
    await assert.rejects(loadSitePlugin("not-a-plugin"), /未知站点插件/);
    assert.deepEqual(loadedSitePluginIds(), ["centos"]);
  });
});

test("restores saved stations by plugin id or unique host and re-registers pruned modules", async () => {
  await withCleanRegistry(async () => {
    const stations = [
      { id: "a", pluginId: "centos", baseUrl: "https://ai.centos.hk/pricing" },
      { id: "b", baseUrl: "https://all-in-one.icu" },
      { id: "c", pluginId: "centos", baseUrl: "https://ai.centos.hk/pricing" }
    ];
    assert.equal(sitePluginForStation(stations[1])?.id, "all-in-one");
    const providers = await syncSitePlugins(stations);
    assert.deepEqual(providers.map(provider => provider.id).sort(), ["all-in-one", "centos"]);
    pruneSitePlugins([stations[0]]);
    assert.deepEqual(loadedSitePluginIds(), ["centos"]);
    await loadSitePlugins(["all-in-one", "centos"]);
    assert.deepEqual(loadedSitePluginIds().sort(), ["all-in-one", "centos"]);
  });
});

test("adds multiple selected presets once and derives added state from stations", async () => {
  await withCleanRegistry(async () => {
    const providers = await loadSitePlugins(["centos", "linux-do-marketplace"]);
    const stations = addProviderStationPresets([], providers, { exchangeRate: 7.2 });
    assert.equal(stations.length, 2);
    assert.deepEqual(stations.map(station => station.pluginId).sort(), ["centos", "linux-do-marketplace"]);
    assert.equal(stations.find(station => station.pluginId === "linux-do-marketplace").category, "public");
    assert.equal(addProviderStationPresets(stations, providers), stations);
    const added = sitePluginCatalogForStations(stations).filter(plugin => plugin.added).map(plugin => plugin.id);
    assert.deepEqual(added.sort(), ["centos", "linux-do-marketplace"]);
    assert.equal(providerById("centos").id, "centos");
  });
});

test("keeps every static script selector and local page asset connected", () => {
  for (const page of ["dashboard", "options", "popup"]) {
    const html = readFileSync(new URL(`../${page}.html`, import.meta.url), "utf8");
    const source = readFileSync(new URL(`../src/${page}.js`, import.meta.url), "utf8");
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(new Set(ids).size, ids.length, `${page} contains duplicate ids`);
    const available = new Set(ids);
    for (const match of source.matchAll(/\$\("#([A-Za-z0-9_-]+)"\)/g)) {
      assert.ok(available.has(match[1]), `${page}.js queries missing #${match[1]}`);
    }
    for (const match of html.matchAll(/(?:src|href)="((?:src|styles|icons)\/[^"]+)"/g)) {
      assert.ok(existsSync(new URL(`../${match[1]}`, import.meta.url)), `${page} references missing ${match[1]}`);
    }
  }
});
