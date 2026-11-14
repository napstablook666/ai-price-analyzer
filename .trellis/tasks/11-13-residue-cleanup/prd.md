# 清理 LLM/JEV 删除后的残留与冗余

## 背景

`11-13-llm-jev-removal-agent-access` 把扩展里内嵌的 LLM 站点适配建议和 JEV 模型核验整块删掉，留下三类残留：初始化数组仍指向已删除的视图、UI 措辞还在说「Agent 添加」、CSS 与 JS 里留下没有调用方的分支。

## 范围

第一阶段（已完成）

1. `extension/src/options.js` 的 `SETTINGS_VIEWS` 去掉 `providers`。`options.html` 里该 tab 与 panel 已随模型服务视图删除，`activateSettingsView()` 对 `null` 调 `setAttribute` 会让设置页脚本整体中断。
2. 把「Agent 添加」措辞换成按站点地址添加的真实行为表述：`extension/options.html` 按钮文案与图标、`extension/src/options.js` 插件徽章与卡片 class、`extension/src/site-plugins/catalog.js` 三条不可勾选插件的描述、`extension/styles/options.css` 对应选择器。
3. 删掉只为已删除的「模型服务」卡片服务的孤儿样式：`.config-grid`、`.config-card`、`.config-heading`、`.provider-profile-row`、`.provider-profile-actions`、`.field-grid`，以及响应式段里对它们的引用。共享同一行的 `.usage-grid` / `.station-grid` 规则保留。
4. 删掉 `extension/src/options.js` 里恒为空的 `unavailableAction` 常量及其三处拼接。

第二阶段（已完成）

- `extension/src/core/station-presets.js` 从 104 行压到 17 行：删掉 15 个 `addXxxStationPreset` 包装、`addRegisteredStationPreset`、`addRegisteredStationPresets`、`addPublicStationPresets`，以及文件末尾转出 `provider-registry` 常量的一整块 `export {}`。只留 `addStationPreset`（内部）与 `addProviderStationPresets`（唯一生产调用方）。
- `addStationPreset` 里的 `allowEmpty` 分支删掉：生产路径一直是 `allowEmpty: true`，`!stations.length` 那条早就不生效，空列表播种是当前真实行为。
- `extension/src/shared/db.js` 删掉 `addStationIfNeeded`（15 行，无生产调用方）。
- `extension/src/site-plugins/loader.js` 删掉 `loadAllSitePlugins`。
- `extension/test/core.test.js`：56 处包装调用改走 `addProviderStationPresets(stations, [providerById(id)])`，9 处 `addRegisteredStationPresets` 改走 `addProviderStationPresets(stations, PROVIDER_REGISTRY)`，测试引导改为 `loadSitePlugins(SITE_PLUGIN_CATALOG.map(plugin => plugin.id))`；`addXxx([]).length === 0` 的断言按现状改成 `=== 1`（现在空列表会播种），`向空列表注入整个注册表` 的两条断言删掉；整个 `addStationIfNeeded` 假 IndexedDB 测试块删除。
- 结果：`node --test extension/test/*.test.js` 241 例全过（原 242 例，删掉那条假 IDB 用例）。

## 验收

- `extension/options.html` 里 `$("#id")` 的每个引用都能在 HTML 里找到对应元素（脚本静态比对）。
- `SETTINGS_VIEWS`、`data-settings-target`、`settings-view-*` 三段列表完全一致。
- `extension/` 下不再出现 `Agent 添加`、`is-agent-only`、`data-icon="bot"`、`unavailableAction`。
- `node --test extension/test/*.test.js` 不出现由本次改动引入的失败。

## 已知冲突

`extension/test/core.test.js`、`extension/src/core/canonical*.js`、`extension/src/core/matching.js` 正被 `11-13-canonical-models-plugin-split` 那条线改写，测试数从 230 涨到 232，canonical 相关用例处于失败态。第二阶段的删减要等这条线落定再做，否则会在同一文件上打架。