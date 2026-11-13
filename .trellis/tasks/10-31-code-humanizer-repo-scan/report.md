# code-humanizer Mode A 全仓库扫描报告

- 日期:2026-10-31 · 分支:feat/sevenai-model-plaza · 范围:`extension/src` 全部 34 个 JS 模块 + 测试 + 未提交 diff
- Oracle:`npm test` 198/198 通过(core 169 / checkin 8 / refresh-preflight 15 / workspace 6),约 2s
- 代码规模:src ≈ 9,500 行(最大:normalizers.js 1360、options.js 1029、service-worker.js 908、dashboard.js 907、provider-registry.js 701),测试 ≈ 5,400 行

## 总评

仓库整体健康度**高于典型 AI 产出**:core/shared 分层清晰,定价归一化用真实的策略模式 + response-format 注册表分发(多实现,非投机抽象),无 TODO/FIXME、无 console.log 残留、无 try-import 回退、无 `_v2` 克隆。注释密度低且多为外部 API 契约说明。主要债务集中在**死代码导出**和**少量模块间重复 helper**。

## 发现(按模式分组)

### P5 死代码("供将来使用") — 严重度 3(最高优先)

全仓库 grep(含 .js/.html/.json/.md,排除 node_modules/.trellis/.git)验证,以下导出**零消费者**:

| 项 | 位置 | 规模 | 证据 |
|---|---|---|---|
| `NodeAiModelPlazaStrategy` | core/normalizers.js:1039 | 5 行 | 注册表走 `new ModelPlazaStrategy(definition.profile)`(normalizers.js:1285)按 profile 实例化,response-formats.js:6 已配 `profile: "nodeai"` → 该子类被彻底绕过;测试也只经 `"nodeai-model-plaza"` 格式触发通用策略。看似承重实则无效,误导未来维护者 |
| `setStationToken` / `getStationToken` / `removeStationToken` | shared/credentials.js:62-74 | 12 行 | 旧版站点级 token API,已被 provider key 体系(`setProviderApiKey` 等)取代,src/test 均无调用 |
| `addTokenFluxStationPreset` | core/station-presets.js:53 | 3 行 | 其他 13 个同级 preset 函数在测试中被调用 3-5 次,唯独此函数零调用(preset 注册统一走 `addRegisteredStationPresets`) |
| `clearSnapshots` | shared/db.js:208 | 4 行 | `importState` 用内联事务清空 snapshots,不经过它 |
| `formatDate` | shared/ui.js:91 | 3 行 | 无任何调用 |

- 建议修复:直接删除(约 27 行);`addNodeAiStationPreset` 为测试 import-but-never-called(严重度 2),随测试一并清理。
- 行为风险:无(零引用,删除后跑全套测试即可验证)。

### P5 死 re-export — 严重度 2

- `export { normalizePricingPayload };`(core/collectors.js:7):无人从 collectors 导入它(service-worker 只取 `collectStation, createPageFetch`;测试从 normalizers 直取)。纯 pass-through,暗示归属错误。

### P1/P2 重复实现 — 严重度 2

| 重复 | 位置 | 说明 |
|---|---|---|
| `toast()` | dashboard.js:32 与 options.js:12 | 两个 7 行函数体逐字相同(`$("#toast")` + 3600ms timer);`shared/ui.js` 已是现成的 DOM 工具层,属漏放的公共 helper |
| `activeJevProfile()` | dashboard.js:208 与 service-worker.js:715 | 同一逻辑两份;dashboard 版本加了可选链防御(untrusted `state.data?.settings`),service-worker 版本直接索引(已 normalize)——合并时需保留两侧行为差异 |
| 页面桥伪 Response 解析 | collectors.js:38 `readResponse` 与 checkin.js:42 `fetchJson` 分支 | 相同的 `hasOwnProperty.call(response,"body")` 模式(content-bridge.js:42 是第三处校验端);checkin 版本额外吞解析错误(payload={}/null),合并需maintainer确认错误行为 |

- 行为风险:前两项无;第三项**needs-maintainer**(涉及错误吞咽语义)。

### P6/P7 轻微 — 严重度 2(可选清理)

