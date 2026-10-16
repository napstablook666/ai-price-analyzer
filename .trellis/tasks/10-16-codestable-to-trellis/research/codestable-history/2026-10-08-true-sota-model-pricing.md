> Historical source: `.codestable/work/2026-10-08-true-sota-model-pricing.md`.
> Historical status: the original record below is retained verbatim; its test counts, commits, API observations, and working-tree state describe the date recorded and are not current rules.

# 2026-10-08 · TrueSOTA 模型价格适配

## 完成

- 为 `https://true-sota.com/model-pricing` 增加站点适配，固定读取公开 API `/api/v1/model-pricing`。
- 解析 `code: 0` 响应中的 `groups` 与 `models`，按分组 `rate_multiplier` 换算为 USD/百万 tokens；`cache_price` 映射为缓存读价格。
- 站点预置可幂等补入已有站点列表，采集请求使用 `credentials: "omit"`，不携带用户站点凭据。
- 提交：`a7d612cfbdd41bc875fdd2adb2048d4492791565`（`feat(extension): add TrueSOTA model pricing`）。

## CodeStable 归宿

- `.codestable/attention.md`：已记录 TrueSOTA API、价格单位、分组倍率、缓存字段、预置迁移和无凭据采集事实；扩展测试基线已更新为 108 例。
- `.codestable/lessons/2026-10-02-pricing-station-registration.md`：沿用现有 `observed` lesson，补充本次适配涉及的源码证据和 108/108 测试结果；没有新增重复 lesson。
- 本文件：记录本次临时任务状态、提交和剩余工作区归属。

## 验证

- `npm --prefix extension test`：108/108 通过，0 失败。
- 相关 6 个暂存 blob：`node --check` 6/6 通过。
- `git diff --cached --check`、`git diff --check`：通过；仅有 Git 的 LF/CRLF 转换提示。
- 线上 `GET https://true-sota.com/api/v1/model-pricing`：HTTP 200，`code: 0`，5 个分组、59 个模型，存在输入价格字段。

## 工作区归属

- 本次 TrueSOTA 适配已提交，提交包含 6 个文件：`extension/src/core/adapters.js`、`extension/src/core/collectors.js`、`extension/src/core/normalizers.js`、`extension/src/core/station-presets.js`、`extension/src/service-worker.js`、`extension/test/core.test.js`。
- 提交后仍有 15 个已跟踪路径显示未提交修改：6 个本次提交涉及的文件还保留原有混合改动，另有 9 个未触及文件为工作树原有或其他工作线改动。本次未回退或纳入这些内容。
- 项目没有 build 或 lint 脚本；未运行不存在的构建/ lint 命令。
