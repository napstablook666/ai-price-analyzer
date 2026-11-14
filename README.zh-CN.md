<h1 align="center">AI Price Analyzer</h1>

<p align="center"><strong>用于比较 AI 中转站模型价格与 OpenRouter 参考数据的 Chromium MV3 浏览器扩展。</strong></p>

<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/napstablook666/ai-price-analyzer/actions/workflows/ci.yml"><img src="https://github.com/napstablook666/ai-price-analyzer/actions/workflows/ci.yml/badge.svg" alt="CI 状态"></a>
  <a href="https://github.com/napstablook666/ai-price-analyzer/releases"><img src="https://img.shields.io/github/v/release/napstablook666/ai-price-analyzer?style=flat-square" alt="最新版本"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-22C55E?style=flat-square" alt="GPL-3.0 许可证"></a>
</p>

AI Price Analyzer 目前以无需构建的 Chromium MV3 浏览器扩展作为唯一维护产品。它从配置的 AI 中转站采集模型价格，与公开参考数据进行对比，并在本地面板中展示结果。

## 维护范围

持续维护的产品是 [`extension/`](./extension/) 中的浏览器扩展。新的使用问题、Bug 反馈、测试和 Pull Request 都应针对扩展目录。

根目录的用户脚本 [`AI中转站价格分析工具.js`](./AI中转站价格分析工具.js) 已归档。它仍保留在仓库和部分 Release 压缩包中，用于历史兼容，但不再是当前产品，也不再增加新功能或持续适配新页面。新用户应使用下面介绍的浏览器扩展。

## 主要能力

| 能力 | 作用 |
|---|---|
| 多站点采集 | 配置多个中转站，从一个面板刷新各站点的模型目录。 |
| 对比面板 | 使用 IndexedDB 保存快照，筛选、排序报价，并比较估算月成本和推荐结果。 |
| 直接接口与页面采集 | CORS 允许时直接请求 JSON 接口；需要当前浏览器登录态时使用页面桥接。 |
| 公开参考数据 | 缓存 OpenRouter 模型数据和中国银行汇率参考数据。 |
| 可选账户工作流 | 对支持的站点执行签到。 |

## 架构

```text
```text
+---------------------------+       +------------------------+
| popup / options /         | ----> | MV3 service worker     |
| dashboard extension pages |       | refresh and alarms     |
+-------------+-------------+       +-----------+------------+
              | chrome.runtime                  |
              v                                 |
+-------------+-------------+                    |
| page bridge in the       | <------------------+
| current browser tab      |
+-------------+-------------+
              |
              v
+-------------+-------------+       +------------------------+
| station pricing and      | ----> | IndexedDB snapshots,   |
| check-in APIs            |       | settings, comparisons  |
+--------------------------+       +------------------------+
              ^
              |
     +--------+---------+
     | OpenRouter and   |
     | Bank of China   |
     | public references|
     +------------------+
```

## 站点插件与模型归一

站点适配是独立插件，源码在 [`plugins/`](./plugins/)，一个站点一个目录；`extension/src/site-plugins/` 下的同名文件与 `catalog.js` 由 `node scripts/plugin-build.mjs` 生成，不要手改。

同一模型在不同站的写法往往不同（`GLM-5.3`、`z-ai/glm-5.3`、`glm-5.3:thinking`），扩展按三层把它们收敛到同一个模型身份：规范模型表（由 models.dev 与 OpenRouter 生成）→ 插件自带的 `models.json` 别名 → 人工确认的覆盖。

插件协议见 [docs/plugin-development.md](./docs/plugin-development.md)，数据流与两仓拆分路线见 [docs/architecture.md](./docs/architecture.md)。

## 快速安装

1. 从 [GitHub Releases](https://github.com/napstablook666/ai-price-analyzer/releases) 下载 `ai-relay-price-extension-v<version>.zip`，也可以直接使用源码仓库中的 `extension/` 目录。
2. 如果下载的是 ZIP，先解压。要加载的目录必须包含 `manifest.json`。
3. 在基于 Chromium 的浏览器中打开 `chrome://extensions`，启用“开发者模式”，点击“加载已解压的扩展”，选择解压后的扩展目录或仓库中的 [`extension/`](./extension/) 目录。

本地使用不需要打包器、Docker、Playwright 或第三方运行时依赖。

## 快速开始

