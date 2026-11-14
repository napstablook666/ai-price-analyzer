# Pricing Data Contract

## Scenario: Station model-list comparison

This contract covers station pricing from collection through snapshots and dashboard comparison. OpenRouter reference data remains a separate official pricing pipeline.

## Signatures

- `prepareStationInput(stationInput = {})` returns a station prepared for collection and comparison.
- `cleanPricingRows(rows, options = {})` returns normalized pricing rows.
- `normalizePricingPayload(payload, format = "auto", options = {})` applies station model-list normalization after the selected parser.
- `currencyToRmb(currency, rechargeRate = 1)` returns the RMB conversion factor or `null` for an unconfirmed source currency.
- `getProxyPriceQuote(item, groupRatio = 1, rechargeRate = 1, basePrice = SYSTEM_BASE_PRICE_PER_1M, priceCurrencyVerified = true, rechargeRateVerified = true)` returns quote costs, source currency, and blocking reasons.

## Station preset registration

- Adding a pricing adapter or a pricing-host allowlist entry does not by itself make a station selectable. If the station should appear in the user's station list, register its preset through the persisted station registration and upgrade-migration flow, and test that existing lists are backfilled idempotently.
- Do not change the established empty-list default as a side effect of registering a station.
- This observed rule applies to new pricing stations and reports that an implemented adapter is missing from the selectable list. It does not apply to standalone check-in presets, which have their own display flow.
- Evidence: this task's migration map retains the original lesson path and evidence inventory; `extension/src/core/adapters.js`, `extension/src/core/station-presets.js`, `extension/src/core/collectors.js`, `extension/src/core/normalizers.js`, `extension/src/service-worker.js`, and `extension/test/core.test.js`.

## Contracts

- Every ordinary station model list uses the project's business unit `CREDITS`, regardless of raw `$`, `¥`, `USD`, CNY, or missing labels.
- `prepareStationInput()` canonicalizes every station's model-list unit to `{ priceCurrency: "CREDITS", priceCurrencyVerified: true }`. Collection passes `modelListCurrency: "CREDITS"`, so this is also the comparison unit for KillAI, fuck-everyone, and ordinary stations.
- Protected providers retain the legacy recharge-rate verification field: explicit `rechargeRateVerified: true` is preserved; missing or false remains unconfirmed for compatibility, but neither state blocks comparison. Currency is not protected independently of the model-list unit.
- `rechargeCurrency` is only the payment currency used to derive a station's `rechargeRate`; it never supplies a model-list source currency.
- With station collection option `modelListCurrency: "CREDITS"`, normalized rows use `price_currency: "CREDITS"` for ordinary and protected providers alike.
- Without `modelListCurrency`, generic parser calls preserve explicit source markers after trimming and uppercasing; missing or blank markers remain `UNKNOWN`. This parser behavior does not establish a trusted currency for station comparison.
- An explicit `priceCurrencyVerified: false` keeps the raw source marker for generic normalization when no `modelListCurrency` override is present; do not bypass this guard globally.
- `currencyToRmb()` returns `null` for an empty value, `UNKNOWN`, `UNSPECIFIED`, `NONE`, or unsupported currency. CNY/RMB symbols use factor `1`; USD/CREDITS/POINTS use the effective recharge rate selected by comparison.
- `getProxyPriceQuote()` adds `currency_unverified` when conversion is unavailable or `priceCurrencyVerified === false`. It must not globally ignore the false flag.
- In comparison, only `rechargeRateVerified === true` uses the configured recharge rate; false or missing verification uses factor `1`. Recharge verification never creates an unavailable reason.
- Runtime dashboard comparison and refresh scheduling must use the same prepared station shape. A station false value must not survive for an ordinary provider in one path while being repaired in the other.
- `GET_DASHBOARD` retains all prepared station metadata in `stations`, but latest snapshots, comparisons, and summary must be built only from stations where `enabled === true`; disabled cached snapshots cannot create offer rows or verification reasons.
- Dashboard comparison prioritizes station-level recharge state over snapshot metadata. A persisted station `rechargeRateVerified: true` overrides stale snapshot `false` and uses the configured rate; station false or missing state uses `1:1`, regardless of stale snapshot confirmation.
- `REFRESH_PREFLIGHT` checks only enabled page-mode stations whose provider request policy requires page credentials. Use a read-only GET through the existing page bridge; do not run collection, refresh page credentials, write snapshots, or read the extension's stored station credentials. Direct public API stations bypass the login check.
- Preflight may close a station tab only when this extension's preflight created it and the session check is ready. Reused tabs and tabs needing login or manual review remain open.
- `REFRESH_ALL` requires an unexpired one-use preflight confirmation. Preflight results never change currency or recharge verification flags; currency verification and other pricing availability checks remain authoritative.
- `NORMALIZATION_VERSION` changes whenever old normalized snapshots could encode a different trust decision. Version `24` is required after ordinary stale verification repair; `snapshotNeedsRefresh()` rejects older versions.
- Raw official OpenRouter API reference prices remain USD. Comparison maps the same numeric USD-credit value 1:1 to `CREDITS` and computes RMB benchmark cost separately with the configured `openRouterRechargeRate`. OpenRouter purchase fees are not model prices.
## Public comparison mode

