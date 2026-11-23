# Man8Out 插件取证

核验日期：2026-11-23。入口为[模型市场](https://ai.man8out.com/modelsmarket)。面板是 **Sub2API 系**（同 NexaVlinks 定制前端，`/api/v1/channels/catalog` 接口族），站内记账单位 `NEX`，符号 `◈`。以下价格是本次快照，插件采集时重新读接口，不用本文兜底。

## 结论

- **不需要登录**：`/api/v1/channels/catalog` 与 `/api/v1/payment/public/plans` 匿名 200。要登录的是充值与结算三件套（`/payment/config`、`/payment/limits`、`/payment/checkout-info`），一律 401 `Authorization header is required`。插件走 `mode: "direct"`，`credentials: "omit"`。
- 规模：**18 个分组、40 个唯一模型、74 条分组×模型记录**。归一后 **80 行**（长上下文档位展开）。
- 计费构成：token 46 条、图片按次 8 条、**站点未配置价格 20 条**（`pricing: null`）。无价条目不进比价表，不当免费。
- 价格口径：`pricing.input_price` 等字段是**官方基准价、按 token 计价**（`2e-6` = $2/百万 token）。**分组倍率 `rate_multiplier` 由前端乘上去**，接口不预乘。倍率区间 **0.09x ~ 1.5x**，大于 1 的组真实存在，插件不能钳到 1。
- **没有按比例的余额充值口径可核**：`payment_balance_disabled = false`（余额充值开着），但换汇/赠送规则在 `/payment/config`，要登录。插件不编造 `rechargeRate`，`rechargeRateVerified: false` 落表。
- 订阅套餐公开可读 10 档，全是 **CNY 计价、7 折到原价之间**，另赠 1~90 `NEX`。**订阅购买开关 `purchase_subscription_enabled = false`**，页面能看不能下单。

## 接口与登录

| 接口 | 匿名结果 | 插件用途 |
| --- | --- | --- |
| `GET /api/v1/channels/catalog?available_only=true&timezone=Asia/Shanghai` | 200，56 KB | **唯一取价来源** |
| `GET /api/v1/payment/public/plans` | 200，13 KB | 只做人读证据，不进采集链 |
| `GET /api/v1/settings/public` | 200，315 KB | 站点开关与币种名 |
| `GET /api/v1/payment/config` | 401 | 换汇、赠送阶梯、支付渠道 |
| `GET /api/v1/payment/limits` | 401 | 单笔上下限、手续费 |
| `GET /api/v1/payment/checkout-info` | 401 | 下单实付金额 |

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

**这站不卖「余额充值比例」，卖订阅。** 匿名能拿到的只有套餐价目：

| 套餐 | 类别 | 价格 | 周额度 | 有效期 | 赠 `NEX` | ¥/周 $1 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `Ultra` | 高级 | ¥2198 | $2329.26 | 28 天 | 90 | 0.9436 |
| `Powerful` | 普通 | ¥768 | $783.00 | 28 天 | 5 | 0.9808 |
| `Boost` | 普通 | ¥328 | $325.00 | 30 天 | 4 | 1.0092 |
| `Advance` | 普通 | ¥128 | $123.00 | 28 天 | 3 | 1.0407 |
| `Standard` | 普通 | ¥68 | $62.00 | 28 天 | 2 | 1.0968 |
| `Go` | 普通 | ¥25 | $22.50 | 28 天 | 1 | 1.1111 |
| `Max` | 高级 | ¥1098 | $932.00 | 28 天 | 40 | 1.1781 |
| `Pro` | 高级 | ¥388 | $328.00 | 28 天 | 15 | 1.1829 |
| `Lite` | 高级 | ¥38 | $30.00 | 28 天 | 2 | 1.2667 |
| `Plus` | 高级 | ¥138 | $94.00 | 28 天 | 5 | 1.4681 |

口径说明，别读错：

- 最后一列是 `price ÷ weekly_limit_usd`，即**每拿到 1 元「官方额度」要付多少人民币**。不是充值比例，站内没有「充 ¥1 得 ◈N」这个字段的公开来源。
- 「周额度」按 `validity_days` 的周数消耗，28 天 = 4 周，30 天 = 4 周 + 2 天，超期作废。
- 普通档比高级档便宜，`Plus` 是全场最贵的一档（1.47 元/$1），`Ultra` 最便宜（0.94 元/$1）。档位设计和价格不成单调关系，选档别按名字猜。
- 三个后台开关：`payment_enabled = true`、`payment_balance_disabled = false`、`purchase_subscription_enabled = false`。**余额充值是开着的，订阅下单是关着的**，但套餐列表照常公开。

插件因此只写 `rechargeRateVerified: false` 加一段说明，不填任何 `rechargeRate` 数字。等哪天真拿到登录态收银台金额，再补一次并改这个标记。

## 可疑配置

`/api/v1/settings/public` 里 `balance_low_notify_recharge_url = "http://8.211.146.67"`，明文 HTTP 指向一个裸 IP（阿里云香港段），不用域名也不走 HTTPS。首页没有任何地方引用它，只在设置里躺着。这是站点配置本身的问题，不是插件要处理的事，记在这里备查。

## 插件实现

`plugins/man8out/plugin.js`：

- `adapter.endpoint` 复用 `NEXA_CHANNEL_CATALOG_ENDPOINT`，这是同族站点共用的接口路径，不另起常量。
- `preservePriceCurrency: true` + `priceCurrency: "USD"`。不写这个标记，`prepareStationInput` 会把币种强制改成 `CREDITS`（`src/core/provider-registry.js:228`）。
- `preserveRechargeRateVerification: true` + `rechargeRateVerified: false`，防止默认值把未核验的充值口径变成「已验证」。
- `prepare` 里 `rechargeRateVerified: stationInput.rechargeRateVerified === true`，只认真布尔，不吃字符串。
- 无 `modelAliases`。40 个模型名都符合规范 id，不需要人工映射。

## 复现

```bash
# 1. 匿名取价，确认 200 与规模
curl -s 'https://ai.man8out.com/api/v1/channels/catalog?available_only=true&timezone=Asia%2FShanghai' \
  | jq '{channels: (.data|length), models: ([.data[].platforms[].supported_models[]]|length)}'

# 2. 确认充值三件套要登录
curl -s -o /dev/null -w '%{http_code}\n' 'https://ai.man8out.com/api/v1/payment/config'

# 3. 确认订阅套餐匿名可读
curl -s 'https://ai.man8out.com/api/v1/payment/public/plans' | jq '[.data[] | {name, price, weekly_limit_usd, validity_days}]'

# 4. 插件端到端
cd extension && node --test test/site-plugins.test.js --test-name-pattern man8out
```

固定样本：

- `out/man8out/catalog-anon.json` —— 匿名目录快照（56 KB）
- `out/man8out/payment-public-plans.json` —— 订阅套餐快照
- `out/man8out/settings-public.json` —— 站点开关与币种
- `extension/test/fixtures/man8out-catalog.json` —— 测试夹具，6 个分组 15 个模型，覆盖 token/长档/按次/无价四种形态
