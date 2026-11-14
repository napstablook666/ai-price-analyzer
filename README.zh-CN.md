<h1 align="center">AI Price Analyzer</h1>

<p align="center"><strong>用于比较 AI 中转站模型价格与公开参考数据的 Chromium MV3 浏览器扩展。</strong></p>

<p align="center">
  <a href="./README.md">English</a> |
  <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/napstablook666/ai-price-analyzer/actions/workflows/ci.yml"><img src="https://github.com/napstablook666/ai-price-analyzer/actions/workflows/ci.yml/badge.svg" alt="CI 状态"></a>
  <a href="https://github.com/napstablook666/ai-price-analyzer/releases"><img src="https://img.shields.io/github/v/release/napstablook666/ai-price-analyzer?style=flat-square" alt="最新版本"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-22C55E?style=flat-square" alt="GPL-3.0 许可证"></a>
  <a href="https://napstablook666.github.io/ai-price-analyzer/"><img src="https://img.shields.io/badge/docs-%E5%9C%A8%E7%BA%BF-0F766E?style=flat-square" alt="文档"></a>
</p>

AI Price Analyzer 从配置的 AI 中转站采集模型价格，把不同站点的模型写法归一到统一模型身份，并在本地面板中展示比价结果。它是 Chromium Manifest V3 扩展，不需要打包器或服务端。

## 仓库划分

项目拆分为两个公开仓库：

- **扩展仓库：** 当前仓库，包含 MV3 页面、service worker、采集与匹配核心、生成的插件运行时代码、测试和文档。
- **插件仓库：** [ai-price-analyzer-plugins](https://github.com/napstablook666/ai-price-analyzer-plugins)，包含手写的站点适配器，一个站点一个目录。

开发站点插件时，把插件仓库签出到本仓库旁边的并排 `plugins/` 目录。扩展构建器会从这些源文件生成 `src/site-plugins/`。生成物签入扩展仓库，所以只下载发布包时可以直接加载扩展。

## 主要能力

| 能力 | 作用 |
| --- | --- |
| 多站点采集 | 配置多个中转站，从一个面板刷新各站点的模型目录。 |
| 本地比价面板 | 使用 IndexedDB 保存快照，筛选、排序报价，并比较估算成本。 |
| 直接接口与页面采集 | CORS 允许时直接请求 JSON 接口；需要当前浏览器登录态时使用页面桥接。 |
| 模型身份匹配 | 使用规范模型、插件别名和用户覆盖，把站点写法归一到同一身份。 |
| 公开参考数据 | 缓存 OpenRouter 模型数据和中国银行汇率参考数据。 |
| 可选账户工作流 | 对支持的站点执行签到。 |

## 安装

1. 从 [GitHub Releases](https://github.com/napstablook666/ai-price-analyzer/releases) 下载 `ai-relay-price-extension-v<version>.zip`，或者克隆本仓库。
2. 如果下载的是 ZIP，先解压。要加载的目录必须直接包含 `manifest.json`。
3. 在基于 Chromium 的浏览器中打开 `chrome://extensions`。
4. 启用“开发者模式”，点击“加载已解压的扩展”，选择解压后的目录或本仓库根目录。

## 快速开始

1. 点击扩展图标，选择“站点与设置”，或者打开扩展对比面板。
2. 添加站点网址，检查扩展建议的主机、接口、认证方式和采集模式后确认保存。
3. 允许跨域的 JSON 接口使用“直接接口”模式；需要浏览器登录态的站点使用“页面桥接”模式，并保持当前标签页已登录。
4. 保存站点后回到对比面板，点击“刷新全部”。
5. 查看已采集模型、参考价格、匹配状态、估算成本和推荐结果。

设置页面还提供参考价刷新、支持站点的签到设置，以及 JSON 状态导入导出。导出的状态不包含站点密钥或 API Key。

## 文档

- [使用手册](./docs/user-guide.md)
- [开发手册](./docs/development.md)
- [架构与数据流](./docs/architecture.md)
- [扩展侧插件协议](./docs/plugin-development.md)
- 完整文档站：<https://napstablook666.github.io/ai-price-analyzer/>（VitePress，本地预览跑 `npm run docs:dev`）
- [插件仓库 README](https://github.com/napstablook666/ai-price-analyzer-plugins/blob/main/README.md)
- [插件仓库开发手册](https://github.com/napstablook666/ai-price-analyzer-plugins/blob/main/DEVELOPMENT.md)

## 数据来源与隐私

- 扩展从配置的中转站页面或接口读取模型和价格数据。
- 扩展可能请求公开的 OpenRouter 模型目录：`https://openrouter.ai/api/v1/models`；也可能请求中国银行外汇牌价页面：`https://www.boc.cn/sourcedb/whpj/`。
- 设置和采集快照保存在扩展本地存储与 IndexedDB 中。
- 本项目不运行服务端账户或分析服务。
- 不要在 Issue 或 Pull Request 中粘贴私有 API 响应、Cookie、授权请求头、账户标识或凭据。

详细说明见 [PRIVACY.md](./PRIVACY.md)，漏洞报告方式见 [SECURITY.md](./SECURITY.md)。

## 开发

需要开发站点插件时，先克隆两个仓库：

```bash
git clone https://github.com/napstablook666/ai-price-analyzer.git
cd ai-price-analyzer
git clone https://github.com/napstablook666/ai-price-analyzer-plugins.git plugins
```

在扩展仓库根目录运行：

```bash
npm test
node scripts/plugin-build.mjs --check
node scripts/model-lookup.mjs claude 4.6
node canonical/build.mjs --offline
```

修改插件源后运行 `node scripts/plugin-build.mjs`，再运行测试并在 Chromium 中重新加载本仓库根目录。插件仓库签出到其他路径时，用 `PLUGIN_DIR` 指向它。不要手改 `src/site-plugins/` 或 `src/shared/plugin-order.js` 下的生成物。

贡献流程见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 发布

发布由 Git tag 触发。保持 `package.json` 与 `manifest.json` 的版本一致，然后推送类似 `v0.2.1` 的 tag。GitHub Actions 会发布：

- `ai-relay-price-extension-v<version>.zip`：可直接加载的 Chromium 扩展。
- `ai-price-analyzer-v<version>-source.zip`：构建所用的源码和插件快照。
- `SHA256SUMS.txt`：发布文件校验和。

## 许可证

[GPL-3.0](./LICENSE)
