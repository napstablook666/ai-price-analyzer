# SevenAI Model Plaza Implementation Plan

Task approved and activated; implementation and verification are complete. This plan is retained as the execution record.

## Checklist

- [x] Add the SevenAI endpoint constant, host/path matcher, direct no-auth request policy, and selectable preset in `extension/src/core/provider-registry.js`.
- [x] Add a dedicated `sevenai-model-plaza` response-format definition and profile, reusing `ModelPlazaStrategy` without changing existing provider profiles.
- [x] Add a fixture-driven regression test in `extension/test/core.test.js` for preset registration/backfill, URL preparation, credential-free GET collection, two interval tiers, group-rate scaling, and CREDITS comparison.
- [x] Update the registry preset expectation and retain coverage for the unchanged empty-list default and other providers.
- [x] Run `npm --prefix extension test`; address failures without broadening scope.
- [x] Perform an independent read-only review of the implementation, resolve actionable findings, and rerun the suite.
- [x] Update `.trellis/spec/frontend/pricing-data-contract.md` with the verified SevenAI endpoint, anonymous-request policy, tier/group fields, and unverified recharge-rate boundary.
- [x] Review the final diff and commit only task-owned changes, preserving unrelated worktree changes.

## Acceptance Checks

- The fixture's `grok-4.5` `<200K` tier normalizes to input `0.24`, output `0.72`, and cache-read `0.036` per 1M after the `0.12` group multiplier; the second interval remains a separate tier.
- The collection request is exactly `GET /api/v1/model-plaza?timezone=Asia%2FShanghai`, uses `credentials: "omit"`, and sends no authorization header.
- Model-list rows are `CREDITS`; no verified recharge conversion is introduced.
- Existing registered presets are unchanged except for SevenAI, and the empty-list default remains unchanged.

## Validation Command

Run from the repository root:

```text
npm --prefix extension test
```

## Rollback

Revert only the SevenAI-owned provider, response-format, normalizer-profile, test, and spec hunks if validation or review exposes a regression. Do not revert unrelated user changes.
