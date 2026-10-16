# Implementation Plan

## Ordered Checklist

1. [x] Update `extension/src/service-worker.js` so `dashboard()` keeps all prepared stations for response metadata but filters `enabled` stations before latest-snapshot lookup and comparison aggregation.
2. [x] Extend `extension/test/refresh-preflight.test.js` with two explicitly confirmed protected stations whose snapshots carry stale false metadata plus a disabled protected station carrying exactly 125 rows; assert the enabled offers have zero `recharge_unverified` reasons and the disabled rows cannot affect comparisons, snapshots, or summary count.
3. [x] Run the focused service-worker regression test and inspect the failure output before changing any other code.
4. [x] Run the complete extension test command and review the final diff for accidental changes to recharge/currency protection.
5. [x] Run the Trellis quality check, update `.trellis/spec/frontend/pricing-data-contract.md` with the enabled-station dashboard boundary and station-first verification precedence, then commit and archive the task after explicit implementation approval.

## Validation Commands

- Focused: `node --test extension/test/refresh-preflight.test.js`
- Full: `npm --prefix extension test`
- Diff review: `git diff -- extension/src/service-worker.js extension/test/refresh-preflight.test.js`
- Final task check: `python ./.trellis/scripts/task.py current && python ./.trellis/scripts/get_context.py --mode phase --step 2.2`

## Risk and Rollback Points

- Risk: filtering the returned station list would hide disabled stations from options. Keep full station metadata in the response and filter only comparison inputs.
- Risk: filtering pricing logic instead of the dashboard boundary would weaken real protected-provider verification. Do not modify `getProxyPriceQuote()`, `prepareStationInput()`, or provider registry rules.
- Risk: a dashboard tab already open while options saves may retain old in-memory rows until `GET_DASHBOARD` runs again. The test and acceptance check explicitly reload the dashboard data path.
- Rollback: revert the `dashboard()` station-selection change and the single regression fixture/test block; no persisted data is changed.

## Completion Gate

- `prd.md`, `design.md`, and this `implement.md` are complete.
- `implement.jsonl` and `check.jsonl` contain real curated context entries.
- Blocking open questions are empty.
- Planning approval was received before `task.py start`; implementation, quality check, and spec update are complete. Commit and archive are finalization steps.