### 1. Scope / Trigger

- Trigger: the dashboard must compare paid proxy stations separately from public model-list stations while preserving the existing paid comparison pipeline.
- This contract covers `comparisonMode` persistence, public-only derived rows, station-level collection errors, and anonymous public presets.

### 2. Signatures

- `normalizeSettings(settings = {})` returns `comparisonMode: "paid" | "public"`, defaulting invalid or missing values to `"paid"`.
- `filterComparisonsByMode(comparisons, mode)` keeps `comparisonGroup === "public"` for public mode and excludes it for paid mode.
- `saveComparisonMode(mode)` persists only the two supported modes and returns dashboard data rebuilt with the selected mode.

### 3. Contracts

- Public presets use `category: "public"`, `auth.type: "none"`, `credentials: "omit"`, no authorization header, and `rechargeRateVerified: false`; their model-list rows remain `CREDITS` and use the existing unconfirmed 1:1 comparison fallback.
- WindHub uses `GET https://windhub.cc/api/pricing` with explicit response format `windhub`. Preserve `group_ratio`, `cache_ratio`, `completion_ratio`, vendor, usable-group, and supported-endpoint metadata; apply each multiplier once and keep missing optional prices `null`.
- A WindHub `success: true` envelope with no valid normalized model rows is an error snapshot (`status: "error"`), not an empty successful catalog, so the dashboard can show a station-level failure.
- Linux.do Marketplace is a public page-mode preset. It reads `POST /admin/graphql` only through the page bridge, injecting `localStorage["axonhub_access_token"]` as a Bearer header in page world; never guess anonymous endpoints or use extension credentials. Refresh preflight uses safe `GET /admin/system/price-version` with the same page auth and never runs GraphQL pricing queries. Detail queries explicitly request the verified `channel.enabled` and `channel.public` fields; false values are filtered, while missing state is retained only with an `unknownChannelStates` diagnostic.
- Linux.do collection first queries `marketplaceModels`, then sends `marketplaceModel(modelID: $modelID, window: $window)` with `{ modelID, window: "LAST_7D" }`; detail work is bounded to four concurrent requests. A detail is eligible only when its non-empty `modelID` exists in the catalog; missing and unlisted IDs are skipped and recorded as `detail:modelID:missing` or `detail:modelID:unlisted`.
- Known price items map `prompt_tokens` to input, `completion_tokens` to output, `prompt_cached_tokens` to cache-read, and `prompt_write_cached_tokens` to cache-write. Each value is `pricing.usagePerUnit * item.multiplier` exactly once; non-finite, negative, or overflowing values are rejected. `channel_multiplier` is metadata only and is populated only when all known item multipliers agree.
- Partial detail failures retain valid rows and expose sanitized `failedModels`, `failedModelCount`, and `failedModelReasons` diagnostics. Reasons contain only a model ID and a bounded redacted summary; access tokens, authorization headers, request bodies, and complete responses never enter snapshots or diagnostics.
- Public dashboard mode filters rows, station facets, summaries, sort choices, headers, reference status, empty state, and station errors from the same mode-specific source. It hides official-price, monthly-cost, diff, recommendation, and paid-only model-match controls.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Missing or invalid `comparisonMode` | Persist/use `paid` |
| Public mode | No paid comparison row, paid facet, official-price result, or recommendation difference is rendered |
| Public request failure | Show a station-level error and keep paid mode usable |
| WindHub invalid model price or malformed envelope | Preserve existing partial diagnostics; never coerce the value to zero |
| Linux.do endpoint still unconfirmed | Explicit collection failure; no anonymous fallback guessing or credential forwarding |
| Linux.do channel `enabled`/`public` is false | Filter the channel before normalization; never emit its prices |
| Linux.do channel state is missing | Keep a valid-price row only with `unknownChannelStates` diagnostic; do not silently claim public/enabled |
| Linux.do detail `modelID` missing or absent from catalog | Skip the detail and record a stable `invalidPricingValues` diagnostic; never emit an unlisted model |
| Linux.do known item price or `usagePerUnit * multiplier` is non-finite, negative, or overflowing | Reject that item/channel and expose a partial diagnostic; never coerce to `0` or `1` |
| Linux.do detail request fails while other models are valid | Keep valid rows and expose sanitized `failedModels` / `failedModelReasons`; if all details fail, return a station-level error |

