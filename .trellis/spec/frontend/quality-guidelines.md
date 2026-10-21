# Quality Guidelines

> Code quality standards for the browser extension and its background worker.

## Error Observability

- Background cleanup and event handlers may be best-effort, but unexpected rejected promises must remain observable with `console.warn`.
- The known Chrome race where a temporary tab is already gone is an explicit exception. `withPageFetch()` and refresh preflight cleanup may ignore only that error shape; all other removal failures are warned.
- Event listeners that start asynchronous work must attach a rejection handler. Return the caught promise when the listener is tested or composed by another async dispatcher, so the caller can await completion without changing the browser event contract.
- Do not add retries or change persisted state merely to make a warning visible. Preserve the existing result, fallback tab ID, and state ownership semantics.

## Shared Normalization

- Use `stationContext(station).hostname` for station URL hostname matching. Do not duplicate `new URL(...).hostname`, lowercasing, or `www.` stripping in consumers.
- Keep malformed station URLs as non-matches through the shared normalizer's empty-host result.

## Forbidden Patterns

- Empty `.catch(() => {})` handlers on background cleanup, tab-removal reconciliation, scheduled work, or config parsing.
- Local copies of shared URL/hostname normalization logic.
- Comments that describe a provider-specific implementation when the code is already driven by the generic preset contract.
- Logging raw credentials, cookies, authorization headers, or secret query parameters.

## Testing Requirements

- Run `npm --prefix extension test` for changes to extension behavior.
- Add fault-injection coverage for changed rejection handlers. Assert both the warning and the preserved operation result or fallback state.
- Include malformed URL coverage when a consumer switches to `stationContext()`.
- Run `node --check` on changed JavaScript modules and `git diff --check` before completion.

## Code Review Checklist

- [ ] Unexpected background failures are observable and expected tab-closure races stay quiet.
- [ ] Async listeners do not retry or mutate state beyond their existing contract.
- [ ] URL matching reuses `stationContext()`.
- [ ] Tests cover failure paths, not only successful collaborator calls.
- [ ] No unrelated user changes were reformatted or refactored.
