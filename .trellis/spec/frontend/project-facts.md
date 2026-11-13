# Frontend Project Facts

This document records project-specific facts for the browser extension. Rules below are scoped to the extension unless stated otherwise. Dated measurements and online observations are context, not permanent thresholds; use current code and fresh test output when validating a change. Original source paths and the source-to-destination inventory are retained in this task's migration map.

## Development and validation

- The browser extension in `extension/` is the active product. Pause JavaScript userscript work unless the user explicitly resumes it or an extension feature depends on it. UI requests, including screenshot feedback and visual adjustments, target the extension by default.
- The root `AI中转站价格分析工具.js` is a deprecated userscript. Do not implement extension requests there; changes to it were twice rejected and reverted on 2026-10-07.
- Run the extension tests with `npm --prefix extension test` or `cd extension && npm test`. The source attention file recorded 122 tests at migration time; that historical count is not a current acceptance threshold.
- Price collection is manual. The four-hour automatic alarm is only for the separately enabled check-in feature.

Evidence: `extension/package.json`.

## Pricing snapshots and comparison

- Compare using each station's latest available snapshot. Retain snapshots for 30 days.
- Comparison results are cached in Service Worker memory. Invalidate the cache when stations, snapshots, settings, or reference data are written. Advance the station-write version both when a station write starts and when it ends, so concurrent reads cannot use a partially written configuration.
- The detailed pricing units, currency trust, recharge-rate, OpenRouter, refresh-preflight, and normalization-version contracts are maintained in [Pricing Data Contract](./pricing-data-contract.md).

Evidence: `extension/src/service-worker.js`, `extension/src/core/snapshot-policy.js`, and `extension/src/core/pricing.js`.

## Monthly cost estimation

- Cost estimates use a monthly basis. `DEFAULT_MONTHLY_USAGE` is defined in `extension/src/shared/schema.js`; dashboard row values and sort keys are `monthlyCost` and `officialMonthlyCost`, and the settings UI labels this as estimated monthly usage.
- The recorded baseline was derived from s2api daily trends for 2026-09-06 through 2026-10-07 (32 days), scaled to 30 days. The 30-day figures were 45,494 requests, 382.95M input tokens, 2,946.28M cached-read tokens, and 30.74M output tokens. The source interval totals were 48,527 requests, 408.48M input tokens, 3,142.7M cached-read tokens, and 32.79M output tokens. These are dated measurements, not an assertion that the current workload or defaults should remain unchanged.
- Usage presets (`USAGE_PRESETS`) only overwrite and compare fields that the selected preset defines. `measured` and `baseline` do not define `peakShare`; applying either must preserve the user's peak share. The old `legacy` preset ID was replaced by `measured`. `usagePresetId()` in `extension/src/shared/schema.js` matches only fields defined by each preset.
- When `normalizeSettings()` reads legacy saved settings, it migrates the old daily usage, old base preset, and prior measured monthly preset to the then-current measured monthly preset while preserving `peakShare`. Other custom usage values remain unchanged.

Evidence: `extension/src/shared/schema.js`.

## Check-in and page-session requests

- Check-in presets are defined in `extension/src/core/checkin.js` (`CHECKIN_PRESETS`; the first preset is `vyceai.com`). A request that needs the site's logged-in session must run through the page bridge in a logged-in site tab. Perform the status GET, submit the POST in that same page context, then perform an authoritative GET in that context. Report success only when the post-submit response has `canClaim === false`.
- If a required logged-in page cannot be found, fail explicitly. Do not fall back to a Service Worker request, even with `credentials: "include"`; it is not the site's page session. This rule covers authenticated check-in and other side-effecting requests that depend on page cookies, including HttpOnly cookies. It does not apply to public, unauthenticated read-only APIs.
- A new check-in target is normally added as a `CHECKIN_PRESETS` entry with its host match, status/claim paths, and token-cookie name; check-in presets follow their own display flow and do not need a saved pricing station. Store check-in records by preset ID, independent of station ID, so the dashboard can show them without a saved station. The four-hour alarm runs only for stations with automatic check-in enabled.
- FastAIToken's page `localStorage.auth_token` is injected only into `/api/v1/channels/available`; never return it to the extension or use it for another endpoint. Hepingan's `api.hepingan.top/available-channels` has the same endpoint restriction. Hepingan may open a temporary collection page when no matching tab exists and relies on the current Chrome profile's persistent login; first use requires login, and when multiple same-origin tabs make the target ambiguous, do not choose one at random.

