# AI Price Analyzer v0.26.0

## 新功能

- **新增 Man8Out 插件（`man8out`）。** 40 个模型、18 个分组、74 条分组×模型记录，归一后 80 行。取价走 `GET /api/v1/channels/catalog`，匿名 200，`credentials: "omit"`，不用登录。接口给的是官方基准价（`2e-6` 表示 $2/百万 token），分组倍率 `rate_multiplier` 由前端乘，插件照乘，区间 0.09x ~ 1.5x，大于 1 的组不钳到 1。站内 20 条 `pricing: null` 是「站点没配价」，不进比价表，不当免费。
- **新增 OpenRouter 插件（`openrouter`）。** 官方聚合站，477 个条目归一成 435 个模型、515 行（80 行是长上下文档）。`GET /api/v1/models` 匿名可读，927 KB 全量价目一次到手。插件总数从 56 涨到 58，两家都不需要登录。
- **OpenRouter 的模型身份按 `id` 走，和基准站同一套口径。** 显示名留给标签，所以同一个模型在两边能对上、只出一行；`:batch` 兄弟条目独立成行（半价），不会和主条目撞车。

## 计费口径

- **长上下文档摊成行内单档。** OpenRouter 的 `overrides` 只给下限，插件补 `max_tokens = 下一档下限`，并丢掉相邻档的重复下限（272K 那条本身也是边界，留着就会让 400K 的请求同时命中两档）。结果一个请求只命中一档。
- **三类条目直接丢弃，不进表。** 19 条浮动别名（`~vendor/x-latest`，价随目标漂）、12 条 `:free` 变体（0 价）、8 条路由占位（`openrouter/auto` 一类报 `-1`）。留着它们的后果是表里出现对不上的行和一个 `-1.0` 的假报价。
- **OpenRouter 充值费率是实测值。** 登录后走到收银台看 Total due，没有真付款：加密通道 5% 固定无最低（$10 面值实付 $10.50），信用卡 5.5% 触底 $0.80（$10 实付 $10.80，$100 实付 $105.50），起充 $10，余额 1 额度 = $1，没有赠送档位。折算 **7.665 元 / 美元额度**，`rechargeRateVerified` 与 `rechargePaymentsVerified` 都是 `true`。同一份目录按这个汇率折算，435 条 offer 与基准站 **435/435 条 `diffPercent = 0`**；换成面值 7.3 折算则是 435 条全 `+5%`，那 5% 就是充值手续费。
- **Man8Out 的充值口径换成收银台实测。** 充 10 元到账 ◈10.00，支付宝另收 1%（¥0.10），实付 ¥10.10；站内 ◈ 与官方美元额度 1:1，折算 1 美元额度 = ¥1.01，单笔 1 ~ 10000 元，无赠送档位（三档折扣规则全 `enabled: false`）。订阅套餐 10 档整周期折算 **¥0.236 ~ ¥0.367 每 ◈**，比充值便宜 2.7 ~ 4.3 倍；每周发一批、28 或 30 天到期、用不完不累积，所以按整周期单价记，不按首发那一周算。Ultra 售罄，其余 9 档页面可开通。

## 破坏性变更

- **生图与视频模型整条不进比价表。** 对比类型页签（文本/生图/视频）废弃：判到非文本直接跳过，`billingMode === "image"` 再兜一层，报价行上只剩 token 与 request 两种计费方式。之前「两个档都保留但算不准」的状态作废，避免页面上留一堆 0 元或对不上的行。
- 随之删掉生图专用链路：`src/core/image-billing.js`（586 行）、`parseImageModels`、OpenRouter `/images/models` 抓取、`mediaUnitPrice`、月度用量里的 image 三键、仪表盘的对比类型开关。
- **采集侧没删。** 插件的按次价、按秒价、媒体规格照旧解析，站点改版时还能看出哪类报价没读进来。要恢复比价，接 `mediaTypeForPricing()` 一处开关即可，做法写在 `docs/development/media-pricing.md`。按次计费的文本模型（token 之外收一次调用费）不受影响。

## 兼容性

- 无新增扩展权限，站点域名继续由插件目录决定，权限仍是 `storage`、`scripting`、`tabs`、`alarms`、`cookies`、`declarativeNetRequest`、`<all_urls>`。
- 旧设置里的媒体相关字段读出来按新口径处理，不用清缓存；已采集的历史快照照旧显示，只是不再出媒体行。
- `man8out` 与 `openrouter` 都匿名可读，不需要 cookie。Man8Out 的充值与结算三件套（`/payment/config`、`/payment/limits`、`/payment/checkout-info`）仍要登录，插件不依赖它们取价。
- OpenRouter 的 3 个模型带时段折扣档（`utc_*` 字段），规则表达不了按小时变动的 token 价，表里只显基础价；按张计价的 `image`、按分钟计价的 `audio`、按次查价的 `web_search` 不进 token 比价口径。

## 附件

- `ai-relay-price-extension-v0.26.0.zip`：可直接加载的扩展目录包。
- `ai-price-analyzer-v0.26.0-source.zip`：扩展与插件两仓的源码快照。
- `SHA256SUMS.txt`、`update.json`、`update.ps1`：校验与签名更新清单。
