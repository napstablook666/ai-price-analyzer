# Leaflow Canopy 插件取证

核验日期：2026-11-21。入口为用户提供的[项目模型页](https://01a1fe61-12f8-7a6f-9b6f-8e6ffadd40aa.leaflow.net/products/canopy/models)。以下价格是本次目录快照，插件采集时重新读取接口，不使用本文作为报价兜底。

## 结论

- 登录后的完整目录为 **28 个模型**：12 个文本、2 个图片、4 个视频、8 个音频，以及 2 个当前项目未获授权的 `cyber/` 模型。
- 本次可生成 **18 个模型、35 条报价**。图片按规格展开，视频按分辨率展开；Qwen 图片的两种尺寸同价，沿用核心合并规则。8 个音频和 2 个受限模型保留在未解析清单中，不冒充文本报价。
- 完整目录需要浏览器登录态。公开产品页只有 8 个精选模型，不能作为完整目录。独立美元价格表可匿名读取，但它含有未上架的历史模型，不能单独决定在售列表。
- 登录充值页使用 **USD**，最低充值 **1 USD**，快捷面值为 **10 / 50 / 100 / 500 USD**；当前账户提供 Stripe 银行卡、支付宝。
- 本次未创建充值订单、未支付、未调用模型。人民币实付汇率、支付手续费和赠额均未核验。**美元充值面值相等不代表 1 USD 额度等于 1 CNY**。

## 模型与计费

文本单位为 USD / 百万 token。缓存写入为站点实际声明的写入项，不补造 1 小时缓存价格。

| 模型 | 输入 | 输出 | 缓存读 | 缓存写 |
| --- | ---: | ---: | ---: | ---: |
| `claude-opus-5-5` | 4 | 20 | 0.2 | 5 |
| `decision-model-preview` | 0 | 0 | 0 | 0 |
| `deepseek-v4.1-flash` | 0.283 | 1.131 | 0.006 | 0.283 |
| `deepseek-v4.1-flash-1017` | 0.283 | 1.131 | 0.006 | 0.283 |
| `gpt-6-astra` | 10 | 50 | 1 | 12.5 |
| `gpt-6-sol` | 2 | 10 | 0.2 | 2.5 |
| `kimi-k3` | 2.1 | 10.5 | 0.21 | 0 |
| `kimi-k3.1-pro` | 2 | 10 | 0.2 | 2 |
| `qwen3.7-flash` | 0.165 | 0.66 | 0.033 | 0.206 |
| `qwen3.7-plus` | 0.826 | 3.301 | 0.166 | 1.032 |
| `qwen3.8-flash` | 0.15 | 0.47 | 0.016 | 0.2 |
| `qwen3.8-max` | 1.65 | 4.951 | 0.206 | 2.063 |

图片单位为 USD / 张。这里只展开计费接口实际声明的组合，不生成尺寸与质量的笛卡尔积。

| 模型 | 尺寸 | low | medium | high |
| --- | --- | ---: | ---: | ---: |
| `gpt-image-2` | 1024x1024 | 0.006 | 0.053 | 0.211 |
| `gpt-image-2` | 1024x1536 | 0.005 | 0.041 | 0.165 |
| `gpt-image-2` | 1536x1024 | 0.005 | 0.041 | 0.165 |

`qwen-image-2.1-turbo` 的 `1024x1024` 和 `2048x2048` 均为 `quality=auto`、0.014133 USD / 张。两档同价合并后仍使用真实规格价，不能把缺少顶层统一价解释成免费。

视频单位为 USD / 秒，不能当成 USD / 次。

| 模型 | 480p | 720p | 1080p | 4k |
| --- | ---: | ---: | ---: | ---: |
| `seedance-2-0` | 0.07 | 0.15 | 0.37 | 0.78 |
| `seedance-2-5` | 0.103 | 0.231 | 0.569 | 未报价 |
| `wan3.0-video` | 0.041256 | 0.082513 | 0.165025 | 未报价 |
| `wan3.0-video-prime` | 0.0636 | 0.127199 | 0.254399 | 未报价 |

音频目录如下，暂不进入现有文本、图片或视频榜。它们包含音频 token 和字符等不同计量单位，直接当文本 token 会错价。

- `cosyvoice-v3-flash`
- `cosyvoice-v3-plus`
- `cosyvoice-v3.5-flash`
- `cosyvoice-v3.5-plus`
- `qwen-audio-3.1-asr-flash-message`
- `qwen-audio-3.1-asr-flash-streaming`
- `qwen-audio-3.1-realtime-flash`
- `speech-2.8-turbo`

当前项目未获授权的 `cyber/deepseek-v4.1-flash` 和 `cyber/wan3.0-video` 同样保留为未解析，不因历史费率表里存在价格就展示为可购买。

## 接口与登录

| 数据 | 请求 | 登录要求 |
| --- | --- | --- |
| 当前项目模型与计量器 | `GET /api/products/canopy/api/v1/models` | 项目域名登录 cookie；匿名请求返回 401 |
| 当前有效美元费率 | `GET /api/billing/api/v1/prices?currency=USD&product_id=canopy&page_size=200` | 插件通过同源页面读取；公开计费域名也可匿名读取 |
| 公开美元费率 | `GET https://billing.leaflow.cloud/api/v1/prices?currency=USD&product_id=canopy&page_size=200` | 匿名实测 200，1 个 Canopy 计划、277 条费率 |
| 充值与支付方式 | `https://console.leaflow.net/billing/top-ups/new`，账户 `payment-options` 接口 | 账号登录态；不在插件采价时创建订单 |

计费 GET 接口的 `currency` 是必填参数。省略时实际返回 400：`query parameter "currency" not set`。接口默认分页 50、最多 200，插件显式请求 200，并在 `total_count` 大于已取条目数时停止，避免悄悄截断。

插件通过已有页面 bridge 复用 HttpOnly cookie，不读取或保存 AccessToken，不使用用户手填 Bearer，也不执行远程页面脚本。主目录和辅助价格均成功后，再运行响应解码与归一化。

## 关联与保护

- 先以模型目录确定当前模型和权限，再用 `billing.plan_id`、`meter_lookup_key`、单位及完整维度关联价格。计费表中存在的旧模型不能补进目录。
- 原始单价按 `unit_amount / unit_quantity` 计算；文本再乘 1,000,000。分辨率、质量和尺寸只取实际返回的组合。
- 仅接受当前 USD、按单位、无计费区间的费率。币种、单位、计划唯一性或价格异常时停止，不退回公开精选目录或静态价格。
- `reasoning` 只有与输出同价时才能并入现有输出列；发生异价或新增未知维度时保留未解析。
- 缺失缓存价格留空。目录实际声明为 0 的价格保留为 0，不能把缺失值补成 0。
- 登录失效、辅助价格读取失败和分页缺失均有回归测试。

## 充值口径

`rechargePlans` 保存四档美元面值，`rechargeCurrency="USD"`，人民币比例保持 `rechargeRateVerified=false`、`rechargeAuto=false`。用户自己确认的兑换比例与充值证据不覆盖。

当前系统对未确认充值比例仍有默认 1:1 回退；这是既有计算行为，不是本站人民币实付证据。对比实际人民币成本前，应填写自己的支付实付比例。只有登录表单面值已确认，第三方支付结果仍未验证。

公开活动中的赠金或特定条件折扣不并入通用比例。付款金额、账户到账额和活动赠额需要各自证据，不能用官网模型价格倒推充值汇率。

## 复现与固定样本

- `test/fixtures/leaflow-pricing.json`：28 个当前模型及 277 条原始费率；保留旧费率以测试关联边界，移除账号、余额、会话和响应头。
- `test/fixtures/leaflow-recharge.json`：充值币种、最低金额、快捷面值与支付方式；明确记录未创建订单、未支付、人民币汇率未知。
- `test/golden/leaflow.txt`：固定价格、未解析清单、图片规格与视频单位。
- `test/leaflow.test.js`：经实际采集、归一化和比价函数核验单位、登录边界、异常数据及一次汇率换算。
- `test/price-map.test.js`：规格同价合并时不能使用缺失的顶层价格生成零价。

从 `extension/` 运行：

```bash
node --test test/leaflow.test.js test/price-map.test.js
node scripts/price-map-golden.mjs
npm run verify
npm run verify:clean
```

本地两次只读重放的原始响应与结果在工作区 `out/research/leaflow/`，不随仓库提交。

## 公开资料

- [公开模型页](https://leaflow.net/en/products/models/)
- [公开定价页](https://leaflow.net/en/pricing/)
- [列出在售价格](https://leaflow.cloud/zh-CN/billing/v1/list-prices)
- [支付选项](https://leaflow.cloud/zh-CN/billing/v1/list-payment-options)
- [创建充值的数据契约](https://leaflow.cloud/zh-CN/billing/v1/create-top-up)
