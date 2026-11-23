# Man8Out 插件取证

核验日期：2026-11-23。入口为[模型市场](https://ai.man8out.com/modelsmarket)。面板是 **Sub2API 系**（同 NexaVlinks 定制前端，`/api/v1/channels/catalog` 接口族），站内记账单位 `NEX`，符号 `◈`。以下价格是本次快照，插件采集时重新读接口，不用本文兜底。

## 结论

- **不需要登录**：`/api/v1/channels/catalog` 与 `/api/v1/payment/public/plans` 匿名 200。要登录的是充值与结算三件套（`/payment/config`、`/payment/limits`、`/payment/checkout-info`），一律 401 `Authorization header is required`。插件走 `mode: "direct"`，`credentials: "omit"`。
- 规模：**18 个分组、40 个唯一模型、74 条分组×模型记录**。归一后 **80 行**（长上下文档位展开）。
- 计费构成：token 46 条、图片按次 8 条、**站点未配置价格 20 条**（`pricing: null`）。无价条目不进比价表，不当免费。
- 价格口径：`pricing.input_price` 等字段是**官方基准价、按 token 计价**（`2e-6` = $2/百万 token）。**分组倍率 `rate_multiplier` 由前端乘上去**，接口不预乘。倍率区间 **0.09x ~ 1.5x**，大于 1 的组真实存在，插件不能钳到 1。
- **充值口径已实测**：¥1 到账 ◈1，支付宝另收 1% 手续费，实付 ¥1.01 换 ◈1。站内 ◈ 与官方美元额度 1:1，折算 **1 美元额度 = ¥1.01**。无赠送档位（三档折扣规则 `enabled` 全 `false`），单笔 1–10000 元。
- 订阅套餐 10 档，CNY 计价，**每周发一批 ◈ 额度，28 或 30 天到期，用不完不累积**。整周期折算 **¥0.236 ~ ¥0.367 每 ◈**，比充值（¥1.01）便宜 2.7~4.3 倍。Ultra 售罄，其余 9 档页面显示可开通。

## 接口与登录

| 接口 | 匿名结果 | 插件用途 |
| --- | --- | --- |
| `GET /api/v1/channels/catalog?available_only=true&timezone=Asia/Shanghai` | 200，56 KB | **唯一取价来源** |
| `GET /api/v1/payment/public/plans` | 200，13 KB | 只做人读证据，不进采集链 |
| `GET /api/v1/settings/public` | 200，315 KB | 站点开关与币种名 |
| `GET /api/v1/payment/config` | 401 / 登录 200 | 换汇、赠送阶梯、支付渠道 |
| `GET /api/v1/payment/limits` | 401 / 登录 200 | 单笔上下限、手续费 |
| `GET /api/v1/payment/checkout-info` | 401 / 登录 200 | 下单实付金额 |

`/api/v1/payment/public/plans` 是唯一能匿名看到人民币数字的接口，但它卖的是订阅，不是余额。

## 定价口径

`pricing` 是官方基准价，跨组同名模型逐字节一致（已验证）。实付价 = 基准价 × `groups[].rate_multiplier`。

- `input_price` / `output_price` / `cache_read_price` / `cache_write_price` / `cache_write_1h_price` 单位是 **USD / token**，写进比价表前乘 `1e6`。
- `per_request_price` 是**每次调用单价**，配 `billing_mode: "image"` 与 `intervals[].tier_name`（`1K`/`2K`/`4K`）。
- `intervals` 是长上下文档：档内 `tier_name` 只有 `standard` 与 `long_context` 两档，**整个请求按高档计价**（`whole_request`），不是超出部分分段。
- `pricing: null` 与 `billing_mode: "token"` 但价格全 `null`（如 `gpt-6-sol`）都是「没报价」，归一后不产生空价行。

## 分组与倍率

`rate_multiplier` 是分组折扣；`user_rate_multiplier` 若存在则优先，本站 18 个分组都没给。

| 分组 | 平台 | 倍率 | 模型数 |
| --- | --- | ---: | ---: |
| `[仅付费] GPT  活动疯狂星期天  009  不降智` | openai | 0.09 | 4 |
| `[官方/仅付费] deepseek(1017)` | deepseek | 0.15 | 2 |
| `[上游] GROK` | grok | 0.15 | 3 |
| `[官方] GLM` | zhipu | 0.15 | 1 |
| `[免费鸡蛋用我] deepseek免费鸡蛋分组` | deepseek | 0.16 | 2 |
| `[官方] Kimi` | kimi | 0.25 | 2 |
| `[免费鸡蛋用我]  免费鸡蛋专属GPT分组` | openai | 0.3 | 4 |
| `[官方] Qwen` | qwen | 0.3 | 2 |
| `[自建/仅付费] Astra/Sol/Luna` | openai | 0.3 | 1 |
| `标准` | openai | 0.3 | 7 |
| `[自部署] Kimi` | kimi | 0.33 | 1 |
| `[仅付费] 官key，百分百智商绝对稳 0.4x` | openai | 0.4 | 15 |
| `[上游] 哈基米4` | gemini | 0.45 | 4 |
| `[仅付费] 企业对接L3级别官key` | openai | 1 | 15 |
| `[生图] 2.6 1分一张稳定生图 支持原生协议无4k` | gemini | 1 | 4 |
| `image2.6` | openai | 1 | 2 |
| `Duomi 跑量 · 临时低价` | openai | 1 | 2 |
| `[仅付费] CCMAX  0注入` | anthropic | 1.5 | 3 |

同一模型在几个组里各出现一次，比价表按分组行分别展示，不合并。

## 模型与计费

价格是**官方基准价，USD / 百万 token**，不是实付价。实付 = 表内数值 × 所在分组倍率（0.09 ~ 1.5）。按次计费的 `按次` 列单位是 USD / 次。

| 模型 | 平台 | 计费 | 输入 | 输出 | 缓存读 | 缓存写 | 按次 | 档位 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| `claude-fable-5-1` | anthropic | token | 10 | 50 | 0.25 | 12.5 | — | — |
| `claude-fable-5-2` | anthropic | token | 8 | 40 | 0.2 | 10 | — | — |
| `claude-opus-5-5` | anthropic | token | 4 | 20 | 0.2 | 5 | — | — |
| `codex-auto-review` | openai | 无价 | — | — | — | — | — | 站点未配置 |
| `deepseek-v4-pro-0813` | deepseek | token | 4.5 | 13.5 | 0.15 | 0 | — | — |
| `deepseek-v4.1-flash` | deepseek | token | 1 | 4 | 0.02 | 0 | — | — |
| `gemini-3.0-pro-image` | gemini | 按次 | — | — | — | — | 0.08 / 0.12 / 0.12 | 1K · 2K · 4K |
| `gemini-3.1-flash-image` | gemini | 按次 | — | — | — | — | 0.08 / 0.12 / 0.12 | 1K · 2K · 4K |
| `gemini-3.1-flash-lite-image` | gemini | 按次 | — | — | — | — | 0.08 / 0.12 / 0.12 | 1K · 2K · 4K |
| `gemini-4-argon` | gemini | token | 4 | 20 | 0.2 | — | — | — |
| `gemini-4-carbon` | gemini | token | 4 | 20 | 0.2 | — | — | — |
| `gemini-4-hydrogen` | gemini | token | 1.5 | 7.5 | 0.075 | — | — | — |
| `gemini-4-neon` | gemini | token | 3 | 15 | 0.15 | — | — | — |
| `gemini-nano-banana-2.1` | gemini | 按次 | — | — | — | — | 0.08 / 0.08 / 0.12 | 1K · 2K · 4K |
| `glm-5.3` | zhipu | token | 8 | 28 | 2 | 8 | — | — |
| `gpt-4o-mini` | openai | 无价 | — | — | — | — | — | 站点未配置 |
| `gpt-5.4` | openai | 无价 | — | — | — | — | — | 站点未配置 |
| `gpt-5.5` | openai | 无价 | — | — | — | — | — | 站点未配置 |
| `gpt-5.6` | openai | 无价 | — | — | — | — | — | 站点未配置 |
| `gpt-5.6-luna` | openai | 无价 | — | — | — | — | — | 站点未配置 |
| `gpt-5.6-sol` | openai | 无价 | — | — | — | — | — | 站点未配置 |
| `gpt-5.6-terra` | openai | 无价 | — | — | — | — | — | 站点未配置 |
| `gpt-6-astra` | openai | 无价 | — | — | — | — | — | 站点未配置 |
| `gpt-6-luna` | openai | token | 0.4 | 2.4 | 0.02 | 0.55 | — | — |
| `gpt-6-sol` | openai | token | — | — | — | — | — | 有 `billing_mode` 但价格全空 |
| `gpt-6.1-sol` | openai | token | 2 | 10 | 0.1 | 2.5 | — | — |
| `gpt-6.1-terra` | openai | token | 1 | 5 | 0.05 | 1.25 | — | standard · long_context |
| `gpt-6.2-astra` | openai | token | 8 | 40 | 0.4 | 10 | — | standard · long_context |
| `gpt-6.2-sol` | openai | token | 2 | 10 | 0.1 | 2.5 | — | standard · long_context |
| `gpt-image-2.5-flare` | openai | 按次 | — | — | — | — | 0.06 / 0.06 / 0.06 | 1K · 2K · 4K |
| `gpt-image-2.5-sunburst` | openai | 按次 | — | — | — | — | 0.06 / 0.06 / 0.06 | 1K · 2K · 4K |
| `gpt-image-2.6-flare` | openai | 按次 | — | — | — | — | 0.012 | 单档 |
| `gpt-image-2.6-sunburst` | openai | 按次 | — | — | — | — | 0.012 | 单档 |
| `grok-4.6` | grok | token | 2 | 6 | 0.5 | — | — | standard · long_context |
| `grok-4.7` | grok | token | 2 | 6 | 0.5 | — | — | standard · long_context |
| `grok-4.7-build-fast` | grok | token | 4 | 12 | 1 | — | — | standard · long_context |
| `kimi-k3` | kimi | token | 20 | 100 | 2 | 20 | — | — |
| `kimi-k3.1-pro` | kimi | token | 13 | 68 | 1.3 | 13 | — | — |
| `qwen3.8-flash` | qwen | token | 0.15 | 0.47 | 0.016 | 0.2 | — | — |
| `qwen3.8-max` | qwen | token | 12 | 36 | 2.4 | 15 | — | — |

`deepseek-v4-pro-0813` 与 `deepseek-v4.1-flash` 的 `cache_write_price` 是**零**（不是缺失），插件保留 0 不改成 null。

## 充值口径

两条完全不同的路，单价差 3~4 倍，别混着算。

### 余额充值：¥1.01 换 ◈1

登录后收银台实测（2026-11-23）：

- 自定义金额 10 → **到账 ◈10.00**，`手续费 (1%)` ¥0.10，**确认支付 ¥10.10**
- 单笔 1–10000 元，支付宝与微信两个渠道，`recharge_fee_rate = 1`
- 三档充值折扣规则 `enabled` 全 `false`，没有阶梯赠送，`recharge_bonus_tiers` 为空
- 快捷金额 9 档（◈10 到 ◈5000）面额与人民币都是 1:1

**站内 ◈ 就是美元额度**，不是某种折扣币。两处对账：

| 位置 | 模型 | 官方价 | × 倍率 | 页面显示 |
| --- | --- | --- | ---: | --- |
| `/pricecalc` | `qwen3.8-flash` | 输入 $0.15 / 缓存 $0.016 / 输出 $0.47 | 0.3 | ◈0.045 / ◈0.0048 / ◈0.141 |
| `/dashboard` 推荐 | `gpt-6.2-sol` | 输入 $2 / 输出 $10 / 缓存写 $2.5 / 缓存读 $0.1 | 0.09 | ◈0.18 / ◈0.9 / ◈0.225 / ◈0.009 |

所以 `rechargeRate = 10.10 / 10 = 1.01`，即 **1 美元额度 = ¥1.01**。

### 订阅：整周期 ¥0.236 ~ ¥0.367 每 ◈

10 档套餐，CNY 一次性付费，额度**每周刷新**，到有效期作废，不累积。

| 套餐 | 价格 | 周限额 | 有效期 | 全周期额度 | 赠 ◈ | 每 ◈ 成本 | 状态 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `Ultra` | ¥2198 | ◈2329.26 | 28 天 | ◈9317.04 | 90 | ¥0.2359 | 售罄 |
| `Powerful` | ¥768 | ◈783 | 28 天 | ◈3132 | 5 | ¥0.2452 | 可开 |
| `Boost` | ¥328 | ◈325 | 30 天 | ◈1300 | 4 | ¥0.2523 | 可开 |
| `Advance` | ¥128 | ◈123 | 28 天 | ◈492 | 3 | ¥0.2602 | 可开 |
| `Standard` | ¥68 | ◈62 | 28 天 | ◈248 | 2 | ¥0.2742 | 可开 |
| `Go` | ¥25 | ◈22.5 | 28 天 | ◈90 | 1 | ¥0.2778 | 可开 |
| `Max` | ¥1098 | ◈932 | 28 天 | ◈3728 | 40 | ¥0.2945 | 可开 |
| `Pro` | ¥388 | ◈328 | 28 天 | ◈1312 | 15 | ¥0.2957 | 可开 |
| `Lite` | ¥38 | ◈30 | 28 天 | ◈120 | 2 | ¥0.3167 | 可开 |
| `Plus` | ¥138 | ◈94 | 28 天 | ◈376 | 5 | ¥0.3670 | 可开 |

读法：

- 最后一列 = `价格 ÷ (周限额 × 周数)`。相比直接充值（¥1.01/◈）便宜 **2.75~4.28 倍**。
- 周限额每周重置，用不完清零。能不能拿到这个价，取决于你跑不跑满每周额度，跑不满摊下来会接近充值价。
- 档位名字和价格不成单调关系：`Plus` 最贵（¥0.367），`Ultra` 最便宜（¥0.236），`Max` 比同级的 `Powerful` 还贵。选档只看最后一列。
- 高级档绑定 `[高级订阅] 订阅专属分组`，另解锁 `[自建/仅付费] Astra/Sol/Luna` 的 0.25~0.29 倍率，档位越高倍率越低。
- 后台开关 `payment_enabled = true`、`balance_disabled = false`、`purchase_subscription_enabled = false`，但订阅页 9 档都显示「立即开通」，Ultra 显示「售罄」。以页面为准，别信这个开关。

插件只把**充值**换算写进 `rechargeRate`（`1.01`），订阅落 `rechargePlans` 当展示元数据，不参与比价表的成本折算。订阅额度带周期，摊成单价会失真。

## 可疑配置

`/api/v1/settings/public` 里 `balance_low_notify_recharge_url = "http://8.211.146.67"`，明文 HTTP 指向一个裸 IP（阿里云香港段），不用域名也不走 HTTPS。首页没有任何地方引用它，只在设置里躺着。这是站点配置本身的问题，不是插件要处理的事，记在这里备查。

## 插件实现

`plugins/man8out/plugin.js`：

- `adapter.endpoint` 复用 `NEXA_CHANNEL_CATALOG_ENDPOINT`，这是同族站点共用的接口路径，不另起常量。
- `preservePriceCurrency: true` + `priceCurrency: "USD"`。不写这个标记，`prepareStationInput` 会把币种强制改成 `CREDITS`（`src/core/provider-registry.js:228`）。
- `preserveRechargeRateVerification: true` + `rechargeRateVerified: true`。前一个标记必须在，否则 `prepareStationInput` 会把默认值写回「已验证」；转 true 的依据是上面那组收银台实测。
- `rechargeRmb: 1.01` / `rechargeCredits: 1`，`normalizeStation` 据此算出 `rechargeRate = 1.01`。
- `rechargePayments` 落一条支付宝实付（面额 10 / 实付 10.10 / `feeRate` 0.01），`rechargePlans` 落 10 档订阅。两者都只作展示与追溯，不参与成本折算。
- `prepare` 里 `rechargeRateVerified: stationInput.rechargeRateVerified === true`，只认真布尔，不吃字符串。
- 无 `modelAliases`。40 个模型名都符合规范 id，不需要人工映射。

## 复现

```bash
# 1. 匿名取价，确认 200 与规模
curl -s 'https://ai.man8out.com/api/v1/channels/catalog?available_only=true&timezone=Asia%2FShanghai' \
  | jq '{channels: (.data|length), models: ([.data[].platforms[].supported_models[]]|length)}'

# 2. 匿名仍是 401，登录后才 200
curl -s -o /dev/null -w '%{http_code}\n' 'https://ai.man8out.com/api/v1/payment/config'

# 3. 登录态取充值配置与套餐（token 在 localStorage.auth_token）
TOKEN='<浏览器 localStorage 里的 auth_token>'
curl -s -H "Authorization: Bearer $TOKEN" 'https://ai.man8out.com/api/v1/payment/config' \
  | jq '.data | {enabled, min_amount, max_amount, enabled_payment_types, recharge_fee_rate, balance_recharge_multiplier, recharge_discount_rules}'
curl -s -H "Authorization: Bearer $TOKEN" 'https://ai.man8out.com/api/v1/payment/checkout-info' \
  | jq '[.data.plans[] | {name, price, weekly_limit_usd, validity_days, bonus_amount, for_sale}]'

# 3b. 收银台实付要人工看：/purchase?tab=recharge 自定义金额 10，读「手续费 (1%)」与「确认支付」

# 4. 插件端到端
cd extension && node --test test/site-plugins.test.js --test-name-pattern man8out
```

固定样本：

- `out/man8out/catalog-anon.json` —— 匿名目录快照（56 KB）
- `out/man8out/payment-public-plans.json` —— 订阅套餐快照
- `out/man8out/payment-config.json` —— 充值配置快照（登录态，922 B）
- `out/man8out/payment-checkout-info.json` —— 收银台套餐快照（登录态，13 KB）
- `out/man8out/settings-public.json` —— 站点开关与币种
- `extension/test/fixtures/man8out-catalog.json` —— 测试夹具，6 个分组 15 个模型，覆盖 token/长档/按次/无价四种形态
