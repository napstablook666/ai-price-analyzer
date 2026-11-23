# 中转站批次调研（2026-11-23）

核验日期 2026-11-23。对象是社区板块里在用的 35 家中转站。本文只记录**匿名可达性 + 报文形状**，价格数值以采集时的 `/api/pricing` 为准，不在文里兜底。

探测方式统一：`fetch` 直连，UA 为 Chrome 131，`redirect: follow`，超时 12–15s。原始报文落在 `out/recon/raw/`，抽路径的结果在 `out/recon/third/paths.json`。

表里的模型数、分组数是抓取那一刻的值，不是长期承诺：中转站每天都在加减模型，快跑AI 在同一小时内从 118 个模型 / 15 个分组长到 123 / 19。要拿今天的数，重抓一遍 `/api/pricing` 自己数，别拿本文当准。

## 结论

35 家分四类：

| 类 | 家数 | 判据 | 能否本轮适配 |
| --- | ---: | --- | --- |
| A 匿名直连 | 9（11 个域名） | `/api/pricing` 匿名返回 JSON，new-api 新版形状 | 能，只要插件声明 |
| B 接口在但要 Authorization | 9 | 端点存在，401 `Authorization header is required` | 要登录态才能验证 |
| C 纯 SPA | 8 | 所有 `/api/*` 回落到 index.html | 要浏览器渲染，或另找接口 |
| D 不可达 | 9 | 5xx / DNS 失败 / Cloudflare 挑战 / 站点暂停 | 不能 |

A 类 9 家全部是 new-api（`v1.0.0-rc.*` 或定制版本），报文结构一致：`data[]` + `group_ratio` + `usable_group` + `vendors`，模型条目里 `billing_mode: "tiered_expr"` 加 `billing_expr` 表达式。这一形状扩展里已有 `price-map` 的 `tokenflux` 基座覆盖，**新增站点只写声明，不动核心代码**（见 `plugin-development.md` 的「新增一个同形状站点不再需要动扩展代码」）。

## A 类：匿名直连

| 站点 | 域名 | 模型 | 分组 | 按次/张 | 带 expr | `quota_display_type` / 符号 | `price` | `usd_exchange_rate` | `custom_currency_exchange_rate` |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: |
| 快跑AI | `kuaipao.pro` + `kuaipao.ai` | 123 | 19 | 6 | 51 | CUSTOM / `$` | 0.4 | 1 | 0.4 |
| PQH | `pqh.ai` | 108 | 53 | 4 | 64 | USD / `¤` | 7.3 | 7.3 | 1 |
| 0ait | `0ait.com` | 72 | 37 | 4 | 53 | USD / `¤` | 7.3 | 7.3 | 1 |
| 4Z API | `4zapi.com` | 323 | 80 | 114 | 0 | — / 空 | 1 | 6.68752 | 1 |
| 深空API | `xkrelay.com` | 71 | 26 | 7 | 52 | CUSTOM / `¥` | 1 | 1 | 1 |
| ZeroCat | `zero.cat` | 67 | 11 | 0 | 47 | CNY / `¤` | 1 | 1 | 1 |
| CoreCode | `corecode.live` | 28 | 7 | 7 | 14 | USD / `¤` | 1 | 6.8 | 1 |
| CodeRelay | `coderelay.cn` | 54 | 16 | 3 | 21 | USD / `¤` | 1 | 1 | 1 |
| packycode | `packycode.com` + `packyapi.com` | 78 | 25 | 13 | 0 | USD / `¤` | 1 | 7 | 7 |

`quota_per_unit` 全部是 500000，即 1 美元额度 = 500000 quota，与扩展的既有假设一致。

同后端合并的判定：

- `kuaipao.pro` 与 `kuaipao.ai` 的 `/api/pricing` 响应字节数完全一致（55190），`/api/status` 的 `server_address` 自报 `https://kuaipao.ai`。判定同一后端。
- `packycode.com` 与 `packyapi.com` 的 `/api/pricing` 响应一致（28946 字节，`catalog_version` 同为 5808）。判定同一后端。

### 分组倍率分布（`group_ratio` 去重后升序）

