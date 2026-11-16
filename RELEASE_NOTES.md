# AI Price Analyzer v0.5.2

比价表的单价列以前只有一串数字，看不出这家中转比官方贵还是便宜。这版把差价直接画在数字上。

## 主要变化

- **中转价按与官方价的贵贱上色。** 单价表的中转列逐项和官方比大小：比官方贵标红 `▲`，比官方便宜标绿 `▼`，鼠标悬停能看具体差多少百分比。官方列永远是中性色，当基准用。
- **不上色的三种情况。** 差距在 0.5% 以内（四舍五入的抖动）、官方缺价、任一侧是估算值，一律保持中性灰。估算值是拿输入价兜底算出来的，跟官方真实价比大小没有意义，不上色免得被当成结论。
- **缓存项也带色。** 输入/输出是常看的，还是对齐的两行；缓存读、缓存写、缓存写入（1h）压成「官方 → 中转」小标签，颜色和箭头跟主行一致，一排三个也放得下。
- **单价单元格渲染收敛到一处。** 主行和缓存标签原先各拼一份 `<span class="price-value">`，现在共用一个 `cellMarkup()`，多一个 tone 参数。颜色走 `--price-tone` 自定义属性，不必和 `.price-grid`、`.price-line-primary` 两条定色规则比选择器权重。

## 校验

- `npm test`：308 项全过。
- `npm run plugins:check`：22 个插件产物与源同步。
- `npm run version:check`：`package.json`、`manifest.json` 均为 `0.5.2`。
- `node --check`：`src/service-worker.js`、`src/dashboard.js`、`src/dashboard-pricing.js`、`src/options.js`、`src/content-bridge.js`、`src/page-bridge.js` 通过。
- `npm run docs:build`：文档站构建通过。

## 隐私检查

公开源码已按常见凭据与私钥标记扫过。不要把账号、cookie、私有响应或带账号信息的 URL 写进源码、fixture、issue 和 release 附件。

## Assets

- `ai-relay-price-extension-v0.5.2.zip` — 可直接加载的扩展目录包。
- `ai-price-analyzer-v0.5.2-source.zip` — 含 `plugins/` 源的完整源码包。
- `SHA256SUMS.txt` — 上面两个包的校验值。

## 升级说明

直接覆盖加载新版本即可。插件不用重装，这一版没改采集代码。
