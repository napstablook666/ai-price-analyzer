# linux.do「扬帆起航」中转站全量清单（2026-11-24）

调研对象：linux.do 分类 `扬帆起航`（cat 46，含子板 `startup-lv1` / `startup-lv2`）里出现过的中转站。
目的：给插件开发选站——哪些站现在就能写声明接入，哪些要先补核心能力，哪些别碰。

只记录**匿名可达性与报文形状**，不背书价格。表里的模型数、分组数是抓取那一刻的值，中转站每天加减模型。

## 结论

板块抓全了：1322 帖（2024-07-05 起）。标题看得出是站的 471 帖，其中 338 帖的正文抽得出域名，一共 **318 个唯一主机**（237 个来自站名类帖，其余来自工具帖、教程帖里的顺带链接）。匿名可采的 43 个主机里，**41 家能靠现有价格映射直接出价**，只有 2 家是没见过的「报文里直接给绝对价」形状。

| 类 | 判据 | 主机 | 其中站名类 | 能不能写插件 |
| --- | --- | ---: | ---: | --- |
| A 匿名出价 | `/api/pricing` 返回模型数组 | 43 | 39 | 41 家写声明即可，2 家要新规则 |
| B 要鉴权 | 401 / 403 | 29 | 21 | 要登录态才验证得了 |
| C HTML 回落 | `/api/pricing` 回 index.html | 83 | 41 | 换端点或浏览器才看得到 |
| E 端点 404 | 站点活着，`/api/pricing` 不存在 | 80 | 67 | 换端点逐个试 |
| D 连不上 | DNS / TLS / 超时 | 83 | 69 | 现在不碰 |

上面这张表看的是「能不能采到价」，不是「站还开不开」。按根域归并成站、再做两轮实测后：**231 个站里 203 个还能打开，26 个已经歇菜**（详见下一节）。上表的 D 类 83 个主机里活下来的只剩 7 个，其余多是彻底下线的站——所以做插件时优先看 A 类，B/C/E 类要看具体站是否还在。

三条判断：

- **现有 58 个插件没覆盖这批站。** 43 个 A 类主机里只有 `allrouter.cc`、`relayrouter.app` 已装；`sucloud.vip` 与 RelayRouter 是同一套 319 个模型的目录，算重复，不用另写。
- **新站的报文和 TokenFlux（`data[]` + `group_ratio` + `billing_expr`）同族。** 用扩展现有的 `allrouter` / `relayrouter` 基座跑 dry-run，41 家的文本价都能落到行上，未决项只剩两类已知边界（见「未决项是什么」）。这意思是新站基本是写插件声明，不动 `src/core`。
- **真正要新写代码的只有 2 家**：`acombcom.cn`、`api.jucode.cn`。它们的模型条目里直接给 `input_price` / `output_price` / `request_price` 绝对价，没有 `model_ratio`，`group_ratio` 也空——现在的基座取值取不到，需要一条「绝对价 + 单分组默认倍率 1」的规则。

## 存活复检：203 站还能开，26 站已歇菜

把 318 个主机按根域归成 **231 个站**，两轮实测：fetch 探全量，再用 curl 并行复核每个死站的根域 / `api.` / `www.` 三个点。

| | 站数 | 说明 |
| --- | ---: | --- |
| 还能开 | 203 | 其中 **41 个接口现成能出价**；3 个主域打不开、站点只剩 `www.` |
| 已歇菜 | 26 | 见下表 |
| 免费二级域平台 | 2 | `cc.cd`、`ccwu.cc` 是 DNSHE 的公共域名服务，挂在下面的才是站 |
| 解析噪声 | 11 | punycode 拼接串、DDNS 域名，不是站 |

「能开」的判据：`/api/status` 出 JSON，或者首页是真页面。停放页（跳 `/lander`）、`nginx` 默认页、Vercel 的 `DEPLOYMENT_DISABLED` / `DEPLOYMENT_NOT_FOUND`、子域分发站的「未找到对应站点」，一律算死。

26 个歇菜的站（按板块里的热度排）：

