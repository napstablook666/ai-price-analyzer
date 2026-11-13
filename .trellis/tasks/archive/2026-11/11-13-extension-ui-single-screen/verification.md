# Verification

## Automated checks

- `npm --prefix extension test`: 239 tests, 239 passed, 0 failed. Log: `out/ui-browser/final-tests.log`.
- `node --check` for every `extension/src/**/*.js`: passed. Log: `out/ui-browser/syntax.log`.
- `git diff --check`: passed. Log: `out/ui-browser/diff-check.log`.
- Token contrast: `#18181b` on `#f5f6f8` = 16.38:1; `#52525b` on `#f5f6f8` = 7.15:1; `#686871` on `#f5f6f8` = 5.10:1; `#686871` on `#ffffff` = 5.52:1.

## Browser verification

Used a local read-only static server for `extension/` and a mock `chrome.runtime.sendMessage` implementation. No real relay site, credential, saved extension workspace, or remote provider module was used.

Full result: `out/ui-browser/browser-report.json`.

- Options at 1440×900 and 1280×720: `bodyOverflow=false`, `horizontalOverflow=false`, `errors=[]`.
- Dashboard at 1440×900 and 1280×720: `bodyOverflow=false`, `horizontalOverflow=false`, `errors=[]`; the table scrolls locally.
- Options and dashboard at 360×800: `bodyOverflow=false`, `horizontalOverflow=false`, `errors=[]`; long regions scroll locally.
- Popup at 360×600: body is 360×387, `bodyOverflow=false`, `horizontalOverflow=false`, `errors=[]`.
- Plugin search returned one TokenFlux card; the public category returned two cards. Selecting both and clicking add once submitted `ADD_SITE_PLUGINS` with `["linux-do-marketplace", "windhub"]`. The station count changed from 1 to 3, both cards became added, and the pre-existing station's unsaved name edit remained intact.
- Repeated the multi-select flow in separate clean page loads. The service-worker integration test also verifies duplicate batch submissions create no additional station.
- Keyboard ArrowRight switched to `#providers`; the LLM controls became visible. The Agent dialog focused `#new-station-url` on open and returned focus to `#add-station` on close.
- Dashboard search reduced three rows to one; reset restored three rows. Page size 20/50/100/200/500 remains available.

Screenshots: `out/ui-browser/options-final-*.png`, `dashboard-final-*.png`, and `popup-final.png`.

The browser profile's Dark Reader extension mutated the pages after load. Verification removed only those injected DOM styles and kept a test-page MutationObserver to prevent reinsertion. No anti-Dark-Reader rule or dark theme was added to the extension source. Final screenshots have the actual token background `rgb(245, 246, 248)`.

## Regression lessons

- The first template rewrite dropped runtime DOM IDs. Restored the original dashboard/options controls before applying visual changes; `site-plugins.test.js` now checks static selectors, duplicate IDs, and local assets.
- Cached dynamic imports previously prevented a pruned provider from being re-registered. `loadSitePlugin()` now registers the cached `sitePlugin` again; the regression is covered by unit and refresh-preflight tests.
- Follow-up: the dynamic-import loader described above was incompatible with MV3 `ServiceWorkerGlobalScope`. It was replaced by static module imports plus on-demand runtime registration in task `11-13-service-worker-static-plugins`; the current contract is `.trellis/spec/frontend/site-plugins.md`.
