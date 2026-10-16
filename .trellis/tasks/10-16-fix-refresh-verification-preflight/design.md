# 技术设计

## 变更边界

本任务包含两个紧密相关的修复：

1. 确保 dashboard 统计、刷新调度器和采集使用同一份 prepared station，修复真实普通站点被批量标记待核验的问题。
2. 给批量刷新增加页面登录态 preflight 和人工确认门禁，不在用户确认前写快照或启动价格采集。

不修改凭据存储、导入导出、推荐算法和 provider 的实际未核验判断。

预计修改：

- `extension/src/service-worker.js`：统一 dashboard/refresh station preparation；增加 `REFRESH_PREFLIGHT` 和确认后的 `REFRESH_ALL` 参数/状态；管理临时预检标签页。
- `extension/src/core/refresh-scheduler.js`：保持正式刷新逻辑纯粹，或增加显式 preflight 状态契约，不让 preflight 混入快照写入。
- `extension/src/core/page-tabs.js`：复用已有标签并记录本次预检创建的临时标签，提供登录态检查和只关闭临时标签的边界。
- `extension/src/dashboard.js`、`extension/dashboard.html`：显示预检结果、未登录站点、取消和“确认开始刷新全部”按钮；确认前不调用正式刷新。
- `extension/test/core.test.js` 及必要的 dashboard/service-worker 测试：覆盖真实 prepared station 形状、preflight、确认门禁、临时标签清理和保护状态。
- `.trellis/spec/frontend/pricing-data-contract.md` 或相关 workflow spec：记录 dashboard/refresh 共享 prepared station 和 preflight 门禁。

## 真实统计数据流

```text
IndexedDB stations
  -> getStations()
  -> prepareComparisonStation()
  -> GET_DASHBOARD / REFRESH_ALL
  -> buildComparisonRows() / collectStation()
  -> currency/recharge verification gates
```

两条入口必须调用同一个准备函数，不能一个入口读原始 station、另一个入口读 prepared station。测试应直接构造旧记录并分别走 dashboard 与 refresh 使用的入口，断言普通站点得到 `priceCurrency: "CREDITS"`、`priceCurrencyVerified: true`，明确保护 provider 保留 false。

## 登录 preflight 数据流

```text
Dashboard: click refresh all
  -> REFRESH_PREFLIGHT
  -> service worker selects enabled page-auth stations
  -> find/reuse/open station tabs
  -> page bridge performs safe auth/session probe
  -> return { ready, needsLogin, uncertain, noLoginRequired }
  -> close only preflight-created tabs for ready stations
  -> dashboard waits for user action
  -> user clicks confirm
  -> REFRESH_ALL with preflight token/state
  -> existing refresh scheduler and snapshot writes
```

### 登录判断

- 复用 `provider-registry` 的 request policy、page auth 和现有 `withPageFetch()`/bridge 能力，不新建一套凭据读取逻辑。
- 预检请求必须是无副作用、足以确认会话的 GET 或已存在的页面 bridge 检查；禁止提交表单、刷新凭据或写入站点状态。
- 401/403、会话失效和明显登录页归入 `needsLogin`；网络异常或无法确定归入 `uncertain`，要求用户手动确认后再决定是否开始。
- 只关闭本次 preflight 创建的临时 tab。复用的用户已有 tab 不关闭，未登录 tab 保持可供手动登录。

### 确认门禁

- preflight 结果存放在 service worker 的短生命周期状态中，带站点 id 集合和一次性 token/时间戳，避免旧结果被误用于下一次刷新。
- `REFRESH_ALL` 在缺少有效 preflight 确认时返回稳定错误，不启动 `runRefreshAll()`。
- dashboard 的确认按钮只在 preflight 完成后可用；用户取消或预检过期时清空状态。
- 正式刷新仍使用现有并发、错误快照和进度事件；登录失败站点按现有失败隔离处理，不影响已成功站点。

## 兼容与风险

- 公开直连站点不需要 preflight，保持现有刷新入口。
- 旧快照不因 preflight 自动删除；只有正式刷新成功/部分成功时才按现有保存策略写入新快照。
- 不把“登录失败”转换成已核验币种；它只影响本次刷新资格和错误状态。
- 若页面 bridge 无法安全判断登录态，保守返回 `uncertain`，由用户确认后继续，正式采集仍按真实响应决定是否阻断。

## 回滚

- 若 preflight 与 provider 页面策略冲突，回滚 preflight 门禁和临时 tab 管理，保留 prepared station 统一修复。
- 若 dashboard 状态复杂度过高，保留 service worker 的确认门禁，将展示缩减为最小站点列表，不在刷新函数内加入隐式等待。
