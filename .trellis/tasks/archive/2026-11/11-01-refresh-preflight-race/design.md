# 修复刷新预检令牌竞态技术设计

## 1. 变更边界

当前行为缺口在 `extension/src/service-worker.js`：页面预检跨越多个异步 `await`，而模式、站点和设置保存路径会在另一个请求中清除预检；旧预检完成后仍可能无条件把令牌写回 `activeRefreshPreflight`。本任务在服务工作线程增加预检代次/失效版本，让发布前校验成为服务端最终边界，并在刷新预检测试中覆盖竞态和非布尔禁用值。

预期修改文件：

- `extension/src/service-worker.js`：维护只用于当前扩展进程的预检代次；创建预检时捕获代次和范围签名，在异步页面探测完成后重新验证代次、模式和站点签名，过期结果不得发布或持久化；统一所有会清除预检的路径递增代次。
- `extension/test/refresh-preflight.test.js`：增加延迟页面预检竞态、模式切换后直接确认失效、站点配置单独失效，以及 `enabled: "false"` 的分组全链路回归测试。
- `.trellis/spec/frontend/pricing-data-contract.md`：若实现形成新的可复用契约，补充预检异步发布必须经过代次/范围复验的规则。

明确不修改：

- `extension/src/core/refresh-preflight.js` 的令牌格式和签名算法，除非测试证明当前接口无法表达所需校验。
- `extension/src/core/refresh-scheduler.js`、采集器、页面桥接和站点适配器。
- 已提交的分组刷新 UI、比较算法、预检有效期和并发数。
- 工作区中 ai.centos.hk、Linux.do、Vyce 或 Trellis bootstrap 等其他任务的未提交改动。

## 2. 失效模型

### 2.1 预检版本

在 `service-worker.js` 内维护 `let refreshPreflightRevision = 0`。版本只用于本次 service worker 生命周期内的并发排序，不作为外部 API 字段，也不替代现有 token、expiresAt 或 stationSignature。

引入两个内部操作：

```js
function invalidateRefreshPreflight() {
  refreshPreflightRevision += 1;
  activeRefreshPreflight = null;
  return persistRefreshPreflightState();
}

function currentRefreshPreflightFingerprint(settings, stations) {
  const scope = refreshScope(stations, settings.comparisonMode);
  return {
    scope,
    stationSignature: refreshStationSignature(scope.stations, scope.comparisonMode)
  };
}
```

实际命名可按现有代码风格调整，但行为必须保持一致。所有原来调用 `clearRefreshPreflightState()` 的业务失效路径先递增版本，再清理内存和 session 存储；仅用于刷新确认一次性消费或取消的清理也应使用同一失效边界，防止已经启动的旧预检随后发布。

### 2.2 创建预检

`createRefreshPreflight()` 在读取当前 settings/stations 后捕获：

- `const requestRevision = refreshPreflightRevision`
- 规范化的 `comparisonMode`
- 当前分组站点的 `stationSignature`

逐站进行页面探测。探测完成后，在写入 `activeRefreshPreflight` 前重新读取当前准备后站点和 settings，重新计算当前范围签名，并要求：

1. `requestRevision === refreshPreflightRevision`
2. 当前模式等于请求模式
3. 当前分组签名等于请求开始时的签名

任一条件不满足，旧请求不得写入 `activeRefreshPreflight` 或 session。推荐返回一个不带旧 token 的可识别结果，或抛出现有 `REFRESH_CONFIRMATION_REQUIRED` 语义；调用方不得把它当成可确认预检。清理旧临时标签页的现有逻辑必须继续执行，避免竞态留下预检创建的页面标签。

即使变更恰好发生在重新读取范围之后、发布之前，也必须由 revision 校验兜底。模式/站点保存路径的失效操作先增加 revision，再执行异步 session 清理，避免旧创建请求在 `clearRefreshPreflightState()` 的 await 间隙发布。

### 2.3 当前清理与恢复

`restoreRefreshPreflightState()` 恢复 session 中的预检时，不回退 revision，也不让旧 session 记录绕过当前 scope/signature 校验。`dashboard()` 已有的签名校验继续保留。

如果 service worker 重启，revision 会从 0 开始，但 persisted preflight 仍由 `REFRESH_ALL` 的当前模式和 stationSignature 校验；本任务不引入持久化代次，因为持久化的站点范围签名已经是跨生命周期的安全边界。

### 2.4 非布尔 enabled

生产代码已有严格 `station.enabled === true` 的分组范围和单站检查。本任务只补回归测试，不把 `normalizeStation()` 改成隐式布尔转换，也不扩大范围过滤到调度器以外的路径。

测试通过一个当前分组的正常启用站点和一个 `enabled: "false"` 的同组站点，断言：

- 预检结果不包含字符串禁用站点
- `REFRESH_ALL` 的采集/快照/进度总数只包含正常站点
- 完成摘要的 total/stationCount 不包含字符串禁用站点

## 3. 数据流

```text
SAVE_COMPARISON_MODE / SAVE_STATIONS / SAVE_SETTINGS / IMPORT_STATE
        │
        ├─ increment preflight revision
        └─ clear active + persisted preflight

REFRESH_PREFLIGHT
        │ capture revision + mode + scoped station signature
        ├─ await page probes
        ├─ re-read current settings/stations
        ├─ validate revision + mode + signature
        └─ publish token only when all match

REFRESH_ALL
        ├─ recompute current scope
        ├─ assert existing token + mode + signature
        └─ dispatch only current enabled group
```

## 4. 兼容性与错误处理

- `REFRESH_PREFLIGHT` 的成功响应字段不变。
- 旧异步预检不会覆盖新预检；旧请求不能产生可确认 token。
- 模式切换后的直接 `REFRESH_ALL` 使用旧 token 必须得到 `REFRESH_CONFIRMATION_REQUIRED`。
- 空分组和严格启用规则保持现有行为。
- 不捕获并吞掉页面探测错误；只在发布边界拒绝已过期结果。

## 5. 验证策略

- 用测试 harness 的 deferred page response 控制一个页面预检的完成时机，验证模式切换发生在等待期间时旧请求不能发布。
- 单独验证模式切换后的旧 token，不能先调用 `SAVE_STATIONS` 来间接清理。
- 单独验证站点配置变化后的旧 token。
- 验证 `enabled: "false"` 不进入预检和实际刷新集合。
- 运行完整扩展测试、聚焦预检测试、5 个受影响 JS 文件的 `node --check` 和 `git diff --check`。
