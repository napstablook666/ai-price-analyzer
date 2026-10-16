# Dashboard Recharge Verification Count: Read-Only Findings

## Result

The reported `125` is most likely a count of affected comparison offers, not 125 persisted recharge-ratio settings. The UI expands each model/group/tier into an offer row and counts `recharge_unverified` once per row. The exact 125 cannot be attributed to the user's database from repository files alone; the current IndexedDB data was not inspected.

The repository already has the earlier `145 currency / 125 recharge` fix assumptions recorded in the archived `10-16-fix-verification-status` task. That task intentionally fixed false currency status while retaining genuinely unknown recharge ratios for KillAI and fuck-everyone. If the currently loaded `125` comes from those protected stations, the warning is expected under the existing contract. A separate concrete inclusion issue is that dashboard comparisons do not filter disabled stations, so disabling a pending station does not remove its rows or warnings.

## Complete Data Flow

1. `extension/src/service-worker.js:808` routes `GET_DASHBOARD` to `dashboard()`.
2. `dashboard()` at `extension/src/service-worker.js:368` calls `getPreparedStations()` at line 375. `getPreparedStations()` reads `getStations()` and maps `prepareComparisonStation()` (`service-worker.js:135-141`); that function applies `prepareStationInput()` then `normalizeStation()`.
3. `prepareStationInput()` in `extension/src/core/provider-registry.js:578-581` sets every prepared station's model-list unit to `priceCurrency: "CREDITS"` and `priceCurrencyVerified: true`. It sets ordinary providers' `rechargeRateVerified` to true, but when a provider has `preserveRechargeRateVerification`, it keeps false and only treats a non-false value as true. Only `killai` and `fuck-everyone` currently declare that preservation flag (`provider-registry.js:360,390`). Their provider preparation fills a missing rate-verification value from presets, both false (`provider-registry.js:105-133,368-408`).
4. `dashboard()` requests the latest usable snapshot for every prepared station ID (`service-worker.js:378-379`). `snapshotNeedsRefresh()` rejects snapshots whose `normalizationVersion` is below the current version (`extension/src/core/snapshot-policy.js:3-5`). It does not limit the station IDs to enabled stations.
5. `buildComparisonRows()` in `extension/src/core/pricing.js:175-185` maps stations and iterates latest snapshots and their normalized model rows. For each row it takes station verification first, with snapshot metadata only as a nullish fallback (`pricing.js:212-214`). `getProxyPriceQuote()` adds `recharge_unverified` only when `rechargeRateVerified === false` (`pricing.js:39-53`). Reasons are accumulated onto comparison offers and emitted as `pricingUnavailableReasons` (`pricing.js:238-262,319-326`). It does not skip `station.enabled === false`.
6. `dashboard.js:475-477` calls `GET_DASHBOARD`; `render()` at `dashboard.js:436-454` flattens all comparison offers into `state.rows` and calls `renderSummary(state.rows)`. In `renderSummary()` (`dashboard.js:92-100`), `rows.flatMap(row => row.pricingUnavailableReasons)` increments each reason once per offer row. Filters do not change this count because it is computed from all `state.rows` during render. Each individual row also displays the reason in `statusMarkup()` (`dashboard.js:60-62,69-73`). The dashboard's `data.summary` is built by `summarizeComparisons()` and contains model/offer/station/stale counts, not verification-reason counts (`service-worker.js:403-406`; `pricing.js:355-364`).

Therefore the UI text `125 条充值比例待核验` means 125 offer rows carry that reason. It does not mean there are 125 station settings to edit; a single false station flag can repeat across all models, groups, and tiers in that station's snapshot.

## Most Likely Cause and Caveats

- The most likely source after the archived verification fix is offers belonging to KillAI and/or fuck-everyone whose persisted `rechargeRateVerified` remains false. Those providers deliberately preserve false and default missing values to false; each offer from them gets `recharge_unverified`. This matches the earlier exact report in `.trellis/tasks/archive/2026-10/10-16-fix-verification-status/prd.md:9-15` and its acceptance criteria at lines 27-38, which explicitly say unknown recharge ratio remains pending.
- A confirmed `rechargeRateVerified: true` on either protected station should survive preparation and remove `recharge_unverified`; the current integration test checks false only in `GET_DASHBOARD`, while the core test checks the true path only at `prepareStationInput()`/comparison level. Thus there is no evidence in this checkout that already-confirmed protected station state itself is being overwritten by the dashboard path.
- Disabling a station does not suppress its dashboard rows. `refresh-scheduler.js` filters enabled stations (`extension/src/core/refresh-scheduler.js:58`), while `dashboard()` passes all prepared station IDs and `buildComparisonRows()` does not filter enabled. If the user resolved the count by disabling the affected station, its cached offer rows remain in the dashboard and count. Whether disabled stations should disappear from comparisons is a product behavior decision; the options UI labels the setting as participating in both comparison and batch query.
- An already-open dashboard is not pushed a station-update message after `SAVE_STATIONS`; `dashboard.js` reloads on initial load and `visibilitychange` (`dashboard.js:896-903`). So a dashboard left open while another page saves station settings can temporarily show old in-memory rows until the next `GET_DASHBOARD`/reload. Once reloaded, station fields are freshly prepared; old snapshot verification metadata should not override a station's explicit true because of the station-first nullish precedence in `pricing.js:212-213`.
- No local station database or screenshot fixture ties the number 125 to particular station IDs. The attribution above is the strongest repository-based explanation, not proof of the user's live count composition.

## Archived Fix Assumptions

