# 发布流程 📦

发布靠打 tag 触发，`.github/workflows/release.yml` 负责校验、打包、发 Release。

## 触发条件

```yaml
on:
  push:
    tags:
      - 'v*.*.*'
```

推一个 `v1.13.0` 这样的 tag 就开始跑。

## 版本号必须三处一致

发布脚本会对比三样，任何一处不一致直接失败：

| 位置 | 字段 |
| --- | --- |
| `package.json` | `version` |
| `manifest.json` | `version` |
| tag 名 | 去掉前缀 `v` 后的部分 |

也就是 tag `v1.13.0` 要求两处都是 `1.13.0`。先改文件、再打 tag，顺序反了会白跑一次。

## 发布前校验

| 步骤 | 内容 |
| --- | --- |
| 生成物 | `node scripts/plugin-build.mjs --check` |
| 版本一致 | 上面那三处 |
| 语法 | `node --check` 六个入口文件 |
| 单测 | `npm test` |

任何一步失败，Release 不会产出。

## 产物

| 文件 | 内容 |
| --- | --- |
| `ai-relay-price-extension-vX.Y.Z.zip` | 浏览器加载包，包含 `manifest.json`、仪表盘、设置页、运行时代码和 Windows 更新脚本 |
| `ai-price-analyzer-vX.Y.Z-source.zip` | 扩展源码、测试、文档以及独立仓库的 `plugins/` 源码 |
| `SHA256SUMS.txt` | 两个 ZIP 包的 SHA256 校验值 |
| `update.json` | 带签名的自动更新清单 |
| `update.ps1` | Windows 外部更新脚本 |

Release 正文取 `RELEASE_NOTES.md`，并自动生成变更列表。

## 手工发布步骤

1. 用 `npm run version:patch`、`version:minor` 或 `version:major` 升版本，更新锁文件、安装文档和 `RELEASE_NOTES.md`。
2. 运行 `npm run plugins:build`。在扩展仓提交版本、文档和内置目录快照，在插件仓提交 `plugins.json`。
3. 执行 `npm run verify`、`npm run verify:clean` 和 `npm run docs:build`。
4. 给插件仓的发版提交打 `vX.Y.Z` 标签，先推送插件仓的 `main` 和标签。普通 CI 读取插件仓的 `main`，Release 读取插件仓的同名标签。
5. 推送扩展仓的 `main`，再给扩展仓的发版提交打 `vX.Y.Z` 标签并推送，触发 Release。
6. 等 Release 工作流成功，确认五个附件齐全，核对 ZIP 校验值及包内扩展版本。

## 用户侧升级

扩展是手动加载的，没有商店自动更新：

1. 下载新的 `ai-relay-price-extension-vX.Y.Z.zip`。
2. 解压覆盖原目录。
3. `chrome://extensions` 里点该扩展的刷新。
4. 打开面板确认站点还在、数据能采。

站点配置和设置存在浏览器本地，覆盖文件不影响。

## 回滚

打一个更低版本的 tag 不行，版本必须单调前进。回滚的做法：

1. 修代码。
2. 直接发一个更高的版本号（补丁修正），在 `RELEASE_NOTES.md` 里写明回滚了什么。

## 相关

- [测试与验收](./testing)
- [开发总览](./index)
- [插件协议](../plugin-development)