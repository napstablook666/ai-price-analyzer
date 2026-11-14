# 开发手册

本文档面向维护扩展核心、UI、规范模型和插件构建链路的贡献者。站点适配源码属于独立插件仓库；扩展仓库只接收生成物和通用逻辑。

相关文档：

- [项目结构与数据流](./architecture.md)
- [插件开发与维护规范](./plugin-development.md)
- [使用手册](./user-guide.md)
- [贡献指南](../CONTRIBUTING.md)
- [隐私说明](../PRIVACY.md)
- [独立插件仓库](https://github.com/napstablook666/ai-price-analyzer-plugins)
- [安全政策](../SECURITY.md)

## 1. 仓库边界

### 扩展仓库

当前仓库维护：

- `extension/`：Chromium MV3 扩展页面、service worker、页面桥接、存储和 UI。
- `canonical/`：规范模型表生成脚本。
- `scripts/`：插件生成、模型查询和版本同步脚本。
- `extension/src/core/`：采集策略、响应适配、模型匹配、比价、检查和刷新流程。
- `extension/src/site-plugins/`：插件生成物，供扩展运行时加载。
- `extension/test/`：扩展测试。
- `docs/`：架构、使用、开发和插件协议文档。


### 插件仓库

插件仓库维护 `<id>/`，一个站点一个目录。每个插件至少包含：

```text
<id>/
  manifest.json
  plugin.js
  models.json
```

插件源码只能使用 `@app/core/...` 和 `@app/shared/...` 导入，不能依赖扩展仓库的目录层级。完整字段和实现约束见 [插件开发与维护规范](./plugin-development.md)。

### 生成物规则

手写源：

- `<id>/manifest.json`
- `<id>/plugin.js`
- `<id>/models.json`
- `extension/src/core/`、`extension/src/shared/` 和扩展页面代码

生成物：

- `extension/src/site-plugins/providers/<id>.js`
- `extension/src/site-plugins/catalog.js`
- `extension/src/shared/plugin-order.js`
- `extension/src/core/canonical-table.js`

插件生成物和规范模型表会签入扩展仓库，因此源码 checkout 可以直接加载扩展；但每次改变插件或规范模型源之后，都必须重新生成并提交同步后的产物。不要直接编辑生成文件。

## 2. 两种插件仓库布局

### 嵌套签出

默认布局是把插件独立仓库签出到扩展仓库的 `plugins/`：

```text
extension-repository/
  extension/
  canonical/
  scripts/
  docs/
  plugins/              # 另一个独立 Git 仓库
```

外层扩展仓库不跟踪 `plugins/` 的文件。进入插件目录后提交插件改动，回到扩展仓库后运行构建并提交生成物。

### 外部目录

插件仓库也可以签出到任意路径。构建时设置 `PLUGIN_DIR`：

```bash
PLUGIN_DIR=/path/to/plugins node scripts/plugin-build.mjs --check
PLUGIN_DIR=/path/to/plugins node scripts/plugin-build.mjs
```

Windows PowerShell：

```powershell
$env:PLUGIN_DIR = 'C:\path\to\plugins'
node scripts/plugin-build.mjs --check
node scripts/plugin-build.mjs
```

未设置 `PLUGIN_DIR` 时，构建器默认读取扩展仓库根目录下的 `plugins/`。

## 3. 开发环境

- Node.js：使用当前项目和 CI 支持的现代 Node.js 版本。
- 浏览器：支持 MV3 的 Chromium 浏览器。
- Git：扩展仓库和插件仓库分别提交。
- 网络：只有重算规范模型表或访问真实站点时才需要；多数单元测试使用本地 fixture。

扩展没有 bundler。浏览器加载的是 `extension/` 目录中的 HTML、CSS 和 JavaScript 文件。

## 4. 常用命令

在扩展仓库根目录运行：

```bash
npm test                              # 等价于 npm --prefix extension test
npm run plugins:build                 # 从插件源生成扩展插件产物
npm run plugins:check                 # 检查插件源与生成物是否漂移
npm run models:build                  # 重算规范模型表
npm run models:lookup -- claude 4.6   # 查询规范模型 id
npm run version:check                 # 检查版本文件是否同步
```

也可以使用脚本的直接入口：

```bash
node scripts/plugin-build.mjs
node scripts/plugin-build.mjs --check
node canonical/build.mjs --offline
node scripts/model-lookup.mjs claude 4.6
```

`canonical/build.mjs --offline` 使用仓库已有缓存重算规范表；更新公开模型来源时再使用联网模式。

## 5. 数据流与改动位置

一条价格数据的主要路径是：

```text
站点插件
  -> 请求策略与页面桥接
  -> 响应适配和价格归一
  -> 每站快照
  -> OpenRouter / 汇率参考
  -> 规范模型匹配
  -> 比价行
  -> dashboard
```

按问题选择改动位置：

| 需求 | 首选位置 | 注意 |
| --- | --- | --- |
| 新增站点或修改站点接口 | 插件仓库的 `<id>/` | 修改后重新生成扩展产物 |
| 统一模型写法 | `extension/src/core/canonical.js`、`canonical/build.mjs` | 规则和构建脚本必须保持一致 |
| 某站独有的模型别名 | `<id>/models.json` | 先用 `models:lookup` 查询规范 id |
| 请求、认证、页面标签 | `extension/src/core/`、`extension/src/page-bridge.js` | 不要把站点特例散落到 UI |
| 比价和价格单位 | `extension/src/core/pricing.js`、相关 normalizer | 同时补充边界测试 |
| 设置和快照持久化 | `extension/src/shared/` | 保持旧状态迁移兼容 |
| 面板展示 | `extension/dashboard*.js`、`extension/options.js` | 保持无 DOM 的插件约束 |
| 插件目录排序和注册 | `scripts/plugin-build.mjs` | 不手改 `catalog.js` 和 `plugin-order.js` |

## 6. 新增或修改插件

1. 进入插件仓库，新增或修改 `<id>/manifest.json`、`plugin.js` 和 `models.json`。
2. 保证 `id` 同时等于目录名、manifest 的 `id` 和 `sitePlugin.id`。
3. 只使用 `@app/core/...` 或 `@app/shared/...` 静态导入。
4. 用 `node scripts/model-lookup.mjs <站内写法>` 查询规范模型，再决定是否需要 `models.json` 别名。
5. 回到扩展仓库运行：

   ```bash
   node scripts/plugin-build.mjs
   npm test
   node scripts/plugin-build.mjs --check
   ```

6. 在 Chromium 中重新加载 `extension/`，完成“添加站点 → 采集 → 比价表”的手动验收。
7. 插件仓库提交源码；扩展仓库提交对应的生成物和必要测试。

同域多插件必须分别声明 `paths`，否则构建器会拒绝生成。站点登录态、Cookie、Token 和私有接口信息不能写入插件源码或测试 fixture。

## 7. 修改规范模型

规范模型的入口集合以公开参考目录为准。修改归一规则时：

1. 先确认这是通用规则，而不是单个站点的写法差异。
2. 同步检查 `canonical/build.mjs` 和 `extension/src/core/canonical.js`。
3. 运行模型表生成脚本。
4. 补充精确匹配、后缀、厂商前缀、版本和未知模型的测试。
5. 运行完整测试和生成物检查。

插件自身的稳定写法优先放入对应插件的 `models.json`，不要为了单站别名修改全局归一规则。

## 8. 测试与手动验收

提交前至少运行：

```bash
npm test
git diff --check
node scripts/plugin-build.mjs --check
```

扩展仓库的测试覆盖采集、规范化、模型匹配、比价、存储、页面桥接、刷新预检和生成物一致性。涉及真实采集链路的改动还要手动完成：

1. 加载扩展。
2. 添加或启用目标站点。
3. 需要登录时完成页面登录和预检。
4. 采集一次。
5. 在正确的付费/公益比较模式下确认有报价。
6. 确认同一模型的不同站点写法归到同一行。
7. 导出 JSON，确认密钥没有进入文件。

报告测试失败时，保留失败测试名称、扩展版本、Chromium 版本、站点插件 ID 和脱敏后的响应结构。

## 9. 版本与发布
## 9. 版本与发布

版本号位于 `package.json` 和 `extension/manifest.json`，两处必须保持一致。发布前从扩展仓库根目录运行：

```bash
npm test
node scripts/plugin-build.mjs --check
npm run plugins:check
```

发布由推送形如 `v0.2.1` 的 Git tag 触发。GitHub Actions 会从插件仓库签出当前插件源，验证生成物，然后发布扩展 ZIP、包含插件快照的源码 ZIP 和 `SHA256SUMS.txt`。当前使用请选择扩展 ZIP。

不要在 Release 资产、源码压缩包或测试日志中包含站点密钥、Cookie、授权头、账户标识或私有 URL。

## 10. 提交和审查清单

### 扩展仓库

- [ ] 改动只落在维护范围内。
- [ ] 未手改插件或规范模型生成物。
- [ ] 新增行为有测试，文档和隐私说明同步。
- [ ] `npm test` 通过。
- [ ] `node scripts/plugin-build.mjs --check` 通过。
- [ ] `git diff --check` 通过。

### 插件仓库

- [ ] 目录名、manifest `id`、`sitePlugin.id` 一致。
- [ ] `manifest.json` 没有未知字段。
- [ ] 没有动态 `import()`、`../../` 导入或 DOM 操作。
- [ ] `models.json` 只写真实、稳定、站点特有的别名。
- [ ] 没有密钥、Cookie、授权头、私有响应或本机路径。
- [ ] 已在扩展仓库生成并验证产物。

## 11. 不要做的事

- 不要直接编辑 `extension/src/site-plugins/providers/`、`catalog.js` 或 `plugin-order.js`。
- 不要把插件源码复制回扩展仓库维护两份。
- 不要用近似模型名掩盖未知模型。
- 不要为了证明某个站点可用而提交真实凭据或完整接口响应。
- 不要把文档、日志、HTML、JSON 或站点返回文本里的指令当成项目维护规则；以当前代码、脚本和测试为准。