| 站 | 贴数 | 打不开的样子 |
| --- | ---: | --- |
| `dart.us` | 2 | 域名停放页（跳 /lander） |
| `bondai.cc` | 2 | 回源 502，服务已下 |
| `routescope.ai` | 2 | 回源 502，服务已下 |
| `drawaspark.com` | 1 | 子域分发站已回收 |
| `i-ching-online-ai.com` | 1 | Vercel 站已删除（404） |
| `sylphcli.com` | 1 | 回源 502，服务已下 |
| `charactertest.app` | 1 | Vercel 部署被停（402） |
| `amethyst.ltd` | 1 | 回源 502，服务已下 |
| `nlink.vip` | 1 | 回源 502，服务已下 |
| `bilitool.cc` | 1 | 回源 502，服务已下 |
| `miba6cqdwdtn.space` | 1 | 回源 502，服务已下 |
| `dubaiapi.cn` | 1 | 回源 502，服务已下 |
| `justrouter.com` | 1 | 回源 502，服务已下 |
| `tjzpri.net` | 1 | 域名不解析，回源 502 |
| `ntu17.shop` | 1 | 回源 502，服务已下 |
| `renmin365.cn` | 1 | 回源 502，服务已下 |
| `oimi.xin` | 1 | CF 1001（源站不解析） |
| `wtturl.cn` | 1 | 域名不解析，回源 502 |
| `routescop.ai` | 1 | 回源 502，服务已下（`routescope.ai` 的错拼域名） |
| `fanren.us` | 1 | 回源 502，服务已下 |
| `dimeta.top` | 1 | 域名不解析，回源 502 |
| `modeldig.com` | 1 | 回源 502，服务已下 |
| `pauren.xyz` | 1 | 域名不解析，回源 502 |
| `mixapi.top` | 1 | 回源 502，服务已下 |
| `arkzero.cn` | 1 | `api.arkzero.cn` 只有 nginx 404 |
| `heronx.ai` | 1 | 域名不解析，回源 502 |

主域挂了但站点还在跑的有 3 个，抓的是 `www.`：

- `www.beakapi.com` — BeakAPI - AI API Gateway。后端 `/api/status`、`/api/pricing` 都是 404，价格要抓包另找端点。
- `www.gtnet.xyz` — GTNet - AI API Gateway。同一个前端模板，接口同样 404。
- `www.geekfunlab.com` — GeekFunLab - The AI Tools Directory。这是导航站，不是中转站，不写插件。

## 怎么复现

全部脚本和原始报文在 `out/recon/linuxdo-20261124/`（本机，不入库）：

```
raw/all-topics.json        1322 帖（三个分类分页到底，cat 46 第 40 页为空）
raw/parsed.json            428 篇 OP 抽出的主机
raw/host-rows.json         318 主机 × 分类 / 币种 / 出现过的帖
raw/pricing/<host>.json    43 份 /api/pricing 原始报文（11-20 快照，在 ego 工作目录）
raw/batch/<host>.pricing.json  接入时重抓的现网报文（22 家 × 主机 + /api/status）
raw/batch/summary.json     重抓后的模型数 / 行数 / 未决数（插件写的依据）
raw/batch/e2e.json         插件自查：走 sitePlugin.prepare → adapter → applyPriceMap 的结果
raw/a-stats.json           43 家字段盘点（模型数、分组、expr 数…）
raw/base-dryrun.json       用现有基座 dry-run 后的行数 / 有价行 / 未决数
raw/a-table.md             下面那张表的数据源
raw/clone-pairs.json       A 内部同目录对、A 与已装插件的同目录对
raw/liveness.json          317 主机逐个探活的结果
raw/head-checks.json       可疑站的首页开头复核（判停放页 / 部署报错用）
raw/deadcheck.tsv          判死的站再打根域 / api. / www. 的 curl 原始输出
raw/stations-liveness.json 按根域归并后的站级存活结果
raw/stations-liveness.md   上面那张歇菜表的渲染稿
scripts/round-40-report.mjs … round-45-doc.mjs   复盘脚本
liveness-scan.mjs          全量探活（fetch 主探 + curl 兜底 + 判死的二次复核）
classify-stations.mjs      按根域归并成站，判能开 / 歇菜 / 平台 / 噪声
verify-survey.mjs          拿本文的表和 a-stats / base-dryrun 对账
```

