> Historical source: `.codestable/work/2026-10-07-sidrune-model-plaza.md`.
> Historical status: the original record below is retained verbatim; its test counts, commits, API observations, and working-tree state describe the date recorded and are not current rules.

# 2026-10-07 · Sidrune 适配与比例修正

## 完成

- 为 `https://sidrune.ai/model-plaza` 增加公开价格适配及站点预置，支持按次、Token、缓存和图片报价。
- 新预置默认采用 `USD`，并把 `1 USD : 1 平台币` 换算为人民币等值后保存；保留用户已有的 Sidrune 自定义倍率。
- 适配提交：`0924cf779eae0d4a1c3db07a1f07f1a90ff05c10`。
- 比例修正提交：`973b6e021322ec58497e0da896cf7f82e0125b95`。

## CodeStable

- `.codestable/attention.md` 已记录 Sidrune API、默认比例和测试状态，无需重复添加。
- `.codestable/lessons/2026-10-02-pricing-station-registration.md` 已记录站点预置注册经验，状态保持 `observed`；未新增 lesson。
- 本收尾记录保存在 `.codestable/work/2026-10-07-sidrune-model-plaza.md`，该目录受 `.gitignore` 排除，不纳入提交。

## 验证

- 当前完整工作树 `npm --prefix extension test`：107/107 通过。
- 从提交前暂存索引隔离出的测试副本：94/94 通过。
- Sidrune 比例修正涉及的 4 个 JavaScript 文件 `node --check`：通过。
- 提交差异 `git show --check HEAD`、提交前暂存差异检查及工作树差异检查：通过；Git 提示 LF/CRLF 转换。
- 项目没有 build 或 lint 脚本；未做浏览器实测，未验证线上 API 实时响应。

## 原适配审查

- 原适配冻结补丁 SHA-256：`5A7B52F91C776CBC58DD60325385FF1E94364CC59E4600EF36D266CB1899ABD6`；审查结论 `No findings`。该审查不包含后续比例修正。
- 尚未覆盖生产 API 响应变化及浏览器存储迁移。

## 工作区

- 当前分支 `main`，相对 `origin/main` ahead 12。
- 保留 15 个未暂存的已跟踪扩展文件改动；无暂存差异、无未跟踪文件。这些改动未纳入上述提交。
- Sidrune 适配和比例修正无自动化测试阻塞；线上与浏览器验证仍未完成。
