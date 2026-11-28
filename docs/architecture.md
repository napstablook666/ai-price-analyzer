# 项目结构与数据流

浏览器扩展从多个 AI 中转站采集模型报价，归一报价结构和模型身份后，与 OpenRouter 基准价对齐，生成同模型的比价行。

## 一条数据从哪来、到哪去

```text
plugins/<id>/{manifest.json,plugin.js,models.json}   插件仓库手写源
  ↓ scripts/plugin-build.mjs
src/site-plugins/{providers/<id>.js,catalog.js,...}   扩展仓库生成物
  ↓ 插件激活、站点准备
core/request-strategy.js::resolveStationCollection   解析请求策略与 endpoint
  ↓ service-worker.js::collect
core/collectors.js::collectStation                  按 direct/page 与认证策略请求
  ↓ core/normalizers.js::normalizePricingPayload
规范报价数组 + group_ratio + 计费元数据
  ↓ IndexedDB snapshot
{ stationId, collectedAt, status, source, normalized, rawMeta, ... }
  ↓ service-worker.js::dashboard
最新有效 snapshot + references + 设置中的覆盖/插件别名/AI 缓存
  ↓ core/pricing.js::buildComparisonRows
按模型身份和报价组生成 comparisons/offers
  ↓ dashboard.js / dashboard-pricing.js
筛选、排序、计价模式展示与月成本排名
```

快照的报价数据在 `snapshot.normalized.data`，采集时间是 `snapshot.collectedAt`。`normalized` 还承载 `sourceFormat`、分组倍率和归一诊断；`rawMeta` 保存请求 URL、HTTP 状态及诊断镜像。页面拿到的比价结果由后台从最新 snapshot、基准 references 和当前设置计算，并有短期内存缓存，不是直接读取原始响应。

消息入口在 `src/service-worker.js`：`REFRESH_ALL` / `REFRESH_STATION` 触发采集，`FETCH_REFERENCES` 刷新基准参考，`GET_DASHBOARD` 返回比价数据，`ADAPT_STATION` 识别站点地址。请求策略与页面认证的准备由 `core/request-strategy.js`、插件定义和后台采集协调共同完成；响应格式解析入口是 `core/normalizers.js::normalizePricingPayload`，`core/adapters.js` 主要负责从站点配置推断 adapter，不是报价解析主入口。

## 统一模型是怎么做到的

模型身份通过通用归一、站点别名、人工确认和可选 AI 缓存逐层解析。实际匹配优先级如下：

1. **人工覆盖** `modelMatchOverrides`：用户确认的站点写法映射，优先级最高。
2. **插件别名** `plugins/<id>/models.json`：仅覆盖该站点声明的拼写。
3. **AI 匹配缓存** `llmMatchCache`：已接受的站点写法与官方模型映射；它是独立缓存，不写入人工覆盖。
4. **规范模型匹配**：`core/canonical.js` 使用 `canonical-table.js` 将常见路径、版本和装饰写法归到规范身份。
5. **内置规则**：精确、后缀、忽略版本、模糊匹配，作为兜底。

前四层的入口是 `core/matching.js::matchModelWithOverrides`；规范模型与内置规则在 `matchModel` 中处理。规范表由 `canonical/build.mjs` 生成，OpenRouter 提供可比价的模型身份，models.dev 补充厂商原生别名。AI 只提供经过缓存的可选辅助判断，不能替代规范身份；站点专属差异优先放插件别名，用户纠正放人工覆盖。

## 按次计费与充值阶梯怎么进比价

按次计价的站（`quota_type` = 1，`model_price` 是「一次」的价）不能直接塞进按 token 的混合单价里，否则会把按次成本摊进 token 分母，得出一个没有意义的数。约定如下：