### 5. Good/Base/Bad Cases

- Good: switching to public mode rebuilds the station filter from public rows, persists across dashboard reload, and displays the site-unit/1:1 notice.
- Base: a disabled public station remains editable in settings but cannot contribute snapshots, rows, or error counts to dashboard comparison.
- Bad: only hiding paid columns while leaving paid rows in the result, treating a Linux.do page URL as its API, or applying WindHub group/cache/output multipliers twice.

### 6. Tests Required

- Assert mode defaulting, persistence, row isolation, public-only station facets, public empty state, hidden paid controls, accessible `aria-pressed` state, and reduced-motion CSS coverage.
- Assert public preset registration is idempotent, requests omit extension credentials and authorization, WindHub metadata/multipliers/cache fields survive normalization, and Linux.do uses explicit GraphQL fixtures with bounded detail concurrency, page-session diagnostics, and `enabled`/`public` channel filtering.
- Assert catalog membership for detail IDs, missing/unlisted-ID diagnostics, overflow rejection, known-item multiplier agreement, and redacted `failedModelReasons` in both normalized output and snapshot `rawMeta`.
- Assert station-level error snapshots are visible only in the matching mode and disabled stations cannot create comparison rows.

### 7. Wrong vs Correct

#### Wrong

```js
const visibleRows = allRows;
paidColumns.hidden = mode === "public";
```

This leaks paid offers into public mode and makes summaries/facets inconsistent.

#### Correct

```js
const modeRows = filterComparisonsByMode(allRows, state.comparisonMode);
renderSummary(modeRows);
renderFacetFilters(modeRows);
renderRows(modeRows);
```

The mode boundary must be applied before every derived dashboard projection.


## TokenFlux Public Pricing

### 1. Scope / Trigger

- Trigger: a selectable public pricing station reads TokenFlux's anonymous pricing API.
- This contract covers `https://tokenflux.cloud/pricing` and `GET /api/pricing`; no login or extension credential is supported.

### 2. Contracts

- The explicit response format is `tokenflux`; a valid envelope has `success: true`, a flat `data` array, and top-level `group_ratio`.
- Token rows use `model_ratio` as CNY per million input tokens and `completion_ratio` as the output/input multiplier. Apply the selected group's `group_ratio` once to input, output, and cache-read prices.
- `create_cache_ratio` is the only source for `cache_write_price`; missing values remain `null`.
- A positive `model_price` with `quota_type: 1` emits `request_price`; a positive `model_price` with `image-generation` emits `image_price`. These rows keep token prices empty.
- `tiered_expr` and `billing_expr` are out of scope. Skip the model, add its mode to `unsupportedBillingModes`, and mark the result `incomplete` without dropping other valid rows.
- Collection assigns rows to `CREDITS`; `rechargeRateVerified` remains false, so comparison uses the existing 1:1 recharge fallback.

### 3. Validation & Tests

- Reject failed or malformed envelopes through the explicit format guard; skip individual rows with missing names or non-finite required values.
- Test the exact public endpoint, omitted credentials, group multiplier, cache fields, image/request fields, unsupported tiered diagnostics, and idempotent preset registration.

## all-in-one.icu Tenant Model Pricing

### 1. Scope / Trigger

- Trigger: a login-required tenant model page adds a selectable station adapter for `https://all-in-one.icu/#/tenant/models`.
- This contract covers the authenticated page request and token/tiered model-list normalization; it does not implement site login or persist site credentials.

### 2. Signatures

- `prepareStationInput(stationInput = {})` matches the `all-in-one.icu` hostname and `#/tenant/models` hash route.
- `collectStation(station, { fetchImpl = fetch, pageFetch, collection } = {})` uses the page bridge for the tenant catalog.
- `normalizePricingPayload(payload, format = "auto", options = {})` dispatches explicit format `all-in-one-models` to `AllInOneModelsStrategy`.

### 3. Contracts

