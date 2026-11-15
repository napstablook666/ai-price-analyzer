# AI Price Analyzer v0.3.0

本次发布重构价格页的信息层次，把站点图标、批量刷新和插件安装状态一并收口。

## 主要变化

- **价格页重构。** 去掉 MODEL EXPLORER 标题块，换成一行摘要胶囊（覆盖模型、官方匹配、首选方案、需核验），右侧保留筛选后的报价条数。官方价状态并入顶栏合并读数：`更新于 hh:mm:ss · 官方价 N HH:MM`。
- **五列明细表。** 付费模式从七列收到五列：模型、中转站、单价（费用项 / 官方 / 中转）、月成本 · 混合单价、状态。月成本、价差、混合单价合到一格，列宽固定为 24% / 20% / 9% + 13% + 13% / 21%，每行竖线对齐。
- **月成本排名改成浮层。** 悬停或点击月成本金额、长条才出现，浮层挂在页面固定层，鼠标移进去可以滚动列表；点外部、离开浮层或按 Esc 才收。表格里不再常驻名次。
- **月成本长条移到单价单元格底部。** 按同模型最高月成本归一，柱长 = 当前 ÷ 同模型最高 × 100%，分页与排序不改变相对长度。
- **批量刷新。** 顶栏「刷新指定站点」支持一次选多个站点：`runRefreshAll` 接受 `stationIds`，`REFRESH_STATION` 先确认全部站点都存在且启用，任一站不合法就整批拒绝。
- **站点与供应商图标。** 图标随插件仓库分发：`plugins/<id>/icon.svg|png` 经 `plugin-build.mjs` 复制到 `icons/sites/<id>.<ext>` 并生成 `src/shared/site-logos.js`；新增 `npm run plugins:icons` 从 manifest 域名抓 favicon，23 个插件都已补齐。站点列、站点筛选、供应商筛选、刷新菜单和设置页插件行接入图标，没有图标时退回首字母色块。
- **移除工作区导入导出。** 删掉 `src/shared/workspace.js`、`EXPORT_STATE` / `IMPORT_STATE`、设置页数据面板与 `docs/guide/workspace.md`。此前的工作区数据仍在浏览器本地，只是不再有导出入口。
- **插件安装状态修复。** 刷新仓库只替换条目清单，安装记录原样保留：`needsCode` 插件不会再变回「未安装」，已装版本也不会被仓库版本顶掉，`updateAvailable` 能正常算出更新。内置插件去掉按 bundled 来源设置的 `removable: false`，恢复可勾选移除。
- **其它修复。** 单位说明浮层点击外部关闭、价格代码不再缩写；官方匹配详情鼠标离开即收；图标漂移检测按行尾归一化比较，Windows 克隆后 9 个 svg 不再被误判成漂移。

## 校验

- `npm test`：271 项全过。
- `npm run plugins:check`：23 个插件产物与源同步。
- `npm run version:check`：`package.json`、`manifest.json` 均为 `0.3.0`。
- `npm run docs:build`：VitePress 文档站构建通过。

## 隐私检查

公开源码已按常见凭据与私钥标记扫过。不要把账号、cookie、私有响应或带账号信息的 URL 写进源码、fixture、issue 和 release 附件。

## Assets

- `ai-relay-price-extension-v0.3.0.zip` — 可直接加载的扩展目录包。
- `ai-price-analyzer-v0.3.0-source.zip` — 源码包，含签出到 `plugins/` 的插件仓库。
- `SHA256SUMS.txt` — 上面两个包的校验和。