- 仅内部使用却 export 的符号(无外部消费者,同文件内使用):`openDatabase`、`withStore`(db.js)、`DEFAULT_PROVIDER_PROFILES`、`DEFAULT_ACTIVE_PROVIDERS`、`DEFAULT_SETTINGS`、`DEFAULT_STATION`、`cloneDefaultSettings`(schema.js)、`WORKSPACE_FILE_NAME`(workspace.js)、`MODEL_ALIASES`、`cleanModelName`、`removeVersion`、`getOfficialNames`(matching.js)、`MODEL_REQUEST_TIMEOUT_MS`(model-api.js)、`referencePrices`(pricing.js)、`getStationRequestConfig`(request-strategy.js)、`RESPONSE_FORMATS`(response-formats.js)。去掉 `export` 即可,收益低,可不做。
- service-worker.js:437 `// ---- 站点签到 ----` 单条分隔线注释(P14 噪音,908 行编排文件中仅此一处,可留)。

## 豁免项(严重度 1,有正当理由,不动)

- **空 catch ×5 + 静默 `.catch(()=>{})` 若干**(checkin.js:94/99、page-bridge.js:435、collapse.js:10、workspace.js:84、page-tabs.js:72 等):均位于信任边界(localStorage 探测、页面环境桥、best-effort 资源清理),符合"防御性代码在信任边界是正确的"。
- **`ParsingStrategy` 类层次(18 个子类)**:真实多实现策略模式,经 response-format 注册表分发,非投机抽象。
- **`typeof x === "object"` / `Array.isArray` 探测(86 处)**:处理外部站点 payload,信任边界内合法。
- **checkin.js 13 条注释**:均为外部 API 契约/字段映射说明,代码无法自表达。
- **未提交工作区 diff**(normalizers parsePrice 化简 + 测试 fixture 语义修正 + options 表单字段):干净,无 slop。

## 测试侧(P15/P16,报告级)

- 测试断言真实行为(normalizePricingPayload 输出、preflight 状态机等),未见 mock 自证式断言。core.test.js 4606 行单文件偏大,可按域拆分——属风格建议,不计债。

## 修复顺序建议(若批准进入 Mode B)

1. **P5 死代码**(严重度 3、零风险):删 NodeAiModelPlazaStrategy + 站点 token 三函数 + addTokenFluxStationPreset + clearSnapshots + formatDate + 死 re-export(约 28 行)。
2. **P1 toast** 合并到 shared/ui.js(严重度 2、低风险)。
3. **P1 activeJevProfile** 合并(严重度 2、低风险,保留两侧空值行为)。
4. **P1 伪 Response 解析合并**(needs-maintainer,单独提案)。
5. P6 收缩 export(可选)。

每步一个 commit,全量测试把关。


---

## Mode B 执行记录(2026-10-31,用户批准"全部修复")

| Commit | 模式 | 内容 | 验证 |
|---|---|---|---|
| 918ca15 | P5 | 删除 6 处死导出:NodeAiModelPlazaStrategy、set/get/removeStationToken、addTokenFluxStationPreset、clearSnapshots、formatDate、collectors 死 re-export(-46 行) | 198/198 |
| 1a82ba0 | P5 | 测试改从 normalizers 导入 normalizePricingPayload | 198/198 |
| 62c3137 | P1 | toast 合并到 shared/ui.js(2 处 → 1) | 198/198 |
| 5f2fdd7 | P1 | activeJevProfile 合并到 shared/schema.js(2 处 → 1;dashboard 调用点显式传 settings,保留空值语义);顺带删除测试 import-but-never-called 的 addNodeAiStationPreset | 198/198 |
| 0dab068 | P1 | readResponse 伪 Response 分支为不可达代码(两个调用点均先判 `typeof response.json === "function"`),删除;checkin.js 的同名判别是活逻辑,保留 | 198/198 |
| a98a73a | P7 | 收缩 15 个仅模块内部使用的导出 | 198/198 |
| 477e103 | P14 | 删除 service-worker 唯一分隔线注释 | 198/198 |

- 净变化:src +40/−94(≈ −54 行),7 个 commit,每个 commit 单独通过全量测试。
- P1 伪 Response 解析合并:实际处置为"删不可达分支"而非强行合并 —— collectors 的调用方已在外层判别真实 Response 与页面桥结果,函数内的判别分支永不执行;checkin.js 的判别在其 fetchJson 内部是必要逻辑且语义不同(错误吞咽/HTTP 错误包装),不属重复。无行为变更。
- 豁免项全部维持原判(信任边界防御、策略类层次、类型探测、契约注释)。
- 审计遗留:无新增发现;worktree 中 README/CONTRIBUTING/options.html/css 与 .trellis 文档改动为用户既有未提交工作,未触碰。
