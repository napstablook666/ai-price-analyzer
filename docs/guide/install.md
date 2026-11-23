# 安装与加载 🖥️

扩展是标准的 Chromium MV3 扩展包，没有构建步骤，也没有第三方运行时依赖。可加载的目录就是[仓库根目录](https://github.com/napstablook666/ai-price-analyzer)。

## 系统要求

| 项目 | 要求 |
| --- | --- |
| 浏览器 | Chrome / Edge 等 Chromium 内核浏览器，支持 MV3 |
| 扩展版本 | `0.26.1`（见 `manifest.json`） |
| Node.js | 仅开发与测试需要，Node 20 及以上 |
| 权限 | `storage`、`scripting`、`tabs`、`alarms`、`cookies`、`declarativeNetRequest`，主机权限 `<all_urls>` |

`<all_urls>` 是故意的：站点域名由插件目录决定，加站不需要重新申请权限。扩展只在你添加过的站点上注入页面脚本，其余页面不读内容。

## 从 Release 安装

1. 打开 [Releases](https://github.com/napstablook666/ai-price-analyzer/releases)，下载 `ai-relay-price-extension-v<version>.zip`。
2. 解压到一个固定目录，**不要放在临时目录或下载文件夹的清理范围里**。
3. 确认解压后的目录里直接能看到 `manifest.json`。多套一层文件夹是最常见的加载失败原因。
4. 访问 `chrome://extensions`，打开右上角「开发者模式」。
5. 点「加载已解压的扩展」，选中第 3 步的目录。
6. 在工具栏的扩展菜单里固定它，之后点图标就能直接打开价格对比面板。

## 从源码安装

```bash
git clone https://github.com/napstablook666/ai-price-analyzer.git
cd ai-price-analyzer
```

然后在浏览器里加载 `ai-price-analyzer` 目录本身（里面有 `manifest.json`）。

如果你要改站点采集逻辑，在扩展仓库旁边签出插件仓库。下面的命令从 `ai-price-analyzer` 目录执行。

```bash
git clone https://github.com/napstablook666/ai-price-analyzer-plugins.git ../plugins
npm run plugins:build
```

构建器默认读取 `../plugins/`，签出到其他位置时用 `PLUGIN_DIR` 指向插件仓库。插件源码不在扩展仓库里，`src/site-plugins/providers/*.js` 和 `catalog.js` 是生成物，直接改会在 `npm test` 里被判为漂移。

## 更新

- 在设置页「关于 → 一键更新」绑定当前加载的扩展目录，检查到新版本后点击「立即更新」。更新会校验发布清单签名和文件摘要。
- Windows 用户可以双击扩展目录里的 `update.bat` 更新。
- 也可以下载新包覆盖原目录，再到 `chrome://extensions` 或 `edge://extensions` 重新加载扩展。源码安装使用 `git pull` 后重新加载，改过插件源码的先运行 `npm run plugins:build`。
- 设置页「关于 → 版本与更新」可查看当前版本和最近一次检查结果，默认每 6 小时检查一次。

扩展版本、插件生成物、`package.json` 三处版本号要保持一致，`npm run version:check` 会校验。

## 卸载与数据残留

卸载扩展会清掉 `chrome.storage` 里的设置、站点和快照，重新安装后要重新加站、重填凭据。

## 常见加载失败

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 「清单文件缺失或不可读取」 | 选中的目录不含 `manifest.json` | 重新选到含 `manifest.json` 的那一层 |
| 扩展加载了但图标是灰的 | 扩展被浏览器禁用 | 在扩展页手动启用 |
| 点图标没反应 | 扩展没加载完整，或被其他扩展占用了图标位置 | 重新解压整包，不要只拷部分文件；图标被占用时到 `chrome://extensions` → 详情 → 快捷键里开页面 |
| 采集报「无法注入脚本」 | 页面是 `chrome://`、扩展页或 PDF | 换到站点正常页面再试 |

更多症状见[故障排查](../troubleshooting)。