| 站点 | 倍率 |
| --- | --- |
| 快跑AI | 0.2, 0.5, 0.75, 0.875, 1, 1.8, 2.5, 3, 5, 6, 9, 15.3 |
| PQH | 0.12 起，共 25 档（0.12–2.6） |
| 0ait | 0.15 起，共 25 档 |
| 4Z API | 0.040447 起，共 41 档 |
| 深空API | 0.08, 0.13, 0.15, 0.2, 0.23, 0.25, 0.3, 0.4, 0.45, 0.5, 0.6, 1 …共 16 |
| ZeroCat | 0.04, 0.1, 0.15, 0.2, 0.22, 0.25, 0.4, 0.5, 0.7, 1, 1.5 |
| CoreCode | 0.5, 0.7, 1, 1.2, 1.9, 2.05 |
| CodeRelay | 0.06, 0.1, 0.15, 0.3, 0.5, 0.6, 0.65, 1.5 |
| packycode | 0.3, 0.5, 0.8, 0.95, 1, 2.5, 2.8, 5, 7 |

### 币种与 ratio 基准

- **快跑AI**：`/api/notice` 公告原文写「汇率参考：¥0.4 ≈ $1」，与 `price = 0.4`、`custom_currency_exchange_rate = 0.4`、`group_ratio_note = "× 0.4 充值"` 三处一致。判定 **0.4 元 = 1 美元额度**。
- **PQH / 0ait**：`price = 7.3` 与 `usd_exchange_rate = 7.3` 同值，`quota_display_type = USD`。判定 **1 美元额度 = ¥7.3**。两站 `/api/status` 的 `price`、`quota_per_unit` 完全相同，与「0ait 与 PQH 同家」的说法吻合，但模型目录规模不同（108 / 72），是两套独立部署。
- **4Z API**：`price = 1`、`usd_exchange_rate = 6.68752`，`quota_display_type` 缺省。汇率是实时值（非整数），倾向 **1 美元额度 ≈ ¥6.69**，但 `price = 1` 与之矛盾，标 `probable`。
- **深空API**：`quota_display_type = CUSTOM`、符号 `¥`、`price = 1`、`usd_exchange_rate = 1`。判定 **¥1 = $1 额度**。
- **ZeroCat**：`quota_display_type = CNY`、`price = 1`、`usd_exchange_rate = 1`。判定 **¥1 = $1 额度**。
- **CoreCode**：`quota_display_type = USD`、`price = 1`、`usd_exchange_rate = 6.8`。`price` 与 `usd_exchange_rate` 冲突，标 `probable`，待页面核对。
- **CodeRelay**：`USD`、`price = 1`、`usd_exchange_rate = 1`。判定 **¥1 = $1 额度**。
- **packycode**：`price = 1`、`usd_exchange_rate = 7`、`custom_currency_exchange_rate = 7`。判定 **¥7 = $1 额度**。

`price` 与 `usd_exchange_rate` 不同值的三家（4Z、CoreCode、packycode）需要页面三证补齐，代码里先按 `usd_exchange_rate` 写并标 `rechargeRateVerified: false`。

### 需要特别处理的报文差异

1. **4Z API 与 packycode 没有 `billing_expr`**（expr 数为 0），全靠 `model_ratio` + `completion_ratio` + `cache_ratio` 走 token 规则。这两家必须核对 `model_ratio` 一个单位值多少美元，不能套用 `tokenflux` 基座默认的 1 = $2。
2. **4Z API 有 `/api/pricing_new`**，比 `/api/pricing` 多 `group_model_ratio`、`group_desc`、`voice_clone_fee`、`custom_voice_fee`；`data[]` 同为 323 条。当前 `/api/pricing` 够用。
3. **DeepSeek 那类带时间加价的表达式**：`zero.cat` 的 `billing_expr` 形如
   `(tier("base", p * 4.5 + c * 13.5 + cr * 0.15)) * (hour("UTC") >= 1 && hour("UTC") < 4 ? 2 : 1) * (...)`
   求值器 `evalExpression` 只认四则运算（见 `src/core/price-map.js:88`），`hour()` 与 `tier()` 都会被 `parseBillingTiers` 先切走；**时间加价这一层当前不入价**，采集值是基础档价。
4. **深空API 有 `peak_offpeak_status` / `peak_offpeak`，packycode 有 `peak_pricing` / `peak_active`**：高峰期加价字段，基座未消费，同样按基础价采集。
5. **packycode 的模型条目带 `price_currency: "CNY"` 与 `tiers[]`**，与同批其他站不同，需要单独确认 `tiers` 的语义（是本币档价还是美元档价）。

## B 类：接口在，但要 Authorization

