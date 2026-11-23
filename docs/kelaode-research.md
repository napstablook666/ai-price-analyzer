# 克劳德 APi 插件取证

核验日期：2026-11-23。入口为[模型广场](https://api.kelaode.si/model-plaza)。面板软件是 sub2api（版本 1.1.6，Vue 前端 + Go 后端）。以下价格是本次快照，插件采集时重新读取接口，不用本文兜底。

## 结论

- 模型广场**要求登录**：`settings/public` 里 `model_plaza_require_auth = true`，匿名读 `/api/v1/model-plaza` 返回 401。插件因此走 `page` 模式，复用当前 Chrome 配置文件的登录态。
- 目录为 **2 个分组、15 个模型**，全部按 token 计费。没有图片、视频、按次计费的模型，也没有需要展开规格的报价。
- 价格单位是 **USD / 百万 token**。站点文案写「1 人民币=1 美刀」，但收银台另收 4% 手续费，实际折算 **1 美元额度 = ¥1.04**。
- 接口给的 `pricing` 是**官方基准价**（与同条目的 `official_pricing` 一致），分组倍率由前端乘上去。插件同样乘倍率，得到实付价。
- 长上下文分档真实生效：GPT 组 `≤272K` / `>272K`，`claude-haiku-5-5` `≤100K` / `>100K`。`long_context_basis = "whole_request"`，跨过阈值后**整个请求**按高档计价，不是超出部分分段计价。

## 模型与计费

两组倍率：`GPT 官方满血不降智分组` 0.2x，`claude max 官方满血号池` 0.9x。倍率来自 `rate_multiplier`；`user_rate_multiplier` 若存在则优先（本站两个分组都没有，按缺省处理）。

下表的「输入 / 输出 / 缓存」都是**官方基准价**，单位 USD / 百万 token。实付价 = 表内数值 × 分组倍率。

GPT 组（0.2x）：

| 模型 | 输入 | 输出 | 缓存读 | 缓存写 | 缓存写 1h | `>272K` 输入 | `>272K` 输出 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `codex-auto-review` | 0.20 | 1.20 | 0.02 | 0.25 | 0.25 | 0.40 | 1.80 |
| `gpt-5.6` | 5.00 | 30.00 | 0.50 | 6.25 | 6.25 | 10.00 | 45.00 |
| `gpt-5.6-luna` | 0.20 | 1.20 | 0.02 | 0.25 | 0.25 | 0.40 | 1.80 |
| `gpt-5.6-sol` | 5.00 | 30.00 | 0.50 | 6.25 | 6.25 | 10.00 | 45.00 |
| `gpt-5.6-terra` | 2.00 | 12.00 | 0.20 | 2.50 | 2.50 | 4.00 | 18.00 |
| `gpt-6-astra` | 10.00 | 50.00 | 1.00 | 12.50 | 12.50 | 20.00 | 75.00 |
| `gpt-6-luna` | 0.10 | 0.50 | 0.01 | 0.125 | 0.125 | 0.20 | 0.75 |
| `gpt-6-sol` | 2.00 | 10.00 | 0.20 | 2.50 | 2.50 | 4.00 | 15.00 |
| `gpt-6.2-astra` | 8.00 | 40.00 | 0.40 | 10.00 | 10.00 | 16.00 | 60.00 |
| `gpt-6.2-sol` | 2.00 | 10.00 | 0.10 | 2.50 | 2.50 | 4.00 | 15.00 |

claude max 组（0.9x）：

| 模型 | 输入 | 输出 | 缓存读 | 缓存写 | 缓存写 1h | `>阈值` 输入 | `>阈值` 输出 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `claude-fable-5-2` | 8.00 | 40.00 | 0.20 | 10.00 | 16.00 | — | — |
| `claude-haiku-5-5` | 0.10 | 0.50 | 0.01 | 0.125 | 0.20 | 0.50 | 2.50 |
| `claude-opus-5-5` | 4.00 | 20.00 | 0.20 | 5.00 | 8.00 | — | — |
| `claude-sonnet-5` | 2.00 | 10.00 | 0.20 | 2.50 | 4.00 | — | — |
| `claude-sonnet-5-5` | 2.00 | 10.00 | 0.10 | 2.50 | 4.00 | — | — |

`claude-haiku-5-5` 的档位阈值是 100K，`>100K` 档的缓存价同比例翻倍（读 0.05、写 0.625、1h 写 1.00）。

页面实测对照（实付 / 官方）：

| 模型 | 档位 | 实付输入 | 实付输出 | 缓存读 | 缓存写 | 1h 缓存写 | 官方输入 | 官方输出 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `claude-opus-5-5` | — | 3.60 | 18.00 | 0.18 | 4.50 | 7.20 | 4.00 | 20.00 |
| `gpt-6-sol` | ≤272K | 0.40 | 2.00 | 0.04 | 0.50 | 0.50 | 2.00 | 10.00 |
| `gpt-6-sol` | >272K | 0.80 | 3.00 | 0.08 | 1.00 | 1.00 | 4.00 | 15.00 |

## 接口与登录

采集接口：`GET /api/v1/model-plaza`，带 `Authorization: Bearer <auth_token>`，`credentials: include`。

响应是 `{ code: 0, message: "success", data: { description, groups: [...] } }`，分组字段 `id / name / platform / rate_multiplier / user_rate_multiplier / peak_rate_enabled / long_context_pricing_enabled / models[]`，模型字段 `name / platform / pricing / official_pricing / long_context_basis / intervals[]`。

`intervals[]` 里 `min_tokens / max_tokens / tier_label` 是档位，价格字段与顶层同名。`input_multiplier`、`output_multiplier` 等字段存在但全为 `null`，档位差价直接写在价格里，不靠倍率。

登录态全在 localStorage：

| 键 | 内容 |
| --- | --- |
| `auth_token` | 访问令牌，24 小时 |
| `refresh_token` | 刷新令牌，每次续期后轮换 |
| `token_expires_at` | 毫秒时间戳字符串，前端自己记的过期时间 |

localStorage 里还有一个 `auth_user`（当前账号资料），采集用不上。

过期流程照前端实现：`POST /api/v1/auth/refresh`，body 是 `{refresh_token}`，响应 `data.access_token` + `data.refresh_token` + `expires_in`。插件用 `localStoragePageAuth` 配了同一套续期，所以浏览器登录过一次之后不用再管。

登录走 `POST /api/v1/auth/login`，**开了 Cloudflare Turnstile**，注册同样要过 Turnstile。插件不碰登录，只读已有的 token。

`settings/public` 里影响采集的字段：`model_plaza_enabled: true`、`model_plaza_require_auth: true`、`registration_enabled: true`、`turnstile_enabled: true`、`subscription_enabled: false`。

## 充值口径

充值只有余额一种，没有订阅套餐（`subscription_enabled: false`，套餐列表为空）。

- `GET /api/v1/payment/config`：`enabled: true`，`min_amount: 20`，`max_amount: 2000`，`enabled_payment_types: ["easypay"]`（支付宝），`recharge_fee_rate: 4`（百分比），`recharge_bonus_tiers: []`、`recharge_bonus_mode: "bonus"`。
- 收银台实测面额 100 元：支付金额 ¥100.00、手续费 (4%) ¥4.00、实付金额 ¥104.00，到账记 100 美元额度。
- `GET /api/v1/payment/limits` 里 alipay 的 `fee_rate` 是 0、单笔上下限也是 0，真正生效的是 `payment/config` 的 4% 与 20–2000 元区间。
- 没有赠送档位，所以「充得多送得多」这类比例完全不存在，唯一变量是那 4% 手续费。

折算：**1 美元额度 = ¥1.04**。插件写死在 `rechargeRmb: 1.04` / `rechargeCredits: 1`，并标 `rechargeRateVerified: true`，不让全局汇率覆盖。

## 与同族面板的关系

端点和 `plugins/nodeai`、`plugins/fuck-everyone` 一致，`kelaode` profile 的差别只有三处：

1. `currency: "USD"`，同族里 NodeAI 是 CNY、其余是 `null`。
2. `groupMultiplier` 读 `user_rate_multiplier ?? rate_multiplier`，缺省当 1。
3. 站点要登录，所以站点用 `page` 模式而不是 `direct`。

## 复现与固定样本

```bash
cd extension && npm test
cd extension && npm run verify
```

抓取原始响应留存于 `out/kelaode-model-plaza.json`、`out/kelaode-payment-plans.json`、`out/kelaode-payment-config.json`、`out/kelaode-payment-limits.json`、`out/kelaode-groups-rates.json`。

固定样本：`test/core.test.js` 里 `kelaodeFixture`（裁剪为 1 个 GPT 模型 + 1 个 claude 模型），断言覆盖两组倍率、`≤272K` / `>272K` 两档、缓存读写与 1h 缓存写、以及 `price_currency === "USD"`。
