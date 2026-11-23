# 登录站调研（2026-11-23）

7 家能在线充值的中转站，全部用真实登录态抓了全量。遥星与奥特曼只有兑换码、不能在线充值，已剔除。原始报文在 `out/recon/live/`，提取脚本 `out/recon/unify2.mjs`。

口径按 `pricing-evidence` 技能写：报文、页面、站点自述三样各能证明什么，凑不齐就标 `probable`。

## 一句话口径

**这几家的「充值 1:1」都指 1 元人民币买入 1 美元额度**，等于官方价 × 1/7.2 ≈ 0.14 折。分组倍率是在这个基础上再乘的系数，不是折扣率。所以「余额组 0.4」的实际意思是官方价 × 0.4 / 7.2。

全线 1:1，没有例外。7 家全部实测确认：

- AbuAPI、初元、元流、YesCode、Crab-ai 的充值页与 settings 口径一致。
- Right Code 实测下一笔 `$5` 订单，账单金额 `￥5.00`，状态待支付，1:1 确认。最低 `$1`。弹窗标注「手续费 6%」，但订单金额未加，只在申请国内发票时计入（国内发票最低 ￥50.00）。
- NexAIX 只有 settings 里的 `price=7.3` 默认值，页面没打开（域名 `nexaix.ai` 本机不通），标 `probable`。

所以这 7 家的实际成本都是 **官方价 × 分组倍率 ÷ 7.2**。分组倍率是乘数，不是折扣率：「余额组 0.4」的意思是官方价 × 0.4 ÷ 7.2。

## 汇总表

| 站 | host | 技术栈 | 模型 | 分组 | 按量 | 按次 | 档位/表达式 | 币种 | 充值 | 取价接口 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AbuAPI | `www.abuai.chat` | new-api 魔改 | 245 | 24 | 157 | 54 | 31 | ¥1 = $1 | ¥1 = $1 | `/api/pricing` + `/api/status` |
| NexAIX | `nexaix.ai` | new-api | 7 | 2（default 0.9 / vip 1） | 7 | 0 | 0 | ¥1 = $1 | ¥1 = $1（`price=7.3`） | `/api/pricing` |
| 初元API | `initapi.ai` | sub2api | 53 | 13 | 53 | 0 | 0 | ¥1 = $1 | 1:1 + 阶梯赠 33%~100% | `/api/v1/model-plaza` |
| 元流 | `api.axis.fan` | sub2api | 58 | 6 | 58 | 0 | 0 | ¥1 = $1 | 1:1 | `/api/v1/model-plaza` |
| YesCode | `co.yes.vg` | sub2api 变体 | 61 | 10 | 61 | 0 | 0 | ¥1 = $1 | 套餐 ¥100–¥1000 | `/api/v1/model-plaza` |
| Crab-ai | `crab-ai.net` | sub2api | 6 | 2（0.12 / 1） | 6 | 0 | 0 | ¥1 = $1 | ¥1 = $1，最低 ¥10 | `/api/v1/model-plaza` |
| Right Code | `rightapi.io`（API：`api.site`） | Spring Boot | 111 | 13 个上游 | 92 | 19 | 0 | ¥1 = $1 | ¥1 = $1，最低 $1 | `/models/public` |

## 三套技术栈

### new-api 系列（AbuAPI、NexAIX）

`/api/pricing` 返 `data` 对象，键是模型名，值是 `{ model_ratio, completion_ratio, cache_ratio, quota_type, enable_groups, billing_mode, billing_expr, sale_source }`。

- `quota_type = 1` 或 `model_price > 0` → 按次
- `billing_mode = tiered_expr` → 价格写成 DSL 表达式，AbuAPI 有 31 条这种
- AbuAPI 的 `sale_source` 有六种取值：`ratio` 115、`fixed` 54、`expression` 31、`official` 7、`fiat` 3、`unset` 35

AbuAPI 的表达式带 `tier()` 和 `u()`，`u("resolution")` 读分辨率、`u("video_input")` 读是否含视频输入，形如：

```
u("resolution") == "4k" ? tier("4k-video", u("tokens") * 13.12 / 1000000)
                       : tier("4k-none",  u("tokens") * 21.32 / 1000000)
```

### sub2api 系列（初元、元流、Crab）

`/api/v1/model-plaza` 返 `data.groups[]`，每组 `{ name, ratio, models[] }`，组内模型带 `pricing.billing_mode`（`token` / `request`）、`pricing.intervals[]`（长上下文档位）。初元额外给了 `official_pricing`，可以直接算相对官方的倍率。

`/api/v1/settings/public` 给 `description` 字段，充值口径就写在那里。元流的原文：

> 充值1:1，GPT月卡倍率低至0.16，claude月卡低至0.8，以下为余额分组倍率

### 独立实现（Right Code、YesCode）

- **Right Code**：`/models/public` 返 `upstreams[]`，每个上游有 `prefix` 和 `models[]`。13 个上游按渠道切，模型按 `billing_mode` 分 `token` / `tiered` / `request` 三种，`tiers[]` 是长上下文档。
- **YesCode**：`/api/v1/public/admin-settings` 45KB，`/api/v1/model-plaza` 返扁平 `models[]` + `vendors[]`，4 个厂商，模型带 `input_token_price` / `output_token_price` / `cache_read_token_price` / `cache_creation_token_price`，单位是美元/M。

## 分组倍率

同一模型在不同组里价格不同，插件必须把分组作为维度。

