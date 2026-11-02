# Scan repository for AI coding slop

## Goal
Produce a read-only Code Humanizer Mode A audit of the repository so maintainers have a verified, prioritized list of AI-coding-slop debt and behavior-risk items without changing product code.

## Confirmed Facts
- The maintained product is the browser extension under `extension/`.
- The extension uses native JavaScript modules and Node's built-in test runner; its test command is defined in `extension/package.json`.
- The root project also contains an archived userscript, its historical test, release/version scripts, and repository documentation.
- The working tree already contains unrelated user changes. The audit must inspect the current working tree and must not reset, overwrite, or reformat those changes.
- The repository has a frontend spec layer. The existing project-facts, pricing-data-contract, and code-reuse thinking documents are evidence sources; most other frontend guideline files are currently placeholders.

## Requirements
- R1: Establish and record the baseline health of the documented test, syntax-check, and version-check commands before classifying findings.
- R2: Build a repository-wide index of existing helpers, shared modules, validators, normalizers, adapters, registries, and other abstractions before judging duplication or reinvention.
- R3: Scan first-party source, tests, scripts, configuration, and supporting text in the current working tree. Include the extension, root archived userscript, `.trellis/scripts`, and other first-party code; use documentation and configuration to verify call sites and contracts.
- R4: Classify only evidence-backed findings against the Code Humanizer catalog. Do not turn stylistic preference, justified compatibility behavior, trust-boundary validation, or intentional exploration into findings.
- R5: For each actionable finding, record the pattern number, severity from 0 to 4, repository-relative file and line, concrete evidence, proposed fix, and behavior risk (`none`, `error-type`, or `needs-maintainer`).
- R6: Separate justified severity-1 exemptions and verification gaps from actionable findings. Preserve exact error behavior and do not propose silent behavior changes as cleanup.
- R7: Write the completed audit to `report.md` in this task directory. The report must state the scanned scope, exclusions, baseline results, helper/abstraction index, findings grouped by pattern, per-file severity totals, exemptions, and proposed fix order.
- R8: Do not modify product source, tests, configuration, documentation, or existing user changes as part of the audit.

## Acceptance Criteria
- [ ] The documented baseline commands are run and their pass/fail results and relevant output are recorded in `report.md`.
- [ ] The report covers the full first-party repository scope defined in the report and clearly names excluded generated, dependency, VCS, binary, or audit-output paths.
- [ ] Existing helpers and abstractions are indexed before duplication findings are asserted.
- [ ] Every actionable finding has pattern number, severity, exact file:line location, evidence, proposed fix, and behavior-risk classification.
- [ ] Findings are prioritized by severity and behavior risk, with safe fixes before items requiring maintainer approval.
- [ ] The report contains no unverified claims and lists remaining coverage or test gaps explicitly.
- [ ] No product files are changed; only Trellis task artifacts and the audit report may be added or updated.

## Out of Scope
- Applying any code-humanizer cleanup or refactoring.
- Adding or changing tests, lint rules, dependencies, APIs, release files, or documentation outside the task artifacts.
- Reverting, staging, committing, or otherwise normalizing pre-existing working-tree changes.
- Reviewing binary/image contents, `.git` internals, dependency directories, or the audit report itself for code-humanizer debt.

## Open Questions
- None. The user selected a repository-wide scan, and the requested deliverable is a read-only Mode A report.
