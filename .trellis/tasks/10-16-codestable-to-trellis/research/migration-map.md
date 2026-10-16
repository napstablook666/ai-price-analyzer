# CodeStable Migration Map

## Durable facts from `.codestable/attention.md`

| Source fact | Trellis destination |
|---|---|
| Extension-first scope; deprecated root userscript; extension test command and time-bound count | `.trellis/spec/frontend/project-facts.md` - Development and validation |
| Manual price refresh; four-hour alarm limited to enabled check-in | `.trellis/spec/frontend/project-facts.md` - Development and validation; Check-in and page-session requests |
| Latest station snapshot, 30-day retention, in-memory comparison cache invalidation, station-write version boundaries | `.trellis/spec/frontend/project-facts.md` - Pricing snapshots and comparison |
| Pricing units, currency trust, recharge-rate semantics, OpenRouter mapping, refresh preflight, and normalization-version rules | `.trellis/spec/frontend/pricing-data-contract.md` - Signatures, Contracts, Validation & Error Matrix; `.trellis/spec/frontend/project-facts.md` - Pricing snapshots and comparison | The existing pricing contract remains the normative owner; current code/test evidence stays in the contract. |
| Monthly cost basis, dated s2api sample and 30-day normalization, monthly field names, preset field semantics, legacy settings migration | `.trellis/spec/frontend/project-facts.md` - Monthly cost estimation |
| Check-in presets, logged-in page bridge, post-submit `canClaim` verification, records by preset ID, adapter setup | `.trellis/spec/frontend/project-facts.md` - Check-in and page-session requests |
| FastAIToken and Hepingan page-token restrictions and tab selection rules | `.trellis/spec/frontend/project-facts.md` - Check-in and page-session requests |
| CheapRouter, Sidrune, NexaVlinks, AIAPI, TrueSOTA, and NodeAI endpoints and normalization boundaries | `.trellis/spec/frontend/project-facts.md` - Provider-specific collection facts |
| Dashboard pagination and complete-result filtering/sorting | `.trellis/spec/frontend/project-facts.md` - Dashboard behavior |
| Collapsible dashboard section classes and global collapse behavior | `.trellis/spec/frontend/project-facts.md` - Dashboard behavior |
| Four model filter inputs, render/focus constraint, and label updater | `.trellis/spec/frontend/project-facts.md` - Dashboard behavior |
| JEV model mapping, review columns, batch confidence, and manual-review boundary | `.trellis/spec/frontend/project-facts.md` - JEV review rules |

The source's historical test count and dated cost sample are retained only as dated observations; neither is a current threshold or guaranteed current baseline.

## Observed lessons

| Source | Destination | Evidence and applicability |
|---|---|---|
| `.codestable/lessons/2026-10-02-pricing-station-registration.md` | `.trellis/spec/frontend/pricing-data-contract.md` - Station preset registration; also summarized in `project-facts.md` | Adapter/host allowlist changes need persisted preset registration and idempotent migration when the station is intended to be selectable. Does not change empty-list defaults and does not cover standalone check-in presets. The original source path is retained in this map; current implementation and test evidence are in the contract. |
| `.codestable/lessons/2026-10-03-checkin-page-context.md` | `.trellis/spec/frontend/project-facts.md` - Check-in and page-session requests; Migrated observations | Applies to authenticated, side-effecting page-session operations; requires same-page bridge and authoritative post-submit verification. Does not apply to public read-only APIs. The original source path is retained in this map; current implementation and test evidence are in the spec. |

## Historical work records

All original bodies are retained with the same filenames. Each destination adds only a historical-status notice before the source body.

| Source | Destination |
|---|---|
| `.codestable/work/2025-10-01-cost-preset-fix.md` | `codestable-history/2025-10-01-cost-preset-fix.md` |
| `.codestable/work/2025-10-01-jev-checkin.md` | `codestable-history/2025-10-01-jev-checkin.md` |
| `.codestable/work/2026-10-07-batch-jev-model-matching.md` | `codestable-history/2026-10-07-batch-jev-model-matching.md` |
| `.codestable/work/2026-10-07-cheaprouter-pricing-fix.md` | `codestable-history/2026-10-07-cheaprouter-pricing-fix.md` |
| `.codestable/work/2026-10-07-dashboard-ui-polish.md` | `codestable-history/2026-10-07-dashboard-ui-polish.md` |
| `.codestable/work/2026-10-07-sidrune-model-plaza.md` | `codestable-history/2026-10-07-sidrune-model-plaza.md` |
| `.codestable/work/2026-10-08-aiapi-model-prices.md` | `codestable-history/2026-10-08-aiapi-model-prices.md` |
| `.codestable/work/2026-10-08-nexavlinks-model-market.md` | `codestable-history/2026-10-08-nexavlinks-model-market.md` |
| `.codestable/work/2026-10-08-true-sota-model-pricing.md` | `codestable-history/2026-10-08-true-sota-model-pricing.md` |

## Source cleanup

`.codestable/` was ignored local state. Deletion was deferred until the source/destination inventory and body comparisons passed. The only ignore rule removed was the dedicated `.codestable/` entry and its adjacent CodeStable comment; unrelated rules remain unchanged.
