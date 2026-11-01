# 按分组刷新站点技术设计

## 1. 变更边界

最小行为缺口是：仪表盘已经用 `settings.comparisonMode` 隔离报价展示，但刷新预检和 `REFRESH_ALL` 仍从所有已启用站点取数，导致当前模式之外的站点也会被检查、采集和写入快照。

本任务只改“刷新全部”的范围传播和反馈，不改站点分类规则、价格归一化、比较算法或“刷新当前站点”的语义。

预期修改文件：

- `extension/src/service-worker.js`：读取当前比较模式，统一筛选分组站点；让预检、确认签名和实际刷新使用同一集合；向仪表盘返回分组标签/数量，并处理空分组。
- `extension/src/core/refresh-preflight.js`：把比较模式纳入预检签名，确保切换模式或范围变化后旧令牌不能确认新范围。
- `extension/src/dashboard.js`：显示当前分组和站点数量，刷新预检、进度、完成提示与空分组状态保持一致；切换模式时清除旧预检。
- `extension/src/popup.js`：沿用同一预检响应，在弹出页的预检和完成状态中显示当前分组；不改变单站刷新入口。
- `extension/src/shared/ui.js`：扩展刷新摘要格式化函数，使带分组元数据的刷新结果能显示分组，同时保留单站刷新调用的旧文案。
- `extension/test/refresh-preflight.test.js`：覆盖预检/确认/刷新范围、模式签名、禁用站点、空分组和模式切换后的令牌失效。
- `extension/test/core.test.js`：覆盖调度器继续只处理调用方传入的站点集合，并验证分组刷新后的进度总数与快照结果。

明确不修改：`extension/src/core/refresh-scheduler.js` 的筛选职责保持不变，仍只按 `enabled` 和可选 `stationId` 工作；`REFRESH_STATION` 仍通过 `stationId` 刷新所选启用站点。

## 2. 数据流与契约

### 2.1 分组范围

服务工作线程新增一个内部的比较模式规范化/标签映射和范围选择边界：

1. `getSettings()` 得到规范化的 `comparisonMode`，只允许 `paid` 或 `public`。
2. `getPreparedStations()` 得到与仪表盘比较一致的准备后站点。
3. “刷新全部”使用 `enabled === true && station.category === comparisonMode`；非法或缺失分类已经由 `normalizeStation()` 归一为 `paid`。
4. `REFRESH_STATION` 不调用该分组过滤，只继续走 `stationId`。

范围筛选应在服务工作线程完成，而不是让仪表盘传入站点 ID 列表。这样预检、确认和刷新都以存储中的当前站点状态为准，避免前端篡改或遗漏范围。

### 2.2 预检与确认

`REFRESH_PREFLIGHT` 返回：

- `comparisonMode`: `paid | public`
- `comparisonLabel`: `付费中转站 | 公益站`
- `stationCount`: 当前模式下已启用站点数
- `results`: 只包含当前模式下已启用站点的预检结果
- `token`、`expiresAt`、`stationSignature`

当前模式没有启用站点时，返回 `stationCount: 0`、空 `results`，并保留一个可展示的零范围预检结果；前端不允许确认或调用 `REFRESH_ALL`。服务端也拒绝带空范围确认的刷新，保证不存在空刷新流程。

`refreshStationSignature(stations, comparisonMode)` 继续只签名已启用站点的关键配置，并把规范化的比较模式放入签名。`assertRefreshConfirmation()` 接收当前分组站点和当前模式，旧模式或范围变化会因签名不一致返回 `REFRESH_CONFIRMATION_REQUIRED`。

### 2.3 实际刷新

`REFRESH_ALL`：

1. 恢复预检状态并读取当前准备后站点与设置。
2. 重新按当前 `comparisonMode` 筛选站点。
3. 用同一模式和同一分组集合校验预检令牌。
4. 消费预检状态。
5. 把已验证的分组站点传给现有 `runRefreshAll({ preparedStations })`。
6. 用带分组元数据的刷新摘要返回 `dashboard()`。

因此预检结果、确认签名、采集请求、进度 `total`、错误快照和刷新摘要共享同一站点集合。另一分组不会传入调度器，也不会产生新快照。

### 2.4 UI 状态

仪表盘和弹出页从 `GET_DASHBOARD` 的设置以及预检响应读取当前分组。所有“刷新全部”文案使用同一标签和数量：

- 初始按钮可保留“刷新全部”，其辅助说明/预检标题明确当前分组。
- 预检状态显示“正在检查 X（N 个启用站点）”。
- 进度显示“X：已完成 / 总数”，零站点显示“当前分组没有启用的站点，未发起刷新”。
- 完成摘要显示“X刷新完成：...”，单站刷新仍使用现有 `formatRefreshSummary(summary)` 文案。

模式切换成功后，前端清除 `state.refreshPreflight` 并重新渲染；服务端 `saveComparisonMode()` 也清除会话中的旧预检，避免另一个页面继续确认旧分组令牌。刷新进行中仍由现有按钮锁定和互斥逻辑负责。

## 3. 兼容性与风险

- 旧的单站刷新不携带比较模式，保持按 `stationId` 工作。
- 旧会话中没有 `comparisonMode` 的预检状态不能通过新签名校验，用户需要重新预检，符合确认令牌失效规则。
- 直接站点仍返回 `noLoginRequired`，页面站点仍使用现有只读 GET 预检。
- `refreshStationSignature` 的公共测试调用如果不传模式，应默认按 `paid` 计算，以避免无关调用破坏；服务工作线程显式传入当前模式。
- 刷新参考价仍由现有调度器在非空刷新时处理；空分组在调度器入口前被拒绝/短路，不应触发无意义的参考价刷新。
- 进度消息来自 Service Worker 广播，打开多个页面时每个页面根据自身当前模式渲染；完成后通过 `GET_DASHBOARD` 的最新模式数据纠正显示。

## 4. 回滚与验证

回滚点按文件分组：先撤销服务工作线程的范围筛选和预检签名传播，再撤销 UI 文案与测试。若发现旧预检会话兼容问题，保留签名模式字段并强制重新预检，不回退到跨分组刷新。

验证重点：

- paid/public 两种模式的预检结果和实际 `collect` 调用集合完全相等。
- 禁用站点永远不出现在预检、进度、错误快照和刷新摘要中。
- 模式切换或站点配置变化使旧令牌失效。
- 另一模式的历史快照仍存在且 `GET_DASHBOARD` 只按当前模式展示。
- 单站刷新和并发/单次确认测试继续通过。
