# Leaflow Canopy 插件取证

核验日期：2026-11-21。入口为用户提供的[项目模型页](https://01a1fe61-12f8-7a6f-9b6f-8e6ffadd40aa.leaflow.net/products/canopy/models)。以下价格是本次目录快照，插件采集时重新读取接口，不使用本文作为报价兜底。

## 结论

- 登录后的完整目录为 **28 个模型**：12 个文本、2 个图片、4 个视频、8 个音频，以及 2 个当前项目未获授权的 `cyber/` 模型。
- 本次可生成 **18 个模型、35 条报价**。图片按规格展开，视频按分辨率展开；Qwen 图片的两种尺寸同价，沿用核心合并规则。8 个音频和 2 个受限模型保留在未解析清单中，不冒充文本报价。
- 完整目录需要浏览器登录态。公开产品页只有 8 个精选模型，不能作为完整目录。独立美元价格表可匿名读取，但它含有未上架的历史模型，不能单独决定在售列表。
- 登录充值页使用 **USD**，最低充值 **1 USD**，快捷面值为 **10 / 50 / 100 / 500 USD**；当前账户提供 Stripe 银行卡、支付宝。
- 补验支付宝收银台报价为 **10 USD 面值对应 67.18 CNY**，按最终金额折算 **6.718 CNY / USD 额度**；收银台显示的未取整汇率为 **6.71849**。这只是 2026-11-21 的待支付报价，不能覆盖全局每日市场参考汇率。

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

`rechargeCurrency="CNY"` 展示人民币成本，`rechargeRmb=67.18`、`rechargeCredits=10` 保存本次收银台比例；`rechargePlans` 仍保留 10 / 50 / 100 / 500 **USD 面值**，不把四档面值冒充人民币报价。`rechargePayments` 只记录 10 USD 的支付宝人民币报价。`rechargeRateVerified=true`、`rechargePaymentsVerified=true` 表示该次报价证据已核实，不表示支付成功或汇率恒定；`rechargeAuto=false`，不因采价而创建订单或额外访问支付接口。

- **实付依据**：用户提供的支付宝收银台显示订单金额 67.18 人民币（10.00 美元），显示汇率 1 美元 = 6.71849 人民币。最终人民币总额保留两位小数，成本比例取 `67.18 / 10 = 6.718`，不再乘全局市场参考汇率。
- **订单状态**：只读复查唯一已有订单，接口返回 `amount="10.0000000000"`、`currency="USD"`、`method_type="alipay"`、`status="failed"`、`failure_reason="payment_intent_payment_attempt_expired"`。截图不含订单标识，不仅凭同额同渠道认定它与已有订单为同一笔。本轮未新建订单、未支付，报价不是成功扣款或到账证明。
- **手续费**：充值表单抽查 1 / 10 / 50 / 100 / 500 USD，未显示阶梯折扣或单列手续费；支付宝截图也未单列手续费。`feeRate` 保持缺省，不能把未披露写成零费率，不能在 67.18 元总额上重复加手续费。银行卡人民币结算、发卡行费用及其他面值的人民币总额未核验，不生成相应渠道报价。截图中的花呗分期利息另算，不并入一次付款比例。
- **通用赠额**：当前账户 `credit-grants` 返回空列表，充值表单未发现通用“充 X 送 Y”或大额折扣，`rechargeTiers=[]`；这不是对所有账户或未来活动的零赠额承诺。

[官网活动页](https://leaflow.net/en/campaigns/)列出的权益不符合通用充值档位，保留条件，全部排除在通用比例和模型成本之外：

| 活动 | 条件与额度 | 有效期 |
| --- | --- | --- |
| 新手任务 | 注册 30 天内的 USD 账户；创建服务器并加入 Fleet 后获 1 USD Canopy 赠金，激活 Canopy 获 5M token，部署网站再获 20M token；token 限 `deepseek-v4.1-flash` | 入账后 7 天 |
| Shipping AI 次日返还 | 仅 `deepseek-v4.1-flash` 指定使用；基础返 50%，邀请最多升至 90%，次日手动领取，日上限 10M 至 100M token | 24 小时；活动截至 2026-12-02 00:00 UTC+8 |
| 邀请 | 被邀请用户领取 5M 指定模型 token，每用户和结算账户限一次 | 24 小时 |
| 体验分享 | 内容公开并人工审核；服务器天数、指定 token 或限定赠金，不随充值金额自动赠送 | 依奖励为 24 小时或 30 天 |
| 旧余额迁移 | 匹配旧账户后恢复历史余额，不是充值赠送 | 6 个自然月 |

只自动升级首版未核实的默认 1:1 记录和空白新记录；用户自定义比例、备注、折扣、方案、周期标志和渠道证据原样保留。渠道总额直接用于成本折算，不重复乘手续费、市场汇率或赠额系数。

## 复现与固定样本

- `test/fixtures/leaflow-pricing.json`：28 个当前模型及 277 条原始费率；保留旧费率以测试关联边界，移除账号、余额、会话和响应头。
- `test/fixtures/leaflow-recharge.json`：美元面值、支付宝人民币报价、已有订单超时状态、手续费未知边界和条件赠额；移除账号、订单标识、银行信息与会话。本轮只读，不新建订单、不支付。
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
