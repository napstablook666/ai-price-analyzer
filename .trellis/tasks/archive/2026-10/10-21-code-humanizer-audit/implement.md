# Implementation Plan

## Ordered Checklist

1. Capture the initial `git status --short` and relevant diff summary without changing the worktree.
2. Run the documented baseline: `npm --prefix extension test`, extension `node --check` commands, `node --check "AI中转站价格分析工具.js"`, `node test-kbq-pricing.js`, and `npm run version:check`.
3. Enumerate first-party files and index existing helpers, shared utilities, payload normalizers, validators, adapters, registries, storage/database access, UI helpers, and public entry points. Search all text files for call sites before declaring dead code or duplication.
4. Scan the Code Humanizer catalog by pattern class, prioritizing duplication/reinvention, speculative abstractions, defensive slop, noise, and test slop. Use actual callers, type flow, tests, and project contracts to reject false positives.
5. Verify every candidate and assign severity, exact file:line, evidence, proposed fix, and behavior-risk classification. Record justified exemptions and unresolved verification gaps separately.
6. Write `.trellis/tasks/10-21-code-humanizer-audit/report.md` with scope, exclusions, baseline, inventory, findings, per-file totals, exemptions, coverage gaps, and proposed fix order.
7. Re-read the report, verify all required fields and file:line anchors, compare product paths against the initial worktree state, and confirm no product files were changed.

## Validation Commands

- `npm --prefix extension test`
- `node --check extension/src/service-worker.js`
- `node --check extension/src/dashboard.js`
- `node --check extension/src/options.js`
- `node --check extension/src/content-bridge.js`
- `node --check extension/src/page-bridge.js`
- `node --check extension/src/popup.js`
- `node --check "AI中转站价格分析工具.js"`
- `node test-kbq-pricing.js`
- `npm run version:check`
- `git status --short`
- `git diff --stat`

## Review Gates

- Do not start the scan until the planning summary is explicitly approved.
- Do not report a duplicate without a whole-repository helper/call-site search.
- Do not report a cleanup that changes an error type or error timing as a safe fix.
- Do not modify product files while producing the report.
- Before completion, verify the report itself is excluded from the findings and the initial user changes remain intact.

## Rollback Points

The audit has no code rollback step. If a command or inspection unexpectedly writes product files, stop immediately and identify the changed paths; preserve unrelated user edits and resolve only with explicit instruction.
