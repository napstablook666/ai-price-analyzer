# Pricing Data Contract

## Scenario: Generic pricing currency preservation

### 1. Scope / Trigger

This contract applies when a station exposes generic pricing through an array payload, `data`, or `models`. It protects source currency data between collection, normalization, snapshots, and dashboard comparison.

### 2. Signatures

- `cleanPricingRows(rows, options = {})` returns normalized pricing rows; direct parser callers preserve explicit source labels, while station collection passes `modelListCurrency: "CREDITS"`.
- `parseGenericPricing(payload, options = {})` accepts an array, `{ data: [] }`, or `{ models: [] }` and returns `{ sourceFormat, data, group_ratio }`.
- `normalizePricingPayload(payload, format = "auto", options = {})` applies the station model-list unit after the selected parser.
- `currencyToRmb(currency, rechargeRate = 1)` returns the RMB conversion factor or `null` when the source currency cannot be confirmed.
- `getProxyPriceQuote(item, groupRatio = 1, rechargeRate = 1, basePrice = SYSTEM_BASE_PRICE_PER_1M, priceCurrencyVerified = true, rechargeRateVerified = true)` returns quoted prices, converted cost prices, source currency, and unavailable reasons.
### 3. Contracts

- Station model-list normalization with `modelListCurrency: "CREDITS"` writes `price_currency: "CREDITS"` for every normalized station row unless `priceCurrencyVerified === false`; raw `$`, `USD`, `CNY`, or blank source labels do not change a verified ordinary station's business unit.
- Without the station model-list option, generic parser calls still preserve explicit `price_currency`/`currency` as an uppercase, trimmed string; this keeps parser behavior testable and avoids changing unrelated raw-data consumers.
- `rechargeCurrency` is only the payment currency used to derive `rechargeRate`; it never supplies or overrides a model-list source currency.
- `currencyToRmb()` returns `null` for an empty value, `UNKNOWN`, `UNSPECIFIED`, `NONE`, or any unsupported currency; CNY/RMB symbols use factor `1`, and USD/CREDITS/POINTS use the configured recharge-rate factor.
- `getProxyPriceQuote()` adds `currency_unverified` when conversion is unavailable or `priceCurrencyVerified === false`. Such quotes have no converted cost and cannot enter comparison or recommendation calculations.
- `rechargeRateVerified === false` independently produces `recharge_unverified`.
- `NORMALIZATION_VERSION` changes whenever the normalized row contract changes. `snapshotNeedsRefresh()` must reject snapshots created with an older version.
- Raw official OpenRouter reference data does not pass through station model-list normalization and remains USD.
- In comparison rows, map the same numeric OpenRouter USD credit price 1:1 to `CREDITS` for `officialQuotedPrices`; compute the RMB benchmark cost separately with the project-configured `openRouterRechargeRate` / RMB-per-USD rate. The rate affects cost only, not the quoted price.
- OpenRouter recharge-account fees are not modeled or included in benchmark prices.
### 4. Validation & Error Matrix

| Condition | Normalized value | Comparison result |
|---|---|---|
| Station model-list row with `modelListCurrency: "CREDITS"` | `CREDITS` | Converted with the configured recharge rate |
| Generic parser called without station model-list option and `price_currency: "CNY"` | `CNY` | Converted with factor `1` |
| Generic parser called without station model-list option and `price_currency: "USD"` | `USD` | Converted with the configured recharge rate |
| Missing/blank row currency in station model-list normalization | `CREDITS` | Converted with the configured recharge rate |
| `rechargeRateVerified: false` | Preserve station flag | `recharge_unverified`; no usable cost |
| Station `priceCurrencyVerified: false` | Preserve station flag and source marker | `currency_unverified`; no converted cost |
| Raw official OpenRouter API reference price | `USD` | Preserve API semantics; do not pass through station normalization |
| OpenRouter comparison quote | `CREDITS` | Preserve the numeric USD-credit value 1:1; calculate RMB cost separately with the configured benchmark rate |
### 5. Good/Base/Bad Cases

- Good: a station row with `{ input_price: 2 }` becomes `price_currency: "CREDITS"` when collected with `modelListCurrency: "CREDITS"`.
- Good: a station row with `{ input_price: 2, price_currency: "USD" }` is still normalized to `price_currency: "CREDITS"` at the station model-list boundary.
- Good: `{ input_price: 2, price_currency: " CNY " }` remains `CNY` when using the raw generic parser without station model-list options.
- Bad: recharge-only `rechargeCurrency: "USD"` without the station model-list normalization option cannot prove an unknown model source currency.
- Bad: a station with `priceCurrencyVerified: false` keeps its diagnostic source marker and remains unavailable even if the raw list contains `$` or `USD`.
### 6. Tests Required

- Test array, `data`, and `models` generic payloads through station normalization and assert every row uses CREDITS; also retain raw parser tests for explicit CNY/USD preservation.
- Test `currencyToRmb()` for missing, blank, unknown, unsupported, CNY, USD, CREDITS, and POINTS values.
- Test both `currency_unverified` branches: unavailable item currency and explicit station verification failure; test `recharge_unverified` separately.
- Test the `token123.cfd` collection-to-comparison flow with recharge payment currency set to both CNY and USD; assert the model source remains CREDITS and monthly costs use the configured recharge rate.
- Test KillAI/fuck-everyone explicit unverified provider states remain blocked.
- Test official OpenRouter reference prices remain USD and are not rewritten by station normalization.
- Test that an older normalization version requires snapshot refresh.
### 7. Wrong vs Correct

#### Wrong

```js
const code = String(currency || "USD").toUpperCase();
```

This turns a missing source currency into a false USD claim.

#### Correct

```js
const code = String(currency ?? "").trim().toUpperCase();
if (!code || ["UNKNOWN", "UNSPECIFIED", "NONE"].includes(code)) return null;
if (["CNY", "RMB", "¥", "￥"].includes(code)) return 1;
if (!["USD", "CREDITS", "POINTS"].includes(code)) return null;
```

This preserves the official reference currency while making the station model-list unit explicit at collection time. Missing station row labels no longer enter comparison as unknown, but explicit provider verification failures and unverified recharge ratios remain blocking states.
