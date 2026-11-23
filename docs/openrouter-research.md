# OpenRouter 插件取证

2026-11-23 实测。站点：`https://openrouter.ai`，采集入口 `/api/v1/models`。

结论先写：OpenRouter 是官方聚合站，模型目录**匿名可读**，价格用美元计价；它自己就是本项目「基准站」的价格来源，所以这个插件的作用不是补一份参照价，而是把同一份目录当成一个真站点参与比价——`priceCurrency: "USD"` + 充值折算之后，它的成本比面值贵 5%，这 5% 正好是充值手续费。

## 接口与登录态

| 探测 | 结果 |
| --- | --- |
| `GET /api/v1/models`（无 cookie） | 200，927 044 字节，477 个条目 |
| `GET /settings/credits`（无 cookie） | 307 → 登录页，收银台必须登录 |
| 采集是否需要登录 | 不需要。目录和价格都在匿名响应里，`credentials: "omit"` |

采集只用一个请求，`decodeResponse` 在归一之前把报文改形（见下）。不需要页面登录态，也不需要 cookie 刷新。

## 目录构成（477 条）

| 类别 | 条数 | 处理 |
| --- | --- | --- |
| 正式条目 | 458 | 全量归一 |
| 浮动别名 `~vendor/x-latest`（带 `alias_target`） | 19 | 丢弃，避免同一个模型多出一行「某个拼写」的价 |
| `:free` 变体 | 12 | 0 价，和付费条目同身份，进表会变成 0 元重复行 → 丢弃 |
| `openrouter/auto` 一类路由占位 | 8 | `prompt`/`completion` 报 -1（无单价）→ 丢弃 |
| 留在目录里出价 | **435** | 展开长度档后 **515 行**（80 行是分档行） |

厂商 69 家；`:batch`（批处理半价）92 条照常当独立模型出价。

字段覆盖：342 个有 `cache_read` 价、116 个有 `cache_write` 价、36 个有 `input_cache_write_1h`；35 个报按张计价的 `image`、38 个报 `audio`、198 个报 `web_search`（每次搜索另收）。后三类不进 token 比价口径，见「已知缺口」。

## 定价口径

- `pricing.*` 的单位是**美元 / token**，四舍五入到 1e-8 美元。乘 `1e6` 换成项目统一的「美元 / 百万 token」。
- 例：`openai/gpt-6.2-astra-pro` 报 `prompt: 8e-6`、`completion: 4e-5` → 归一后输入 `$8`、输出 `$40` / 百万 token。
- 站点标价即官方价，无折扣倍率、无分组。`groups.unlisted = "官方价"` 只做一个占位分组名。

## 分档形状

`pricing.overrides` 有两种，形状不一样：

1. **上下文长度档**（86 条，出现在阈值 32K / 100K / 128K / 200K / 256K / 272K 上）
   每条只给 `min_prompt_tokens` 这个下限，不给上限。直接摊成 tiers 的话每档都是 `[min, +∞)`，pricing 层按单次请求长度选档时会同时命中好几档，同一模型在表里出多行。所以 decode 里补 `max_tokens = 下一档的 min`（开区间上界），最后一档不设上限。
   验：`openai/gpt-6.2-astra-pro` 在 400K/次的请求下只剩一条 offer，价 `16 / 60`；300K 以下走 `8 / 40`。
2. **时段档**（`utc_start` / `utc_end` / `utc_days`，3 个模型、10 条）
   token 规则表达不了时段条件，按已知缺口跳过，基础价照常出。

## 充值口径（登录后实测收银台）

入口 `settings/credits` → Buy Credits。两条路，手续费口径不同：

| 通道 | 面值 | 手续费 | 实付 | 费率 |
| --- | --- | --- | --- | --- |
| 加密支付 | $10 | $0.50 | $10.50 | 5% 固定，无最低 |
| 加密支付 | $100 | $5.00 | $105.00 | 5% 固定，无最低 |
| 信用卡（Stripe） | $10 | $0.80 | $10.80 | 页面自述 5.5%，最低 $0.80（$10 档触底到 8%） |
| 信用卡（Stripe） | $100 | $5.50 | $105.50 | 5.5%，与页面自述一致 |

- 起充 **$10**：输入 5 / 6 / 7 报 `Invalid amount`，输入 10 正常。
- 余额币种就是美元（`Total available` 显示 `$`），1 额度 = $1，**没有任何赠送档位**。
- 没有订阅套餐，只有一次性充值。

## 折算与比价口径

最便宜的路是加密 $10 档：$1 额度实付 $1.05。

项目里 `priceCurrency: "USD"` 的站点，`pricing.currencyToRmb` 把 `rechargeRate` 当「1 美元的元价」。这个价不能写死：写死 7.3 的话，汇率跌到 6.68 时站点成本仍按 7.3 算，基准按 6.68 算，自比凭空多出 9 个点。

所以插件声明 `rechargePremium: 1.05`（1 额度实付 1.05 美元的支付手续费倍率），`rechargeRmb: 1`、`rechargeCredits: 1` 只做占位，计算层 `pricing.rechargeForCurrency` 拿实时汇率乘 premium：

```
1.05 × 实时汇率 = 元 / 美元额度（2026-11-23 的 6.6813 → 7.015）
```

`rechargeRateVerified: true`，三笔实测记在 `rechargePayments`（`paidRmb` 留空，人民币金额按实时汇率折算，不留 7.3 的旧值），`rechargePaymentsVerified: true`。

对表验算（435 条 offer，基准价与站点价都走同一把尺子）：

- 汇率 6.68 与 7.3 两档下，自比都是 `+5%`，即加密充值的支付手续费，不是采集偏差，也不再随汇率漂。
- 参照价按面值折（不含 5%）→ 435/435 条 `diffPercent = 0`。
- 0.26.1 之前添加的站点，`rechargeRate` 里存的是写死的 7.665。`prepareStationInput` 会在站点没有 `rechargePremium` 时套用插件声明的溢价并清掉那条旧常数，升级即时生效，不用删了重建。

## 已知缺口

| 缺口 | 影响 | 现状 |
| --- | --- | --- |
| 时段折扣档（`utc_*`） | 3 个模型在特定时段更便宜，表里只显基础价 | 跳过，注释写在 `decodeModels` |
| `image` / `audio` / `web_search` 按次计价 | 35 / 38 / 198 个模型还有额外计量价 | 不在 token 比价口径内，与其他站点一致 |
| `:free` 变体 | 12 个免费档不在表里 | 与参照价口径一致（同一模型只留付费档） |
| 汇率 | 元价随实时汇率浮，5% 支付手续费是唯一固定溢价 | 已在计算层处理，不再有需要重算的常数 |

## 复现

```bash
# 匿名拉目录（不需要 cookie）
curl -s -o out-openrouter-models.json https://openrouter.ai/api/v1/models

# 长期回归：三条丢弃规则、分档上界、折算口径
node --test test/openrouter.test.js
```

条目数、行数和与参照价的对表结果由临时脚本算（未入库：`.tmp/or-stats.mjs` 出统计，`.tmp/or-diff2.mjs` 出 435×0% / 435×+5%）。

`npm test` 里的 `test/openrouter.test.js` 用 `test/fixtures/openrouter-models.json` 锁住三件事：别名与路由占位被丢弃、长度档补出开区间上界、`:batch` 与主条目各自出价。
