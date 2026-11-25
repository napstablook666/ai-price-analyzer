# AI Price Analyzer v0.27.0

## 新功能

- **站点插件从 58 家扩到 104 家。** 这一版把 linux.do「扬帆起航」板块整个扫了一遍：318 个主机 → 存活复检 203 个 → 能匿名或带登录态取到价目表的全部接成插件。新增 46 家，按报文形状归到已有的几个基座（`allrouter`、`relayrouter`、`tokenflux`、`stellaisle`、`true-sota` 等），没有为任何一家写一次性代码。
- **新的价格映射基座 `direct`：人民币每百万直价。** 有的站不走「倍率 × 额度」，价目表上直接就是 ¥/百万 token（Relayo / acombcom.cn 是这种）。`direct` 把 `input_price` / `output_price` / `cache_read_price` 原样接到比价表，不再假装能反推出倍率。
- **登录态采集。** 一批站点的 `/api/pricing` 要 `Authorization`，新增两条取凭据的路径：`localStoragePageAuth`（从页面 localStorage 的 `user` 键取 token，可带额外请求头）与 `cookieRefreshAuth`（用登录 cookie 调 `/api/user/auth/refresh` 现换 `access_token`，带过期时间）。已经接上 4 家，凭据过期时该站标记为会话失效，不污染比价表。
- **调研文档 `docs/relay-survey-20261124-linuxdo-startup.md`。** 318 个主机的分诊表、存活复检口径、每一批的模型数/行数/分组倍率/充值比例/是否要登录，以及 150 个没接的卡在哪一条。

## 修复

- **service worker 注册失败。** MV3 的 module service worker 不允许顶层 `await`，Rust wasm 的异步实例化在 `import` 阶段就抛 `Service worker registration failed`。改成同步 `WebAssembly.Module` + `Instance`，wasm 字节以 base64 内联，加载不再等 Promise。
- **Rust 产物误报过期。** 干净签出上文件 mtime 全是检出时间，`rust-dist` 的新旧判断永远失败。改用 `git log -1 --format=%ct` 的提交时间比。
- **`billing_expr` 多行模板。** 插件生成器把 profile 多行数组只注释掉第一行，其余行当代码执行，`SyntaxError: Unexpected identifier`。改成每行加 `//`。

## 计费口径

- **同一模型的多分组价目各算一行。** 一个模型在 12 个分组里有 12 个价，比价表按「模型 × 分组」出行，不做平均也不取最低，分组倍率原样带在行上。
- **按次、按张、按秒不折算成 token 价。** `billing_expr` 里 `u("request")` / `u("image")` 这类只落 `request_price` / `image_price`，不塞进 `input_price` 骗排序。
- **长上下文分档与时段档按抓取时刻求值。** `len <= 272000` 与 `weekday("Asia/Shanghai") 1-5 && hour 9-18` 这类条件，在采集时按当前时刻算一次并写进 `priceNote`，比价表里看到的就是那一次的价，不假装是全天价。
- **充值比例区分「读到的」与「验证过的」。** 从 `/api/status` 的 `price` / `quota_per_unit` / `usd_exchange_rate` 推出来的换算记 `rechargeRateVerified: false`，只有对着实际付款档位核过才置 `true`。

## 兼容性

- 无新增扩展权限，无 schema 变更，老设置直接可用。
- 老版本存下的站点配置不需要删了重建；新插件第一次采集时自动带出价目。

## 附件

- `ai-relay-price-extension-v0.27.0.zip`：可直接加载的扩展目录包。
- `ai-price-analyzer-v0.27.0-source.zip`：扩展与插件两仓的源码快照。
- `SHA256SUMS.txt`、`update.json`、`update.ps1`：校验与签名更新清单。
