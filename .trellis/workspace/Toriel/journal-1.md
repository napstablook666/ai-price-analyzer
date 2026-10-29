# Journal - Toriel (Part 1)

> AI development session journal
> Started: 2026-10-16

---



## Session 1: 修复币种核验与刷新登录预检
<!-- trellis-session: v=2 fp=30e28455ad1fd9da -->

**Date**: 2026-10-16
**Task**: 修复币种核验与刷新登录预检
**Branch**: `main`

### Summary

统一普通中转站和 OpenRouter 的中转币比较语义，修复普通站点历史核验状态和刷新使用未准备站点的问题；增加刷新前页面登录预检、临时标签管理、人工确认门禁和回归测试。核心测试 155/155，扩展完整测试 174/174，预检测试 11/11。保留工作区其他未提交改动，00-bootstrap-guidelines 仍在进行中。

### Git Commits

| Hash | Message |
|------|---------|
| `45ceeab` | fix(extension): normalize model pricing as credits |
| `41dbd08` | fix(extension): refresh prepared station currency state |
| `5e821f2` | fix(extension): add refresh login preflight |

### Status

[OK] **Completed**


## Session 2: 迁移 CodeStable 到 Trellis
<!-- trellis-session: v=2 fp=c821912ce2f9676d -->

**Date**: 2026-10-16
**Task**: 迁移 CodeStable 到 Trellis
**Branch**: `main`

### Summary

将 CodeStable 的 durable facts 迁入 Trellis frontend specs，保留 9 份带历史标记的工作记录并建立迁移映射，删除 .codestable/ 及专属 .gitignore 规则。扩展测试 175/175、Trellis context validation 和 git diff --check 通过；产品源码及其他工作线改动未纳入本次提交。

### Git Commits

| Hash | Message |
|------|---------|
| `354ea71` | docs: migrate CodeStable knowledge to Trellis |

### Status

[OK] **Completed**


## Session 3: 修复币种核验状态
<!-- trellis-session: v=2 fp=bb60b59651c14c59 -->

**Date**: 2026-10-16
**Task**: 修复币种核验状态
**Branch**: `main`

### Summary

定位并修复 KillAI 与 fuck-everyone 模型价格已按 CREDITS 采集、但准备阶段仍保留 priceCurrencyVerified=false 导致币种待核验的问题。现在旧 false/missing 状态会在准备阶段规范为 CREDITS/true，充值比例核验仍独立保留；新增两类受保护站点的采集、比较、仪表盘回归测试。核心测试 155 条、刷新仪表盘测试 11 条通过，提交 d379b8e。

### Git Commits

| Hash | Message |
|------|---------|
| `d379b8e` | fix(extension): clear stale protected currency warnings |

### Status

[OK] **Completed**


## Session 4: 移除充值比例核验阻断
<!-- trellis-session: v=2 fp=6bdec0e8793a0233 -->

**Date**: 2026-10-17
**Task**: 移除充值比例核验阻断
**Branch**: `main`

### Summary

完成充值比例核验功能移除：未确认或缺失比例按 1:1 参与比较，删除 dashboard 和选项页提示，保留已确认比例及币种核验等独立保护。核心回归与扩展完整测试均通过；充值比例任务已归档。工作区其他并行修改和 00-bootstrap-guidelines 保持不变。

### Git Commits

| Hash | Message |
|------|---------|
| `2c0a5ad` | fix(extension): remove recharge ratio verification blocker |

### Status

[OK] **Completed**


## Session 5: Code Humanizer 清理
<!-- trellis-session: v=2 fp=code-humanizer-fixes -->

**Date**: 2026-10-21
**Task**: 修复 Code Humanizer 审计发现
**Branch**: `main`

### Summary

完成归档审计中的 7 个可执行问题：后台清理、预检状态恢复和定时签到失败现在会告警但保持原有结果、状态和调度语义；Trellis 配置解析异常保持 fail-open 并输出警告；站点预设和签到匹配复用 `stationContext()`；删除过时的站点专属注释。新增失败路径和标准化回归覆盖。扩展测试 187/187、预检测试 15/15、Node 语法检查、价格脚本、版本检查、Python 解析器 smoke check 和 `git diff --check` 均通过。工作区其他修改未纳入提交。

### Git Commits

| Hash | Message |
|------|---------|
| `17fae69` | fix(extension): surface background failures and reuse station context |
| `3625d9b` | fix(trellis): warn on config parser fallback |
| `631e8f9` | chore(task): archive code humanizer fixes |

### Status

[OK] **Completed**


## Session 6: KillAI per-request pricing adaptation
<!-- trellis-session: v=2 fp=62b2f868b0eda906 -->

**Date**: 2026-10-29
**Task**: KillAI per-request pricing adaptation
**Branch**: `feat/sevenai-model-plaza`

### Summary

Added KillAI per_request-to-request billing mapping using the shared model-plaza parser. Added regression coverage for per_request_price/request_price aliases, one-time group multiplier, empty token/image fields, no partial diagnostics, and unchanged authenticated page collection. Documented the pricing contract. Validation: extension tests 188/188 passed; JS syntax and diff checks passed.

### Git Commits

| Hash | Message |
|------|---------|
| `c9ffc9d` | fix(extension): support KillAI per-request pricing |

### Status

[OK] **Completed**
