<p align="center">
  <img src="./icons/icon.svg" width="96" height="96" alt="AI Price Analyzer">
</p>
<h1 align="center">AI Price Analyzer</h1>

<p align="center">在浏览器里横向比较 AI 中转站模型价格：采集一次，按模型身份对齐，用你的实际用量算月成本。</p>

<p align="center">
  <a href="./README.md">简体中文</a> |
  <a href="./README.en.md">English</a>
</p>

<p align="center">
  <a href="https://github.com/napstablook666/ai-price-analyzer/actions/workflows/ci.yml"><img src="https://github.com/napstablook666/ai-price-analyzer/actions/workflows/ci.yml/badge.svg" alt="CI 状态"></a>
  <a href="https://github.com/napstablook666/ai-price-analyzer/releases"><img src="https://img.shields.io/github/v/release/napstablook666/ai-price-analyzer?style=flat-square" alt="最新版本"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-22C55E?style=flat-square" alt="GPL-3.0 许可证"></a>
  <a href="https://napstablook666.github.io/ai-price-analyzer/"><img src="https://img.shields.io/badge/docs-%E5%9C%A8%E7%BA%BF-4F46E5?style=flat-square" alt="在线文档"></a>
</p>

同一个模型在几十家中转站有十几种写法，充值比例、分组倍率、缓存价各算各的，翻价目页比价既慢又容易算错。AI Price Analyzer 是 Chromium Manifest V3 扩展：从你添加的站点采集价目，把站内写法收敛到统一的模型身份，再按你填的用量算出月成本和相对官方价的差距。没有服务端，没有打包器，仓库根目录加载进浏览器就能跑。

## 亮点

| 亮点 | 为什么会在意 |
| --- | --- |
| 一个站点一份采集规则 | 站点知识放在插件仓库的 `<id>/` 目录里，加站不用动扩展核心。 |
| 先对齐模型身份再比价 | 规范模型表、插件别名、人工覆盖三层收敛，`GLM-5.3`、`z-ai/glm-5.3`、`glm-5.3:thinking` 落到同一行。 |
| 接口直连与页面桥接都支持 | CORS 放行的 JSON 接口直接采；需要登录态的站点复用当前浏览器会话。 |
| 按你的用量算钱 | 输入、缓存读、缓存写、输出分别计价，落到月成本和混合单价。 |
| 数据留在本机 | 快照存 IndexedDB，站点凭据存扩展本地存储，只请求你添加过的站点和两个公开参考源。 |
| 生成物有测试兜底 | 核心、采集、匹配、插件生成物都有 `node:test` 用例，漂移会红。 |

## 架构

```text
┌──────────────────────┐   ┌──────────────────────┐   ┌──────────────────────┐
│ site-plugin          │──▶│ provider-registry    │──▶│ adapters             │
└──────────────────────┘   └──────────────────────┘   └───────────┬──────────┘
                                                                  │ snapshot
                                                                  ▼
┌──────────────────────┐                              ┌───────────▼──────────┐
│ openrouter + boc     │─────────────────────────────▶│ matching             │
└──────────────────────┘                              └───────────┬──────────┘
                                                                  │
                                                                  ▼
                                                      ┌───────────▼──────────┐
                                                      │ pricing              │
                                                      └───────────┬──────────┘
                                                                  │
                                                                  ▼
                                                      ┌───────────▼──────────┐
                                                      │ dashboard            │
                                                      └──────────────────────┘
```

- `src/site-plugins/providers/<id>.js`：每个站点一份采集规则，由插件仓库生成。
- `src/core/provider-registry.js`：请求策略，统一处理直连、页面登录态和 Cookie 会话。
- `src/core/adapters.js`：按 `responseFormat` 分支解析响应，产出每站一份快照。
- `src/core/matching.js`：把站内模型名匹配到规范模型 id，参考价和规范表一起参与判定。
- `src/core/pricing.js`：把快照、参考价和你的用量算成比价行。
- `src/service-worker.js`：消息入口，`REFRESH_ALL` / `REFRESH_STATION` 采集，`FETCH_REFERENCES` 拉官方价，`GET_DASHBOARD` 出比价数据，`ADAPT_STATION` 识别站点。

