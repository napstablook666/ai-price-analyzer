# 技术设计

## 边界

修复 `extension/src/core/provider-registry.js` 的站点准备逻辑，并在 `extension/test/core.test.js` 增加回归断言。仪表盘、保存和比价流程继续复用现有 `prepareStationInput()`，不新增状态层或迁移。

## 数据流

1. 选项页或存储层提供站点对象。
2. `prepareStationInput()` 根据 provider 类型规范化站点配置；所有模型列表币种统一为 `CREDITS`/已核验，受保护 provider 的充值比例仍保留各自核验状态。
3. `service-worker.js` 的 `prepareComparisonStation()`、`getPreparedStations()` 和 `GET_DASHBOARD` 使用准备后的站点。
4. 仪表盘行状态根据比较结果中的价格核验原因展示，准备后仍为 false 的标志才会形成相应阻断。

实施中确认的根因在第 2 步：采集器已经用 `modelListCurrency: "CREDITS"` 统一改写 KillAI/fuck-everyone 行币种，但旧 `prepareStationInput()` 实现仍把两站点的币种核验状态强制写成 false。本次修复让模型列表币种始终为 CREDITS/true；受保护 provider 只对充值比例保留 false/UNKNOWN 保护。

## 兼容性与状态规则

- 所有 provider：模型列表币种准备为 `priceCurrency: "CREDITS"`、`priceCurrencyVerified: true`，与 collector 的行级单位一致。
- 受保护 provider：充值比例仅显式 true 时为 true；false、缺失和 preset 未知值保持 false。
- 普通 provider：充值比例继续自动核验为 true。
- 旧数据无需迁移。刷新、保存和仪表盘准备时，false/missing 受保护币种标志会规范成 true；旧充值比例未知状态继续提示。
- 通用 parser 在未传 `modelListCurrency` 时仍尊重显式来源标记和 false 核验选项，不改变全局通用货币解析保护。

## 取舍与回滚

只把币种状态与已存在的 CREDITS 行级采集契约对齐，并将保护边界限定到未知充值比例；由核心与 dashboard 测试覆盖旧 false/missing 币种状态和充值阻断。
