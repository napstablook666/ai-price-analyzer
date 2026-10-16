# 修复币种与充值比例待核验提示

## Goal

让选项页和比价页只显示真实未核验的数据。KillAI 与 fuck-everyone 的模型列表价格按 CREDITS 处理；币种 false/missing 标志不再阻断比较，未知充值比例仍保持待核验。

## Confirmed Facts

- 用户报告仍看到 `145 条币种待核验、125 条充值比例待核验`，并认为相关数据此前已经处理。
- `extension/src/core/normalizers.js` 的 `applyModelListCurrency()` 在 collector 传入 `modelListCurrency: "CREDITS"` 时把行价格单位统一规范为 `CREDITS`，包括 KillAI 和 fuck-everyone。
- `extension/src/core/provider-registry.js` 的旧 `prepareStationInput()` 实现把受保护 provider 的 `priceCurrencyVerified` 设为 false，因此即使行价格已是 CREDITS 也会产生 `currency_unverified`。
- `service-worker.js` 的 `GET_DASHBOARD` 使用 `getPreparedStations()` 后再生成比较行；比价状态标签由比较行的 `pricingUnavailableReasons` 产生，因此准备阶段残留的 false 会直接显示为 `currency_unverified`。
- 充值比例仍是独立风险：KillAI 和 fuck-everyone 的未知 `rechargeRateVerified` 必须保持 false，只有显式 true 才可通过。
- 普通 provider 已有自动规范化为 `CREDITS`、币种已核验和充值比例已核验的行为，不能回归。
- 充值比例的未知保护不能被本次修复取消。只有已有明确 `rechargeRateVerified: true` 的值可以继续保持 true，缺失或 false 的受保护值仍要提示人工确认。

## Requirements

- R1: `prepareStationInput()` 必须把受保护 provider 的模型列表币种规范为 `CREDITS` 并设为已核验，不依赖旧 `priceCurrencyVerified` 值。
- R2: 受保护 provider 旧数据中的币种核验值为 false 或缺失时，准备后均为 true，不能再产生 `currency_unverified`。
- R3: 普通 provider 继续返回 `priceCurrency: "CREDITS"`、`priceCurrencyVerified: true` 和 `rechargeRateVerified: true`。
- R4: 受保护 provider 的充值比例核验独立保留：显式 true 保留；false、缺失和默认未知仍为 false。
- R5: 回归测试覆盖 KillAI 和 fuck-everyone 的准备、模型列表采集、比较状态原因，以及充值比例保护。

## Acceptance Criteria

- [x] KillAI 和 fuck-everyone 的 false 或缺失币种核验状态经 `prepareStationInput()` 后为 `CREDITS`/true。
- [x] 两个受保护 provider 的模型列表采集行均为 `price_currency: "CREDITS"`；比较原因不含 `currency_unverified`。
- [x] 未知充值比例仍产生 `recharge_unverified`；显式 `rechargeRateVerified: true` 可移除此原因。
- [x] 普通 provider 的既有自动核验测试继续通过。
- [x] `GET_DASHBOARD` 从旧站点状态生成比较行时不再为两个受保护 provider 产生 `currency_unverified`，未知充值比例仍产生 `recharge_unverified`。
- [x] 核心和 dashboard 测试通过，且 diff 不引入无关改动。

## Out Of Scope

- 不把真正未知的受保护站点充值比例自动标记为已核验。
- 不修改第三方站点的实际价格、币种或充值规则。
- 不重做待核验提示的 UI，不新增数据库迁移或新的状态字段。

## Open Questions

- None. Latest user evidence establishes the CREDITS model-list contract for both protected providers; unknown recharge ratios remain a separate manual-verification requirement.
