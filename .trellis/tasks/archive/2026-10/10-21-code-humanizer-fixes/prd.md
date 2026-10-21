# Fix Code Humanizer audit findings

## Goal

Remove all seven actionable findings from the archived repository audit while preserving the extension's existing error, state, and fallback contracts. The user-visible outcome is a repository with the reported cleanup debt addressed and verification covering the changed behavior.

## Confirmed Facts

- The archived audit identified seven findings across four locations:
  - `extension/src/service-worker.js:93`: temporary page cleanup rejects are discarded.
  - `extension/src/service-worker.js:242`: refresh-preflight cleanup rejects are discarded.
  - `extension/src/service-worker.js:890`: tab-removal state reconciliation rejects are discarded.
  - `extension/src/service-worker.js:895`: scheduled aggregate check-in rejects are discarded.
  - `.trellis/scripts/common/trellis_config.py:237-238`: unexpected parser exceptions return `{}` without a warning.
  - `extension/src/core/station-presets.js:4-6` and `extension/src/core/checkin.js:25-28`: hostname normalization duplicates the canonical logic in `extension/src/core/provider-registry.js:173-175`.
  - `extension/src/core/checkin.js:84-87`: duplicate and stale provider-specific comments remain.
- `extension/src/service-worker.js` already returns operation failures through its message handler, records per-station check-in failures in `runCheckinForStation`, and persists refresh-preflight fallback state.
- `.trellis/scripts/common/config.py:92-96` already reports parser failures to stderr before returning defaults. `trellis_config.py` should follow that established contract.
- `stationContext()` is the canonical hostname/path normalizer and returns an empty hostname for malformed station URLs.
- The extension test suite has service-worker and preflight harnesses, station-preset coverage, and check-in matching coverage.

## Requirements

- R1. Preserve temporary-tab cleanup and fallback behavior. Expected already-closed-tab races may remain quiet; unexpected cleanup failures must be observable without changing the surrounding operation's result or rejecting behavior.
- R2. Preserve refresh-preflight state ownership and persistence semantics. Rejected tab-removal event reconciliation must be observable, while the listener remains non-blocking and no new retry policy is introduced.
- R3. Preserve scheduled check-in cadence and per-station error records. Aggregate alarm failures must be observable, with no automatic retry or state-schema change.
- R4. Preserve fail-open Trellis configuration behavior. Unexpected parser failures must emit the same kind of warning as the package-aware config reader and still return defaults.
- R5. Replace duplicate hostname normalization in station presets and check-in matching with `stationContext()`, preserving valid-host matching and malformed-URL non-matching behavior.
- R6. Remove the stale duplicate check-in comment while retaining concise documentation that matches the generic preset contract.
- R7. Add or update focused tests for the changed error-observability and normalization behavior, then run the full extension suite and documented repository checks.

## Acceptance Criteria

- [x] All seven findings in the archived audit report are addressed in source.
- [x] No changed path silently swallows the targeted cleanup, reconciliation, alarm, or config-parser failures; expected best-effort and trust-boundary catches remain justified.
- [x] Temporary-tab IDs, preflight fallback results, per-station check-in records, and public error responses retain their existing semantics.
- [x] Hostname normalization has one canonical implementation on the affected paths, and malformed URLs still do not match a preset.
- [x] Stale duplicate comments are removed without adding narration elsewhere.
- [x] Focused tests cover the changed behavior, `npm --prefix extension test` passes, all documented Node syntax checks pass, `node test-kbq-pricing.js` passes, `npm run version:check` passes, and `git diff --check` passes.
- [x] The final diff contains no unrelated cleanup or generated metadata changes beyond the task artifacts required by Trellis.

## Out of Scope

- Introducing a logging framework, retry scheduler, or new persisted state schema.
- Changing the refresh-preflight state machine, check-in scheduling interval, station matching rules, or public message error contract.
- Refactoring unrelated broad catches, legacy userscript instrumentation, or pre-existing user worktree changes.
- Committing or staging unrelated existing changes.

## Open Questions

None. Use the repository's existing warning style and the smallest local changes needed to make unexpected failures observable.
