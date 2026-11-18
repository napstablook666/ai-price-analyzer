# AI Price Analyzer v0.11.0

这版加了一个新站点，顺手把采集进度面板从「5 秒后自己消失」改成「留到你点关闭」。

## 主要变化

- **AllRouter 插件（`allrouter`）。** `allrouter.cc/api/ratio_config` 匿名可读，一次 GET 约 43 KB，不需要登录。采 49 个在售模型：报文里的 486 个模型名大部分是 New API 出厂默认表，站点根本不卖，真实在售清单只有登录后的 `/api/user/models` 有，所以插件带白名单，只报这 49 个。十个别名把站内写法（`[1m]` 后缀、`-openai-compact` 端点变体、`-highspeed` 加速版）并回规范模型，同一模型横着能比价。
- **新的 `allrouter` 归一格式。** 这个站的倍率基数是 1 = $2/百万 token，和 NewCodex 一样，但报文是列式的：`model_ratio` / `completion_ratio` / `cache_ratio` / `create_cache_ratio` / `model_price` / `billing_expr` / `billing_mode` 七张「模型名 → 值」的表，没有行数组，拼行在归一层做。倍率与表达式两份能互相校验：`claude-opus-5-5` 的 `ratio 2` 对上表达式 `p*4`，`claude-sonnet-5-5` 的 `ratio 1` 对上 `p*2`，`claude-haiku-4-5` 的 `ratio 0.5` 对上官方 $1/M。直接用 `tokenflux` 会把倍率类模型全报低一半。
- **表达式优先于倍率。** 27 个模型把真实价写在 `billing_expr` 里，包括按长度分段的长上下文模型（`len <= 272000` 一档、超过另一档），以及 DeepSeek 三个的峰谷分时（工作日 9-12 点、14-18 点走 `peak`，其余走 `off_peak` 半价）。这类模型倍率只是占位，插件按表达式出价，峰谷两档各出一行。
- **采集进度面板改成手动关闭。** 原来采完再留 5 秒就自动收起，汇总和每站成败一闪而过。现在面板一直留着，直到点右上角的关闭按钮；下一轮刷新开始会重新展开，出错时同样保持可见。

## 校验

- `npm test`：465 项全过。
- `npm run plugins:check`：28 个插件产物与源同步。
- `npm run version:check`：`package.json`、`manifest.json` 均为 `0.11.0`。
- `node --check`：`src/service-worker.js`、`src/dashboard.js`、`src/options.js`、`src/content-bridge.js`、`src/page-bridge.js` 通过。
- AllRouter 用站上真实的 `/api/ratio_config` 报文（43,842 字节）回放整条采集链路：49 个规范模型全部落到报价，77 行（27 个表达式模型的分段与峰谷各出多行），零 unresolved。表达式解析、缓存价、图片模型三处都拿站内数字逐个对过。

## 隐私检查

仓库里没有 cookie、token、账号名。AllRouter 只请求公开的 `/api/ratio_config`，不带凭据（`credentials: "omit"`），采集结果只存在本机 IndexedDB。

## Assets

- `ai-relay-price-extension-v0.11.0.zip` — 可直接加载的扩展目录包。
- `ai-price-analyzer-v0.11.0-source.zip` — 含 `plugins/` 源的完整源码包。
- `SHA256SUMS.txt` — 上面两个包的校验值。

## 升级说明

`allrouter` 用到新的响应格式（`allrouter`），旧版扩展认不出来，插件标了 `needsCode`：装之前先把扩展升到 0.11.0。

装上之后建议点一次 allrouter 的采集对一下数：站上按分组卖，插件不登录，出的是 `default` 组的基准价，分组倍率要登录后的 `/api/user/groups` 才看得到。DeepSeek 三个报的是高峰价，低峰时段实际更便宜。三个 `gpt-image-2.5` 的表达式含图片 token 系数（`img*8`），解析器不认，只报文本价，按张的钱站点没公开口径。

价格由站点决定，采集规则会随站点改版失效，扩展侧算出的月成本与价差都是估算，以站点后台实际扣费为准。详见[免责声明](https://napstablook666.github.io/ai-price-analyzer/disclaimer)。
