# AI Price Analyzer v0.2.1

This release packages the current Chromium MV3 extension and the two-repository plugin workflow.

## Included

- Multi-station scheduled collection with IndexedDB snapshots, manual refresh, pagination, sorting, filtering, and collapsible dashboard sections.
- Direct endpoint and page-bridge collection modes for public and login-dependent stations.
- Station check-in support where a provider exposes claim and status APIs.
- Pricing normalization for token, image, request, group-ratio, recharge-ratio, and monthly-workload formats.
- Canonical model matching with plugin aliases and user-confirmed overrides.
- Standalone station plugin sources in [ai-price-analyzer-plugins](https://github.com/napstablook666/ai-price-analyzer-plugins).

## Validation

- `npm test` passed for the extension test suite.
- `node scripts/plugin-build.mjs --check` passed for the generated plugin runtime files.
- Extension entry points and the MV3 manifest were syntax-checked.

## Privacy review

The public source was checked for common credential and private-key markers. Do not add credentials, cookies, private responses, or account-specific URLs to source files, fixtures, issues, or release assets.
