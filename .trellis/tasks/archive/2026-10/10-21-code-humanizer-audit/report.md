# Code Humanizer Repository Audit

## Result

This is a read-only Mode A audit of the current working tree. No product cleanup was applied. The authoritative catalog is the 16-pattern Code Humanizer catalog supplied in the task prompt. Findings use its severity scale: 0 absent, 1 justified, 2 minor debt, 3 clear debt, 4 severe debt.

The audit found 7 actionable findings:

- Pattern 8, severity 3: 2 findings in `extension/src/service-worker.js`.
- Pattern 8, severity 2: 3 findings in `extension/src/service-worker.js` and `.trellis/scripts/common/trellis_config.py`.
- Pattern 1, severity 2: one duplicated hostname-normalization implementation across extension modules.
- Pattern 12, severity 2: one duplicated/stale comment block.

All Pattern 8 findings have `needs-maintainer` behavior risk. They are report-only because changing error visibility, retry behavior, or error timing may change operational behavior.

## Scope

Scanned first-party text in the current working tree:

- Maintained browser extension under `extension/`, including JavaScript modules, HTML, CSS, tests, manifest, package metadata, and workspace data.
- Root archived userscript `AI中转站价格分析工具.js`, its root test, release/version scripts, and root package metadata.
- First-party `.trellis/scripts`, `.trellis/spec`, project instructions, and repository documentation where they establish contracts, call sites, or operational behavior.
- First-party configuration and supporting text files.

Excluded from code-pattern findings:

- `.git/`, dependency directories, generated dependency output, binary/image files, and VCS internals.
- The audit task artifacts under `.trellis/tasks/10-21-code-humanizer-audit/`, including this report.
- Existing user changes were treated as input and were not normalized, reverted, staged, or rewritten.

## Baseline

The documented baseline commands were run against the current working tree:

- `npm --prefix extension test`: passed, 184 tests, 184 pass, 0 fail, 0 skipped, 0 todo.
- `node --check extension/src/service-worker.js`: passed.
- `node --check extension/src/dashboard.js`: passed.
- `node --check extension/src/options.js`: passed.
- `node --check extension/src/content-bridge.js`: passed.
- `node --check extension/src/page-bridge.js`: passed.
- `node --check extension/src/popup.js`: passed.
- `node --check "AI中转站价格分析工具.js"`: passed.
- `node test-kbq-pricing.js`: passed, `KBQ pricing checks passed`.
- `npm run version:check`: passed, project `0.2.1`, userscript `4.15.14`.

No repository lint or type-check command is defined in the documented package scripts.

## Existing Helper and Abstraction Index

The repository already owns the following relevant contracts and helpers. These were checked before classifying duplication:

- `extension/src/shared/schema.js`: station, settings, URL-origin, imported-state, and normalization contracts.
- `extension/src/shared/credentials.js`: credential storage and migration boundaries.
- `extension/src/shared/db.js`: local storage, imported-state validation, and persistence helpers.
- `extension/src/shared/workspace.js`: workspace parsing, validation, file I/O, and serialized workspace operations.
- `extension/src/shared/ui.js`: shared UI and icon helpers.
- `extension/src/core/provider-registry.js`: provider registry, station context, hostname/path normalization, request policy, provider preparation, and provider adapters.
- `extension/src/core/station-presets.js`: provider-preset insertion built on the provider registry.
- `extension/src/core/normalizers.js`: parsing strategies and explicit parse-error results.
- `extension/src/core/response-formats.js`: response-format definitions and handler registry.
- `extension/src/core/request-strategy.js`, `collectors.js`, `model-api.js`, `page-tabs.js`, `refresh-*`, `pricing.js`, `matching.js`, and `adapters.js`: shared request, collection, refresh, pricing, matching, and adapter flows.
- `extension/test/*.test.js`: core, check-in, refresh-preflight, and workspace behavior tests.
- `.trellis/scripts/common/`: shared YAML/config, Git, task-store, task-utils, and active-task helpers. The standalone YAML parser is intentionally shared by hook-compatible and package-aware readers.

The provider registry and response-format/normalizer registries have multiple concrete providers, formats, and strategies. They are not single-implementation abstractions.

