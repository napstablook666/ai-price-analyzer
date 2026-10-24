# SevenAI Model Plaza Integration Design

## Data Flow

The station URL is recognized by `PROVIDER_REGISTRY`, prepared as a direct station, and collected through the existing request strategy. The explicit `sevenai-model-plaza` response format routes the response through the existing `ModelPlazaStrategy`. Normalized rows continue through the established model-list currency and comparison boundary.

## Provider and Request

- Match the normalized hostname `sevenai.moe` and path `/model-plaza`.
- Keep the station URL at `https://sevenai.moe/model-plaza?embedded=1` and use direct collection.
- Request `GET /api/v1/model-plaza?timezone=Asia%2FShanghai` with `credentials: "omit"`, no auth configuration, and no page bridge.
- Register a normal station preset so the existing `addRegisteredStationPresets()` and `ensureStationPresets()` flow backfills it once into non-empty saved lists. Do not change empty-list defaults.

## Normalization

- Add a dedicated `sevenai-model-plaza` response format and profile, leaving existing provider profiles unchanged. Set `currency: null`, `intervalMode: "all"`, `groupMultiplier` from a finite `rate_multiplier` only, and `nonTokenBilling: Object.freeze({})` so unexpected modes use the existing unsupported/incomplete diagnostics.
- Require the existing `{ code: 0, data.groups: [...] }` envelope. For each group, use `name` and `rate_multiplier`; for each model, use `name` and `pricing`.
- Preserve all `pricing.intervals` and their `tier_label` values. The observed rates are per token; normalize to per-million prices and apply the group `rate_multiplier` once. Base prices with no intervals use the model-level `pricing` fields.
- Do not assert a source currency from the page label. Collection's existing station boundary assigns `CREDITS` to ordinary model-list rows. Do not set a verified recharge conversion; the existing unconfirmed-rate comparison behavior remains in effect.

## Compatibility

- Do not edit the shared empty-list default, existing providers, or comparison conversion logic.
- Existing stored user stations remain intact. The registered preset is appended only when that host is absent; ID collision handling and idempotency remain provided by the shared preset helper.
- The public response contains no login-only personal groups. No account credentials are read or sent.

## Verification Focus

Use a fixed response fixture based on the observed API envelope, including the `GROK` group and both `grok-4.5` intervals. Assert the tier labels, group multiplier, per-million prices, and `CREDITS` comparison row. Exercise URL preparation and collection with a mocked response, asserting the exact endpoint, GET method, omitted credentials, and absent authorization header. Cover preset backfill and empty-list behavior through the existing registry-preset tests.