判定口径：`fetch` 直连，UA Chrome 131，`redirect: follow`，超时 12s；`/api/pricing`、`/api/status`、`/api/v1/model-plaza` 三个端点各打一次。A 类判据是 `/api/pricing` 能解出 `models > 0`。

## A 类 43 个主机

`行` 是用建议基座 dry-run 出来的价格行数；`文本/按次/按张` 是有价行的分布；`未决` 是解析不出价的行数（原因见下一节）。

| 主机 | 模型 | 分组 | expr | 按次/张 | 行 | 文本/按次/按张 | 未决 | 建议基座 | 币种 | price | 插件 | 主题 |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- | --- | ---: | --- | ---: |
| `xycai.cn` | 336 | 1 | 14 | 89 | 382 | 305/57/20 | 0 | allrouter | USD | 6.9 | — | 3201934 |
| `xyc.ai` | 336 | 1 | 14 | 89 | 382 | 305/57/20 | 0 | allrouter | USD | 6.9 | — | 3211099 |
| `sucloud.vip` | 319 | 41 | 0 | 127 | 1287 | 1082/205/0 | 2 | relayrouter | - | 1 | 已装 | 1036972 |
| `relayrouter.app` | 319 | 41 | 0 | 127 | 1287 | 1082/205/0 | 2 | relayrouter | - | 1 | 已装 | 3126433 |
| `foxapi.chat` | 168 | 9 | 94 | 76 | 314 | 179/127/8 | 0 | allrouter | CNY | 1 | — | 3054642 |
| `tokenmarket.cheap` | 112 | 16 | 64 | 20 | 267 | 213/47/7 | 1 | allrouter | CNY | 1 | — | 2762636 |
| `api.kaopuapi.xyz` | 106 | 5 | 2 | 44 | 174 | 93/81/0 | 0 | allrouter | CNY | 7.3 | — | 2749872 |
| `api.tccxy.top` | 103 | 17 | 54 | 11 | 318 | 313/1/4 | 0 | allrouter | USD | 1 | — | 2742434 |
| `xcode.best` | 89 | 14 | 41 | 18 | 229 | 207/18/4 | 1 | allrouter | CNY | 1 | — | 1614685 |
| `teamapi.chat` | 77 | 2 | 71 | 6 | 190 | 178/12/0 | 0 | allrouter | CNY | 7.3 | — | 3149605 |
| `api.jucode.cn` | 74 | 0 | 0 | 8 | 0 | 0/0/0 | 74 | 不适用（绝对价） | - | - | — | 1907376 |
| `allrouter.cc` | 58 | 10 | 41 | 6 | 184 | 184/0/0 | 0 | allrouter | CUSTOM | 1 | 已装 | 2718979 |
| `hhapi.xyz` | 58 | 20 | 57 | 18 | 167 | 152/5/10 | 6 | allrouter | USD | 1 | — | 3191652 |
| `1xm.ai` | 54 | 11 | 9 | 6 | 197 | 189/6/2 | 0 | allrouter | USD | 1 | — | 2111628 |
| `api.linktoagi.com` | 53 | 11 | 17 | 5 | 140 | 135/5/0 | 0 | allrouter | CNY | 1 | — | 3115519 |
| `api.fengying.xin` | 53 | 5 | 14 | 3 | 101 | 101/0/0 | 0 | allrouter | USD | 0.5 | — | 2560629 |
| `api.daidaishou.xyz` | 53 | 8 | 49 | 6 | 134 | 119/15/0 | 0 | allrouter | CNY | 7.3 | — | 3163409 |
| `new.vbcoding.cc` | 49 | 8 | 12 | 10 | 96 | 82/14/0 | 0 | allrouter | CNY | 1 | — | 2956526 |
| `fastmodel.top` | 46 | 1 | 32 | 23 | 31 | 18/3/10 | 15 | allrouter | USD | 7.3 | — | 3143212 |
| `qianxing.pro` | 45 | 9 | 44 | 8 | 111 | 89/0/22 | 0 | allrouter | USD | 1 | — | 2496158 |
| `fast.qianxing.pro` | 45 | 9 | 44 | 8 | 111 | 89/0/22 | 0 | allrouter | USD | 1 | — | 2496158 |
| `api.ifalso.com` | 45 | 8 | 14 | 14 | 62 | 52/7/3 | 4 | allrouter | USD | 1 | — | 2510675 |
| `fuelapi.top` | 45 | 21 | 45 | 7 | 209 | 161/48/0 | 6 | allrouter | USD | 1 | — | 3138448 |
| `api.yunxuai.cc` | 42 | 7 | 26 | 8 | 99 | 95/0/4 | 0 | allrouter | USD | 1 | — | 3120693 |
| `api2.apiaqi.com` | 39 | 9 | 13 | 3 | 166 | 163/3/0 | 0 | allrouter | USD | 7.3 | — | 2748003 |
| `agentgate.cc` | 39 | 5 | 39 | 5 | 76 | 68/0/8 | 0 | allrouter | USD | 7.3 | — | 3199037 |
| `astra.astrgate.net` | 37 | 6 | 36 | 0 | 86 | 86/0/0 | 0 | allrouter | CNY | 7.3 | — | 3182778 |
| `api.viola-api.top` | 36 | 12 | 9 | 1 | 103 | 102/1/0 | 0 | allrouter | USD | 1 | — | 2751099 |
| `viola-api.top` | 36 | 12 | 9 | 1 | 103 | 102/1/0 | 0 | allrouter | USD | 1 | — | 2751099 |
| `axisapi.cn` | 35 | 8 | 35 | 10 | 67 | 61/6/0 | 0 | allrouter | CNY | 1 | — | 2503952 |
| `ycnovaflow.vip` | 32 | 8 | 28 | 7 | 56 | 49/7/0 | 7 | allrouter | CNY | 1 | — | 3111515 |
| `api.boreara.com` | 31 | 8 | 0 | 8 | 85 | 81/4/0 | 0 | relayrouter | CNY | 7.3 | — | 2924786 |
| `acombcom.cn` | 30 | 2 | 0 | 22 | 0 | 0/0/0 | 30 | 不适用（绝对价） | CNY | 1 | — | 3129585 |
| `tokvi.net` | 26 | 1 | 8 | 3 | 25 | 18/6/1 | 5 | allrouter | CNY | 7.3 | — | 3058602 |
| `metr4ai.com` | 26 | 6 | 21 | 0 | 48 | 48/0/0 | 1 | allrouter | CNY | 1 | — | 3205586 |
| `puoai.com` | 23 | 1 | 23 | 6 | 20 | 5/15/0 | 3 | allrouter | USD | 1 | — | 3223320 |
| `ai.deadlion.cn` | 18 | 1 | 0 | 0 | 26 | 26/0/0 | 0 | relayrouter | TOKENS | 7.3 | — | 2927211 |
| `shenlongapi.com` | 16 | 8 | 11 | 0 | 66 | 66/0/0 | 0 | allrouter | USD | 6.8 | — | 3153976 |
| `bitwiseplus.cc` | 16 | 2 | 11 | 10 | 54 | 44/0/10 | 0 | allrouter | CNY | 7.3 | — | 3204681 |
| `orcax.net` | 14 | 1 | 2 | 2 | 14 | 14/0/0 | 0 | allrouter | CUSTOM | 1 | — | 3069487 |
| `newapi.orbitix.site` | 11 | 3 | 11 | 2 | 19 | 17/2/0 | 0 | allrouter | CNY | 1 | — | 3098990 |
| `tonkicapi.xyz` | 7 | 5 | 7 | 0 | 48 | 48/0/0 | 0 | allrouter | USD | 1 | — | 2765557 |
| `moyaspace.com` | 5 | 3 | 0 | 0 | 5 | 5/0/0 | 0 | relayrouter | CNY | 1 | — | 2726416 |