- Request `GET /api/tenant/models` from the same-origin page with `credentials: "include"`; page auth reads only `localStorage.tenant_access_token` and injects `Authorization: Bearer <token>`. Extension station auth and user passwords must not cross the bridge.
- The token is a flat JWT string, so the policy must not declare `storagePaths`. When the user signs in without "remember me" the site writes the same keys to `sessionStorage`; the page bridge therefore falls back to `sessionStorage` for both the access token and the refresh token.
- The provider must skip the unauthenticated DOM/captured-response shortcut and make the authenticated page request. Missing token or HTTP 401/403 is a page-session failure; there is no anonymous fallback.
- Tab resolution matches `pageUrl` first, then the active same-origin tab when the plugin declares `reuseAmbiguousOriginTab`. Several stale same-origin tabs (a leftover login page, a dashboard page) must not turn into the "not logged in" hint. Plugins without the flag keep rejecting ambiguous origins so multi-account stations never read another account's prices.
- The explicit response envelope is `{ code: 0, data: { list: Model[] } }`; compatibility list wrappers are accepted only by `all-in-one-models`, never by generic auto detection.
- `billing_mode: "token"` and tier values are already per-million prices; preserve them as provided. `billing_mode: "tiered"` emits one row per `pricing_tiers` item and preserves `min_tokens`, `max_tokens`, and tier labels. Cache read/write aliases map to the existing normalized cache fields.
- Invalid or missing prices, malformed tier objects/bounds produce existing partial diagnostics and never fabricate zero or model-level fallback prices. A tier without `tier_label` derives its name from `min_tokens`/`max_tokens` (`0-100K`, `100K 以上`) so sibling tiers never share a row label. `billing_mode: "per_request"` emits one row carrying `request_price` from `per_request_price` with `input_price`/`output_price` kept null. Modes with no mapping (`per_second`, `special`) land in `unsupportedBillingModes`. Rows are `CNY`: the tenant quotes in its `billing_currency` setting (CNY today), so `preservePriceCurrency` keeps the preset currency instead of the `CREDITS` fallback; recharge verification remains unconfirmed.

### 4. Validation & Error Matrix

| Condition | Normalized / collection result |
|---|---|
| Logged-in page with valid `tenant_access_token` | Authenticated GET and token/tiered rows |
| Missing token or 401/403 | Page-session failure; no capture or anonymous fallback |
| Generic `{ data: { list: [...] } }` without explicit format | Not classified as all-in-one |
| Invalid price or tier boundary | `invalidPricingValues` / `unpricedModels`; no fabricated row |
| Unsupported billing mode | `unsupportedBillingModes`, partial result, no token row |
| Valid model rows | `price_currency: "CNY"`, no inferred USD recharge conversion |

### 5. Good/Base/Bad Cases

- Good: `input_price: 2` stays `2` per 1M; two valid tiers remain two rows with their own boundaries.
- Base: a missing optional cache price remains `null` while valid input/output prices are retained.
- Bad: using a stale captured response after the local-storage token disappears, flattening tiered prices to model-level values, or sending a configured station bearer token.

### 6. Tests Required

- Assert preset idempotence and unchanged empty-list registration, hash-route tab selection, exact endpoint, GET/include request, explicit response format, and absent extension authorization.
- Assert page auth configuration uses `tenant_access_token` and Bearer scheme; assert the provider skips pre-auth capture and delegates missing-token failure to the page bridge policy.
- Assert already-per-million token prices, cache aliases, multiple tier boundaries, malformed tiers, invalid prices, per-request rows, unsupported modes, explicit-format gating, CNY rows, and 1:1 recharge comparison.

### 7. Wrong vs Correct

#### Wrong

```js
if (pageFetch.supportsCapture) return pageFetch({ capture: true });
```

This can reuse stale page data without checking the current tenant token.

#### Correct

```js
if (requestStrategy.skipCapture !== true && pageFetch?.supportsCapture) {
  // use capture only for providers whose page policy permits it
}
```

The all-in-one provider sets `skipCapture: true`, so every collection goes through the local-storage-authenticated page request.

## SevenAI Model Plaza

### 1. Scope / Trigger

- Trigger: a selectable public model-plaza station adds a new endpoint and response profile that flows through collection, normalization, saved presets, and comparison.
- This contract covers the anonymous catalog only. Do not collect login-only groups or send station credentials.

### 2. Signatures

- `prepareStationInput(stationInput = {})` prepares SevenAI URLs through the provider registry.
- `collectStation(station, { fetchImpl = fetch, pageFetch, collection } = {})` collects the direct station response.
- `normalizePricingPayload(payload, format = "auto", options = {})` dispatches `sevenai-model-plaza` to `ModelPlazaStrategy`.

### 3. Contracts

