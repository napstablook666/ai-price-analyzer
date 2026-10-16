# 技术设计

## 变更边界

根因是旧站点记录中的 `priceCurrencyVerified: false` 仍然流入比较层。普通模型列表的业务单位已经确定为 CREDITS，因此站点准备边界应统一修复普通站点的旧字段，而不是在 `pricing.js` 里忽略 false。

本任务将“是否保留未核验状态”变成 provider registry 的显式契约：普通站点默认 canonicalize 为 CREDITS/verified；KillAI、fuck-everyone 等 provider 明确声明保留 false。

预计修改：

- `extension/src/core/provider-registry.js`：在 `prepareStationInput()` 统一普通站点为 CREDITS/true；给保护 provider 增加保留核验状态的显式标记。
- `extension/src/service-worker.js`：增加运行时 prepared station 映射，dashboard 与 refresh scheduler 共用。
- `extension/src/core/normalizers.js`：将 `NORMALIZATION_VERSION` 从 23 增至 24，让旧快照刷新。
- `extension/test/core.test.js`：覆盖 T蜜和其他普通站点 stale false、未知普通站点、保护 provider 和比较结果。
- `.trellis/spec/frontend/pricing-data-contract.md`：记录普通站点 canonicalization、保护 provider 和 version 24。

## 数据流

```text
IndexedDB stations (ordinary rows may have stale priceCurrencyVerified=false)
  -> getStations()
  -> prepareStationInput()
       ordinary / unknown station => priceCurrency=CREDITS, priceCurrencyVerified=true
       protected provider => preserve explicit false
  -> normalizeStation()
  -> same prepared list
       -> refresh scheduler -> collectStation -> normalized row CREDITS -> snapshot v24
       -> dashboard -> snapshot policy -> buildComparisonRows -> RMB cost
```

## Prepared station contract

1. `prepareStationInput()` obtains the provider from the existing registry.
2. Providers that explicitly declare `preservePriceCurrencyVerification: true` keep their own false/UNKNOWN state. This marker is used by KillAI/fuck-everyone and is the only route that preserves the blocking state.
3. Every other station, including a station without a registered provider, receives `priceCurrency: "CREDITS"` and `priceCurrencyVerified: true` after provider-specific URL/adapter preparation.
4. `normalizePricingPayload(..., { modelListCurrency: "CREDITS" })` then writes CREDITS rows for ordinary stations.
5. `buildComparisonRows()` remains unchanged: it still blocks an explicit protected false and separately blocks unverified recharge ratios.

## Runtime boundary

Add one service-worker helper that reads stations and applies `prepareStationInput()` plus `normalizeStation()` once. Pass this helper to both `runRefreshAll({ getStations })` and the dashboard comparison path. This prevents refresh from writing a CREDITS snapshot while dashboard still reads the stale false station record.

`SAVE_STATIONS` already calls `prepareStationInput()`; after this change it also persists canonical ordinary station fields on the next save. No direct IndexedDB migration is required.

## Compatibility and versioning

- `NORMALIZATION_VERSION` increments from 23 to 24 because old snapshots can encode the old station verification decision.
- Existing OpenRouter comparison remains unchanged and is still a reference-price pipeline, not a station recharge account.
- Explicit protected provider fields remain visible for diagnostics and still produce `currency_unverified`.

## Tests

- T蜜 input with stale false prepares to CREDITS/true and collects a CREDITS row.
- Another ordinary registered station and an unregistered ordinary station receive the same canonical fields.
- Prepared station comparison has `sourceCurrency: "CREDITS"`, usable cost, and `pricingUnavailable: false`.
- KillAI/fuck-everyone prepared records keep false and remain blocked.
- `rechargeRateVerified: false` remains a separate blocking reason.
- Version 23 snapshots require refresh; version 24 snapshots do not solely fail due to version.

## Risk and rollback

The key risk is accidentally removing provider protection. The explicit registry marker and tests for both protected providers make that failure visible. If a future provider must stay unverified, add the marker to its registry definition rather than adding a global URL exception or weakening quote calculation.
