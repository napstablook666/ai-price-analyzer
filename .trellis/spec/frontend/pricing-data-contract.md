# Pricing Data Contract

## Scenario: Station model-list comparison

This contract covers station pricing from collection through snapshots and dashboard comparison. OpenRouter reference data remains a separate official pricing pipeline.

## Signatures

- `prepareStationInput(stationInput = {})` returns a station prepared for collection and comparison.
- `cleanPricingRows(rows, options = {})` returns normalized pricing rows.
- `normalizePricingPayload(payload, format = "auto", options = {})` applies station model-list normalization after the selected parser.
- `currencyToRmb(currency, rechargeRate = 1)` returns the RMB conversion factor or `null` for an unconfirmed source currency.
- `getProxyPriceQuote(item, groupRatio = 1, rechargeRate = 1, basePrice = SYSTEM_BASE_PRICE_PER_1M, priceCurrencyVerified = true, rechargeRateVerified = true)` returns quote costs, source currency, and blocking reasons.

## Contracts

- Every ordinary station model list uses the project's business unit `CREDITS`, regardless of raw `$`, `¥`, `USD`, CNY, or missing labels.
- `prepareStationInput()` canonicalizes ordinary registered and unregistered stations to `{ priceCurrency: "CREDITS", priceCurrencyVerified: true }` after provider-specific URL/adapter preparation.
- A provider that explicitly declares `preservePriceCurrencyVerification: true` keeps its own false/UNKNOWN state. This is the protection contract for KillAI, fuck-everyone, and any future provider whose currency is deliberately unverified.
- `rechargeCurrency` is only the payment currency used to derive a station's `rechargeRate`; it never supplies a model-list source currency.
- With station collection option `modelListCurrency: "CREDITS"`, normalized rows use `price_currency: "CREDITS"` for ordinary stations. Protected provider diagnostics may retain their raw marker.
- Without `modelListCurrency`, generic parser calls preserve explicit source markers after trimming and uppercasing; missing or blank markers remain `UNKNOWN`. This parser behavior does not establish a trusted currency for station comparison.
- An explicit `priceCurrencyVerified: false` keeps the raw source marker during station normalization; do not bypass this guard globally.
- `currencyToRmb()` returns `null` for an empty value, `UNKNOWN`, `UNSPECIFIED`, `NONE`, or unsupported currency. CNY/RMB symbols use factor `1`; USD/CREDITS/POINTS use the configured recharge-rate factor.
- `getProxyPriceQuote()` adds `currency_unverified` when conversion is unavailable or `priceCurrencyVerified === false`. It must not globally ignore the false flag.
- `rechargeRateVerified === false` independently produces `recharge_unverified`.
- Runtime dashboard comparison and refresh scheduling must use the same prepared station shape. A station false value must not survive for an ordinary provider in one path while being repaired in the other.
- `REFRESH_PREFLIGHT` checks only enabled page-mode stations whose provider request policy requires page credentials. Use a read-only GET through the existing page bridge; do not run collection, refresh page credentials, write snapshots, or read the extension's stored station credentials. Direct public API stations bypass the login check.
- Preflight may close a station tab only when this extension's preflight created it and the session check is ready. Reused tabs and tabs needing login or manual review remain open.
- `REFRESH_ALL` requires an unexpired one-use preflight confirmation. Preflight results never change currency or recharge verification flags; protected provider and recharge blocks remain authoritative.
- `NORMALIZATION_VERSION` changes whenever old normalized snapshots could encode a different trust decision. Version `24` is required after ordinary stale verification repair; `snapshotNeedsRefresh()` rejects older versions.
- Raw official OpenRouter API reference prices remain USD. Comparison maps the same numeric USD-credit value 1:1 to `CREDITS` and computes RMB benchmark cost separately with the configured `openRouterRechargeRate`. OpenRouter purchase fees are not model prices.

## Validation & Error Matrix

| Condition | Prepared/normalized value | Comparison result |
|---|---|---|
| Ordinary registered station | `priceCurrency=CREDITS`, verified | CREDITS row converted with station recharge rate |
| Ordinary unregistered station | `priceCurrency=CREDITS`, verified | CREDITS row converted with station recharge rate |
| Protected provider with explicit false | Preserve provider marker/false | `currency_unverified`; no converted cost |
| Missing/blank raw currency on ordinary station | `CREDITS` | Converted with station recharge rate |
| `rechargeRateVerified: false` | Preserve station flag | `recharge_unverified`; no usable cost |
| Raw OpenRouter reference price | `USD` | Preserve API semantics |
| OpenRouter comparison quote | `CREDITS` | Numeric USD-credit value stays 1:1; RMB cost is separate |

## Good/Base/Bad Cases

- Good: a stale ordinary station with `priceCurrencyVerified: false` is prepared as CREDITS/true before refresh and dashboard comparison.
- Good: `{ input_price: 2, price_currency: "USD" }` becomes `price_currency: "CREDITS"` at an ordinary station model-list boundary.
- Good: a protected provider remains false even when its payload contains `$` or `USD`.
- Bad: adding a dashboard-only label that hides `currency_unverified` without preparing the station.
- Bad: changing `getProxyPriceQuote()` to ignore every `priceCurrencyVerified: false`.
- Bad: treating recharge USD/CNY as the source unit of a model row.

## Tests Required

- Test array, `data`, and `models` generic payloads without station options preserve explicit source markers and keep missing/blank markers `UNKNOWN`; the station collection boundary overrides ordinary rows to CREDITS.
- Test T蜜 and another ordinary station with stale false input through preparation, collection, snapshot, and comparison; assert usable RMB costs.
- Test an unregistered ordinary station receives CREDITS/true.
- Test KillAI/fuck-everyone preserve false and remain unavailable.
- Test `currencyToRmb()` for missing, blank, unknown, unsupported, CNY, USD, CREDITS, and POINTS.
- Test both `currency_unverified` branches and `recharge_unverified` separately.
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
