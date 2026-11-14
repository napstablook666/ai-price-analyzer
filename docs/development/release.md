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
| `ai-relay-price-extension-v1.13.0.zip` | 加载所需的那部分：`manifest.json`、三个 HTML、`styles.css`、`styles/`、`icons/`、`src/`，解压即用 |
| `ai-price-analyzer-v1.13.0-source.zip` | 源码包：整份仓库副本（`src/`、`scripts/`、`canonical/`、`docs/`、`test/`、各类 md）+ 独立仓库的 `plugins/` |
| `SHA256SUMS.txt` | 上面两个包的校验和 |

Release 正文取 `RELEASE_NOTES.md`，并自动生成变更列表。

## 手工发布步骤

1. 在 `plugins/` 仓库同步最新插件，本仓库跑 `node scripts/plugin-build.mjs`。
2. 升版本：`npm run version:patch`（或 `version:minor` / `version:major`），两处一起改；也可以手改 `package.json` 与 `manifest.json`。
3. 更新 `RELEASE_NOTES.md`，写清新增站点、修的问题、破坏性变更。
4. `npm test`，`npm run plugins:check`。
5. `npm run docs:build`，确认文档没坏链接。
6. 提交，打 tag：`git tag v1.13.0 && git push origin v1.13.0`。
7. 等 Actions 绿，检查 Release 里三个文件都在。

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