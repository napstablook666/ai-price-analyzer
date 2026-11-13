# Site Plugin and UI Contract

## 1. Scope / Trigger

Use this contract when adding or changing relay-station adapters, the plugin catalog, batch station creation, or the three extension page templates. Provider modules are local ES modules loaded through static imports. MV3 module Service Workers disallow dynamic `import()`; do not reintroduce it in `extension/src`.

## 2. Signatures

- `loadSitePlugin(id): Promise<Provider>` resolves a statically imported module and registers its provider. The async public shape remains for caller compatibility.
- `loadSitePlugins(ids): Promise<Provider[]>` deduplicates IDs before loading.
- `syncSitePlugins(stations): Promise<Provider[]>` registers only modules referenced by saved stations.
- `pruneSitePlugins(stations): void` removes inactive providers from the runtime registry.
- `ADD_SITE_PLUGINS` accepts `{ ids: string[] }` and returns `{ stations, added, alreadyAdded, sitePlugins }`.
- A provider module exports `sitePlugin` with `id`, `matches`, `preset`, and the existing prepare/request strategy fields.

## 3. Contracts

- `SITE_PLUGIN_CATALOG` statically imports every local provider and maps each ID to a synchronous module accessor. UI metadata excludes `load`, `preset`, `prepare`, and `request`; `sitePluginCatalogForStations()` derives `added` and `stationCount` from saved stations rather than maintaining an installation database.
- Static modules are parsed when the Service Worker starts. “On demand” means runtime registration and activation only, not deferred network loading or Service Worker code splitting.
- Saved stations retain `pluginId`. Stations without it use host/path matching; a unique host match is a valid fallback for legacy origin-only URLs.
- An empty workspace starts with an empty `PROVIDER_REGISTRY`. `GET_DASHBOARD` registers saved-station providers only. `ADD_SITE_PLUGINS` registers selected providers, appends their presets in one locked transaction, and then prunes the registry to active stations.
- Static ES module identity and registry membership are separate. A statically imported `sitePlugin` must be registered again after pruning.
- UI changes must preserve static `$("#id")` targets, dynamic class hooks, `data-*` attributes, collapsible first-child structure, and DOM-specific operations such as `emptyState.querySelector("a span:last-child")`.

## 4. Validation & Error Matrix

- Unknown plugin ID -> reject `未知站点插件：${id}`; never evaluate a dynamic path.
- Module ID different from catalog ID -> throw `站点插件身份不匹配：${id}` before registration.
- All requested IDs unknown or not addable -> reject `请至少选择一个可添加的站点插件`.
- Duplicate IDs in one request -> register/add once.
- Already-added host -> leave the station array unchanged and report it in `alreadyAdded`.
- Unknown host in Agent/custom flow -> continue through the existing generic adapter, not the plugin whitelist.

## 5. Good/Base/Bad Cases

- Good: select Linux.do Marketplace and WindHub, submit once, receive two new stations and exactly two active provider registrations.
- Base: an empty dashboard registers no providers; a saved CentOS station registers only CentOS, even though all static modules are present in the Service Worker bundle.
- Bad: using dynamic `import()` in the catalog fails at Service Worker runtime before any plugin can be registered.

## 6. Tests Required

- `extension/test/site-plugins.test.js`: static whitelist imports, zero dynamic imports across `extension/src`, empty registry, selective/deduplicated registration, host fallback, prune/re-register, multi-preset idempotence, static DOM IDs, duplicate IDs, and local page assets.
- `extension/test/refresh-preflight.test.js`: `ADD_SITE_PLUGINS` integration, including empty-start lazy registration, duplicate batch requests, persistence, and invalid-only input.
- Run `npm --prefix extension test`, `node --check` for affected JavaScript, and `git diff --check`.
- Browser verification must cover 1440×900, 1280×720, 360px layouts, local rather than body scrolling, keyboard tab navigation, dialog focus, and a real multi-select add flow. Remove third-party theme-extension mutations from test pages before treating screenshots as evidence of the extension's own colors.

## 7. Wrong vs Correct

### Wrong

```js
entry("centos", "ai.centos.hk", "ai.centos.hk", "direct", () => import("./providers/centos.js"));
```

Dynamic module import is disallowed on `ServiceWorkerGlobalScope`.

### Correct

```js
import { sitePlugin as centosPlugin } from "./providers/centos.js";
entry("centos", "ai.centos.hk", "ai.centos.hk", "direct", () => ({ sitePlugin: centosPlugin }));
```

Keep registration in `loadSitePlugin()` so the static module is activated only when required. For UI-only refactors, replacing the whole HTML template without comparing runtime selectors is also wrong. Restore the functional DOM contract first, then apply layout and visual changes.
