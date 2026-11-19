# 开发手册

入口索引。详细内容在文档站的「开发」栏目，源码同样在 `docs/`。

## 先读这三份

- [架构与数据流](./architecture.md)：目录职责、数据怎么流、两仓怎么分。
- [扩展侧插件协议](./plugin-development.md)：插件怎么写、能 import 什么、manifest 有哪些字段。
- [规范模型表](./development/canonical.md)：归一规则与生成流程。

## 开发栏目

- [开发总览](./development/index.md)：仓库边界、生成物规则、插件仓库布局、改动位置表。
- [规范模型表](./development/canonical.md)
- [测试与验收](./development/testing.md)
- [发布流程](./development/release.md)

## 命令速查

```bash
npm test                                 # 单元测试
npm run plugins:build                    # 从 ../plugins 重新生成站点插件
npm run plugins:check                    # 检查生成物漂移
npm run models:lookup -- <写法>           # 查规范模型 id
npm run models:build -- --offline        # 重算规范模型表
npm run docs:dev                         # 文档站本地预览
npm run docs:build                       # 构建文档站
npm run version:patch                    # 同步 package.json 与 manifest 版本
npm run version:check                    # 检查两处版本是否一致
npm run orphans:check                    # 找没人引用的模块与导出
```

## 硬约束

- 插件源码只能 `import … from "@app/core/…"` 或 `"@app/shared/…"`，不能写 `../../`，禁止动态 `import()`。
- `plugin.js` 的 `id` 必须等于目录名与 manifest 的 `id`。
- 规范模型归一规则在 `canonical/build.mjs` 与 `src/core/canonical.js` 里必须一致。
- 生成物（`src/site-plugins/*`、`src/shared/plugin-order.js`、`src/core/canonical-table.js`）不手改。
- 老设置里的 `llm` / `jev` / `providerProfiles` / `activeProviders` 继续在 `normalizeSettings` 里清理。
- 删功能要删干净：只服务它的导出、常量和用例一起删，`npm run orphans:check` 会报零引用。

## 验收

`npm run verify` 一次跑完 ids、孤儿、测试、插件漂移、版本四类检查。

`npm test` 全绿 + `npm run plugins:check` 无漂移。涉及采集链路的改动还要手验：加站点 → 采集 → 比价表有数据且同模型并到一行。