## 安装

| 项目 | 要求 |
| --- | --- |
| 浏览器 | Chrome、Edge 等 Chromium 内核浏览器，支持 Manifest V3 |
| 扩展版本 | `0.6.0`（见 `manifest.json`） |
| Node.js | 只有开发和测试需要，Node 20 及以上 |
| 权限 | `storage`、`scripting`、`tabs`、`alarms`、`cookies`、`declarativeNetRequest`，主机权限 `<all_urls>` |

`<all_urls>` 是故意的：站点域名由插件决定，加站不需要重新授权。扩展只在你添加过的站点上注入页面脚本。

从 Release 安装：

1. 打开 [Releases](https://github.com/napstablook666/ai-price-analyzer/releases)，下载 `ai-relay-price-extension-v<version>.zip`。
2. 解压到一个固定目录，不要放在会被清理的临时目录里。
3. 确认目录里**直接能看到** `manifest.json`，多套一层文件夹是最常见的加载失败原因。
4. 打开 `chrome://extensions`（Edge 是 `edge://extensions`），打开「开发者模式」。
5. 点「加载已解压的扩展」，选中第 3 步的目录。

从源码安装：

```bash
git clone https://github.com/napstablook666/ai-price-analyzer.git
cd ai-price-analyzer
```

然后在浏览器里加载这个目录本身。要改站点采集逻辑时，再把插件仓库签出来，见[两个仓库](#两个仓库)。

## 快速开始

1. 点工具栏图标打开价格对比面板，顶栏齿轮进「站点与设置」。
2. 添加站点：填站点网址点「分析站点」，扩展会试探该站的价目接口和页面结构，把识别到的配置填进表单；也可以先在「插件仓库」装好站点插件，再到「已安装」一键加站。
3. 确认配置：采集模式、接口路径、请求方式、认证方式、充值比例。第一次原样保存，跑通再回来调。
4. 点「刷新全部」。需要登录的站点会先过一次登录态预检，分出「已登录 / 需要登录 / 需人工确认 / 无需登录」，按提示登录后重试。
5. 看表：每行是一个「站点 + 分组 + 模型」的报价，默认按混合单价升序，单元格底部是同模型的月成本长条。
6. 打开「偏好与成本 → 成本估算设置」，选成本口径预设或直接填输入输出用量，月成本和价差会跟着重算。

跑完这一轮，面板里应该有一张带参考价、匹配置信度和月成本的表。逐项说明见[在线文档](https://napstablook666.github.io/ai-price-analyzer/)。

## 常用命令

以下命令都在仓库根目录执行：

| 命令 | 作用 |
| --- | --- |
| `npm test` | 全部测试，改完必须绿 |
| `node scripts/plugin-build.mjs` | 改完插件源后重新生成 `src/site-plugins/` |
| `node scripts/plugin-build.mjs --check` | 只校验生成物有没有漂移 |
| `node scripts/model-lookup.mjs <模型写法>` | 查规范模型 id，例如 `claude 4.6` |
| `node canonical/build.mjs --offline` | 用缓存重算规范模型表 |
| `npm run version:check` | 检查 `package.json` 与 `manifest.json` 版本是否一致 |
| `npm run docs:dev` | 本地预览文档站 |

## 文档

| 想做什么 | 看哪里 |
| --- | --- |
| 安装、加载、常见坑 | [docs/guide/install.md](./docs/guide/install.md) |
| 加站与字段逐项解释 | [docs/configuration/station-fields.md](./docs/configuration/station-fields.md) |
| 读懂比价表 | [docs/guide/dashboard.md](./docs/guide/dashboard.md) |
| 调成本口径 | [docs/guide/cost.md](./docs/guide/cost.md) |
| 登录态、Token 与签到 | [docs/guide/session.md](./docs/guide/session.md)、[docs/guide/checkin.md](./docs/guide/checkin.md) |
| 写站点插件 | [docs/plugin-development.md](./docs/plugin-development.md) |
| 架构与数据流 | [docs/architecture.md](./docs/architecture.md) |
| 排错 | [docs/troubleshooting.md](./docs/troubleshooting.md)、[docs/faq.md](./docs/faq.md) |
| 完整手册 | [docs/user-guide.md](./docs/user-guide.md)、[docs/development.md](./docs/development.md) |
| 在线文档站 | <https://napstablook666.github.io/ai-price-analyzer/> |

## 两个仓库

项目拆成两个公开仓库：

- **扩展仓库**（本仓库）：MV3 页面、service worker、采集与匹配核心、生成的插件运行时代码、测试、文档。
- **插件仓库**：[ai-price-analyzer-plugins](https://github.com/napstablook666/ai-price-analyzer-plugins)，站点适配器的唯一手写源，一个站点一个目录。

开发站点插件时把插件仓库签出到本仓库旁边的 `plugins/`：

```bash
git clone https://github.com/napstablook666/ai-price-analyzer.git
cd ai-price-analyzer
git clone https://github.com/napstablook666/ai-price-analyzer-plugins.git plugins
```

构建器从 `plugins/<id>/` 生成 `src/site-plugins/providers/<id>.js`、`src/site-plugins/catalog.js` 和 `src/shared/plugin-order.js`。生成物签入本仓库，所以只下发布包也能直接加载；插件源改动后仍要重新生成，不要手改生成物。插件仓库在别处时用 `PLUGIN_DIR` 指过去。

## 数据来源与隐私

- 模型和价格来自你配置的中转站页面或接口。
- 公开参考源只有两个：OpenRouter 模型目录 `https://openrouter.ai/api/v1/models`，中国银行外汇牌价 `https://www.boc.cn/sourcedb/whpj/`。
- 设置和采集快照存在扩展本地存储与 IndexedDB，本项目不运行服务端账户或分析服务。
- 不要在 Issue 或 Pull Request 里粘贴私有 API 响应、Cookie、授权请求头、账户标识或凭据。

详细说明见 [PRIVACY.md](./PRIVACY.md)，漏洞报告方式见 [SECURITY.md](./SECURITY.md)。


## 免责声明

扩展算的是估算值，仅供参考，以站点后台的实际扣费为准。

- 价格来自你配置的站点当时展示的价目页或接口。站点改价、改分组倍率、改计费口径之后，旧快照不会自己变对。
- 月成本、折算单价、混合单价都建立在「偏好与成本」里那组月用量上。你填的用量和真实账单不会一致，算出来的金额只是同一把尺子下的横向对比。
- 带 `≈`、「估算」、「价格推导」、「币种待核验」标记的数字误差最大，别拿它们当报价依据。
- 扩展不核对账单、不代下单，也不代表任何站点的官方价格。依据这些数字做充值或采购决定，风险由使用者承担。

完整说明见 [docs/disclaimer.md](./docs/disclaimer.md)。
## 发布

发布由 Git tag 触发。先用 `npm run version:patch`（或 `minor` / `major`）同步版本号，再推 `v0.6.0` 这样的 tag。版本号在 `package.json`、`manifest.json`、tag 名三处必须一致；README 与 `docs/` 里写死的版本号顺手一起改。GitHub Actions 会产出三个文件：

- `ai-relay-price-extension-v<version>.zip`：可直接加载的 Chromium 扩展。
- `ai-price-analyzer-v<version>-source.zip`：构建所用的源码和插件快照。
- `SHA256SUMS.txt`：上面两个文件的校验和。

## 贡献

改动流程、提交前检查与代码约定见 [CONTRIBUTING.md](./CONTRIBUTING.md)。站点插件相关改动请一并看插件仓库的 [DEVELOPMENT.md](https://github.com/napstablook666/ai-price-analyzer-plugins/blob/main/DEVELOPMENT.md)。

## 许可证

[GPL-3.0](./LICENSE)