1. 点击扩展图标，选择“站点与设置”，或者直接打开扩展对比面板。
2. 在设置中添加站点网址，等待扩展分析，检查建议的配置后确认添加。
3. 允许跨域的 JSON 接口使用“直接接口”模式；需要浏览器登录态的站点使用“页面桥接”模式，并确保当前标签页已登录该站点。
4. 保存站点和设置，返回对比面板，点击“刷新全部”。
5. 在对比表中查看已采集模型、OpenRouter 参考价、匹配状态、估算月成本和推荐结果。

设置页面还提供参考价刷新、支持站点的签到设置，以及 JSON 状态导入导出。导出的状态不包含站点密钥或 API Key。

## 站点采集

扩展提供两种采集路径：

- **直接接口**：请求配置的站点接口，适合允许扩展请求的 JSON 接口。
- **页面桥接**：通过当前浏览器标签页中的页面桥接请求，适合依赖浏览器 Cookie 或登录页面的站点。

设置页面可以分析站点网址，并在保存前展示建议的接口地址、请求格式、认证方式和采集模式。站点适配器和预设位于 [`extension/src/core/`](./extension/src/core/)。站点页面结构和接口响应可能变化，报告采集问题时请提供经过脱敏的响应结构。

## 数据来源与隐私

- 扩展从配置的中转站页面或接口读取模型和价格数据。
- 扩展可能请求公开的 OpenRouter 模型目录：`https://openrouter.ai/api/v1/models`；也可能请求中国银行外汇牌价页面：`https://www.boc.cn/sourcedb/whpj/`。
- 设置和采集快照保存在扩展本地存储与 IndexedDB 中。导出的状态不包含站点密钥和 API Key。
- 不要在 Issue 或 Pull Request 中粘贴私有 API 响应、Cookie、授权请求头、账户标识或凭据。

## 已归档的用户脚本

原用户脚本源文件是 [`AI中转站价格分析工具.js`](./AI中转站价格分析工具.js)。发布工作流会将它作为 `ai-price-analyzer.user.js` 发布，源码压缩包中也可能继续包含该文件。这些是为历史用户和发布兼容保留的资产，不是当前的扩展版本，新开发不应从这里开始。

## 开发

当前开发应运行扩展检查。根目录 `package.json` 保存扩展项目和归档用户脚本两条版本轨道。更新时运行 `npm run version:patch`，也可以使用 `version:minor` 或 `version:major`；脚本会同时递增并同步所有发布文件。使用 `npm run version:check` 检查版本是否一致。

```bash
node --test extension/test/*.test.js
node --check extension/src/service-worker.js
node --check extension/src/dashboard.js
node --check extension/src/options.js
node --check extension/src/content-bridge.js
node --check extension/src/page-bridge.js
node --check extension/src/popup.js
```

GitHub Actions 还会校验扩展 manifest 和必要的 HTML 入口。工作流仍运行 `node --check "AI中转站价格分析工具.js"` 与 `node test-kbq-pricing.js`，仅用于保持归档用户脚本和历史发布源码有效；这两个命令不是扩展开发入口。

## 发布流程

Release 由 Git tag 触发。打 tag 前运行 `npm run version:patch`，也可以使用 `version:minor` 或 `version:major`；命令会同时递增两条版本轨道并同步所有发布文件。发布工作流会检查项目版本是否与 tag 一致，并发布以下资产：

- `ai-relay-price-extension-v<version>.zip`：当前维护的 Chromium 扩展。
- `ai-price-analyzer-v<version>-source.zip`：源码压缩包，包含扩展和已归档用户脚本。
- `ai-price-analyzer.user.js`：为历史兼容保留的用户脚本资产。
- `SHA256SUMS.txt`：已发布文件的校验和。

当前使用请选择扩展 ZIP。用户脚本资产可以继续出现在 Release 中供历史用户使用，但它不属于当前维护范围。

```bash
npm run version:patch
npm run version:check
version=$(node -p "require('./package.json').version")
git tag "v$version"
git push origin "v$version"
```

## 参与贡献

Issue 和 Pull Request 都应针对 [`extension/`](./extension/)。提交前请：

- 运行 `node --test extension/test/*.test.js` 和相关的扩展语法检查；
- 提供扩展版本、Chromium 版本、目标站点、采集模式和复现步骤；
- 从示例、日志和截图中删除凭据、Cookie、授权请求头、私有 URL 及账户标识；
- 报告站点适配问题时，只提供经过脱敏的响应结构；
- 如果改动增加了 Host 权限、跨域请求或新的数据处理，更新 [`PRIVACY.md`](./PRIVACY.md)。

根目录归档用户脚本的改动仅限于归档、发布或文档维护。

Pull Request 检查清单见 [`CONTRIBUTING.md`](./CONTRIBUTING.md)。

## 许可证

[GPL-3.0](./LICENSE)
