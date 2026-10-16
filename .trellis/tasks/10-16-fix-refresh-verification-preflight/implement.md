# 实施计划

## 顺序

- [x] 1. 复现真实统计：用旧 IndexedDB station 形状走 `GET_DASHBOARD` 和 `REFRESH_ALL` 两条入口，记录普通站点、保护 provider、充值比例未核验的最终字段和待核验计数。
- [x] 2. 统一 station preparation：抽出/复用单一 prepared station 入口，确保 dashboard、刷新调度器和采集都使用同一对象；补普通站点旧字段回归，不放行保护 provider。
- [x] 3. 设计并实现 `REFRESH_PREFLIGHT`：筛选需要页面登录态的启用站点，打开/复用标签，执行无副作用会话检查，返回 ready/needsLogin/uncertain/noLoginRequired。
- [x] 4. 实现临时标签生命周期：预检创建且已确认登录的 tab 自动关闭；复用 tab 和未登录 tab 不自动关闭；记录 tab 与 preflight token，避免误关用户页面。
- [x] 5. 实现 dashboard 确认门禁：预检结果展示在 dashboard；用户未点击“确认开始刷新全部”前不调用正式刷新；取消/过期清理状态。
- [x] 6. 将确认后的正式刷新接回现有 `runRefreshAll()`，保留并发、快照写入、失败隔离和进度事件；公开 API 站点不增加登录阻塞。
- [x] 7. 增加测试：真实统计回归、preflight 不写快照、已登录/未登录/不确定三种状态、临时 tab 清理、取消/确认门禁、公开站点旁路、KillAI/fuck-everyone/recharge false 保护。
- [x] 8. 运行 `node --test extension/test/core.test.js`、扩展完整测试、dashboard/service-worker/page-tabs 相关语法检查；检查实际 lint/typecheck 脚本。
- [x] 9. 使用 trellis-check 做跨层复核，确认登录态预检没有读取或写入凭据、没有关闭用户标签页、没有用 UI 统计掩盖真实核验状态。
- [x] 10. 更新 spec、勾选验收项、提交并归档任务；保留工作区已有无关改动。

## 验收命令

```text
node --test extension/test/core.test.js
npm test --prefix extension
node --check extension/src/service-worker.js
node --check extension/src/core/refresh-scheduler.js
node --check extension/src/core/page-tabs.js
node --check extension/src/dashboard.js
node --check extension/test/core.test.js
npm run lint --prefix extension
npm run typecheck --prefix extension
```

不存在的 lint/typecheck 脚本记录并跳过；定向和扩展完整测试必须通过。

## 风险文件与回滚点

- `extension/src/service-worker.js`：确认门禁和临时 tab 管理核心；出现误拦截时先回滚门禁，不改价格判断。
- `extension/src/core/page-tabs.js`：只允许关闭本次创建的临时页，不能误关用户已有标签。
- `extension/src/dashboard.js`/`dashboard.html`：UI 状态必须和 worker token 一致，不能只在前端伪造确认。
- `extension/src/core/refresh-scheduler.js`：正式刷新保持无隐式登录等待，避免并发状态回归。
- `extension/test/core.test.js`：必须覆盖 screenshot 统计对应的真实对象形状，而不是只测手工构造的已核验 fixture。
