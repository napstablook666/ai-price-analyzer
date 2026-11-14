# 站点管理 UI 重构：小卡片 + 批量管理 + 配置项收紧

## 背景

用户连续两轮反馈 `options.html#stations` 的「已添加站点」区域：

1. 卡片展开后占一大块，行与行没有色块区分（已部分修复：斑马纹 + 字段三列化）。
2. 一行一个站点占位置，插件多了不好管理；前端风格直接抄 magpie 插件页。
3. 配置项太多，插件化后站点地址、适配参数都是插件内置的，不该让用户配，全部删掉，只保留用户自定义项。

参考：magpie「已安装插件」页——紧凑列表、每行图标+名称+徽章+状态、右侧操作按钮（选项/停用/移除），顶部 tab 过滤 + 搜索。

## 目标

- 已添加站点改为**小卡片网格**（一张卡 140px 高以内，一行 3-4 张），32 个站点一屏能看十几个。
- 支持**批量管理**：多选 → 批量启用 / 停用 / 删除。
- 卡片上的配置项收紧，只留用户真正需要自定义的。
- 视觉沿用现有 `styles/base.css` token，风格向 magpie 插件页靠拢（密度、徽章、操作排布）。

## 设计决定（草案）

### 卡片内容（默认态，只读）

- 状态点 + 站点名称 + host（插件内置，不再显示 UUID）
- 徽章：付费/公益、采集模式（直连/页面）
- 充值比例摘要：`20.4 CNY : 3 中转币`（公益站显示「公益：不计汇率」）
- 参与比价开关（switch，点一下就生效）
- 操作：配置、查询模型、删除

### 配置弹层（点「配置」打开，复用 station-dialog）

保留的用户自定义字段：

- 站点名称（昵称）
- Token / 密钥、用户名、密码（认证信息，插件决定认证方式，用户只填值）
- 充值金额 + 币种、到账中转币、充值比例（派生只读）
- 我已核实模型价格币种 + 核验备注
- 基础价 / 1M USD

删除的字段（插件内置或添加时自动探测，不再出现在 UI）：

- 模型列表/站点地址（插件内置 baseUrl）
- 采集模式（插件 manifest.mode）
- 请求体 JSON、接口路径、响应格式、请求方式、手动价格 JSON（插件 adapter / 添加时自动探测）
- 站点 UUID 不再展示

数据层不删字段：station 记录仍带 adapter/baseUrl，只是 UI 不再暴露编辑入口。手动添加的站点在「添加站点」对话框分析阶段自动探测适配参数。

### 批量管理

- 卡片左上角 checkbox（或悬浮出现），顶部出现批量操作条：全选、批量启用、批量停用、批量删除、取消。
- 批量删除走现有确认流程（一次确认）。

### 保留不变的

- 顶部「本地插件目录」多选添加区不动。
- 「添加站点」手动 URL 分析对话框不动。
- 保存逻辑：卡片开关/弹层保存仍写回同一份 station 记录结构，导出/导入兼容。

## 验收

- `cd extension && npm test` 全绿。
- 手动走一遍：插件目录添加站点 → 卡片出现 → 开关切换 → 配置弹层改充值比例保存 → 批量停用/删除 → 比价表数据正确。

## 已定方案

1. 配置项走弹层（`#station-config-dialog`），卡片不内联展开。
2. 批量操作只做启用 / 停用 / 删除，删除一次确认。
3. 手动添加站点同样隐藏适配字段，分析阶段自动探测。

## 落地记录（2026-11-14）

- `extension/src/options.js`：`stationCard()` 改为三行卡片（名称 + 开关 + 图标操作 / 徽章 / 充值比例 / 查询状态）；新增 `updateStationBatchBar()`，`state.selectedStationIds` 驱动批量条；`renderStations()` 清理失效选中项。
- `extension/options.html`：新增 `.station-batch-bar`（全选、已选计数、批量启用/停用/删除）与 `#stations-list`；站点配置弹层只剩名称、Token、用户名、密码、充值金额/币种、到账中转币、只读充值比例、基础价、币种核实与备注。
- `extension/styles/options.css`：`.stations-list` 改为 `repeat(auto-fill, minmax(320px, 1fr))` 网格；卡片 switch 缩到 34×20，图标按钮 26px；删除 `.station-disclosure/.station-summary/.station-grid/.station-advanced` 等旧样式。
- 验证：`npm test` 241 通过；`node scripts/plugin-build.mjs --check` 无漂移；用 headless Chromium 对卡片网格与配置弹层截图核对（临时预览目录已删）。
- 提交：`9b0f771 refactor(extension): compact station card grid with batch management`。
