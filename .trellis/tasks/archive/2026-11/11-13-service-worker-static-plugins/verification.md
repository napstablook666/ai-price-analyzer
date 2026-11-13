# Verification

## Fix

- `extension/src/site-plugins/catalog.js` now statically imports all 22 provider modules and maps catalog IDs to synchronous module accessors.
- `extension/src/site-plugins/loader.js` no longer evaluates dynamic imports or keeps a Promise module cache. Its public async functions remain compatible, and registration still happens only when a saved or selected plugin requires it.
- Static modules are parsed with the Service Worker; deferred work is provider registration, not network loading.

## Evidence

- `rg -n 'import\s*\(' extension/src`: zero matches. Log: `out/ui-browser/static-plugin-imports.log`.
- `npm --prefix extension test`: 240 tests, 240 passed, 0 failed. Log: `out/ui-browser/static-plugin-tests.log`.
- `node --check` for every `extension/src/**/*.js`: passed. Log: `out/ui-browser/static-plugin-syntax.log`.
- `git diff --check`: passed. Log: `out/ui-browser/static-plugin-diff.log`.

## Regression coverage

- `extension/test/site-plugins.test.js` recursively rejects dynamic imports throughout `extension/src` and checks that every catalog entry has an existing static provider import.
- Empty-start behavior still means an empty `PROVIDER_REGISTRY`, not an empty static module bundle.
- Selective registration, duplicate loading, prune/re-register, multi-preset idempotence, `ADD_SITE_PLUGINS`, and all refresh-preflight tests pass.

## Compatibility note

This fixes the reported `ServiceWorkerGlobalScope` violation without adding an offscreen document or changing the collection runtime. The previous dynamic-import implementation was not valid MV3 Service Worker code and must not be restored.
