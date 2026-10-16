> Historical source: `.codestable/work/2025-10-01-cost-preset-fix.md`.
> Historical status: the original record below is retained verbatim; its test counts, commits, API observations, and working-tree state describe the date recorded and are not current rules.

# 2025-10-01 · 成本口径预设修复与收尾

## 修复：成本口径预设选不上「基础估算」

- 根因：`baseline` 预设未定义 `peakShare`，而 `usagePresetId()` 用 `Number(preset.usage[field])` 对比表单读回的全部 8 个字段；`Number(undefined)` 为 `NaN`，永远不相等 → `syncPresetControls()` 总把下拉框弹回「自定义」。
- 修改：
  - `extension/src/shared/schema.js`：新增导出纯函数 `usagePresetId(usage)`，只对比预设自己定义的字段（可在 node:test 单测）。
  - `extension/src/options.js`：改用 schema 实现；`writeUsageInputs` 跳过传入对象缺失的字段（应用预设不再把高峰占比清零）；`applyUsagePreset` / `applyRefreshPreset` 遇 `custom` 直接返回（数值匹配预设时「自定义」不再被弹回）。
  - `extension/test/core.test.js`：新增回归测试 `matches the baseline usage preset regardless of peak share`。

## 验证

- `cd extension && npm test`：66/66 全绿（期间一次 `uses FastAIToken page auth...` 失败为并发编辑中途瞬态，稳定后复跑通过）。

## 收尾（最终状态）

- `.gitignore` 补 `*.har`（根目录 `login-trace.har` 为抓包调试产物，不入库）；并发会话重复添加了一条，已去重并提交 `ce7be24 chore: dedupe *.har ignore rule`。
- 并发会话已将全部改动（含本修复）合并提交为 `57cfccf feat: add JEV chat adaptation and station daily check-in`（分节信息、66/66 全绿；合并理由：两个功能域交叉严重，按文件拆分会产生不可编译的中间提交）。本修复折入该提交 diff，但提交信息未单列——如需可在 push 前 squash/amend 补一条「fix: cost usage presets match only their defined fields」。
- 工作树干净；不 push（用户未要求）。
