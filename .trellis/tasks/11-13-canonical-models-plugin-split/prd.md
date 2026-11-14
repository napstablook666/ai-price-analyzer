# 统一模型层与插件仓库拆分

## Goal

解决「不同中转站对同一个模型用不同名字」的统一模型问题，并把站点适配从扩展里剥离：扩展只做采集引擎、匹配引擎、UI 与插件协议，每个站点插件自带它的模型拼写适配。

## 背景与已定决策

- 统一模型从来不由 LLM/JEV 负责。现有链路是 `OpenRouter 目录 + 别名索引 + 四条匹配规则 + modelMatchOverrides`，LLM/JEV 只做「页面结构推断适配」和「候选建议」，已在任务 `11-13-llm-jev-removal-agent-access` 中删除，链路未受影响。
- 参照 Magpie 的做法：规范拼写来自外部权威注册表（models.dev），同一模型的所有历史拼写都解析到同一个规范 id（`CanonicalRef` 语义），匹配是纯查表，不依赖 AI。
- **规范名来源**：models.dev 的拼写索引做规范名（`https://models.dev/api.json`），OpenRouter 继续做价格参考，两者合并成一张表。
- **仓库拆分**：先落成两个自包含单元 `extension/`（扩展与核心）与 `plugins/`（站点插件）。`plugins/` 不引用扩展内部相对路径，只写 `@app/core/…` / `@app/shared/…`，由构建器改成扩展内路径，因此抽成独立仓库时不需要改代码。

## 实际落地（与初版计划的差异）

- 规范表生成物落在 `extension/src/core/canonical-table.js`，不是仓库根的 `canonical/models.json`：MV3 的 service worker 只能 import 扩展目录内的模块，放根目录运行时不认。生成器仍是 `canonical/build.mjs`，`--offline` 用本地缓存重算。
- 插件形态收敛为三件套 `manifest.json` + `plugin.js` + `models.json`，不另设 `adapter.js`：站点采集逻辑本来就在 `plugin.js` 的 `sitePlugin` 对象里（`matches` / `prepare` / `request` / `preset`），再拆一层钩子文件没有收益。
- 目录没有再改名成 `shell/`，扩展侧保持 `extension/`；`plugins/` 已经是独立单元，构建器 `scripts/plugin-build.mjs` 从它生成 `providers/*.js`、`catalog.js`、`shared/plugin-order.js`。
- 匹配优先级实现为：`modelMatchOverrides` 人工覆盖 → 插件 `models.json` 别名 → 规范模型层 → 内置规则链（exact / suffix / ignore_version / fuzzy）。人工覆盖最高，因为它代表用户亲手确认过的事实。
- 文档命名为 `docs/architecture.md` 与 `docs/plugin-development.md`，README 中英双语各加一节指向。

## Requirements

### R1 规范模型层（已完成）

- [x] `canonical/build.mjs` 拉 models.dev + OpenRouter，合并生成规范表，带 `version` / `generatedAt` / `sources`，可重复生成可 diff。
- [x] 分组算法：取 id 最后一段、去装饰后缀（`:free` `:thinking` `@eu` `-v1` `-YYYYMMDD`）、小写、空格与 `.` `_` 等价 `-`，**不合并版本号数字**。
- [x] 同组内被当成独立 id 收集过的模型（如 `deepseek-v4.1-flash-1017`）合并进来源更多的那个，另一个降为别名。
- [x] `extension/src/core/canonical.js`：`canonicalKey` / `resolveCanonicalModel` / `buildCanonicalIndex` / `canonicalKeysForModel`，纯查表 O(1)，索引按需构建一次。

### R2 匹配引擎改造（已完成）

- [x] `matching.js` 的 `buildModelMatchIndex` 接收 `canonicalIndex`，`matchModel` 里以 `canonical` 规则最先命中。
- [x] `matchModel` / `matchModelWithOverrides` / `buildModelMatchIndex` 对外签名兼容，旧调用点不用改。
- [x] 插件别名以 `{ alias, canonicalId }` 注入索引，命中后回落到规范查表，`ruleId` 记为 `plugin-alias`。

### R3 插件协议 v2（已完成）

- [x] `plugins/<id>/manifest.json`：`id` / `name` / `host` / `hosts` / `paths` / `mode` / `category` / `addable` / `description` / `order`，字段白名单校验，`id` 必须等于目录名。
- [x] `plugins/<id>/plugin.js`：导出 `sitePlugin`，导入只允许 `@app/core/…`、`@app/shared/…`，禁止动态 `import()`。
- [x] `plugins/<id>/models.json`：`{ "aliases": { "站内写法": "规范模型 id" } }`，构建时注入 `sitePlugin.modelAliases`。
- [x] `scripts/plugin-build.mjs`：生成 `providers/*.js`、`catalog.js`、`shared/plugin-order.js`，`--check` 检测漂移，清理孤儿产物。
- [x] 22 个现有站点全部迁移到 `plugins/`，扩展侧不再手写任何 provider。

### R4 目录拆分（部分完成）

- [x] `plugins/` 自包含：`manifest.json` / `plugin.js` / `models.json` / `README.md`，不引用扩展相对路径。
- [x] 根 `package.json` 增加 `plugins:build` / `plugins:check` / `models:build` / `models:lookup` / `test`。
- [ ] 真正拆成两个 git 仓库（待用户决定时机）：`plugins/` 单独建仓，扩展侧把 `PLUGIN_DIR` 指向外部目录。

### R5 文档（已完成）

- [x] 根 `AGENTS.md` 增补项目段：定位、命令、改哪儿、硬约束、验收。
- [x] `docs/plugin-development.md`：插件协议、manifest 字段表、models.json 写法、匹配优先级、新增站点步骤、常见坑。
- [x] `docs/architecture.md`：数据流、统一模型三层机制、目录职责表、两仓拆分路线、验证标准。
- [x] `plugins/README.md`、`README.md` / `README.zh-CN.md` 各加一节。

## Acceptance Criteria

- [x] `node canonical/build.mjs --offline` 可重复生成规范表：2150 个模型，834 个多来源，348 KB。
- [x] 全量测试 242 条全绿，新增 canonical、插件构建漂移、模型身份、插件别名链路测试。
- [x] 任一插件目录靠 `manifest.json` + `plugin.js` + `models.json` 即可被识别与采集。
- [x] `extension/src/site-plugins/providers/` 与 `catalog.js` 全部为生成物，`--check` 无漂移。
- [x] 三份文档可直接指导 agent 新增一个站点插件并跑通测试。

## Notes

- 不改采集协议本身（`adapters.js` / `provider-registry.js` 的契约不变）。
- 站点凭据存储（`ai-price-analyzer:tokens`）不动。
- 旧设置里的 `llm/jev/providerProfiles/activeProviders` 继续静默丢弃。