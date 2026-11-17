# AI Price Analyzer v0.6.0

比价表以前只认 token 计费。生图按张、视频按秒、按次计费的报价摊进混合单价后不是算出 ¥0 就是被读错量纲。这版按计费方式把报价分成三条道，各自用各自的尺子。

## 主要变化

- **按计费方式分道。** `billingModeOf()` 判定按 token / 按张 / 按次：报价里有「元/张」才走生图道，只报「元/1M 图输出 token」仍留在 token 道。混合单价列不再把元/张和元/1M 塞进同一把尺子，单位价格先按量纲分榜再排价。
- **按次报价给平衡点。** 按次的单次价摊成元/1M 并给出平衡点，分母用站点画像里的单次 token，不是全局平均。视频按秒的档单独标注，`0.35 元/秒` 不会再被读成 `0.35 元/次`。
- **充值阶梯档位。** 站点买的额度越多折扣越深，取「第一个 >= 实际消耗的档」折算实付，不按档位面值算。额度永久有效的站点，多买的额度下月继续用。
- **价格地图。** 把 cheaprouter、sidrune、tokenflux、true-sota 四站的价目表固化进 `src/core/price-maps/`，按模型身份对齐成地图行，缺价单独标。
- **KillAI 免开页面直采。** 登录态只在 HttpOnly cookie 里，刷新接口还校验 Origin，页面里读不到。改成借 DNR 补齐 Origin 与 Cookie，在 service worker 里换出 access token 后直连价格接口，不再每轮刷新开临时标签页。`manifest.json` 相应加上 `declarativeNetRequest` 权限。
- **maolaoapi.com 站点。** 公开定价 API 直连采集，充值 1.03 元/额度，200/500/1000 档 9.8/9.5/9.0 折已并入档位表。
- **Hepingan 自动续期。** token 24 小时过期后自动用 refresh_token 换新，首次登录过后不用再回站点。
- **magpie 用量同步。** 从本机网关读实测用量写入设置，用量预设优先用实测值，未同步过才退回内置快照。失败按间隔退避，网关没开时不每分钟重试。
- **归一版本 25。** 解析 `len <= N` / `p <= N` 这类长度条件与三元链分支，保留区间开闭；出图规格档（1K/2K/4K）单独成列。
- **站点体检脚本。** `npm run audit:stations` 匿名真拉每个站走完整归一，报模型数、出图出视频行数与解析不出价格的条目。站点偷改接口时由脚本先发现，不用等用户看到榜单空了。

## 校验

- `npm test`：403 项全过。
- `npm run plugins:check`：23 个插件产物与源同步。
- `npm run version:check`：`package.json`、`manifest.json` 均为 `0.6.0`。
- `node --check`：`src/service-worker.js`、`src/dashboard.js`、`src/options.js`、`src/content-bridge.js`、`src/page-bridge.js` 通过。
- `npm run docs:build`：文档站构建通过。

## 隐私检查

公开源码已按常见凭据与私钥标记扫过。不要把账号、cookie、私有响应或带账号信息的 URL 写进源码、fixture、issue 和 release 附件。

## Assets

- `ai-relay-price-extension-v0.6.0.zip` — 可直接加载的扩展目录包。
- `ai-price-analyzer-v0.6.0-source.zip` — 含 `plugins/` 源的完整源码包。
- `SHA256SUMS.txt` — 上面两个包的校验值。

## 升级说明

有两个站点改了采集方式：KillAI 从页面采集换成直接采集（`declarativeNetRequest` 权限，浏览器会重新提示一次权限），Hepingan 支持自动续期。插件产物随扩展一起更新，不用单独重装。

价格由站点决定，采集规则会随站点改版失效，扩展侧算出的月成本与价差都是估算，以站点后台实际扣费为准。详见[免责声明](https://napstablook666.github.io/ai-price-analyzer/disclaimer)。
