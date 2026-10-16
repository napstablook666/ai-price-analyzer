# 修复充值比例待核验计数未清零

## Goal

修复扩展 dashboard 仍显示“125 条充值比例待核验”的问题。当前启用站点都应已确认充值比例，因此 dashboard 在重新加载后应显示 0 条 `recharge_unverified`，同时继续保留未来真实未确认受保护 provider 的阻断保护。

## Background

- 用户反馈 dashboard 仍显示 `125 条充值比例待核验`；该数字来自 `extension/src/dashboard.js:92-100` 对比较报价行的 `pricingUnavailableReasons` 逐行计数，不代表 125 个充值比例配置。
- 用户确认当前应该没有未确认充值比例的站点，因此这些启用站点报价不应产生 `recharge_unverified`。
- `extension/src/service-worker.js:368-406` 的 `dashboard()` 当前把所有 prepared stations 和最新快照送入比较；`extension/src/core/refresh-scheduler.js:58` 的批量刷新已经过滤 `station.enabled === false`。
- `extension/src/core/pricing.js:212-214` 以站点 `rechargeRateVerified` 优先于快照元数据；显式 `true` 应覆盖旧快照中的 `false`。`extension/src/core/pricing.js` 的 `getProxyPriceQuote()` 仍应在真实 `false` 时产生 `recharge_unverified`。
- KillAI 和 fuck-everyone 在 `extension/src/core/provider-registry.js:578-582` 明确保留未知充值比例，缺失或 `false` 不能被自动清除；只有显式 `true` 才能解除该阻断。
- 现有归档任务已经修复普通站点的旧币种/充值状态误判，并明确要求保留受保护 provider 和真实 `rechargeRateVerified: false` 的保护语义。
- 当前没有用户浏览器 IndexedDB 数据，无法证明 125 行具体来自哪个站点；可复现的仓库级根因是 dashboard 未沿用刷新调度器的启用站点边界，且现有回归没有断言“已确认站点 + 旧快照 false”时的 dashboard 原因总数。

## Requirements

- R1: `GET_DASHBOARD` 的比较输入只包含 `enabled === true` 的 prepared stations；停用站点的旧快照不得制造比较行、报价行或“充值比例待核验”计数。
- R2: `GET_DASHBOARD` 返回的站点元数据继续包含停用站点，保证 options 页面可以查看和编辑这些站点；仅比较与汇总边界过滤停用站点。
- R3: 启用站点的显式 `rechargeRateVerified === true` 必须覆盖旧快照中的缺失或 `false`，不产生 `recharge_unverified`。
- R4: KillAI/fuck-everyone 缺失或明确为 `false` 的充值比例仍必须阻断比较；模型列表的 `CREDITS` 归一化、币种核验和充值比例核验继续保持独立。
- R5: 增加覆盖 `GET_DASHBOARD` 数据流的回归测试，直接断言比较行、汇总报价数和 `recharge_unverified` 原因数量，而不是只测试底层 parser 或单个 quote helper。

## Acceptance Criteria

- [ ] dashboard 不再统计已停用站点的缓存报价；重新加载后停用站点的待核验行不会出现在比较结果或汇总原因计数中。
- [ ] 回归场景包含 145 条启用普通站点报价、2 条启用且已确认充值比例的受保护站点报价、1 条启用且已确认充值比例的普通站点报价，以及 125 条停用受保护站点报价；最终 dashboard 只有 148 条报价，`recharge_unverified` 数量为 0。
- [ ] 启用受保护站点的站点配置为 `rechargeRateVerified: true`、但旧快照元数据为 `false` 时，报价仍不产生 `recharge_unverified`。
- [ ] 受保护站点缺失或明确为 `false` 的充值比例仍产生 `recharge_unverified`，现有 core 测试继续通过。
- [ ] 停用站点仍出现在返回的站点元数据中，但其快照不出现在 dashboard 比较输入和返回快照集合中。
- [ ] `npm --prefix extension test` 通过。

## Out of Scope

- 不修改 dashboard 文案，不把报价行数改成去重后的站点配置数。
- 不通过 UI 汇总隐藏真实待核验状态，不新增数据库迁移、新验证字段或 normalization version。
- 不把充值金额币种、充值金额/中转币数量、非零充值比例或成功采集当作充值比例已核验。
- 不改变普通站点、OpenRouter、模型价格币种、刷新预检或批量刷新既有语义。
- 不用全局忽略 `rechargeRateVerified: false` 的方式强行把真实待核验站点清零。

## Key Decisions

- 停用站点的旧快照从 dashboard 比较和汇总中完全排除。用户选择了该方案，因为设置页将停用定义为“不参与比价与批量查询”，刷新调度器也已有相同过滤；代价是停用后暂时无法在 dashboard 查看该站点的缓存报价，重新启用即可恢复。
- 当前启用站点的确认状态以站点配置为准，旧快照的 `false` 不能覆盖已保存的显式 `true`。
- 保留所有未来真实未确认的充值比例保护。修复边界只过滤停用站点并验证配置优先级，不清除或弱化受保护 provider 的 `rechargeRateVerified: false`。

## Risks and Deferred Items

- 本地 dashboard 若在 options 保存前已经打开，页面内存中的旧 `state.rows` 会继续显示到下一次 `GET_DASHBOARD` 或页面重新可见；本任务验收以重新加载后的 dashboard 数据流为准，不新增跨页面实时推送机制。
- dashboard 当前仍可在站点筛选元数据中看到停用站点名称，但不会有对应报价行；本任务不为此新增独立 UI 状态。
