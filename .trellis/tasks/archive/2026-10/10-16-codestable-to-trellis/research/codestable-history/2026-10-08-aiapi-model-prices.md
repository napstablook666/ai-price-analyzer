> Historical source: `.codestable/work/2026-10-08-aiapi-model-prices.md`.
> Historical status: the original record below is retained verbatim; its test counts, commits, API observations, and working-tree state describe the date recorded and are not current rules.

# 2026-10-08 · AIAPI 模型价格页适配

## 完成

- 为 `https://cn.aiapi.bot/dashboard/model-prices` 增加登录态页面采集，读取 `GET /api/me/model-catalog`。
- 解析 `data.data.source` 模型分组与 `effective` 单价；价格已是 CNY/百万 tokens，不重复应用充值倍率。
- 站点预置可幂等补入已有站点列表；页面请求使用浏览器登录态，不保存扩展侧站点凭据。
- 代码提交：`8e8a0738ab8dc268176d1b62f65df2c52e19555d`（`feat(extension): add AIAPI pricing adapter`）。

## CodeStable

- `.codestable/attention.md` 已记录 AIAPI 接口、价格单位与站点迁移事实。
- 更新既有 `.codestable/lessons/2026-10-02-pricing-station-registration.md` 的证据；保持 `observed`，未新增重复 lesson。

## 验证

- 已登录页面 API 返回 HTTP 200，采集所需响应结构已确认；浏览器 session 已停止。
- `npm test --prefix extension` 串行复验：107/107 通过。
- 一次并行验证中 Sidrune 价格断言失败（`7.3 !== 1`），随后单独运行及串行全套测试均通过，未能复现。
- 11 个相关 JavaScript 文件 `node --check`、暂存与未暂存 `git diff --check` 均通过；Git 仅提示 LF 将来可能转为 CRLF。
- `npm --prefix extension run` 显示只有 `test` 脚本；没有 build 或 lint 脚本。

## 工作区

- AIAPI 变更只含适配相关源码与测试，未纳入其他站点或 UI 改动。
- 当前分支 `main` 比 `origin/main` ahead 10；工作区仍有 15 个已跟踪文件修改，其中 7 个保留暂存状态。它们未纳入本次 AIAPI 提交。
- 本记录与 attention/lesson 位于 `.gitignore` 排除的 `.codestable/`，仅本地保存。
