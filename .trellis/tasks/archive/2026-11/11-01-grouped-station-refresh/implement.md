# 按分组刷新站点实施计划

## 实施前置条件

- 实现已完成；后续修改必须保留服务端权威分组范围、单站刷新兼容和已有未提交修改边界。
- 实施前先读取 `trellis-before-dev` 注入前端层规范，并确认工作区中已有的未提交修改不被覆盖。

## 有序步骤

### 1. 建立刷新范围边界

- 在 `extension/src/service-worker.js` 增加内部的比较模式范围选择逻辑，复用现有站点准备和分类归一规则。
- 只让当前 `comparisonMode` 下 `enabled === true` 的站点进入“刷新全部”范围。
- 保持 `REFRESH_STATION` 的 `stationId` 路径和现有启用状态检查不变。

### 2. 让预检、令牌和实际刷新共享范围

- 在 `extension/src/core/refresh-preflight.js` 扩展刷新签名，使规范化的比较模式参与签名计算；未传模式的底层测试调用按现有 `paid` 默认值兼容。
- 修改 `REFRESH_PREFLIGHT`，返回分组标识、分组文案、启用站点数量和仅属于当前模式的结果。
- 修改 `REFRESH_ALL`，重新按当前持久化模式计算范围，再校验令牌和站点签名；范围不一致时返回现有确认过期/需重新预检错误。
- 对空分组在服务端和前端都短路，不能进入采集调度器、参考价刷新或快照写入。
- 模式保存或切换时清除旧的刷新预检状态，防止其他页面确认旧模式令牌。

### 3. 更新刷新反馈

- 在 `extension/src/dashboard.js` 更新预检、进度、完成和空状态文案，统一使用服务端返回的分组标签和数量。
- 在 `extension/src/popup.js` 复用同一分组元数据，保持弹出页与仪表盘的范围提示一致。
- 在 `extension/src/shared/ui.js` 扩展带分组摘要的格式化能力，同时保留单站刷新既有文案和调用兼容性。
- 模式切换成功后清除前端旧预检并立即重新渲染当前模式；不改变现有刷新中的按钮锁定和互斥状态。

### 4. 补充回归测试

- 在 `extension/test/refresh-preflight.test.js` 覆盖 paid/public 范围筛选、禁用站点排除、模式进入签名、范围变化令牌失效、空分组拒绝确认和预检结果元数据。
- 在 `extension/test/core.test.js` 或已有刷新测试位置覆盖实际采集调用集合、进度总数、错误/快照隔离，以及单站刷新不受影响。
- 验证切换模式后另一模式的历史快照和报价仍可从仪表盘读取，当前模式派生数据不泄漏。

## 验证命令

1. `npm --prefix extension test`
2. `node --check extension/src/core/refresh-preflight.js`
3. `node --check extension/src/service-worker.js`
4. `node --check extension/src/dashboard.js`
5. `node --check extension/src/popup.js`
6. `node --check extension/src/shared/ui.js`
7. `git diff --check`

必要时单独重跑聚焦测试：

- `node --test extension/test/refresh-preflight.test.js`
- `node --test extension/test/core.test.js`
- `node --test extension/test/workspace.test.js`

## 风险、检查点与回滚

- 高风险文件是 `extension/src/service-worker.js` 和 `extension/src/core/refresh-preflight.js`，因为范围、确认令牌和刷新互斥在这里汇合。每完成一个文件先运行对应 `node --check` 和聚焦测试。
- UI 修改不得通过隐藏行补救范围问题；范围必须在服务工作线程统一计算，再由 UI 渲染同一元数据。
- 若发现旧预检会话无法安全迁移，保留模式参与签名并让旧令牌重新预检，不回退到跨分组刷新。
- 回滚顺序：先撤销刷新范围和令牌传播，再撤销 UI 文案和测试；不得删除已有的另一分组快照。

## 完成前检查

- [x] 所有 PRD 验收标准都有对应测试或可重复的手工验证。
- [x] 单站刷新、刷新并发锁定、预检一次性消费和失败重试行为未改变。
- [x] `paid`、`public`、空分组、禁用站点和模式切换均有覆盖。
- [x] 通过完整测试、语法检查和 `git diff --check`。
- [x] 进行一次只读代码审查后再提交。
