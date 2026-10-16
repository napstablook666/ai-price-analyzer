# Migrate CodeStable to Trellis and remove CodeStable files

## Goal

Move the local CodeStable knowledge into Trellis so future sessions use a tracked, project-native source of truth, then remove CodeStable-specific local files after the migration is verified.

## Confirmed Facts

- `.codestable/` exists locally but is ignored by `.gitignore`; it is not part of the tracked product source.
- `.codestable/attention.md` contains durable project facts covering extension-first development, test commands, pricing and currency semantics, snapshots and cache invalidation, check-in flows, page-session credentials, station adapters, dashboard behavior, model filtering, and JEV review rules.
- `.codestable/lessons/2026-10-02-pricing-station-registration.md` records the observed rule that a new pricing adapter or host allowlist entry also needs idempotent station preset registration and migration coverage.
- `.codestable/lessons/2026-10-03-checkin-page-context.md` records the observed rule that authenticated check-in requests must use a logged-in page bridge and verify authoritative post-submit state.
- `.codestable/work/` contains nine historical session records from 2025-10-01 through 2026-10-08. They include implementation outcomes, test results, commit references, concurrent-worktree context, and references back to CodeStable records. Several values are historical and must not become current project rules without review.
- Trellis already has a frontend pricing contract at `.trellis/spec/frontend/pricing-data-contract.md`, a per-developer journal at `.trellis/workspace/Toriel/journal-1.md`, and task research/archive locations.
- The current working tree contains pre-existing tracked and untracked changes. This migration must preserve them and avoid product-code edits.

## Requirements

- R1: Transfer durable CodeStable facts into appropriate Trellis specification or project-journal locations, keeping source paths and evidence where they remain useful.
- R2: Transfer historical CodeStable work records according to the history-retention decision below, without presenting stale test counts or old worktree status as current guidance.
- R3: After migration verification, remove the local `.codestable/` directory and the CodeStable-only `.gitignore` entry while leaving unrelated ignore rules unchanged.
- R4: Do not modify extension behavior, product source, tests, or unrelated existing worktree changes.
- R5: Leave the Trellis task artifacts sufficient for a later session to understand what was migrated, what was discarded, and how the deletion was verified.

## Acceptance Criteria

- [x] Every durable fact from `attention.md` has a reviewed destination in Trellis, with no silently dropped project constraint.
- [x] Both observed lessons are represented in the selected Trellis specification or history location with their evidence and applicability boundaries.
- [x] The selected historical work-record retention scope is completed and stale historical values are clearly labeled as history.
- [x] `.codestable/` is absent after migration, and `.gitignore` no longer contains a CodeStable-specific rule or comment.
- [x] A repository search confirms there are no remaining CodeStable files or operational references outside the migration task's historical explanation.
- [x] Existing user changes are preserved and no product-code behavior changes are introduced.

## Decisions

- Preserve all nine files under `.codestable/work/` as historical records.
- Move durable facts into `.trellis/spec/frontend/project-facts.md`, including the two observed lessons and their evidence/applicability boundaries.
- Move the nine work records into `.trellis/tasks/10-16-codestable-to-trellis/research/codestable-history/` with a short historical-status notice; keep their original content and filenames.
- Delete `.codestable/` and its CodeStable-only `.gitignore` entry only after the Trellis copies and migration map have been checked.