- `10-16-fix-currency-verification` (`.trellis/tasks/archive/2026-10/10-16-fix-currency-verification/prd.md` and `design.md`) fixed generic `price_currency` loss and unknown-currency conversion. It explicitly forbids using recharge currency to infer model-price currency and keeps `rechargeRateVerified === false` as a separate blocker.
- `10-16-fix-refresh-verification-preflight` (`prd.md`, `design.md`, `implement.md`) addressed real `GET_DASHBOARD`/refresh use of the same prepared station shape, preventing old ordinary-provider flags from multiplying false pending reasons. It explicitly preserves real KillAI/fuck-everyone and recharge-false blockers. Its refresh scheduler handles enabled filtering, but current dashboard comparison does not.
- `10-16-fix-verification-status` is the closest match to this report: it records the exact `145` currency and `125` recharge counts. Its fix intentionally canonicalized model-list currency to CREDITS/verified while keeping protected providers' unknown recharge ratios false. It states only an explicit true may clear the recharge blocker; this is not a global stale-status cleanup.
- `10-16-fix-currency-verification-followup` keeps recharge amount currency/credits, `rechargeRateVerified`, model `priceCurrency`, and `priceCurrencyVerified` as independent inputs. It prohibits converting CNY/USD recharge settings into proof of model-price currency or recharge ratio verification.

## Real Current Files to Consider

- `extension/src/dashboard.js`: owns the displayed reason count. It counts offers, not unique station ratio settings.
- `extension/src/service-worker.js`: owns `GET_DASHBOARD` station/snapshot selection. It currently includes disabled stations.
- `extension/src/core/pricing.js`: owns station-first verification precedence and `recharge_unverified` per-offer blocking. This behavior is correct for the protected-provider contract and should not be weakened to cosmetically clear the count.
- `extension/src/core/provider-registry.js`: owns the two-provider exception and their unknown-rate defaults. It is intentional protection, not a stale-snapshot cleanup target.
- `extension/src/shared/schema.js`: `normalizeStation()` preserves explicit false (`schema.js:252-276`).
- `extension/src/options.js`: editing recharge amount/credits or recharge currency marks the rate verified (`options.js:135-145,810-818`); `readStations()` saves the flag (`options.js:319-340`).
- `extension/test/refresh-preflight.test.js`: already contains a true `GET_DASHBOARD` regression fixture (`refresh-preflight.test.js:212-279`) with 145 legacy ordinary rows and protected providers, but it asserts only individual protected rows and `offerCount`, not an aggregate `recharge_unverified` count or a saved explicit-true protected station round-trip.
- `extension/test/core.test.js`: already covers the protected providers' false/missing/true preparation and reason behavior (`core.test.js:1255-1338`), but not the dashboard/save round-trip for a confirmed rate.

## Smallest Regression Test

Extend the existing `GET_DASHBOARD prepares legacy station data and scheduler collection uses the same verified shape` test in `extension/test/refresh-preflight.test.js` rather than adding a new parser test:

- Count `flattenComparisonRows(dashboard.comparisons).filter(row => row.pricingUnavailableReasons.includes("recharge_unverified"))` and assert the exact number/attribution for a constructed fixture. This directly tests the data that `dashboard.js` counts.
- Keep at least one protected provider explicitly false and assert it remains blocked; add a second protected station/fixture with `rechargeRateVerified: true` and assert its offers have no recharge reason after `GET_DASHBOARD`, even if the snapshot metadata is false. This closes the “already handled but still counted” path without changing the guard.
- If the intended fix includes disabled stations, add a disabled protected station with a snapshot and assert whether it is excluded from dashboard comparisons. This should be a separate explicit assertion because it changes dashboard participation behavior, not verification semantics.

The existing test does not need an invented expectation that all 125 warnings vanish. It should establish that the count equals actual pending offers and that explicitly confirmed station state clears the offers' reason.

## Protection Semantics That Must Not Change

- `rechargeRateVerified: false` on KillAI/fuck-everyone must remain false through `prepareStationInput()` and `normalizeStation()` and must keep the offer non-comparable/non-recommended via `recharge_unverified`.
- Missing rate-verification on these protected providers must continue to inherit the preset's false value; only explicit true is affirmative confirmation.
- A persisted explicit true for a protected provider must be preserved and should remove only the recharge blocker.
- Ordinary providers' old false/missing prepared shape remains auto-normalized as verified as specified by the archived status task; do not reintroduce the old batch false-positive behavior.
- Model currency (`priceCurrency`/`priceCurrencyVerified`) is separate from recharge ratio verification. The CREDITS model-list contract does not certify the recharge ratio; recharge currency CNY/USD does not prove model price currency either.
- Unknown or empty model-price currency must continue to generate `currency_unverified`; do not remove that gate or turn a warning off only in UI aggregation.
- Page-session preflight, successful collection, nonzero default ratio, or a stored numeric `rechargeRate` must not silently set protected `rechargeRateVerified` true.

## Read-Only / Residual Risk

`python ./.trellis/scripts/task.py current --source` returned `Current task: (none)` in this workspace despite the explicit task path supplied by the caller. Findings were therefore saved under `.trellis/tasks/10-16-fix-recharge-ratio-verification-count/research/` as requested for the supplied active task. No product code, test, spec, or task file was changed. The worktree had pre-existing modifications/untracked files; they were left untouched.

Residual risk: without the user's live IndexedDB station records, it is not possible to confirm whether the 125 rows are protected providers, disabled stations, or a stale open dashboard. The present repository proves the counting rules and intended protection boundaries, not the live row attribution.
