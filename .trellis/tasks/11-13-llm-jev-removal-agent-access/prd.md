# 删除扩展内 LLM/JEV 模块

## Goal

把扩展里内嵌的两条 AI 辅助线（LLM 站点适配建议、JEV 模型匹配/比价复核/人工匹配确认）从扩展代码中完整移除。本地 agent 接入已由用户决定暂缓（原 R2 移出本任务范围，另立任务再议）。

## 已定决策

- LLM 与 JEV 整块删除，含其 UI 与消息处理器。
- JEV 连带的人工匹配确认/移除按钮（`modelJevMarkup`，含 remove 人工覆盖入口）一并删除；`modelMatchOverrides` 机制与已有数据保留，匹配引擎（`matchModelWithOverrides`、`buildModelMatchIndex`）不动。删除后 UI 无新增/移除覆盖入口（可用状态导出编辑）。
- `SUGGEST_ADAPTER`（adaptStation）保留，改为纯本地规则：`inferStationAdapter(station)` + 快照探测 discovery，不再走 LLM。
- 供应商档案机制（providerProfiles/activeProviders，仅服务 llm/jev）整块删除。
- 站点凭据存储（`ai-price-analyzer:tokens`）保留不动。

## 配置备份（已交付用户，未落仓库）

- JEV：`https://sub.nekopeer.com/v1/systemone`，modelId `jev-1.13.2`，key `sk-gl-37ca6f76e709b7833577e5b548c86304`，profile `46b99725-b9cf-489a-b865-e65307ceed63`（Nekopeer Jev）。
- LLM：`https://cn2.s2api.top/v1` / `gpt-6-luna`（另有本机 `http://127.0.0.1:3425/v1` / `auto/glm-5.3-flash` 记录），key `sk-c2c96d9a2954df5a1b14d36e86319714f0c6ef0ec18858ab40e3466ebf4a35d6`，profile `d2d8067d-c9f6-40db-a910-52ccf8bad24d`。
- 来源：扩展 ID `lofpahajllidjpkjiehdmbniallljifl`，profiles `Temp/career-lens-inspect/chrome-profile-live` 与 `AppData/Local/Citro Labs/ego lite/User Data/Default`。

## Requirements

- 删除文件：`extension/src/core/jev-tasks.js`、`extension/src/core/model-api.js`（已完成）。
- `adapters.js` 重写：仅保留 `inferStationAdapter`（去 jev 参数）与 `normalizeEndpoint`（已完成）。
- `matching.js`：删 `JEV_MODEL_CANDIDATE_LIMIT`、`suggestModelCandidates`、`getJevModelCandidates`、`GENERIC_MODEL_TOKENS`；保留 `matchModel`、`matchModelWithOverrides`、`matchOne`、`buildModelMatchIndex`、`normalizeProxyModelName`。
- `schema.js`：删 `DEFAULT_LLM_CONFIG`、`DEFAULT_JEV_CONFIG`、`normalizeModelConfig`、`normalizeProviderProfiles`、`activeJevProfile`、`providerProfiles/activeProviders`；`normalizeSettings` 显式 `delete` 旧数据中的 `llm/jev/providerProfiles/activeProviders` 键（存储兼容）。
- `credentials.js`：删 llm/jev/provider key 全套函数与常量；保留站点 tokens 三件套与 `CREDENTIAL_STORAGE_KEY`。
- `service-worker.js`：删 ANALYZE_JEV / SAVE_JEV_MODEL_MATCH / REMOVE_JEV_MODEL_MATCH / FETCH_MODEL_CATALOG / TEST_MODEL_CONNECTION 及 provider profile 系列处理器、`assertModelMatchJevIdle`、`jevRequestConfig`、`getModelRequestConfig`、analyze/save/remove jev 函数；adaptStation 简化为本地规则；settingsForUi 去掉 hasApiKey/profiles 字段。
- `dashboard.js`：删 jev 状态、渲染、批量核验、供应商切换、相关 import 与调用点。
- `options.js` / `options.html`：删「模型服务」设置视图（LLM/JEV 卡片、模型列表、连接测试、档案管理）与对应 wiring。
- `dashboard.html`：删 provider 切换器与批量 JEV 按钮；`styles/dashboard.css` 删 `.jev-*`。
- `test/core.test.js`：删 JEV/LLM 相关测试，调整 `inferStationAdapter` 调用签名。
- 文档：README.md、README.zh-CN.md、PRIVACY.md 去掉 JEV/LLM 描述。

## Acceptance Criteria

- [x] 扩展代码与 UI 中不再有 LLM/JEV 痕迹；含旧 llm/jev 字段的 settings 加载正常。
- [x] `npm test` 全绿。
- [x] 采集→比价→展示主流程行为不变（本地规则适配、匹配引擎、覆盖数据均保留）。