币种列是 `/api/status` 的 `quota_display_type`，`price` 是同一个接口的 `price`（充值折算线索：`1` 一般表示「1 元 = 1 美元额度」，`7.3` / `6.8` / `6.9` 是站点自己的汇率）。**行里的数字不是结论**，每家真实实付口径要按 `pricing-evidence` 那份 skill 单独核，别拿 `price` 直接当汇率用。

## 未决项是什么

41 家的未决行加起来 53 行，两类，都不是站点方言：

1. **媒体按用量表达式**：`tier("base", u("seconds") * 0.05)`、`u("tokens") * 46 / 1000000`、`u("resolution") == "480p" ? …`。这是视频/按秒/按图计费，`parseBillingTiers` 见到 `u(` 就跳过——和阿里云百炼、豆包视频那批站是同一个缺口，不是新问题。
2. **站点自己标 0 价的占位行**：`tier("base", p * 0 + c * 0)`。解析不出价正是想要的：0 价不参与比价。

所以「未决 1~15 行」的 12 家（`fastmodel.top` 15 行、`ycnovaflow.vip` 7 行、`fuelapi.top` 6 行、`hhapi.xyz` 6 行、`tokvi.net` 5 行、`api.ifalso.com` 4 行、`puoai.com` 3 行、`sucloud.vip` 2 行、`relayrouter.app` 2 行、`xcode.best` 1 行、`tokenmarket.cheap` 1 行、`metr4ai.com` 1 行）不需要为它们改代码，文本价已经出全了，缺的只是视频/媒体行。