## Findings

### Pattern 8: Broad exception swallowing

#### F-1: Temporary page cleanup failure is discarded

- Location: `extension/src/service-worker.js:93`
- Severity: 2
- Evidence: `if (temporary) await chrome.tabs.remove(tab.id).catch(() => {});` runs in the `withPageFetch` cleanup path and discards every rejection.
- Why it matters: a temporary tab can remain open without any observable diagnostic. A missing-tab race may be harmless, but permission or API failures are indistinguishable from that expected race.
- Proposed fix: keep the cleanup best-effort contract, but handle the expected already-closed-tab case separately and surface unexpected removal failures through the extension's chosen background diagnostic path.
- Behavior risk: `needs-maintainer`.

#### F-2: Preflight cleanup failure is discarded

- Location: `extension/src/service-worker.js:242`
- Severity: 2
- Evidence: the `chrome.tabs.remove(tab.id)` call in the successful temporary-tab preflight branch is wrapped in `catch {}` with no diagnostic.
- Why it matters: `closedTemporary` remains false and the tab ID is persisted, so there is a fallback state, but an actual cleanup failure is hidden and may leave a temporary tab behind.
- Proposed fix: distinguish an expected tab-already-closed race from other Chrome API errors and record or surface the latter while preserving the existing tab-ID fallback.
- Behavior risk: `needs-maintainer`.

#### F-3: Tab-removal state reconciliation is silently abandoned

- Location: `extension/src/service-worker.js:890`
- Severity: 3
- Evidence: the `chrome.tabs.onRemoved` listener calls `restoreRefreshPreflightState()` and possibly `persistRefreshPreflightState()`, then terminates the promise chain with `.catch(() => {})`.
- Why it matters: a failed restore or persistence operation can leave temporary-tab ownership stale across a service-worker restart, and the event failure is not observable.
- Proposed fix: preserve the event handler's non-blocking shape but log/record rejected reconciliation, and decide whether persistence should be retried or marked dirty. Do not change the state contract without maintainer approval.
- Behavior risk: `needs-maintainer`.

#### F-4: Scheduled check-in failures are silently discarded

- Location: `extension/src/service-worker.js:895`
- Severity: 3
- Evidence: the alarm listener invokes `checkinAll({ claim: true, autoOnly: true }).catch(() => {});`.
- Why it matters: per-station failures inside `runCheckinForStation` are recorded, but failures while loading stations, updating shared state, or completing the aggregate operation can reject `checkinAll` and disappear entirely.
- Proposed fix: record or surface aggregate alarm failures and retain the existing per-station error state. Decide whether a failed alarm should be retried before changing scheduling behavior.
- Behavior risk: `needs-maintainer`.

#### F-5: Standalone Trellis config parsing hides unexpected parser failures

- Location: `.trellis/scripts/common/trellis_config.py:237-238`
- Severity: 2
- Evidence: `except Exception: return {}` catches every parser exception without warning. The file-reading branch immediately above narrows expected I/O failures, while the package-aware sibling `.trellis/scripts/common/config.py:92-96` emits a warning for parser failures.
- Why it matters: a hook or task command can silently use default configuration after an unexpected parser/programming failure.
- Proposed fix: preserve the documented malformed-config fallback only if it is required, but report the source and exception, or narrow the catch to a defined parser exception once one exists.
- Behavior risk: `needs-maintainer`.

### Pattern 1: Reimplementing an existing helper

#### F-6: Hostname normalization is duplicated

- Locations: canonical helper `extension/src/core/provider-registry.js:173-175`; duplicate helper `extension/src/core/station-presets.js:4-6`; equivalent inline expression `extension/src/core/checkin.js:25-28`.
- Severity: 2
- Evidence: all three paths lowercase a hostname and remove a leading `www.`. `provider-registry.js` already exposes `stationContext()` at `extension/src/core/provider-registry.js:186-188`, which returns the normalized hostname and handles malformed station URLs.
- Proposed fix: use `stationContext(station).hostname` in the preset and check-in paths, then delete the private duplicate and inline normalization. Preserve the existing invalid-URL behavior and verify the existing station/check-in tests.
- Behavior risk: `none` if the existing `stationContext()` contract is used unchanged.

