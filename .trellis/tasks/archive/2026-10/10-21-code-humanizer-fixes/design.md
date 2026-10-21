# Technical Design

## Boundaries

- Keep the changes in the existing service worker, core normalization consumers, and standalone Trellis config reader.
- Use `console.warn` for unexpected background/config failures, matching the existing Trellis warning format and the browser's native diagnostic channel. Do not introduce a logging dependency or new shared logging layer.
- Add one small service-worker predicate for the known Chrome "tab already closed" error shape so the two cleanup paths share the same expected-race rule.

## Behavior and Data Flow

1. `withPageFetch()` continues to return the task result or propagate the task failure. Its temporary-tab `finally` cleanup catches only to classify the Chrome already-closed race; unexpected removal failures are warned and do not replace the original task result.
2. `preflightPageStation()` keeps `closedTemporary`, ownership-set deletion, persisted fallback tab ID, and result shape unchanged. It warns on unexpected `tabs.remove()` failures and still persists the existing fallback state.
3. The `tabs.onRemoved` listener and check-in alarm listener remain fire-and-forget event handlers. Their rejection handlers warn the aggregate failure without retrying or changing state contracts.
4. `read_trellis_config()` keeps its fail-open `{}` result for missing files and parser failures, but emits `[WARN] ... using defaults` for unexpected parser exceptions, matching `common/config.py`.
5. `station-presets.js` and `checkin.js` import and use `stationContext(station).hostname`. The canonical helper continues to return an empty hostname for malformed URLs, preserving the current no-match behavior.
6. Remove only the stale duplicate check-in comment pair. Keep the generic comment that describes the current preset-driven implementation.

## Test Strategy

- Extend the existing service-worker/preflight harness only as needed to inject cleanup failure and capture warning behavior. Assert task results and preflight fallback IDs are unchanged.
- Exercise the existing tab-removal and check-in paths after replacing their rejection handlers so the event listeners still complete without propagating into the caller.
- Keep existing hostname matching and station-preset tests as regression coverage; add a malformed URL assertion if the shared helper change needs explicit coverage.
- Run a direct Python smoke check that forces the standalone parser to raise and asserts `read_trellis_config()` returns `{}` while warning. No new Python test framework or dependency is needed.

## Compatibility and Rollback

- No persisted schema, alarm schedule, public response shape, retry policy, or provider matching rule changes.
- Roll back by reverting the focused service-worker, config-reader, normalization-consumer, and test edits. Existing user worktree changes remain outside the change set.
- Any warning-only behavior change is intentionally limited to previously invisible failures and is covered by focused checks.