| 站 | 分组数与倍率 |
| --- | --- |
| AbuAPI | 24 组，`sale_source=ratio` 的模型按 `enable_groups` 展开 |
| NexAIX | `default` 0.9、`vip` 1.0 |
| 初元 | 13 组：GLM低价组 0.05、ChatGPT低价组 0.085、DeepSeek低价组 0.1、Grok破甲 0.1、CCMAX满血 0.3、GLM-5.3 Flash Uncensored 1.0 |
| 元流 | 6 组：grok-heavy-余额专用 0.3、余额 0.4、国模-claude-code专用 0.6、国模-codex专用 0.6、生图专业版 1.0、CC-MAX-余额专用 1.2 |
| Crab-ai | 2 组：codex-pro 0.12、bugteam 1.0 |
| Right Code | 13 个上游各自定价，没有统一倍率层 |

## 充值方案

| 站 | 方案 | 页面证据 |
| --- | --- | --- |
| AbuAPI | 按金额直充，`price=1`、`usd_exchange_rate=7.3` | 定价页写「价格口径 1 USD = 1 CNY」，报价可切 `$` / `¥` |
| 初元 | 1:1 + 阶梯赠送 | `¥100 → 150 额度`、`¥300 → 450`、`¥500 → 800`、`¥1000 → 1800`（赠 33%–100%） |
| 元流 | 1:1 | `settings.description` |
| YesCode | 按量套餐 ¥100 / ¥200 / ¥300 / ¥500 / ¥1000，折扣 1.0–0.91 | `/subscription?buy=payg`，写「¥1 额度 = $1」 |
| Crab-ai | ¥1 = $1，最低 ¥10 | 充值页 `¥1.00 = $1 额度` |
| Right Code | ¥1 = $1，最低 `$1` | 实测订单 `ORD-399c9aa8a2cc45cfb2b2`：余额 `$5.00` → 账单 `￥5.00`。手续费 6% 只在申请国内发票时收（发票最低 ￥50） |
| NexAIX | ¥1 = $1（`price=7.3` 默认值） | 充值页没打开（`nexaix.ai` 本机不通），只有 settings 报文 |

## 登录需求

7 家全部要登录。`/api/pricing`（new-api）和 `/api/v1/model-plaza`（sub2api）匿名都是 401。

取价必须在页面上下文里 `fetch`，这样才带 cookie 与 `New-Api-User` 头。命令行 `curl` 一定 401。

sub2api 系的凭证在 `localStorage`：`auth_token`、`refresh_token`、`sub2api_login_account`。

## 按量单价怎么算

插件要的是「美元 / 1M tokens」，各家原始字段换算方式不同。

### new-api 系

```
input_per_1m  = model_ratio × 2          （美元，官方倍率，1 = 官方价）
output_per_1m = input_per_1m × completion_ratio
cache_read    = input_per_1m × cache_ratio
cache_write   = input_per_1m × cache_ratio × 1.25   （各家不等，优先读 cache_creation_ratio）
```

`model_ratio` 的基准是「官方价 ÷ 2」，这是 new-api 在 `src/core/pricing.js` 里的 `SYSTEM_BASE_PRICE_PER_1M`。

### sub2api 系

`pricing.input_price` 本身就是**美元 / 1 token**（如 `2e-7`），乘 1e6 得到美元 / 1M tokens。不要再去乘倍率。

分组倍率另算：`最终价 = input_per_1m × group.ratio`。

`pricing.intervals[]` 是长上下文档位，`min_tokens` / `max_tokens` 决定命中哪一档，`long_context_basis` 说明 `whole_request` 还是只算超出部分。

### Right Code

`input_price` 是**美元 / 1M tokens**（不是每 token），和 sub2api 量级差 1e6，取字段前先看数字量级。

报价用 `$` 标，但充值 1 元买 1 美元额度，所以实付 = 报价 ÷ 7.2，和其他家同一个口径。

站点公告：原域名 `right.codes`、`rightapi.ai` 国内已不可访问。主站是 `rightapi.io`（登录、管理、定价），**模型 API 走 `https://api.site`**。插件只需主站，但用户配置 baseURL 时要用 `api.site`。

### 表达式计费（AbuAPI 31 条）

形如：

```
len <= 272000 ? tier("short_context", p * 2 + c * 10 + cr * 0.1 + cc * 2.5)
             : tier("long_context", p * 4 + c * 15 + cr * 0.2 + cc * 5)
```

`p` 是 prompt token 数、`c` 是 completion、`cr` 是 cache read、`cc` 是 cache creation。系数 `2` / `10` 是「美元 / 1M tokens」还是「点数」，报文里没有自述，站点文档也没写。

**这批模型目前无法给出确定单价**，和已有站点 91token / poloai / leaflow 的表达式计费属同一限制。插件里应当跳过或标 `expression`，不要拿系数硬乘。

## 开发上的注意

1. **两套 Dom**：new-api 用 `model_ratio` + `completion_ratio`，sub2api 用绝对单价（`input_price` 是「每 token 美元」的小数，如 `2e-7`）。别混用。
2. **档位是常态**：AbuAPI 31/245、初元与元流在 `intervals[]` 里、Right Code 在 `tiers[]` 里。插件不能只读首档价。
3. **按次要单列**：AbuAPI 54 个、Right Code 19 个模型是 `fixed` / `request` 计费，没有 token 单价。
4. **分组要展开**：初元 13 组、元流 6 组，最便宜和最贵差 24 倍（0.05 vs 1.2）。只取默认组会漏掉低价。
5. **`unset` 要跳过**：AbuAPI 有 35 个模型 `sale_source` 是 `unset`，没有有效价格。

## 缺证清单

| 项 | 缺哪一证 | 何时能补 |
| --- | --- | --- |
| NexAIX 币种与充值 | 页面（`nexaix.ai` 本机直连不通） | 换网络环境或走代理 |
| 表达式计费的系数单位 | 自述（报文与文档都没有） | 可能永远补不上，按跳过处理 |