| 站点 | 端点 | 未带头的响应 |
| --- | --- | --- |
| daNew ai `danew.ai` | `/api/v1/groups/available`、`/api/v1/groups/rates` | 401 `{"code":"UNAUTHORIZED","message":"Authorization header is required"}` |
| 星驰公益 `xingchiapi.com` | 同上 | 同上 |
| InitAPI `initapi.ai` | 同上 | 同上 |
| AIHUB `aihub.dog` | 同上 | 同上 |
| 奥特曼AI `altmancode.com` | 同上 | 同上 |
| 遥星AI `yaoxing.best` | `/api/pricing` | 401（new-api，`settings/public` 里 `pricing.requireAuth = true`） |
| Crab-ai `crab-ai.net` | `/api/v1/model-plaza/notifications` | 401 `{"code":401,"message":"Authentication required"}` |
| Right Code `right.codes` | `/api/v0/*` | Spring 风格 404，前缀未命中，公开路径待挖 |
| YesCode `co.yes.vg` | `/api/v1/models` | 404 `{"error":"Endpoint not found"}`，自研后台 |

前五家是同一套后台（JS bundle 里同样出现 `/api/v1`、`/api/v1/admin`、`/api/v1/admin/ops/ws/qps`），一次逆向能覆盖五站，值得做。

值得注意的例外：

- **Crab-ai** 的 `/api/v1/store/products` **匿名 200**，返回充值商品与优惠券（`storefront.gpt_recharge` 等）。定价接口要登录，但充值档位可以匿名拿到。
- **遥星AI** 是标准 new-api，只是关掉了匿名定价；走 `page` 模式复用登录态即可，插件形状与 A 类完全一样。

## C 类：纯 SPA，`/api/*` 全部回落

`abuai.chat`、`wxiai.com`、`vomni.ai`、`apevonscience.com`、`sharedchat.top`、`axis.yoga`（+`api.axis.fan`）、`nexaix.net`、`chat01.ai`、`oxwork.cn`、`agentin.one`、`modelorbit.ai`。

判定依据：任意路径（含 `/api/models`、`/api/v1/models`）都返回同一份 `index.html`（`abuai.chat` 7778 字节、`wxiai.com` 2205 字节、`sharedchat.top` 548 字节），HTTP 状态 200 是前端路由兜底，不是接口。

其中 `modelorbit.ai`、`vomni.ai`、`aiapi.codes` 共用一套 NextAuth 前端（bundle 里 `/api/auth/session`、`/api/v1/auth/telegram-login` 等），模型目录要登录后才出。

`agentin.one` 是 FastAPI 后端（错误体 `{detail,requestId,status,title,type}`），`/api/service-info` 匿名 200，但它是 Agent 平台，不是价格中转。

`oxwork.cn`、`modelorbit.ai`、`apevonscience.com` 从落地页看不是「按 token 卖模型」的形态（办公 Agent / 图像视频工作台 / 科研算力），比价表里放进去意义有限。

## D 类：当前不可达

| 站点 | 域名 | 现象 |
| --- | --- | --- |
| Undy / Undying API | `undyapi.com` | 全路径 500；`vip.undyingapi.com` DNS 解析失败 |
| Cubence | `cubence.com` / `shareyour.cc` | `cubence.com` 连接失败（`fetch failed`）；`shareyour.cc` 403 `DNS points to prohibited IP` |
| 破晓 API | `poxiao.vip` | 连接失败 |
| AiCodeEditor | `aicodeditor.com` | 连接失败 |
| 奇遇API | `superqiyu.org` | 连接失败 |
| 福星AI | `fuxingapi.com` | 525 SSL handshake failed |
| AIHUB 主域 | `aihub.top` | 403 Cloudflare「Just a moment...」（`aihub.dog` 可访） |
| RawChat 公益站 | `sharedchat.fun` | 403 Cloudflare 挑战（`sharedchat.top` 可达） |
| RawChat | `rawchat.cn` | 连接失败 |

`aihub.top`、`sharedchat.fun` 只是被 CF 挑战挡住，换浏览器会话可解；其余需要站点恢复后重测。

## 本轮未解决的疑点

1. 4Z API、CoreCode、packycode 的 `price` 与 `usd_exchange_rate` 语义冲突，缺页面这一证。
2. 4Z API 与 packycode 的 `model_ratio` 基准未经表达式交叉验证（这两家没有 `billing_expr` 可对照），需要拿页面标价反推。
3. `peak_offpeak` / `tiers` / `hour("UTC")` 这几种时段与档位加价当前不入价，采集值是基础档。