- Match `sevenai.moe/model-plaza`; request `GET /api/v1/model-plaza?timezone=Asia%2FShanghai` with `credentials: "omit"`, no authorization header, and no page bridge.
- The verified envelope is `{ code: 0, data: { description, groups } }`. Each group supplies `name`, finite `rate_multiplier`, and `models`; each model supplies `name` and `pricing` with `billing_mode: "token"`. Preserve model pricing intervals and their `tier_label`, `min_tokens`, and `max_tokens`.
- API token prices are per token. Convert each price to per-million units and apply the group `rate_multiplier` exactly once. Use model-level pricing when no intervals are present.
- A missing, invalid, or whitespace-only `rate_multiplier` must not default to `1` or parse as zero. Mark the group multiplier invalid and do not emit its prices. Unsupported billing modes use the existing incomplete-result diagnostics.
- The page's USD display label does not establish a recharge conversion. Collection assigns ordinary model-list rows to `CREDITS`; keep `rechargeRateVerified` false so comparison uses the existing 1:1 fallback.

### 4. Validation & Error Matrix

| Condition | Normalized result | Comparison behavior |
|---|---|---|
| `code: 0`, finite group multiplier, token prices | Per-million rows with interval labels and group ratio | Usable `CREDITS` offers |
| Missing, invalid, or blank group multiplier | No rows for that group; `invalidPricingValues` and `unpricedModels` identify it | No fabricated zero-price or 1x offer |
| Unsupported `billing_mode` | Existing `unsupportedBillingModes` partial diagnostic | Unsupported model is not emitted as a token price |
| Public GET requires credentials unexpectedly | Standard request failure; request still sends no credentials | No credential fallback |
| Recharge rate unconfirmed | Station rows remain `CREDITS` | Compare with the existing 1:1 fallback |

### 5. Good/Base/Bad Cases

- Good: `input_price: 0.000002` and `rate_multiplier: 0.12` yields `0.24` per 1M; the group multiplier is applied once.
- Base: a model with no intervals produces one row from its model-level `pricing` values.
- Bad: defaulting a missing multiplier to `1`, accepting whitespace as numeric zero, multiplying the group ratio twice, or inferring recharge conversion from the USD display label.

### 6. Tests Required

- Assert the exact endpoint, GET method, `credentials: "omit"`, and absent authorization header.
- With the GROK fixture, assert both intervals remain separate and the `<200K` input/output/cache-read prices are `0.24`, `0.72`, and `0.036` per 1M after the `0.12` multiplier.
- Assert blank/missing group multipliers produce incomplete diagnostics and no priced model rows; assert unknown billing modes remain unsupported.
- Assert preset registration is idempotent for existing lists and does not alter the empty-list default.
- Assert collected rows are `CREDITS` and an unconfirmed recharge ratio remains usable at 1:1.

### 7. Wrong vs Correct

#### Wrong

```js
groupMultiplier: group => finitePrice(group?.rate_multiplier) ?? 1
```

This turns a missing group rate into a plausible but unverified price multiplier.

#### Correct

```js
groupMultiplier: group => {
  const value = group?.rate_multiplier;
  return typeof value === "string" && !value.trim() ? null : finitePrice(value);
}
```

A missing or malformed multiplier then follows the existing invalid-pricing diagnostic path instead of creating a misleading offer.

## KillAI Model Plaza

### 1. Scope / Trigger

- Trigger: the KillAI model plaza reports `per_request` as unsupported and must expose its request-priced models to station comparison.
- This contract covers the existing authenticated page collection and normalization boundary; it does not change API access, page authentication, or billing algorithms.

### 2. Signatures

- `prepareStationInput(stationInput = {})` prepares `https://api.killai.cc/model-plaza?embedded=1` as a page-mode station.
- `collectStation(station, { fetchImpl = fetch, pageFetch, collection } = {})` reads the response through the logged-in page session.
- `normalizePricingPayload(payload, format = "auto", options = {})` dispatches `killai-model-plaza` to `ModelPlazaStrategy`.

### 3. Contracts

- Keep `GET /api/v1/model-plaza?timezone=Asia%2FShanghai`, response format `killai-model-plaza`, and the existing page-session auth policy. Do not send extension credentials directly or fall back to anonymous access.
- The response envelope is `{ code: 0, data: { description, groups } }`. A request-priced model uses `pricing.billing_mode: "per_request"` and `per_request_price` or the compatibility alias `request_price`.
- Emit the amount as `request_price` without per-million conversion. Apply the group's `rate_multiplier` exactly once during normalization; for example, `0.2 * 1.5 = 0.3` per request.
- Request rows have no token or image prices (`input_price`, `output_price`, cache prices, `image_input_price`, `image_output_price`, `image_price`). Do not alter existing token intervals or image-price handling.
- Collection assigns ordinary model-list rows to `CREDITS`; keep `rechargeRateVerified` false so comparison uses the existing 1:1 fallback unless explicitly confirmed.
- Anonymous API access returns `401 Authentication required` and is not a supported collection path.

