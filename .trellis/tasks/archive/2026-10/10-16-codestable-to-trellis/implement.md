# Implementation Plan

## Preconditions

- The user explicitly approved retaining all nine historical work records and implementing the migration.
- The pre-existing worktree path set was captured before edits; existing tracked and untracked user changes remain untouched.
- The active task was already supplied as in progress, so no `task.py start` transition was run.

## Completed Steps

1. Captured the existing status and `.codestable/` source inventory.
2. Created `.trellis/spec/frontend/project-facts.md`, separating durable rules from dated measurements and retaining source/evidence paths.
3. Added the project-facts entry to the frontend index and added only the station-preset registration lesson to the pricing contract.
4. Copied all nine work records with their original filenames and bodies, added historical-status notices and README, wrote the migration map, and updated task manifests to reference the migrated context.
5. Reviewed the destination specs and map, confirming both lessons retain evidence and applicability boundaries.
6. Compared every history destination after its notice against its source; all nine bodies matched byte-for-byte.
7. Removed `.codestable/` after verification and removed only its dedicated comment and ignore rule.
8. Re-ran repository searches and diff checks. No `.codestable/` directory or CodeStable application runtime/configuration references remain. The curated specs cite current code/test evidence; original source paths and migration provenance remain in the migration task. The ignored active-task breadcrumb contains this task's ID and was left intact; the Windows reserved `NUL` artifact is excluded from text search.
9. Marked PRD acceptance criteria complete and ran Trellis context validation. The task remains in progress for the separate finish/archive step.

## Validation Results

- Historical copies: 9/9 destination bodies byte-for-byte equal to their source after stripping the added notice.
- Trellis task validation: `implement.jsonl` 14 entries and `check.jsonl` 15 entries; all files exist and validation passed.
- Extension tests: `npm --prefix extension test` passed, 175 tests, 0 failures.
- `git diff --check`: passed; Git emitted only its existing LF-to-CRLF conversion warnings.
- Final cleanup: `test ! -e .codestable` passed. `.gitignore` diff contains only deletion of the dedicated CodeStable comment and `.codestable/` entry.
- No product source, test, or release file was edited for this task. Pre-existing modifications and untracked user files remain.

## Validation Commands

```text
test ! -e .codestable
python ./.trellis/scripts/task.py validate .trellis/tasks/10-16-codestable-to-trellis
npm --prefix extension test
git diff --check
git status --short
```

The final text search excludes `.git/`, `node_modules/`, `.trellis/.runtime/`, and the Windows reserved `NUL` artifact. Remaining hits are limited to the migration task and its retained historical records; curated specs point to current code/test evidence while source paths are preserved in the migration map.

## Risk Files and Rollback Points

- `.trellis/spec/frontend/project-facts.md`: dated measurements and endpoint observations may age; recheck current code and fresh measurements before treating them as current values.
- `.trellis/spec/frontend/pricing-data-contract.md`: the only addition is the station-registration lesson; the existing pricing contract remains authoritative.
- `.trellis/spec/frontend/index.md`: the new project-facts entry makes the migrated facts discoverable.
- `research/codestable-history/*`: all nine original bodies were verified before source deletion; notices explicitly identify the retained records as historical.
- `.gitignore`: final diff removes only the CodeStable comment and `.codestable/` entry.
- `.codestable/`: absent after verified migration; the retained history copies allow recovery of the nine work records if needed.

## Independent Review

- A read-only review found one low-risk traceability gap: pricing-unit and currency-semantics facts were present in the pricing contract but were not listed as a separate row in `research/migration-map.md`.
- Added the explicit mapping row; no product files, historical bodies, or cleanup scope changed.
- Spec-sync review found no additional reusable frontend contract beyond the migrated facts and existing pricing contract; migration-specific provenance remains in task research.

## Remaining Lifecycle Step

The implementation and validation are complete. Leave task status unchanged; the parent workflow owns the separate finish/archive step.
