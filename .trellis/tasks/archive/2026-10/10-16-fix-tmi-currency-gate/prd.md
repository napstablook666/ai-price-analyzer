# 修复普通中转站仍显示币种待核验

## Goal

修复用户重新加载扩展并刷新数据后，多个普通中转站的模型价格已经显示为 `CREDITS`，但比较行仍显示“币种待核验”、月成本为 `—` 的问题。

项目约定是：OpenRouter 负责官方模型定价基准，各中转站模型列表消耗的都是项目虚构的“中转币”。因此普通站点不应要求用户逐站确认模型报价币种；只有明确列入未核验保护名单的 provider 继续拦截。

## Reproduction Evidence

用户提供的 T蜜截图显示：

- 中转站价格列已显示 `CREDITS`。
- 同一行仍有“币种待核验”。
- 月成本为 `—`，说明 `getProxyPriceQuote()` 仍收到未通过核验的站点状态。
- 用户已经重新加载扩展并刷新站点数据，问题不能只按新建 fixture 修复。
- 用户进一步确认，T蜜之外还有多个普通站点出现同样问题。

## Confirmed Repository Facts

- `extension/src/core/pricing.js:212-214` 的 `buildComparisonRows()` 优先使用站点 `priceCurrencyVerified`，站点中的 `false` 会覆盖快照状态。
- `extension/src/shared/schema.js:272-273` 会保留旧记录中的 `priceCurrencyVerified: false`。
- `extension/src/core/normalizers.js:1128-1133` 在 false 时跳过普通模型列表的 CREDITS 归一化。
- `extension/src/service-worker.js:132-140` 的刷新调度器和 `extension/src/service-worker.js:213-244` 的 dashboard 当前都可以直接拿到未经运行时准备的 `getStations()` 记录。
- `extension/src/core/provider-registry.js:9` 已有 provider 注册表和 `prepareStationInput()`；当前 provider 准备逻辑没有把所有普通站点的模型列表核验状态统一为 CREDITS。
- KillAI 和 fuck-everyone 是当前明确设置 `priceCurrencyVerified: false` 的保护 provider，必须保留拦截。

## User Decision

用户确认：所有未明确列入 KillAI、fuck-everyone 等未核验 provider 的站点，都按中转币 `CREDITS` 自动处理；不能只修复 T蜜一个 host。

## Requirements

- 所有普通中转站，包括已注册 provider 和未注册的普通自定义站点，在站点准备边界统一为 `priceCurrency: "CREDITS"`、`priceCurrencyVerified: true`。
- 已知未核验 provider 必须显式声明保护标记；其 `priceCurrencyVerified: false` 保持不变并继续产生 `currency_unverified`。
- 刷新调度器和 dashboard 比较必须使用同一份运行时 prepared station，不能一个使用旧 IndexedDB 记录、另一个使用修复后的对象。
- T蜜和其他普通站点刷新后的 normalized rows 必须为 `price_currency: "CREDITS"`，比较行应有来源币种 `CREDITS`、可计算的人民币月成本和 `pricingUnavailable: false`，前提是充值比例已核验。
- `rechargeRateVerified: false` 继续单独产生 `recharge_unverified`。
- 递增 normalization version，从 23 到 24，排除之前按旧核验状态生成的快照。
- 增加 T蜜旧记录、其他普通站点、未知普通站点、KillAI/fuck-everyone 和充值比例保护的回归测试。
- 不修改 `pricing.js` 的全局核验语义，不修改 Chrome 凭据、导入导出、OpenRouter 定价、充值比例算法或推荐算法。

## Acceptance Criteria

- [x] 旧 T蜜记录和其他普通站点记录即使带 `priceCurrencyVerified: false`，准备后都使用 `CREDITS`/true；刷新输出行不再是 `UNKNOWN`/`USD`。
- [x] dashboard 与刷新调度器使用同一份 prepared station。
- [x] T蜜和至少一个其他普通站点经过采集快照和 `buildComparisonRows()` 后，来源币种为 `CREDITS`、`pricingUnavailable` 为 false、月成本按各自 `rechargeRate` 计算。
- [x] 未注册但普通的自定义站点也按 CREDITS 处理；明确保护 provider 的 false 状态仍显示“币种待核验”。
- [x] `rechargeRateVerified: false` 仍独立显示“充值比例待核验”。
- [x] normalization version 从 23 增至 24，旧版本快照被刷新策略排除。
- [x] 定向测试、扩展完整测试和可用语法检查通过；lint/typecheck 若无脚本则记录。

## Out of Scope

- 不读取或修改用户实际 IndexedDB，不宣称直接修复用户本机现有记录；运行时准备和用户下一次保存会使用规范字段。
- 不通过 dashboard 标签或 `getProxyPriceQuote()` 全局忽略 false。
- 不把 KillAI、fuck-everyone 或未来显式标记为未核验的 provider 自动放行。
- 不修改 OpenRouter 的官方模型原始 USD 价格和上一任务已完成的 CREDITS 比较映射。

## Notes

- 当前任务已经进入 `in_progress`；本次用户确认扩大了原 T蜜范围，计划文档已同步为“所有普通站点”。
