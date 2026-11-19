# 测试与验收 🧪

改完必须跑绿再提交。测试是 `node --test`，不依赖浏览器。

## 跑测试

```bash
npm test
```

`package.json` 的 `test` 脚本点名的八个文件：

| 文件 | 管什么 |
| --- | --- |
| `test/core.test.js` | 归一、匹配、定价、采集解析 |
| `test/refresh-preflight.test.js` | 刷新预检与确认签名 |
| `test/site-plugins.test.js` | 插件生成物与 catalog 一致性 |
| `test/plugin-build.test.js` | 构建脚本与漂移检测 |
| `test/model-identity.test.js` | 规范模型归一行为 |
| `test/model-api.test.js` | 模型接口连通性检查 |

## 生成物漂移

```bash
node scripts/plugin-build.mjs --check
```

有输出且退出码非 0 就是漂移：`plugins/` 改了但没重新生成，或者有人手改了生成物。修法只有一条——`node scripts/plugin-build.mjs` 重跑，然后重新提测。

## 手工走一遍采集

涉及采集或匹配的改动，测试绿了也要手验：

1. 加一个站点（按网址分析，或从已安装插件里挑）。
2. 刷新该站点，确认有快照、有价格。
3. 回比价表，确认同一模型来自两个站时并到一行。
4. 改一次月用量，确认月成本跟着变。

四步里任何一步不动，就是真问题，不要靠改测试掩盖。

## CI 校验了什么

`.github/workflows/ci.yml` 在 push 到 `master`/`main` 和所有 PR 上跑：

| 步骤 | 内容 |
| --- | --- |
| 检出 | 本仓库 + `napstablook666/ai-price-analyzer-plugins`（`main` 分支）检出到 `plugins/` |
| 生成物 | `node scripts/plugin-build.mjs --check` |
| 语法 | `node --check` 五个入口：`service-worker`、`dashboard`、`options`、`content-bridge`、`page-bridge` |
| manifest | `manifest.json` 能解析 |
| 必需文件 | 两个 HTML、五个图标、`README.md`、`README.en.md`、`LICENSE`、`PRIVACY.md`、`docs/user-guide.md`、`docs/development.md`、`docs/plugin-development.md`、`assets/tokenflux-pricing-analysis.png` |
| 单测 | `npm test` |
| 密钥扫描 | 正则扫私钥头、`AKIA…`、`ghp_…`、`sk-…`、长 password 赋值，命中即失败 |

CI 跑在 Node 20 上。本地版本更高没问题，但别用 Node 20 不支持的语法。

## 文档站

```bash
npm run docs:dev      # 本地预览
npm run docs:build    # 构建，链接坏了会在这里炸
```

改文档后至少跑一次 `docs:build`。VitePress 对失效的内部链接会直接报错。CI 不构建文档站，链接问题只能本地跑出来。

## 提交前清单

- [ ] `npm test` 全绿
- [ ] `node scripts/plugin-build.mjs --check` 无漂移
- [ ] 改了插件：`node scripts/plugin-build.mjs` 已重跑
- [ ] 改了归一：`canonical.js` 与 `canonical/build.mjs` 同步，表已重算
- [ ] 改了文档：`npm run docs:build` 通过
- [ ] 没有把凭据、真实 token 写进任何文件

## 相关

- [发布流程](./release)
- [规范模型表](./canonical)
- [架构与数据流](../architecture)