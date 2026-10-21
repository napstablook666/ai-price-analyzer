# Error Handling

> Error handling conventions for the repository's Python tooling and backend-like infrastructure scripts.

## Overview

Errors at a trust boundary must be reported with enough context to diagnose the failure. Fail-open behavior is allowed only where the caller's contract already defines a safe default.

## Error Types

- Preserve the original exception type and message when propagating an operation failure.
- Use a local warning for unsupported or malformed configuration constructs when the parser can safely skip them.
- Do not replace an unexpected parser failure with a silent empty result.

## Error Handling Patterns

- `.trellis/scripts/common/trellis_config.py::read_trellis_config()` returns `{}` for missing or unreadable config files and for parser failures, because callers can continue with defaults.
- Parser failures still emit `[WARN] <path>: <ExceptionType>: <message>; using defaults` to `stderr`. This keeps the fail-open contract visible without introducing a dependency on a logging framework.
- Reuse the warning behavior in `.trellis/scripts/common/config.py` when adding another config reader. Keep the standalone reader usable when loaded as one file.
- Catch only at the boundary where a safe fallback is defined. Otherwise let the exception propagate.

## API Error Responses

Browser extension message handlers return `{ ok: false, error, code? }` for rejected operations. Internal background event listeners warn about rejected fire-and-forget work and do not invent a response or retry policy.

## Common Mistakes

- Returning `{}` from a broad parser catch without a warning. This hides malformed project configuration and leaves callers using defaults unknowingly.
- Adding a broad catch to normal request or database code where the caller already has an error contract.
- Logging secrets while trying to diagnose a config or network failure.
