# Implementation Plan

## Ordered Checklist

- [x] Add the service-worker cleanup warning/predicate behavior for temporary tabs, refresh-preflight tab removal, tab-removal reconciliation, and scheduled aggregate check-in failures.
- [x] Add focused service-worker/preflight coverage for warning-only cleanup failures and preserved fallback/result behavior.
- [x] Make `trellis_config.py` warn on unexpected parser exceptions while preserving the empty-default result; run the direct Python smoke check.
- [x] Replace duplicate hostname normalization with `stationContext()` in station presets and check-in matching.
- [x] Remove the stale duplicate check-in comments and keep the generic contract comment.
- [x] Run focused tests, then the full extension suite and all documented syntax/pricing/version checks.
- [x] Run `git diff --check`, inspect the final diff for unrelated changes, update the task acceptance checklist, and run the independent quality review.

## Validation Results

- `npm --prefix extension test`: 187 passed, 0 failed.
- `node --test extension/test/refresh-preflight.test.js`: 15 passed, 0 failed.
- `node --check` passed for all changed JavaScript modules.
- `node test-kbq-pricing.js`: passed.
- `npm run version:check`: passed for project `0.2.1` and userscript `4.15.14`.
- Direct parser-failure smoke check: passed.
- `git diff --check`: passed; Git only reported existing LF-to-CRLF normalization warnings.
- `trellis-check` independent review found no source-level defect. It initially identified missing failure-path coverage; those tests were added and passed.

## Risky Files and Rollback Points

- `extension/src/service-worker.js`: event rejection handling and temporary-tab cleanup. Roll back this file and its focused tests if original task/result or preflight state semantics change.
- `extension/test/refresh-preflight.test.js`: harness and warning assertions. Keep test-only changes isolated from product behavior.
- `.trellis/scripts/common/trellis_config.py`: fail-open config behavior. Roll back if missing/malformed config no longer returns the documented defaults.
- `extension/src/core/station-presets.js` and `extension/src/core/checkin.js`: normalization reuse and comment cleanup. Roll back if valid host matching or malformed URL handling changes.

## Review Gates

- [x] PRD and technical plan were reviewed before implementation.
- [x] Full test suite ran before final cleanup review.
- [x] Current diff was inspected for Code Humanizer slop; unrelated pre-existing findings were left untouched.
- [x] Unrelated user changes were not staged or committed.