## 立即可做：写声明就能接的 18 家

筛选条件：`/api/pricing` 匿名可读、dry-run 未决 0、模型 ≥ 30、现有插件没覆盖。同一套价的两个域名只占一行（星云、乾行、Viola 各算一家）。

**下表 18 家已全部接成插件**，连同下面补的 4 家（media 行有缺口但文本价全的）与 `axisapi` / `boreara`，一共 22 家，插件 id 见文末「已接成插件」。

| 站 | 主机 | 模型 | 分组 | expr | 备注 |
| --- | --- | ---: | ---: | ---: | --- |
| 星云中转 | `xycai.cn` + `xyc.ai` | 336 | 1 | 14 | 两个域名同一目录同一价；单分组，倍率区间窄 |
| FoxAPI | `foxapi.chat` | 168 | 9 | 94 | 模型数第二；表达式最全，含按张和长上下文分档 |
| KaopuAPI | `api.kaopuapi.xyz` | 106 | 5 | 2 | 主要靠按次价（81 行），倍率基准 7.3 |
| 甜菜程序猿 | `api.tccxy.top` | 103 | 17 | 54 | 313 行文本价，最密的一家 |
| TeamAPI | `teamapi.chat` | 77 | 2 | 71 | 只有 2 个分组，几乎全靠表达式 |
| OneXModel | `1xm.ai` | 54 | 11 | 9 | 189 行文本价 |
| LinkAGI | `api.linktoagi.com` | 53 | 11 | 17 | 目录与已装 `coderelay` 相似度 0.963，先确认是不是转卖再决定写不写 |
| 呆呆兽 | `api.daidaishou.xyz` | 53 | 8 | 49 | 低价国模，倍率基准 7.3 |
| 风影 | `api.fengying.xin` | 53 | 5 | 14 | 101 行全是文本价，无按次无按张 |
| VBCoding | `new.vbcoding.cc` | 49 | 8 | 12 | 老域名 `vbcoding.cc` 另算 |
| 乾行AI | `qianxing.pro` + `fast.qianxing.pro` | 45 | 9 | 44 | 两个域名同目录 |
| 云续AI | `api.yunxuai.cc` | 42 | 7 | 26 | 95 行文本价 |
| AQIAPI | `api2.apiaqi.com` | 39 | 9 | 13 | 163 行文本价，靠倍率不靠表达式 |
| AgentGate | `agentgate.cc` | 39 | 5 | 39 | 68 行文本 + 8 行按张 |
| 星辰AI | `astra.astrgate.net` | 37 | 6 | 36 | 86 行文本价 |
| Viola | `api.viola-api.top` + `viola-api.top` | 36 | 12 | 9 | 两个域名同目录同价，写一家 |
| Axis API | `axisapi.cn` | 35 | 8 | 35 | 含 DeepSeek 分时半价（`hour(...)` 谓词已被现有解析器吃下） |
| 极光 Boreara | `api.boreara.com` | 31 | 8 | 0 | 没有表达式，纯 `model_ratio`，走 relayrouter 基座 |