Evidence: `extension/src/core/checkin.js`, `extension/src/service-worker.js`, and `extension/test/checkin.test.js`.

## Provider-specific collection facts

- CheapRouter (`cheaprouter.cc/models`) uses the Service Worker to call the public `/api/v1/pricing/public?timezone=Asia%2FShanghai` endpoint with `credentials: "omit"`. Do not depend on the model-page document; it may return `API_KEY_REQUIRED`.
- Sidrune (`sidrune.ai/model-plaza`) uses the public `/api/v1/model-plaza/public` API. The new-station default is `1 USD : 1` platform currency; normalize prices using the group multiplier.
- NexaVlinks (`nexavlinks.com/modelsmarket`) reads `/api/v1/channels/catalog?available_only=true&timezone=Asia%2FShanghai` in an authenticated page context. Existing saved stations restore the local plugin by host; new installations require explicit selection. Do not store station credentials in the extension.
- AIAPI (`cn.aiapi.bot/dashboard/model-prices`) reads `GET /api/me/model-catalog` in the logged-in page context. Use `data.data.source` for groups and treat `effective` prices as CNY per million tokens; do not apply a recharge multiplier again. Existing saved stations restore the local plugin by host; new installations require explicit selection and extension-side credentials are not saved.
- TrueSOTA (`true-sota.com/model-pricing`) uses the public `/api/v1/model-pricing` API. Normalize prices by group `rate_multiplier` to USD per million tokens and map `cache_price` to cache-read price. Existing saved stations restore the local plugin by host; new installations require explicit selection and the request omits credentials.
- NodeAI (`nodeai.cc/model-plaza`) uses public `GET /api/v1/model-plaza`, distinct from the page route, with the explicit `nodeai-model-plaza` normalizer. Multiply token price by the first context interval and 1,000,000 and by the user's group multiplier. Currency is CNY with default recharge ratio 1. Image pricing uses its separate image multiplier and maps to `image_price`; do not expand context intervals into peak/off-peak quote rows.

Evidence: provider adapters, collectors, normalizers, and station presets under `extension/src/core/`.

## Dashboard behavior

- The dashboard shows 20 quotes per page by default; users may choose 50, 100, 200, or 500. Filtering, sorting, and pagination operate on the complete comparison result.
- Collapsible dashboard sections use `.panel-heading` and `.collapse-toggle`. The current sections are `checkin-panel`, `toolbar-panel`, and `comparison-panel`; the global handler manages individual sections and `#collapse-all`. New collapsible sections should keep the heading as the first child and use the same classes.
- Desktop price review uses `.dashboard-workspace` with explicit grid areas `comparison sidebar`; the comparison is the wide primary column and check-in/filters occupy the 280px sidebar. Do not rely on DOM auto-placement. At 1100px and below the sidebar uses `display: contents` and the page returns to stacked cards.
- `createModelBands(visibleRows)` assigns 0/1 by each `canonicalModel`'s first appearance on the current page. Rows render `model-band-even` or `model-band-odd`; all offers for one canonical model keep the same band, while adjacent different models alternate `surface` and `surface-2`.
- Model comparison has four fixed `input[data-model-filter]` inputs inside `#model-filter-menu` (`MODEL_FILTER_BOXES = 4`). `renderModelFilter()` rebuilds these inputs, so toggle/input handlers must not call it in a way that drops focus or entered values. Keep `#model-filter-label` updates in `updateModelFilterLabel()`.

Evidence: `extension/src/dashboard.js`, `extension/dashboard.html`, and `extension/styles/dashboard.css`.

## JEV review rules

- `model_match` reviews the model / official-model mapping. `comparison_review` reviews recommendations and status.
- Batch model matching handles only unconfirmed mappings. Automatically save results with confidence of at least 50%; leave lower-confidence and unmatched results for manual review.

Evidence: `extension/src/core/jev-tasks.js`, `extension/src/dashboard.js`, and `extension/test/core.test.js`.

## Migrated observations

The following are retained as observed lessons with explicit scope, not universal behavior:

- Pricing station registration: define a local provider module and catalog entry, then add stations only through explicit plugin selection or the Agent/custom flow. Existing stations restore their provider through `pluginId` or host matching. Do not auto-add the full catalog on installation or alter empty-list defaults. See [Site Plugin and UI Contract](./site-plugins.md).
- Authenticated check-in: use the logged-in page bridge and authoritative post-submit state as described above. Applies to page-session-dependent operations with side effects, not public read-only APIs. Evidence: `extension/test/checkin.test.js`.
