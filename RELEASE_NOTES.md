# AI Price Analyzer v0.5.1

修一个插件商店的老毛病：扩展发一次版，插件仓库里的版本号就跟着整体跳号，
刷新后所有已装插件都被标成「有更新」，可插件代码一个字节都没动。

## 主要变化

- **内置插件不再按扩展版本号报更新。** 插件仓库的 `version` 由 `scripts/plugin-build.mjs` 从扩展 `manifest.json` 取，21 个采集插件没写自己的版本，于是继承扩展版本号。已安装记录停在上个扩展版本，刷新仓库后 `comparePluginVersions` 对所有已装插件判真，全部挂上「有更新」。
- **判定口径分开。** 采集代码随扩展打包的插件（`needsCode: true` 且内置）已装版本按当前扩展版本算，且不参与版本比较——这类插件装与不装跑的都是扩展里同一份代码，此前点「更新」只是把记录里的版本号改成新值。声明式插件（`site-checkin` 这类代码从仓库装的）仍按仓库版本号判断，该提示更新照常提示。
- **回归测试。** 新增 `pluginUpdateState` 单测，覆盖内置插件不报更新、声明式插件照旧比较、未安装三种情况。

## 校验

- `npm test`：307 项全过。
- `npm run plugins:check`：22 个插件产物与源同步。
- `npm run version:check`：`package.json`、`manifest.json` 均为 `0.5.1`。
- `node --check`：`src/service-worker.js`、`src/core/declarative-plugin.js`、`src/options.js` 通过。

## 隐私检查

公开源码已按常见凭据与私钥标记扫过。不要把账号、cookie、私有响应或带账号信息的 URL 写进源码、fixture、issue 和 release 附件。

## Assets

- `ai-relay-price-extension-v0.5.1.zip` — 可直接加载的扩展目录包。
- `ai-price-analyzer-v0.5.1-source.zip` — 含 `plugins/` 源的完整源码包。
- `SHA256SUMS.txt` — 上面两个包的校验值。

## 升级说明

直接覆盖加载新版本即可。已经装过的插件不需要再点一次「更新」：插件商店里显示的已装版本就是当前扩展自带的版本，之后不会再因为扩展发版而误报。