- **标模式不分表**：`core/pricing.js` 给每条报价打 `billingMode`（`token` / `request` / `image`），三类都进同一张主表，展示时按模式换算法。用户明确要求不要拆成独立区块：分开放很丑，合起来只是算法不一样。
- **单价单元格分派**：`dashboard.js` 的 `priceCellMarkup` 按 `billingMode` 选渲染器 —— `priceGridMarkup`（按 token，两行费用项加柱状图）、`requestPriceGridMarkup`（按次，单次价加折算 / 平衡点 / 你的单次）、`imagePriceGridMarkup`（按张，站内元/张对基准元/张加折合）。中转站列用 `billingModeTagMarkup` 补「按次」「按张」小标签。
- **按张计费**：站点只报了 `image_price`（元/张）、没有任何 token 维度的价时判成 `image`。这种报价的 token 成本恒为 0，摊进混合单价会显示成 `¥0.0000` 加「低 100%」，所以不参与混合单价和价差，用「站内元/张」对「基准元/张」比，基准值取 OpenRouter `pricing.image` 乘汇率；没填图像请求数时不算月成本，只提示去填。
- **折算**：`requestUnitPriceOf(requestRmb, tokensPerRequest)` 把单次价摊成每百万 token 价，分母是「一次请求平均多少 token」。这个值优先取站点自己配置的 `billingProfile.tokensPerRequest`，没配就退回全局估算用量，并在界面上标「估算」。
- **与按量比的可比性**：折算后按次也落在元/1M，可以和按量报价同列排序（`unitPriceSortValue` 用 `requestUnitPrice`）。按张是元/张，量纲不同，排序时置 `null` 落末尾。
- **平衡点**：`breakEvenTokens` = 同模型按量报价的单价换算出的临界单次 token 数。一次跑得比它长，同组按量报价更便宜。
- **充值阶梯**：站点可配 `rechargeTiers: [{ amount, credit }]`，`pickRechargeTier()` 按估算月用量挑**刚好覆盖**的最小一档，`monthlyCostPaid` = 面值月成本 × 该档折扣。主表的月成本、同模型名次、柱长全部按实付金额走，不混用面值。
- 站点已经在自身价格里折过充值比例时，`billingProfile` 会被标记，避免二次打折。


## 凭据仓与登录态保活

需登录站点的关键不是「怎么登一次」，是「登过之后什么时候会再失效」。凭据和续期状态都在 `chrome.storage.local` 的 `ai-price-analyzer:tokens` 里，每站一条记录（`src/shared/credentials.js`）：

| 字段 | 含义 |
| --- | --- |
| `token` | 采集实际用的 access token |
| `identity` | 站点要的身份标识，替换 `{{identity}}` 用（New-API 系的 `New-Api-User`） |
| `username` / `password` | 站点账号，用户在设置里填的 |
| `expiresAt` | token 到期时间（毫秒）。`null` 表示不会过期或不知道 |
| `refreshToken` | refresh 令牌，`kind: "refresh-token"` 用 |
| `lastRenewedAt` | 上次续期成功时间（毫秒），面板上的「上次续期」读它 |
| `lastCheckedAt` | 上次无头检查时间（毫秒）。无过期时间的站靠它区分「探过」和「没探过」 |
| `nextCheckAt` | 面板用的下次检查时间（毫秒）：不落仓，`authStatusForUi` 从 `chrome.alarms` 的 `scheduledTime` 现算 |
| `renewFailures` | 连续失败次数，退避与判定都靠它 |
| `status` | `ok` / `needsLogin` / `unknown` |

换出来的 token 必须落这个仓，不要再放 service worker 的内存变量：MV3 的 worker 随时被回收，内存里的东西一重启就没了，会变成「每次唤醒都重新换一次 token」，多打接口也多撞风控。

`expiresAt` 只有 cookie / refresh 系拿得到，探活系永远为 `null`，所以「探过没有」另存 `lastCheckedAt`，不要拿 `expiresAt` 兼做这件事。

### 续期怎么跑

```text
chrome.alarms: auth-keepalive:<stationId>
  ↓ core/auth-keepalive.js::planKeepalive   按 expiresAt 排期，错峰
  ↓ service-worker.js                       到点执行
core/renewal.js::renewalFromProvider        插件声明 → 续期配置
  ↓ core/renewal.js::renewStationAuth       四种 kind 各走一条
凭据仓回写 token / expiresAt / lastRenewedAt / status
  ↓
chrome.alarms 重排下一次（成功按新 expiresAt，失败退避）
```

