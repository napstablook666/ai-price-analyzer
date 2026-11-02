# Technical Design

## Boundary

This task produces one read-only audit artifact at `.trellis/tasks/10-21-code-humanizer-audit/report.md`. It does not change product source, tests, configuration, documentation, or existing user worktree changes.

The audit target is the current working tree's first-party text source and supporting files: extension JavaScript, HTML/CSS, tests, the root archived userscript and its test, release scripts, `.trellis/scripts`, and other first-party code/configuration. Documentation is searched when it establishes call sites or contracts. `.git`, dependency directories, binary/image assets, and the task's own audit artifacts are excluded from code-pattern findings.

## Evidence Flow

1. Record the current working-tree state and run the repository's documented baseline commands.
2. Build an index of shared modules, helpers, normalizers, validators, adapters, registries, storage/database helpers, UI utilities, and public entry points.
3. Search the whole first-party scope for each Code Humanizer pattern class, then inspect surrounding code and all callers before classifying a candidate.
4. Verify candidates against tests, project-facts, pricing-data-contract, README/CONTRIBUTING rules, and actual runtime types and data flow.
5. Write findings and exemptions with stable repository-relative file:line references, then re-read the report and check that the product diff has not changed.

## Finding Contract

Actionable findings use the required fields: pattern number, severity 2-4, exact file:line, evidence, proposed behavior-preserving fix, and behavior risk (`none`, `error-type`, or `needs-maintainer`). Severity-1 shapes are listed only as justified exemptions. Latent bugs or error-contract changes are reported, not silently corrected.

Findings are grouped by pattern and ordered by severity, then by behavior risk. The report separately records baseline coverage gaps and any areas where evidence was insufficient to assert a finding.

## Compatibility and Risks

The extension is native JavaScript with Node's built-in test runner. The audit uses repository-native commands and static inspection; it does not add a parser dependency or a persistent scanner. The baseline protects against confusing pre-existing failures with review observations, but the test suite primarily covers extension behavior and does not prove every source path. The archived userscript and Trellis tooling therefore require static verification and their smaller test surfaces will be called out as coverage gaps.

Current uncommitted changes are treated as input. The initial status is recorded so the audit can distinguish task artifacts from pre-existing changes; no reset, checkout, staging, or cleanup command is allowed.

## Rollback

There is no product rollback because the audit is read-only. If an accidental product edit is detected, stop and report the path rather than overwriting it, since the worktree contains unrelated user changes.
