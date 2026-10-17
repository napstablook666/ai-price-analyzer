# 移除充值比例核验阻断

## Goal

删除“充值比例待核验”这项用户可见的提示和报价阻断。站点充值比例未明确确认时，仍生成可比较的价格，按默认 1:1 参与计算；已确认并配置了充值比例的站点继续使用该比例。

## Confirmed Facts

- `extension/src/core/pricing.js:getProxyPriceQuote()` 当前会在 `rechargeRateVerified === false` 时加入 `recharge_unverified`，并令 `costPrices` 为 `null`，所以报价无法参与正常比较。
- `extension/src/core/pricing.js:currencyToRmb()` 已支持使用充值比例把 `CREDITS`、`USD`、`POINTS` 转成成本；未确认时应传入 `1`，而不是继续使用可能过期的站点配置值。
- `extension/src/core/provider-registry.js` 为 KillAI 和 fuck-everyone 保留了未确认状态；这些字段来自历史持久化数据，不能要求用户迁移后才能正常显示价格。
- `extension/src/dashboard.js` 将 `recharge_unverified` 映射为“充值比例待核验”，该原因会出现在行状态和汇总计数中。
- `extension/src/options.js` 在站点卡片上渲染“充值折算未核实”告警；充值金额、到账中转币和计算出的充值比例输入本身仍是有效的价格计算数据。
- 币种核验、价格缺失、模型匹配和刷新失败是独立问题，本次不改变这些保护。

## Requirements

- R1: 比较链路中，充值比例未确认或缺失时，强制使用充值比例 `1`，生成正常的 `costPrices`，不再将报价标记为 `recharge_unverified`。
- R2: 已确认的充值比例继续使用站点配置的有效比例；本次不得把已配置的非 1:1 比例改成 1:1。
- R3: 核心报价、dashboard 行状态和汇总中不再产生或展示“充值比例待核验”，包括 `recharge_unverified` 原因和对应中文标签。
- R4: 选项页不再展示充值比例未核实告警；充值金额、到账中转币和只读计算结果继续保留，旧的 `rechargeRateVerified` / `rechargeRateNote` 持久化字段可继续读取以兼容已有数据，但不再阻断价格比较。
- R5: `currency_unverified`、`price_missing`、模型价格币种核验以及刷新预检等独立语义保持不变。
- R6: 增加覆盖核心 quote、dashboard 数据流和选项页告警行为的回归测试，并更新价格数据契约，避免旧的充值比例阻断规则重新出现。

## Acceptance Criteria

- [ ] `rechargeRateVerified: false` 且站点充值比例为 `7.3` 的报价按 `1:1` 生成可用成本，不包含 `recharge_unverified`。
- [ ] `rechargeRateVerified: true` 且站点充值比例为 `1.2` 的报价仍按 `1.2` 计算。
- [ ] `priceCurrencyVerified: false` 的报价仍保留 `currency_unverified` 并按现有规则不可用于成本比较。
- [ ] dashboard 比较行、推荐资格和汇总计数不再出现“充值比例待核验”。
- [ ] 选项页站点卡片不再渲染充值比例未核实告警，且旧站点数据可以正常加载和保存。
- [ ] `npm --prefix extension test` 通过。

## Out of Scope

- 不删除充值金额、到账中转币或充值比例计算输入；这些数据仍用于已确认比例和默认 1:1 成本换算。
- 不删除旧的持久化字段或做数据库迁移；旧字段仅为兼容读取，不能继续产生阻断。
- 不放宽币种核验、缺失价格、模型匹配、采集失败或登录预检等其他保护。
- 不修改官方参考价格、OpenRouter 的独立汇率逻辑或 dashboard 文案之外的推荐规则。

## Open Questions

无。用户已确认未确认充值比例按默认 1:1 参与比较，并要求移除该提示和阻断。