模型数够大但媒体行有缺口、同样能先接的还有 4 家 `tokenmarket.cheap`（112 模型）、`xcode.best`（89）、`fuelapi.top`（45）、`ycnovaflow.vip`（32），未决分别是 1 / 1 / 6 / 7 行，都在上面「未决 1~15 行」那 12 家里，不缺文本价。

这 22 家按「模型数 + 有价行数」分三批接完了：第一批 8 家（星云、FoxAPI、KaopuAPI、甜菜、TeamAPI、OneXModel、LinkAGI、呆呆兽），第二批 8 家（风影、VBCoding、乾行、云续、AQIAPI、AgentGate、星辰、Viola），第三批 6 家（Axis API、极光 Boreara、TokenMarket、Xcode、Fuel API、NovaFlow）。

## 声明怎么写

三种基座的差别只有一句：**报文里有没有 `billing_expr`**。

| 基座 | 取价顺序 | 用在哪 |
| --- | --- | --- |
| `allrouter` | `billing_expr` → 出图+张价 → `quota_type=1` → `model_ratio` | 有 expr 的站（41 家里的 39 家） |
| `relayrouter` | `quota_type=1` → `model_ratio` + `step_ratios` + 5m/1h 缓存写 | 无 expr、有 `step_ratios` 或新缓存字段的站 |
| `tokenflux` | 同 allrouter，但表达式不标媒体类型 | 纯文本站，出图模型少时够用 |

`plugins/<id>/plugin.js` 里就是一段声明，核心代码不用动：