### 4. Validation & Error Matrix

| Condition | Normalized result | Collection / comparison behavior |
|---|---|---|
| Authenticated response with valid `per_request` price | One `request_price` row, group multiplier applied once, no unsupported-mode diagnostic | Complete snapshot; request charge is comparable in CREDITS |
| `per_request` has neither valid request-price field nor image price | Existing `unpricedModels` diagnostic | Snapshot is partial; no fabricated zero price |
| Unknown non-token billing mode | Existing `unsupportedBillingModes` diagnostic | Unsupported model is not emitted |
| Invalid request-price value | Existing invalid-price validation path | Reject invalid page response; do not coerce it to zero |
| API request lacks the page session | `401 Authentication required` | Collection fails without anonymous or extension-credential fallback |

### 5. Good/Base/Bad Cases

- Good: `{ billing_mode: "per_request", per_request_price: 0.2 }` in a group with `rate_multiplier: 1.5` emits `request_price: 0.3`.
- Base: existing token intervals and image rows are unchanged; request rows keep token and image fields empty.
- Bad: omitting the profile mapping, converting a per-request amount to per-million units, applying the group multiplier twice, or bypassing the authenticated page request.

### 6. Tests Required

- Assert the page mode, endpoint, GET method, `killai-model-plaza` format, and existing page-session auth fields remain unchanged; extension Authorization stays absent.
- Assert both `per_request_price` and `request_price` compatibility inputs emit `request_price`; the fixture's `0.2` price with multiplier `1.5` is approximately `0.3`.
- Assert request-row token and image prices are empty, the supported fixture has no `unsupportedBillingModes` and is not incomplete, and existing token interval/image assertions remain.
- Assert the collected request row is CREDITS and does not introduce a recharge-verification reason.

### 7. Wrong vs Correct

#### Wrong

```js
nonTokenBilling: Object.freeze({ image: "image" })
```

`per_request` then falls through to the unsupported billing-mode diagnostic.

#### Correct

```js
nonTokenBilling: Object.freeze({ image: "image", per_request: "request" })
```

This reuses the shared request-price parser and KillAI's existing group-multiplier callback.

## Validation & Error Matrix


| Condition | Prepared/normalized value | Comparison result |
|---|---|---|
| Ordinary registered station | `priceCurrency=CREDITS`, verified | CREDITS row converted with station recharge rate |
| Ordinary unregistered station | `priceCurrency=CREDITS`, verified | CREDITS row converted with station recharge rate |
| Protected provider with stale false/missing currency flag and model-list collection | `CREDITS`, verified | Currency does not block; an unconfirmed recharge ratio uses `1:1` |
| Missing/blank raw currency on ordinary station | `CREDITS` | Converted with the effective recharge rate |
| `rechargeRateVerified: false` or missing in comparison metadata | Preserve legacy station flag when present | Use factor `1`; no recharge verification reason |
| `rechargeRateVerified: true` with configured rate `1.2` | Preserve station flag | Convert CREDITS/USD/POINTS prices with factor `1.2` |
| Raw OpenRouter reference price | `USD` | Preserve API semantics |
| OpenRouter comparison quote | `CREDITS` | Numeric USD-credit value stays 1:1; RMB cost is separate |
| Enabled station with station `rechargeRateVerified: true` and snapshot `false` | Station `true` wins | Use configured rate; no recharge verification reason |
| Disabled station with a cached snapshot | Retain station metadata | Omit snapshot, comparisons, summary offer, and verification-reason counts |

## Good/Base/Bad Cases

- Good: a stale ordinary station with `priceCurrencyVerified: false` is prepared as CREDITS/true before refresh and dashboard comparison.
- Good: `{ input_price: 2, price_currency: "USD" }` becomes `price_currency: "CREDITS"` at an ordinary station model-list boundary.
- Good: stale KillAI/fuck-everyone currency flags normalize to CREDITS/verified because collection already applies `modelListCurrency: "CREDITS"`; an unconfirmed recharge ratio is compared at 1:1, while an explicit true flag uses the configured ratio.
- Good: `GET_DASHBOARD` returns a disabled station in `stations` for editing but excludes its cached snapshot from comparison rows and reason counts.
- Bad: passing every prepared station into dashboard snapshot lookup and comparison because refresh scheduling already filters disabled stations; this leaves stale disabled offers visible.
- Bad: a stale protected-provider currency flag produces `currency_unverified` after its collected rows are already normalized to CREDITS.
- Bad: changing `getProxyPriceQuote()` to ignore every `priceCurrencyVerified: false` for generic or unsupported source currencies.
- Bad: treating an unconfirmed recharge ratio as a reason to exclude the station or using a stale configured ratio instead of 1:1.
- Bad: treating recharge USD/CNY as the source unit of a model row.

