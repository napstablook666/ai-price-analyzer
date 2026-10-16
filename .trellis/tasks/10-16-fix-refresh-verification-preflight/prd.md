# 修复真实核验统计并增加刷新前登录预检

## Goal

修复扩展实际 dashboard 中仍显示大量“币种待核验”和“充值比例待核验”的问题，并把批量刷新改成登录预检与人工确认两阶段流程。

用户希望的刷新流程：

1. 点击“刷新全部”后，先识别本次需要登录态的站点。
2. 一键打开这些站点网页，并自动判断当前是否已经登录。
3. 已确认登录的站点自动关闭标签页。
4. 未登录的站点保持打开，由用户手动登录。
5. 用户手动点击“确认开始刷新全部”后，才开始批量采集。
6. 刷新结果和 dashboard 比较必须使用同一份已准备、已归一化的站点对象。

## Confirmed Facts

- 用户实际 dashboard 显示 `145 条币种待核验、145 条充值比例待核验`，此前代码测试通过不能证明真实 `GET_DASHBOARD` 数据流已经修复。
- `extension/src/service-worker.js` 有 `prepareComparisonStation()`，dashboard 使用 prepared station；刷新调度器也必须通过 `getStations` 参数获得同一份 prepared station。
- `extension/src/core/pricing.js` 会在 `priceCurrencyVerified !== true` 或 `rechargeRateVerified !== true` 时阻断报价；一个普通站点对象形状错误会被每个模型行重复统计。
- `extension/src/core/provider-registry.js` 已能识别需要页面登录态的 provider，但当前刷新前没有统一的登录预检和用户确认状态。
- `extension/src/service-worker.js:61-115` 的 `withPageFetch()` 会通过页面标签和 bridge 执行请求；页面站点没有登录态时会抛出“请先在当前 Chrome 配置文件登录目标站点一次后重试”。
- `extension/src/core/refresh-scheduler.js` 当前负责并发刷新、保存快照和进度通知，但没有 preflight 阶段。
- `extension/src/dashboard.js` 当前直接触发 `REFRESH_ALL` 并监听进度；需要增加“预检结果”和“人工确认开始”的状态。
- `extension/src/core/page-tabs.js` 已提供查找/打开站点标签页的能力，优先复用已有标签，避免无谓开新页。

## Requirements

### 真实核验统计

- 追踪并修复真实 `GET_DASHBOARD -> buildComparisonRows()` 数据流，确保普通站点的 canonical `CREDITS`、`priceCurrencyVerified`、`rechargeRateVerified` 状态在 dashboard 和刷新调度器中一致。
- 普通站点的旧记录不能因为历史字段缺失或旧值而被错误地批量标记为币种待核验；明确保护 provider 的 `priceCurrencyVerified: false` 仍然阻断。
- 充值比例未核验必须保留真实阻断语义，不能用 UI 汇总或全局默认值掩盖；只有确实未登录导致无法读取/确认的站点才产生对应待核验状态。
- 增加至少一个真实 dashboard 形状的回归测试，断言普通站点的统计不再重复产生错误待核验原因。

### 登录预检与确认

- `REFRESH_ALL` 在正式刷新前进入 preflight，不采集价格、不写入快照。
- preflight 只处理需要登录态的启用站点；公开直连站点不要求打开网页登录。
- 一键打开待检查的页面站点，尽量复用已有标签页。
- 自动判断登录态：成功的页面请求/bridge 检查视为已登录；明确的 401/403、登录页/会话失效错误视为未登录；无法判断时保守归为需要用户确认，不得直接开始刷新。
- 已确认登录的站点标签页自动关闭，但不能关闭用户已有的普通业务标签页；只关闭本次预检创建的临时标签页，或明确标记为扩展临时页的标签。
- 未登录站点的标签页保持打开，返回站点名称、原因和标签页信息给 dashboard。
- preflight 返回可展示的状态：已登录、需要登录、检查失败/需人工确认、无需登录。
- dashboard 在 preflight 完成后显示待处理站点，并提供明确的“确认开始刷新全部”按钮；未确认时不得启动 `runRefreshAll()`。
- 用户确认后正式刷新，复用已打开的页面标签和页面登录态；刷新过程仍使用现有并发、失败隔离和进度通知。
- 用户取消或关闭确认流程时，不采集、不覆盖旧快照。

## Acceptance Criteria

- [x] 真实 dashboard 数据流中，普通站点不再因旧的 `priceCurrencyVerified`/`rechargeRateVerified` 形状被批量重复统计；145 条的截图场景有回归覆盖。
- [x] preflight 不会写入价格快照，也不会在用户确认前开始正式刷新。
- [x] 需要登录态的站点可以一键打开；已登录且由预检创建的临时页会关闭；未登录页保持打开。
- [x] 页面登录成功后，用户点击“确认开始刷新全部”才启动正式刷新；取消不会触发采集。
- [x] 公开 API 站点不被强制打开登录页，现有刷新流程保持可用。
- [x] KillAI、fuck-everyone 和真实 `rechargeRateVerified: false` 的拦截语义不变。
- [x] dashboard、service worker、page-tabs、refresh scheduler 的状态契约有回归测试；现有扩展测试和新增测试通过。
- [x] 不修改 Chrome 凭据、站点导入导出和无关 provider 业务判断。

## Out of Scope

- 不自动填写账号、密码、验证码或绕过站点登录。
- 不关闭用户手动打开的普通标签页，不清理用户已有的站点标签页。
- 不删除真实未核验状态，不把所有失败站点强行标记为已核验。
- 不重写推荐算法、价格字段或 provider 注册表的无关适配逻辑。

## Open Questions

无。登录判断优先复用现有页面 bridge 和请求策略；无法可靠判断时进入人工确认状态。
