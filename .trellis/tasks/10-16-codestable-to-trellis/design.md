# Technical Design

## Scope Boundary

This task migrates local CodeStable knowledge into Trellis and removes the CodeStable-only local state. It does not change extension behavior, tests, release metadata, or any existing user worktree change.

The migration has two outputs:

1. Normative project knowledge that future Trellis tasks can load from `.trellis/spec/frontend/`.
2. Historical session records that remain auditable under this task's `research/` directory and move with the task when it is archived.

## Destination Model

### Durable project facts

- Add `.trellis/spec/frontend/project-facts.md` as the home for cross-cutting facts from `attention.md` that are not already owned by a narrower contract.
- Extend `.trellis/spec/frontend/index.md` with the new project-facts entry so the file is discoverable during Trellis pre-development context loading.
- Keep `.trellis/spec/frontend/pricing-data-contract.md` as the normative owner for pricing-unit, currency-verification, recharge-rate, snapshot, and comparison contracts. Add the station-preset registration lesson there when it is not already expressed by the contract.
- Put the authenticated page-bridge/check-in lesson and the remaining cross-cutting operational facts in `project-facts.md`. Each migrated section retains source evidence paths and an applicability boundary.
- Mark dated measurements and test counts as time-bound observations. They are context, not acceptance thresholds or permanent rules.

### Historical work records

- Create `.trellis/tasks/10-16-codestable-to-trellis/research/codestable-history/README.md` explaining that the directory contains historical CodeStable records and that old test counts, worktree states, and commit references describe their original dates.
- Copy all nine files from `.codestable/work/` into that directory with the same filenames and original body text.
- Add a short historical-status notice to each copied file without rewriting its historical claims.
- Create `research/migration-map.md` that maps every durable `attention.md` and lesson item to its Trellis destination and lists all nine historical source files.

### Source cleanup

- Remove only the CodeStable comment and `.codestable/` entry from `.gitignore`; preserve all unrelated ignore rules.
- Delete `.codestable/` only after the destination files, migration map, and verification checks are complete. Because the source is ignored, the deletion will not appear in Git diff and must be verified explicitly.

## Migration Flow

1. Capture the pre-change working-tree path set and inventory every CodeStable source file.
2. Write and index the durable Trellis facts, preserving source evidence and distinguishing normative rules from dated observations.
3. Copy the nine historical work records and write the migration map.
4. Compare the source inventory with destination inventory and search for key source facts before deletion.
5. Delete `.codestable/` and remove its dedicated `.gitignore` rule.
6. Re-run the repository search and verify that remaining CodeStable references are limited to this migration task's rationale/history and do not act as runtime configuration.

## Compatibility and Rollback

- No runtime or public interface compatibility impact is expected because all product files are out of scope.
- If verification fails before deletion, leave `.codestable/` untouched and fix the destination documents.
- After deletion, the retained historical copies are sufficient to restore the local records if needed. Restoring the old local state would require recreating `.codestable/` from `research/codestable-history/` and restoring the two-line `.gitignore` rule; this is intentionally not part of the normal result.
- Existing user changes are protected by comparing the pre-change and post-change path sets and by reviewing the final diff for only the planned Trellis files and `.gitignore`.