```js
const PRICE_MAP = { base: "allrouter" };

const preset = {
  id: "<id>",
  name: "<站名>",
  baseUrl: "https://<host>/pricing",
  priceCurrency: "USD",
  priceCurrencyVerified: false,
  priceCurrencyNote: "充值口径未核，先不参与已验证比价推荐。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "declarative", endpoint: "/api/pricing", method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
};

export const sitePlugin = {
  id: "<id>",
  host: "<host>",
  preset,
  matches: ({ hostname, path }) => hostname === "<host>" && ["/", "/pricing"].includes(path),
  prepareMatches: ({ hostname }) => hostname === "<host>",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/pricing`,
    mode: "direct",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), kind: "declarative", endpoint: "/api/pricing", method: "GET", responseFormat: "price-map", priceMap: PRICE_MAP }
  }),
  mode: "direct",
  responseFormat: "price-map",
  authType: "none",
  rationale: "<站名> 通过公开定价 API 直连采集",
  request: requestPolicy(() => "/api/pricing", { credentials: "omit" })
};
```

`price-map` 只声明 `base` 时，映射里的币种和倍率基准按基座走（`ratioBase` 缺省 = 1 单位 = $2/百万 token）。这些新站的 `model_ratio` 基准都是 1 = $2，没有一家要改 `ratioBase`。

`priceCurrency` 先填 `USD` 并标 `verified: false`：报文里的数是「美元额度」，站点是不是 1 元买 1 美元额度要单独核。干过的 5 家登录态站点（`relay-login-survey-20261123.md`）就是按这个流程补的 `rechargeRmb`。

## 需要新写代码的 2 家

| 站 | 形状 | 缺什么 |
| --- | --- | --- |
| `acombcom.cn` | 30 个模型、2 个分组、`billing_mode: "direct"`，条目里直接给 `input_price` / `output_price` / `request_price` 绝对价，`model_ratio` 全 0 | 基座取 `model_ratio` 得 0；且 `quota_type=1` 的行 `model_price` 缺省 |
| `api.jucode.cn` | 74 个模型、`group_ratio` 空、`enable_groups` 空，绝对价藏在 `jucode_pricing.input_unit_price` 里 | 没有分组就拿不到倍率，`groupSelection` 直接判「没有可用分组」 |

这两家要的东西是同一件：**一条「绝对价 + 无分组时默认倍率 1」的规则**。做成新基座或给 `groups` 加 `fallbackRatio`，两家的模型就都进比价表。是否值得做，看这两个站在板块里的活跃度——`acombcom.cn` 的推广帖只有 30 个模型且没有品牌名，`api.jucode.cn` 的帖子标题是「codex plus 号池 6000 刀」，都不是主力站。**我的判断是本轮不做**，先把 21 家声明写完。

## 重复目录与同后端

同目录（Jaccard ≥ 0.85）要合并成一家写，别写两遍：

- `sucloud.vip` ↔ `relayrouter.app`：319 个模型、41 个分组完全一致（字节数 1287 行也一样）。RelayRouter 插件已装，**SuCloud 不另写**。
- `qianxing.pro` ↔ `fast.qianxing.pro`：同一主题 `2496158`，同主机群。
- `api.viola-api.top` ↔ `viola-api.top`：同一主题 `2751099`。
- `xycai.cn` ↔ `xyc.ai`：两个主题（`3201934` / `3211099`）同一目录，同价 `6.9`。
- `api.linktoagi.com` ↔ 已装 `coderelay.cn` 相似度 0.963、↔ `newcodex.cn` 0.855：**疑似转卖同一上游**，写之前先确认它自己的定价是否与上游一致。

## 本轮不做的三批

**B 类 21 家（要登录）**：`claw-cn.org`、`chaoye.xyz`、`hyperroute.cc`、`hajimi.chat`、`gtnet.xyz`、`api.jetapi.icu`、`sharellm.net`、`xisome.com`、`yukiapi.com`、`zhengshuyun.com` 等。`/api/pricing` 存在但要 `Authorization`，匿名拿不到。做法和 `relay-login-survey-20261123.md` 里那 5 家一样：要一份登录后的 cookie，采一次报文，确认形状后写插件。**这是需要用户提供登录态才能推进的一批。**

**C 类 41 家（HTML 回落）**：`skcdn.cn`、`ricktoken.top`、`mxwq.net`、`akrouter.com`、`novaferry.com`、`api.arkzero.cn`、`yierbubu.net`、`imagiluxion.ai`、`api-xiaohai.com`、`claude-code-hub.org`、`agentrouter.org` 等。`/api/*` 一律回 index.html，说明不是标准 New API 前端。可行的第一条路是逐个试 `/api/public/models`、`/api/models`、`/api/v1/pricing`，试不到就得用 `ego-browser` 打开站点看真实 XHR。

**E 类 67 家 + D 类 69 家**：E 是站点活着但 `/api/pricing` 404（`sccx.cc`、`api.66o.uk`、`pro.abnt.it`、`reddoctor.work` 这类），D 是 DNS/TLS/超时连不上（`201008281.xyz`、`chong.gptnb.cc`、`niuqizp.com` 这类，多数是 2024–2025 的老帖，站已经没了）。E 类值得抽 10 个试试别的端点，D 类直接过。

## 疑点

- `api.linktoagi.com` 与 `coderelay.cn` 目录 96% 重合，是转卖还是同一运营方两个牌子没确认。
- 43 家里的 `price`（7.3 / 6.8 / 6.9 / 0.5 / 1）只有 RelayRouter 有实付验证；其余 42 家的充值折算全部未核，插件里必须保持 `priceCurrencyVerified: false`。
- `xycai.cn` 单分组 336 个模型、`price` 6.9：单分组意味着站内没有折扣档，倍率只有 1 档，比价表里会显示成「无分组折扣」，这是报文事实，不是采集错误。
- 133 篇标题像站的帖子抽不出域名（只说品牌名、图床发二维码），要浏览器进去才知道落在哪个域名。

## 已接成插件

22 家接完，插件总数 80（`plugins/` 下 58 家原有 + 22 家本轮 + 各自的 carpool/变体）。全部走公开 `/api/pricing`，除了 `boreara` 归 `relayrouter` 基座，其余 21 家归 `allrouter` 基座。下面「行数」是「模型 × 分组」的行数，「未决」是 `parseBillingTiers` 没能给价的行数。

| 站 | 插件 id | 主机 | 模型 | 行数 | 未决 |
| --- | --- | --- | ---: | ---: | ---: |
| 星云中转 | `xycai` | `xycai.cn` + `www.xycai.cn` + `xyc.ai` + `www.xyc.ai` | 336 | 382 | 0 |
| FoxAPI | `foxapi` | `foxapi.chat` + `www.foxapi.chat` | 168 | 314 | 0 |
| KaopuAPI | `kaopuapi` | `api.kaopuapi.xyz` | 106 | 174 | 0 |
| 甜菜程序猿 | `tccxy` | `api.tccxy.top` | 103 | 318 | 0 |
| TeamAPI | `teamapi` | `teamapi.chat` | 77 | 190 | 0 |
| OneXModel | `1xm` | `1xm.ai` + `www.1xm.ai` + `api.1xm.ai` | 54 | 197 | 0 |
| LinkAGI | `linktoagi` | `api.linktoagi.com` | 47 | 134 | 0 |
| 呆呆兽 | `daidaishou` | `api.daidaishou.xyz` | 53 | 134 | 0 |
| 风影 | `fengying` | `api.fengying.xin` | 53 | 101 | 0 |
| VBCoding | `vbcoding` | `new.vbcoding.cc` | 49 | 96 | 0 |
| 乾行AI | `qianxing` | `qianxing.pro` + `fast.qianxing.pro` | 45 | 111 | 0 |
| 云续AI | `yunxuai` | `api.yunxuai.cc` | 42 | 99 | 0 |
| AQIAPI | `apiaqi` | `api2.apiaqi.com` | 39 | 166 | 0 |
| AgentGate | `agentgate` | `agentgate.cc` | 39 | 76 | 0 |
| 星辰AI | `astrgate` | `astra.astrgate.net` | 38 | 88 | 0 |
| Viola | `viola` | `api.viola-api.top` + `viola-api.top` | 36 | 103 | 0 |
| Axis API | `axisapi` | `axisapi.cn` | 35 | 67 | 0 |
| 极光 Boreara | `boreara` | `api.boreara.com` | 31 | 85 | 0 |
| TokenMarket | `tokenmarket` | `tokenmarket.cheap` | 100 | 255 | 1 |
| Xcode | `xcode` | `xcode.best` | 89 | 229 | 1 |
| Fuel API | `fuelapi` | `fuelapi.top` | 45 | 209 | 6 |
| NovaFlow 智舟 | `novaflow` | `ycnovaflow.vip` | 31 | 54 | 7 |

最后 4 家有未决行，全是视频按秒（`u("seconds")`）或按 token 计量（`u("tokens") * 46 / 1000000`）的表达式，文本 token 价一行不缺，插件里注明了缺口是哪一个模型。

自查口径：`out/recon/linuxdo-20261124/round-52-e2e.mjs` 走插件自己的 `sitePlugin.load()` → `matches`（逐个 hosts）→ `prepare` → `adapter.priceMap` → 实打 `https://<host>/api/pricing` → `applyPriceMap`，22/22 通过、0 失败，结果落在 `raw/batch/e2e.json`。`npm run verify` 612 项测试全过、`plugins:check` 报 80 个插件产物与源同步。

同模型归行的口径也量了一遍：22 家解析出的文本价行里，`resolveCanonicalModel` 认得出 140 个规范模型，其中 87 个被两家以上同时卖（`claude-opus-5`、`gpt-6-astra`、`gpt-6-1-sol` 各 21 家），这些在比价表里就是同一行。

两处遗留：

- `linktoagi` 与 `coderelay` 目录相似度 0.963，两家都接了，比价表里会并到同一行；确认同一上游转卖后删一边即可。
- 22 家的 `priceCurrencyVerified` 全是 `false`：`/api/status` 的 `price` 读到就记（0.5 / 1 / 6.9 / 7.3），但一家都没真实付款验证过，`rechargeRmb` 只是配置口径。
