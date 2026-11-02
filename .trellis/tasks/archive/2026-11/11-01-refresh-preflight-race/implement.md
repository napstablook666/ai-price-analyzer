# 修复刷新预检令牌竞态实施计划

## 实施前置条件

- 任务已进入 `planning`，完成本计划并经用户批准后，再运行 `python ./.trellis/scripts/task.py start .trellis/tasks/11-01-refresh-preflight-race`。
- 只修改本任务声明的服务工作线程、刷新预检测试和必要的前端契约文档；保留工作区其他任务的未提交修改。
- 先读取 `trellis-before-dev`、前端 spec index、`pricing-data-contract.md` 以及当前任务的 `prd.md` / `design.md`。

## 有序步骤

### 1. 固化预检失效边界

- 在 `extension/src/service-worker.js` 增加内部预检代次或等价的单调版本值。
- 将模式切换、站点保存、设置保存、状态导入和其他会使当前刷新范围/签名改变的路径统一接到“递增代次并清除预检”的入口。
- 保持一次性确认消费、取消预检和 session 持久化行为不变，同时确保失效操作在任何异步清理前完成代次递增。

### 2. 防止异步旧预检发布

- `createRefreshPreflight()` 开始时捕获代次、比较模式和分组站点签名。
- 页面探测全部完成后重新读取当前 settings/stations，复算分组范围和签名。
- 只有代次、模式和签名都仍然匹配时，才写入 `activeRefreshPreflight` 和 `chrome.storage.session`。
- 旧请求失效时不得发布旧 token；清理其临时页面标签和相关 tab 状态，不吞掉实际页面探测错误。
- 不改变成功预检字段、刷新确认接口或调度器职责。

### 3. 补充分组刷新回归测试

- 在 `extension/test/refresh-preflight.test.js` 增加 deferred page response 测试：预检等待期间切换模式，释放旧 probe 后确认 dashboard 不暴露旧预检，旧 token 不能触发刷新。
- 将现有模式切换测试拆成独立断言：模式切换后立即用旧 token 调用 `REFRESH_ALL`；另起预检验证 `SAVE_STATIONS` 的配置变化失效。
- 增加当前分组内 `enabled: "false"` 站点，与正常启用站点并列；断言预检结果、实际快照、进度总数和完成摘要均只包含严格启用站点。
- 若 harness 需要导出或注入 deferred 控制，只做测试所需的最小修改，不改变生产 API。

### 4. 更新代码规范契约

- 若预检代次校验是可复用的跨层契约，在 `.trellis/spec/frontend/pricing-data-contract.md` 增加“异步预检发布必须复验代次和当前范围签名”的具体条款、错误行为和测试点。
- 不重复记录已有的 paid/public 范围规则；只补充本次发现的竞态防护。

## 验证命令

1. `node --test extension/test/refresh-preflight.test.js`
2. `npm --prefix extension test`
3. `node --check extension/src/service-worker.js`
4. `node --check extension/src/core/refresh-preflight.js`
5. `node --check extension/src/dashboard.js`
6. `node --check extension/src/popup.js`
7. `node --check extension/src/shared/ui.js`
8. `git diff --check`

## 风险、检查点与回滚

- 高风险文件是 `extension/src/service-worker.js` 和 `extension/test/refresh-preflight.test.js`。先实现并验证服务端发布边界，再补测试。
- 不要仅依赖 dashboard 的 `refreshPreflight` 隐藏逻辑；令牌发布和 `REFRESH_ALL` 重新校验必须在服务工作线程完成。
- 如果测试暴露 service worker 重启后 session 预检兼容问题，保留现有 stationSignature 校验，不把进程代次持久化成新的外部字段。
- 回滚顺序：先撤销发布前代次/范围校验，再撤销失效入口接线，最后撤销测试和 spec；不得删除另一比较模式的历史快照。

## 完成前检查

- [x] 异步预检在模式/站点变化后不会发布旧 token。
- [x] 模式切换和站点配置变化各有独立的旧 token 失效测试。
- [x] `enabled: "false"` 不进入预检、采集、进度、错误或快照。
- [x] 完整测试、聚焦测试、语法检查和 `git diff --check` 通过。
- [x] 只读代码审查完成，且无未处理的本任务范围缺陷。
