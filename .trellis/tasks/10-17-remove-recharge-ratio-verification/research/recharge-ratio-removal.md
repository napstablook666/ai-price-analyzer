# Recharge Ratio Removal Research

## Repository Evidence

- `extension/src/core/pricing.js:getProxyPriceQuote()` currently calls `currencyToRmb(item.price_currency, rechargeRate)`, adds `recharge_unverified` when `rechargeRateVerified === false`, and returns `costPrices: null` whenever any unavailable reason exists.
- `extension/src/core/pricing.js:buildComparisonRows()` prefers station-level verification over snapshot metadata before calling the quote helper.
- `extension/src/core/provider-registry.js:prepareStationInput()` intentionally preserves false/missing recharge verification for KillAI and fuck-everyone.
- `extension/src/dashboard.js` maps `recharge_unverified` to `充值比例待核验` and counts pricing-unavailable reasons for the dashboard.
- `extension/src/options.js:stationCard()` renders a `station-recharge-warning` when the persisted flag is false; the same card still exposes recharge amount, credits, and a derived read-only ratio.
- Existing dashboard regression fixtures intentionally assert that false/missing protected-provider flags block comparison. Those assertions must change with this task; currency verification assertions must remain.

## Decision

The user explicitly requested removal of the feature and confirmed the intended fallback: an unconfirmed recharge ratio uses the default 1:1 conversion. Keep legacy fields for storage compatibility, but make them non-blocking and remove their user-facing warning.