排期参数在 `core/auth-keepalive.js::KEEPALIVE_DEFAULTS`：

- 提前 `10min` 动手，给失败留一次重试余量。
- 同刻到期的站按站点 id 的 FNV-1a 哈希摊到 `288` 个 5 分钟槽里，不会整点一起醒；槽位比「离临期还剩多久」还长时按剩余窗口取模，排期不会落到过期之后。
- 范围夹在 `now+1min` 到 `now+23h` 之间：太早会自激回环，太晚站点会话本身可能已被服务端回收。
- 失败退避 `15min × 2^(n-1)`，封顶 `6h`；网络、5xx 这类可能自己好的失败连续 `3` 次才转成 `needsLogin`，在此之前只是 `unknown`。401/403 与「仓里没有凭据」是确定的失败，当次就转 `needsLogin`，不等三次。
- `kind: "manual-token"` 不排期，长效令牌没有过期概念。
- 没有 `expiresAt` 且从没探过 → `now + 1min` 先探一次；探过之后还是拿不到过期时间 → 退 6 小时慢档（`slowPathMs`）。探不出来就是探不出来，按分钟锤只会撞风控。
- 续期 TTL 有下限 `MIN_TTL_MS`（11 分钟，`src/core/renewal.js`）：小于保活提前量时排期窗口会塌成一个槽，变成每分钟续一次。refresh 响应不带 `expires_in` 时用 `DEFAULT_REFRESH_TTL_MS`（30 分钟），不要退到分钟级兜底。

`chrome.alarms` 有数量上限，所以前 `480` 个站一站点一个 alarm，超出的按 `20` 个一批合成 sweep alarm（`KEEPALIVE_ALARM_LIMIT` / `KEEPALIVE_SWEEP_SIZE`）。

批次名字里只有批号，名单跟着 alarm 一起存进 `chrome.storage.local` 的 `ai-price-analyzer:auth-keepalive-sweeps`（`core/auth-keepalive.js::planKeepaliveSweeps` 生成，`resolveSweepStationIds` 取用）。不靠批号回切当前排期：排期每次重算次序都会动，回切会把没到点的站提前叫醒、把被推到尾巴的站漏掉。名单丢了（重装、存储被清）才退回按当前排期算，不会因此不续期。

### 刷新预检不再开标签页

`REFRESH_ALL` 之前的登录态检查读的是凭据仓里的 `status`，不再为每个 page 站开一次标签页探活。判据在 `core/auth-keepalive.js::authConfirmedFromRenewal`：`status: "ok"` 且 `expiresAt` 还没到才算活着；`expiresAt` 缺失不算永不过期（只有用户自己粘的 `manual-token` 是那样），缺过期时间的站照样走预检，否则登录态死了也没人发现。实测一次全量刷新（14 个 page 站）的临时标签页数从 27 降到 14，证据见 `.omt3/evidence/u8-d3-tab-count.txt`，脚本 `node scripts/measure-tabs.mjs`。

`mode: "page"` 的站还是要开标签页，因为采集本身只能靠页面。但「刷新前先探一次」这一轮没了，标签页开销从每站 2 次降到每站 1 次。

不打开 dashboard 也会续：`onInstalled` 与 `onStartup`（浏览器重开）建完排期就直接跑一次 `runDueKeepalive`，把当轮到期的站续掉；面板每次轮询数据时也调一次 `kickDueKeepalive`，同一个 5 分钟节流窗口内只扫一次。这条路径和 alarm 走同一个执行器，靠 `lastCheckedAt` 去重，不会把同一批站连着续两遍。浏览器不常开的时候 alarm 可能整轮都轮不到，排到 23 小时的站更是永远轮不到，开机、装好、面板打开都算「该检查了」。