### Pattern 12: Narrating or stale comments

#### F-7: Duplicate check-in token comments

- Location: `extension/src/core/checkin.js:84-87`
- Severity: 2
- Evidence: lines 84-85 describe the same behavior as lines 86-87, except the first pair contains the stale provider-specific name `vyceai` while the implementation accepts a generic preset.
- Proposed fix: remove the stale duplicate pair and keep the generic comment that matches the current function contract.
- Behavior risk: `none`.

## Per-File Severity Totals

- `extension/src/service-worker.js`: severity 3 x2, severity 2 x2.
- `.trellis/scripts/common/trellis_config.py`: severity 2 x1.
- `extension/src/core/station-presets.js`: severity 2 x1 as the duplicate implementation site.
- `extension/src/core/checkin.js`: severity 2 x2 as the inline duplicate and stale comment site.

`extension/src/core/provider-registry.js:173-175` is the canonical helper and is not counted as debt.

## Justified Exemptions

- `extension/src/shared/workspace.js:12` uses `next.catch(() => {})` to release the serialized queue after a failed operation; the original `next` promise is still returned, so the caller receives the failure. This is a queue-liveness contract, not silent caller-error swallowing.
- `extension/src/shared/collapse.js:5,10` treats localStorage persistence as optional UI state. The card UI remains usable if storage is unavailable.
- `extension/src/core/checkin.js:27-28,56-63` handles malformed station URLs and untrusted/network response bodies at trust boundaries. The response parser retains an explicit fallback result and HTTP failures remain errors.
- `extension/src/core/normalizers.js:1084-1085,1108-1109` converts strategy exceptions into explicit `sourceFormat: "parse-error"` results; this is observable error state, not a silent default.
- `.trellis/scripts/common/config.py:92-96`, `.trellis/scripts/common/git.py:53-54`, and `.trellis/scripts/common/task_utils.py:478-483,650-669` have documented operational contracts, return failure information or warnings, and isolate hook/task infrastructure failures.
- The archived userscript's catches around passive pricing-page interception are intentionally best-effort instrumentation. Its injected page context cannot import extension modules; its duplication is therefore not a helper-reuse finding.
- The extension's provider, response-format, parser-strategy, and task abstractions have multiple active implementations or concrete registrations. Patterns 4-7 were not found.
- No unjustified import fallback, dead public helper, `_v2`/`_new` clone, test mock-only suite, or trivial duplicated assertion was verified. Patterns 2-3, 9-11, and 13-16 have no actionable findings in this scan.

## Coverage Gaps

- The 184-test suite does not exercise the four service-worker empty-rejection paths or the standalone Trellis config reader's unexpected-exception path.
- The archived userscript has a narrow root test surface and its browser interception behavior was verified statically rather than through a browser test.
- `.trellis/scripts` has no full automated test suite; helper contracts were checked by source inspection and the available Trellis commands.
- No lint or type-check command is configured.
- A Git Bash inventory command using `rg --files | xargs wc -l` failed because Windows-style paths were concatenated without separators. This affected only line-count reporting; path-aware `rg`, targeted reads, syntax checks, and tests were used for the audit itself.

## Proposed Fix Order

1. F-6, Pattern 1: reuse `stationContext()` to remove duplicate hostname logic. Safe, low behavior risk.
2. F-7, Pattern 12: remove the stale duplicate comment pair. Safe, no behavior risk.
3. F-1, F-2, and F-5, Pattern 8 severity 2: maintainer review of cleanup/config fallback diagnostics before changing catches.
4. F-3 and F-4, Pattern 8 severity 3: maintainer decision on state reconciliation and scheduled check-in retry/error reporting.

No fixes were applied during this audit.

## Worktree Integrity

The final status still contains the pre-existing tracked changes in `CONTRIBUTING.md`, `README.md`, `README.zh-CN.md`, `extension/options.html`, and `extension/styles/options.css`, plus the existing untracked project/Trellis paths and the audit task artifacts. No product source, test, configuration, documentation, or existing user change was edited by the audit.
