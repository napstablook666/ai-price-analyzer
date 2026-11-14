<!-- TRELLIS:START -->

# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, decisions, and progress)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

Reusable workflow skills live in `.agents/skills/` or the platform-specific skills directory. Discuss requirements into a PRD, then implement directly in the current main session.

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

# 本项目（AI 比价扩展）

Chromium MV3 扩展，抓多家 AI 中转站的模型价格，按统一模型身份做比价。两个仓库方向：**扩展空壳**（核心 + UI + 构建脚本）与**插件仓库**（`plugins/`，一个站点一个目录）。现在同仓，边界已按插件仓库划好。

先读 `docs/architecture.md`（数据流、目录职责、两仓拆分路线）和 `docs/plugin-development.md`（插件协议）。改代码前看 `.trellis/spec/`。

## 常用命令

```bash
cd extension && npm test                 # 全部测试，改完必须绿
node scripts/plugin-build.mjs            # 改完 plugins/ 后重新生成（npm run plugins:build）
node scripts/plugin-build.mjs --check    # 校验生成物有没有漂移
node scripts/model-lookup.mjs <模型写法>  # 查规范模型 id
node canonical/build.mjs --offline       # 重算规范模型表
```

## 改哪儿

- **加/改站点**：只动 `plugins/<id>/` 下的 `manifest.json`、`plugin.js`、`models.json`，然后跑构建。不要直接改 `extension/src/site-plugins/providers/*.js` 和 `catalog.js`，那是生成物（`npm test` 会抓漂移）。
- **统一模型 / 匹配**：`extension/src/core/canonical.js`（归一规则）、`extension/src/core/matching.js`（匹配优先级：人工覆盖 > 插件别名 > 规范模型 > 内置规则）。`canonical-table.js` 是生成物。
- **采集、存储、UI**：`extension/src/core/`、`extension/src/*.js`、`extension/*.html`。

## 硬约束

- 插件源码只能 `import … from "@app/core/…"` 或 `"@app/shared/…"`，不能写 `../../`；禁止动态 `import()`（MV3 service worker 只认静态导入）；插件里没有 DOM。
- `plugin.js` 的 `id` 必须等于目录名与 manifest 的 `id`。
- 规范模型归一规则在 `canonical/build.mjs` 与 `canonical.js` 里必须保持一致，改了要同时改、重算表、跑测试。
- 老设置里的 `llm` / `jev` / `providerProfiles` / `activeProviders` 键要在 `normalizeSettings` 里继续清理，不要恢复这些功能。

## 验收

`cd extension && npm test` 全绿 + `node scripts/plugin-build.mjs --check` 无漂移。涉及采集链路的改动，还要手动走一遍：加站点 → 采集 → 比价表有数据且同模型归到同一行。
