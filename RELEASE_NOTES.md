# AI Price Analyzer v0.2.0

This release expands the Chromium MV3 extension from its initial release into a multi-station pricing and account workflow.

## Added

- Multi-station scheduled collection with IndexedDB snapshots, manual refresh, pagination, sorting, filtering, and collapsible dashboard sections.
- Daily check-in support for stations that expose claim and status APIs, including optional alarms.
- JEV-assisted model matching with user-confirmed mappings and refresh-safe batch processing.
- Pricing adapters for AIAPI, CheapRouter, CUN.AI, DDDai, Liuguang, NexaVlinks, Sidrune, and TrueSOTA.
- Token, image, request, group-ratio, recharge-ratio, and monthly workload normalization across supported station formats.
- Page bridges that preserve required browser login state while keeping credentials out of extension messages and portable state.

## Validation

- `node --check` passed for the userscript and extension entry points.
- `node test-kbq-pricing.js` passed.
- `node --test extension/test/*.test.js` passed with 109 tests.
- CI and tag-driven release packaging remain unchanged.

## Privacy review

The release source was checked for common credential and private-key markers. No credentials are intentionally included. Review the repository and release assets before distributing site-specific pricing samples.
