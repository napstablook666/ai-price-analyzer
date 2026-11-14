# plugins 拆独立 git 仓库

## Goal

落实上一任务（11-13-canonical-models-plugin-split）R4 的遗留项：`plugins/` 成为独立 git 仓库，扩展侧通过 `PLUGIN_DIR` 定位插件源，工作区物理拆分为「扩展仓 + 插件仓」两个自包含单元。

## 方案

- 物理布局：`plugins/` 原地成为独立 git 仓库（嵌套独立仓），外层仓库保持为扩展仓。不用 submodule，不迁移目录。
- 外层 `.gitignore` 增加 `/plugins/`，`git rm -r --cached plugins`，插件历史保留在外层仓库。
- `scripts/plugin-build.mjs`：`PLUGIN_DIR` 支持 `process.env.PLUGIN_DIR` 覆盖，默认 `./plugins` 不变，嵌套布局下构建流程零变化。
- 插件仓内容：22 个插件三件套（manifest.json / plugin.js / models.json）+ README，全新历史（外层仓库保留全部历史）。
- 文档：`docs/architecture.md` 拆仓路线改为已落地；`docs/plugin-development.md` 与 `plugins/README.md` 补 PLUGIN_DIR 用法。

## 不做

- 不用 subtree split 保留插件目录历史（历史价值低，外层仓库保留全史）。
- 不引入 submodule / submodule 工具链。
- 不碰另一会话的未提交 WIP（normalizers.js / page-bridge.js / all-in-one 相关 / `.pw-*`）。

## 验收

- [x] `plugins/` 内 `git status` 干净，22 个插件 + README 入库。
- [x] 外层仓库不再跟踪 `plugins/`，`plugin-build --check` 22 个插件同步。
- [x] `PLUGIN_DIR` 指向外部目录时 `--check` 冒烟通过。
- [x] `npm test` 全绿。