## Tests Required

- Test array, `data`, and `models` generic payloads without station options preserve explicit source markers and keep missing/blank markers `UNKNOWN`; the station collection boundary overrides ordinary rows to CREDITS.
- Test T蜜 and another ordinary station with stale false input through preparation, collection, snapshot, and comparison; assert usable RMB costs.
- Test an unregistered ordinary station receives CREDITS/true.
- Test KillAI/fuck-everyone collection applies CREDITS and preparation repairs false/missing currency flags before comparison; false/missing recharge verification uses 1:1, while explicit confirmation uses the configured rate.
- Test `currencyToRmb()` for missing, blank, unknown, unsupported, CNY, USD, CREDITS, and POINTS.
- Test both `currency_unverified` branches and assert recharge verification never creates an unavailable reason.
- Test `GET_DASHBOARD` with false, missing, and true station recharge flags plus stale snapshot metadata; assert unconfirmed ratios use 1:1, confirmed ratios use their configured value, and flattened rows contain no recharge verification reason.
- Test OpenRouter raw USD reference and 1:1 comparison CREDITS mapping without purchase fees.
- Test that an older normalization version requires snapshot refresh.

## Wrong vs Correct

### Wrong

```js
const code = String(currency || "USD").toUpperCase();
```

This turns a missing source into a false USD claim.

### Correct

```js
const code = String(currency ?? "").trim().toUpperCase();
if (!code || ["UNKNOWN", "UNSPECIFIED", "NONE"].includes(code)) return null;
if (["CNY", "RMB", "¥", "￥"].includes(code)) return 1;
if (!["USD", "CREDITS", "POINTS"].includes(code)) return null;
```

The station contract establishes CREDITS before comparison, while protected provider state remains an explicit blocking decision.

## ai.centos.hk Public Paid-Site Pricing

### 1. Scope / Trigger

- Trigger: a selectable paid station reads the public pricing page `https://ai.centos.hk/pricing`.
- The pricing page is anonymous and its verified API is `GET https://ai.centos.hk/api/pricing`; no login, station token, or extension credential is supported.

### 2. Contracts

- Match only hostname `ai.centos.hk` with path `/pricing`. Prepare the station as `direct`, `auth.type: "none"`, and explicit response format `tokenflux`; do not expand this match to other New-API sites.
- Because `stationContext()` strips a leading `www.` for shared matching, this provider also checks the raw URL hostname; `https://www.ai.centos.hk/pricing` remains unsupported.
- Request exactly `/api/pricing` with `GET` and `credentials: "omit"`. The request must not contain `Authorization`, `X-API-Key`, or any bearer/API-key token from station configuration.
- Reuse `TokenFluxPricingStrategy` through the explicit `tokenflux` format. The verified response is the New-API success envelope with `success: true`, a flat `data` array, `group_ratio`, and group/model billing fields.
- Token rows preserve input/output/cache relationships and apply the selected `group_ratio` exactly once. `quota_type: 1` request rows and `image-generation` rows reuse the existing request/image mapping and keep token fields empty.
- `billing_mode: "tiered_expr"` and `billing_expr` remain unsupported. Skip those rows, add the existing `unsupportedBillingModes` diagnostic, and mark the normalized result incomplete without fabricating token prices.
- Collection assigns normalized model-list rows to `CREDITS`; the page's RMB display and group multipliers do not verify recharge conversion. Preserve `rechargeRateVerified: false` so comparison uses the existing unconfirmed 1:1 fallback.

### 3. Validation & Tests

- Assert provider matching and preparation for `/pricing`, rejection of other paths, exact `/api/pricing` URL, `GET`, omitted credentials, no authorization headers, and explicit `tokenflux` response selection.
- With a redacted New-API fixture, assert token input/output/cache values, request and image rows, one-time group multiplication, `CREDITS` rows, unsupported tiered diagnostics, and unconfirmed recharge state.
- Assert the `ai.centos.hk` preset is backfilled through the registered-provider migration, repeated host registration is idempotent, an ID collision receives the existing unique suffix, and an empty station list remains empty.

### 4. Good/Base/Bad Cases

- Good: a token row with `model_ratio: 0.4`, `completion_ratio: 2`, and group ratio `1` yields `0.4` input and `0.8` output CREDITS per million tokens; a group ratio `4.5` yields `4.5` input and `13.5` output when applied once.
- Base: valid request/image rows remain special-priced rows with empty token prices, while valid token rows remain comparable.
- Bad: forwarding a saved bearer token, using the page URL as the API endpoint, treating RMB display as a verified recharge rate, multiplying `group_ratio` twice, or flattening `tiered_expr` into ordinary token pricing.


