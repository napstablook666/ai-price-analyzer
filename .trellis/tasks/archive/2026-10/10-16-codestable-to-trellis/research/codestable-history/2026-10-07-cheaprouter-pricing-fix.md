> Historical source: `.codestable/work/2026-10-07-cheaprouter-pricing-fix.md`.
> Historical status: the original record below is retained verbatim; its test counts, commits, API observations, and working-tree state describe the date recorded and are not current rules.

# 2026-10-07 · CheapRouter 模型价格采集修复

## 完成

- 为 `cheaprouter.cc/models` 增加站点预置、页面模式适配和启动时持久化迁移。
- 通过已登录页面上下文请求同源公开价格接口 `/api/v1/pricing/public?timezone=Asia%2FShanghai`。
- 增加 CheapRouter 公开 API 归一化，以及页面卡片价格解析回退。
- 增加站点迁移、API 采集和 DOM 采集回归测试。

## 工作区归属

- 本次提交只包含 CheapRouter 修复涉及的 8 个源码和测试文件，以及本记录和 CodeStable 稳定事实更新。
- 其余未暂存的扩展界面、JEV、其他站点适配和共享逻辑改动属于工作区原有改动，本次未纳入。

## 验证

- 当前工作树：`npm --prefix extension test`，97/97 通过。
- 独立 `HEAD + 仅 CheapRouter 修复` 副本：84/84 通过。
- 暂存差异：`git diff --cached --check` 通过。
- 纯扩展 JavaScript，无构建脚本；未运行不存在的构建命令。
- Chromium 实测已访问 `https://cheaprouter.cc/models`，页面返回 `API_KEY_REQUIRED`，当前浏览器没有可用登录态或 API Key，无法验证模型卡片渲染；session 已停止。

## CodeStable 记录

- 更新 `.codestable/attention.md`，同步测试总数并记录 CheapRouter 的页面会话、公开接口和 DOM 回退事实。
- 合并证据到已有 `.codestable/lessons/2026-10-02-pricing-station-registration.md`，保持 `observed`，未新增重复 lesson。

## 提交

- 提交消息：`fix(extension): collect CheapRouter model prices`
- 提交：`4b85e6c1c9e866f3f96a9d9106d9902a062fb392`（`fix(extension): collect CheapRouter model prices`）。
