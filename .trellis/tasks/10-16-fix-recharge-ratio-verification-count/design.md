# Technical Design

## Scope and Boundary

Change only the dashboard data boundary and its service-worker regression coverage.

- Production boundary: `extension/src/service-worker.js:368-415`, inside `dashboard()`.
- Regression boundary: `extension/test/refresh-preflight.test.js`, using the existing `withWorker()` service-worker harness.
- Pricing contracts remain owned by `extension/src/core/pricing.js` and `extension/src/core/provider-registry.js`; they are not changed.

## Data Flow

1. `dashboard()` reads and prepares all saved stations through `getPreparedStations()`.
2. Keep that full prepared list as `stations` for the returned metadata. The options page consumes `GET_DASHBOARD.stations` to edit disabled stations.
3. Derive `comparisonStations = stations.filter(station => station.enabled)`.
4. Build `stationsById` and call `getLatestSnapshots()` only with `comparisonStations` IDs. The existing `snapshotNeedsRefresh()` predicate remains unchanged.
5. Pass `comparisonStations` to `buildComparisonRows()` and `summarizeComparisons()`. The returned `stations` remains the full list; returned `snapshots`, `comparisons`, and `summary` describe enabled stations only.
6. Keep check-in and refresh-preflight behavior unchanged. Their existing filters/signature already operate on enabled stations.

This makes the dashboard comparison boundary match `extension/src/core/refresh-scheduler.js:58` without changing persisted station or snapshot records. It also ensures `extension/src/dashboard.js:92-100` counts only rows produced from enabled stations.

## Compatibility and Cache

- No schema or normalization-version change is needed.
- `comparisonRevision` already changes when stations are saved, so toggling a station's enabled state invalidates the cached comparison through the existing cache key path.
- Returning all station metadata preserves the options page and existing station editing flow. Disabled snapshots are omitted from the dashboard response because they are not requested from the snapshot store.
- `recharge_unverified` behavior is untouched. An enabled protected station with `rechargeRateVerified: false` must remain blocked; an explicit station `true` wins over stale snapshot metadata through the existing station-first precedence in `extension/src/core/pricing.js:212-214`.
- An already-open dashboard is not part of the live-state contract. After station settings are saved elsewhere, the dashboard must be reloaded or become visible again to fetch the new `GET_DASHBOARD` result.

## Regression Shape

Extend the existing end-to-end test `GET_DASHBOARD prepares legacy station data and scheduler collection uses the same verified shape` in `extension/test/refresh-preflight.test.js`:

- Set the two enabled protected station fixtures to `rechargeRateVerified: true` and give their snapshot records stale top-level `rechargeRateVerified: false` metadata. Assert their offers have no `recharge_unverified` reason.
- Add a disabled KillAI-shaped station with 125 rows and `rechargeRateVerified: false` plus its successful snapshot.
- Seed it alongside the existing 145-row ordinary station, the two confirmed protected stations, and one confirmed ordinary station.
- Assert the disabled station is still present in `dashboard.stations`, absent from `dashboard.snapshots` and flattened comparisons, and does not alter `dashboard.summary.offerCount`.
- Count flattened offers containing `recharge_unverified` and assert the exact count is zero.
- Retain the existing core coverage for protected-provider false/missing states so the fix does not weaken the real blocking guard.

## Rollback

If the focused service-worker test fails or options-page station editing regresses, revert the single production change in `dashboard()` and its test fixture. No data migration or rollback script is required.
