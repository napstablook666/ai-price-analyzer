> Historical source: `.codestable/work/2026-10-07-batch-jev-model-matching.md`.
> Historical status: the original record below is retained verbatim; its test counts, commits, API observations, and working-tree state describe the date recorded and are not current rules.

# 2026-10-07 · 批量 JEV 核验模型匹配

## 完成

- 看板新增批量核验入口，按站点和规范化后的中转模型名去重，依次请求 JEV `model_match`。
- 仅当置信度达到 50% 时自动保存模型 / 官方匹配；低置信结果与未匹配结果保留给人工处理。
- 核验期间锁定刷新和 JEV 配置入口。若报价、官方目录或配置正在变化，停止批次并提示剩余未处理数量；Service Worker 同时阻止刷新中的匹配请求及保存。
- 沿用现有手动确认映射持久化和匹配流程，没有改动 `comparison_review`。

## 验证

- `npm --prefix extension test`：97/97 通过。
- `node --check`：`extension/src/core/jev-tasks.js`、`extension/src/dashboard.js`、`extension/src/service-worker.js`、`extension/test/core.test.js` 均通过。
- `git diff --cached --check` 与提交后 `git diff HEAD^ HEAD --check` 通过；提交差异仅有 5 个目标文件。
- 未做 Chromium 浏览器实测。

## CodeStable 记录

- `.codestable/attention.md` 已有 JEV 任务语义和 50% 自动确认规则，本次未重复修改。
- 已检查相关 lessons 与既有 JEV 工作记录；没有发现适用于本次且尚无归宿的新经验，不新增 lesson。

## 提交与剩余状态

- 提交：`ebd6b1020930fd9e1f9fd16b202bc4a967d9e696`（`feat(extension): batch JEV model matching`）。
- 提交文件：`extension/dashboard.html`、`extension/src/core/jev-tasks.js`、`extension/src/dashboard.js`、`extension/src/service-worker.js`、`extension/test/core.test.js`。
- 提交后仍有 15 个已跟踪文件处于未暂存修改状态，属于工作区原有的其他改动；未纳入本次提交，也未清理。


## 提交后审查

- 审查提出设置页官方目录刷新与批量核验可能并发。复核确认 `refreshOfficialReferences()` 设置 `refreshReferencesTask` 并广播 `REFERENCES_REFRESHING`；dashboard 监听此事件并阻止批次启动/继续；Service Worker 在 JEV 请求前、请求后及保存前检查该状态。该 finding 已由现有实现覆盖，无需代码修改。
- 现有回归测试覆盖这些状态门禁，但未做浏览器并发实测；本次复核未改代码，沿用收尾时 97/97 的测试结果。
- 后续审查称 `REFRESH_ALL` 绕过参考价 single-flight；核对当前提交确认 `refreshAllInternal()` 调用 `refreshOfficialReferences(forceReferences)`，与 `FETCH_REFERENCES` 共用 `refreshReferencesTask`，该 finding 不适用。审查报告中的测试为 97/97 通过。
