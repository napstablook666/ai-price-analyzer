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