面板上能手动干预三件事：每行「立即检查」（消息 `AUTH_RENEW_NOW`，立刻续一个站再重排）、「打开站点」、展开后粘「令牌 / uid」（消息 `SAVE_STATION_TOKEN`，存仓并立刻检查一次）。`manual-token` 站没有「立即检查」，它没有可续的会话。

页面侧续出来的令牌通过消息回传 worker 回写仓。轮换后的 refresh 令牌必须回传，否则浏览器重开之后无头续期手里是旧的那把，第二次续期必然 401。

### 插件声明决定续期能力

插件在 `request.renewal` 或 `request.cookieAuth` 里声明怎么续，映射函数 `core/renewal.js::renewalFromProvider` 是 service worker 与测试共用的唯一入口。协议与四种 kind 见 [插件开发与维护规范](./plugin-development.md#登录态与续期)。
## 目录职责

| 路径 | 职责 | 能不能手改 |
| --- | --- | --- |
| `../plugins/<id>/` | 站点插件唯一手写源（插件仓库） | 是 |
| `src/site-plugins/providers/` | 由 `../plugins/` 生成 | 否 |
| `src/site-plugins/catalog.js` | 首页站点目录，生成物 | 否 |
| `src/shared/plugin-order.js` | 站点排序，生成物 | 否 |
| `rust/shared-rs/src/data.json` | 品牌图形与别名表（models.dev + simple-icons），由 `scripts/gen-shared-data.mjs` 与 `scripts/provider-logos.mjs` 写 | 否 |
| `src/core/canonical.js` | 规范模型归一逻辑 | 是 |
| `src/core/canonical-table.js` | 规范模型表，生成物 | 否 |
| `canonical/build.mjs` | 规范表生成器（靠齐 OpenRouter 列表，models.dev 补别名） | 是 |
| `scripts/plugin-build.mjs` | 插件构建器 | 是 |
| `scripts/model-lookup.mjs` | 查规范模型 id 的小工具 | 是 |
| `scripts/provider-logos.mjs` | 品牌图标抓取生成器 | 是 |
| `src/core/` | 采集、匹配、比价、存储、凭据 | 是 |
| `test/` | 全部测试 | 是 |

## 两个仓库（已落地）

形态：**扩展仓库**（本仓库：核心、UI、构建脚本、文档）＋ **插件仓库**（[`napstablook666/ai-price-analyzer-plugins`](https://github.com/napstablook666/ai-price-analyzer-plugins)，一个站点一个目录）。插件源码不引用扩展内部相对路径，只写 `@app/core/…`、`@app/shared/…`，构建时改写成真实路径，目录搬走后零改动。

- 工作区里两个仓库并排：`extension/`（本仓库）与 `plugins/`。扩展仓库不跟踪插件文件，构建器默认读上一级的 `plugins/`，签出到别处时用 `PLUGIN_DIR` 指过去。
- `PLUGIN_DIR=/path/to/plugins node scripts/plugin-build.mjs --check` 可校验任意外部插件源与扩展内生成物是否同步。
- 扩展侧 `site-plugins.test.js` 继续盯生成物漂移；插件的目录契约（manifest / plugin.js / models.json、字段白名单）由 `plugin-build.mjs` 兜住。

## 常用命令

```bash
npm test                                  # 全部扩展测试
node scripts/plugin-build.mjs              # 改完 plugins/ 后重新生成
node scripts/plugin-build.mjs --check      # 只校验漂移
node scripts/model-lookup.mjs claude 4.6   # 查规范模型 id
node scripts/provider-logos.mjs            # 重新抓品牌图标，写进 rust/shared-rs/src/data.json
node canonical/build.mjs --offline         # 用缓存重算规范表（联网可去掉 --offline）
npm run version:patch                      # 扩展版本号同步
```

## 验证标准

改任何一层之后至少要满足：

- `npm test` 全绿。
- `node scripts/plugin-build.mjs --check` 无漂移。
- 采集链路：首页能加站点、能采集、比价表里模型有数；模型名改了写法之后仍然归到同一行。
- 设置里带旧字段（如 `llm` / `jev` / `modelMatchOverrides`）的历史数据能正常加载，不报错、不丢覆盖。