## Grouped refresh-all scope

### 1. Scope / Trigger

- Trigger: the dashboard's “刷新全部” action must refresh only the currently selected `comparisonMode` group while preserving the existing single-station refresh path.
- This contract covers service-worker scope selection, preflight confirmation, progress metadata, snapshot/error visibility, and dashboard/popup feedback for `paid` and `public` groups.

### 2. Signatures

- `refreshScope(stations, comparisonMode)` normalizes the mode and returns `{ comparisonMode, comparisonLabel, stationCount, stations }`.
- `refreshStationSignature(stations, comparisonMode = "paid")` signs the normalized mode and enabled station configuration; `assertRefreshConfirmation(preflight, confirmation, stations, comparisonMode, now)` rejects a stale or mismatched scope.
- `REFRESH_PREFLIGHT` returns `comparisonMode`, `comparisonLabel`, `stationCount`, `results`, `token`, `expiresAt`, and `stationSignature`.
- `REFRESH_ALL` accepts only the one-use preflight token and `confirmed: true`; it does not accept a frontend station-ID list.

### 3. Contracts

- The service worker is authoritative. The refresh-all set is exactly `station.enabled === true && station.category === comparisonMode`; the frontend cannot widen it with filters or submitted IDs.
- The same set must be used for page-session preflight, confirmation signature, collection, progress totals, error snapshots, completion summaries, and refresh metadata. `REFRESH_STATION` remains `stationId`-scoped and independent of comparison mode.
- `paid` uses the label `付费中转站`; `public` uses `公益站`. Empty groups return `stationCount: 0` and an empty result list; confirmation is disabled and the service worker returns `REFRESH_NO_STATIONS` without refreshing references, collecting, or writing snapshots.
- Mode changes, station saves, settings changes, imports, and any signed station configuration change invalidate the stored preflight. Dashboard data exposes only the current mode's snapshots, errors, comparisons, and summary while retaining the other mode's records in storage.
- An asynchronous `REFRESH_PREFLIGHT` must capture the service-worker preflight revision, comparison mode, and scoped station signature before page probes, then revalidate all three immediately before publishing or persisting a token. A stale request returns `REFRESH_CONFIRMATION_REQUIRED` and cannot republish the old token.

### 4. Validation & Error Matrix

| Condition | Required result |
|---|---|
| Enabled station in current category | Included in preflight and refresh exactly once |
| Enabled station in the other category | Excluded from preflight, collection, progress, errors, and new snapshots |
| Disabled station, including non-boolean `enabled` values | Excluded from every refresh-all and scheduler collection set |
| Mode or signed station configuration changes after preflight | `REFRESH_CONFIRMATION_REQUIRED`; require a new preflight |
| Current group has no enabled stations | `REFRESH_NO_STATIONS`; no reference refresh, collection, progress, or snapshot write |
| Single-station refresh | Continue using the selected enabled `stationId`, regardless of current comparison mode |

### 5. Good/Base/Bad Cases

- Good: public mode preflights one enabled public station, reports `公益站` and `stationCount: 1`, and passes only that prepared station to the scheduler.
- Base: paid and public snapshots remain stored together, but each dashboard mode returns only its own snapshot/error projections.
- Bad: passing all enabled stations to `REFRESH_PREFLIGHT` and filtering only table rows afterward, trusting frontend station IDs, or letting an empty group trigger official-reference refresh.

### 6. Tests Required

- Assert paid/public preflight and collection sets, disabled-station exclusion, group labels/counts, progress totals, completion metadata, and no cross-group snapshots or errors.
- Assert mode/config changes invalidate one-use tokens, empty groups do not call reference refresh or collection, and concurrent confirmation cannot consume a token twice.
- Assert dashboard mode switching preserves the other group's stored history and `REFRESH_STATION` still refreshes the selected enabled station outside the current group.

### 7. Wrong vs Correct

#### Wrong

```js
const stations = (await getPreparedStations()).filter(station => station.enabled);
return runRefreshAll({ preparedStations: stations });
```

This refreshes the hidden comparison group and relies on the UI to hide the leak.

#### Correct

```js
const scope = refreshScope(await getPreparedStations(), settings.comparisonMode);
assertRefreshConfirmation(preflight, message, scope.stations, scope.comparisonMode);
return refreshAll({ preparedStations: scope.stations, refreshMetadata: scope });
```

The service worker computes and revalidates one authoritative group before dispatching collection.
