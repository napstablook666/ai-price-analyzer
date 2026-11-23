# AI Price Analyzer v0.25.0

## 新功能

- **新增 17 家中转站插件。** 插件总数从 39 涨到 56：
  - 匿名直连 9 家：`kuaipao`、`pqh`、`0ait`、`4zapi`、`xkrelay`、`zerocat`、`corecode`、`coderelay`、`packycode`。
  - Undy API（`undying`）：88 个模型、75 个分组，匿名定价直连。
  - 需要登录的 7 家：`abuapi`（245 模型 24 分组）、`initapi`（53 模型 13 分组）、`axis`（58 模型 6 分组）、`yescode`（61 模型 10 分组）、`crab`（6 模型 2 分组）、`rightcode`（111 模型 13 个上游）、`nexaix`（7 模型 2 分组）。
- **两套新解析器。** `sub2api-model-plaza` 吃 `data.groups[].models[]` 结构（初元、元流、Crab 走这条）；price-map 引擎新增 `expand` 规则，支持 `upstreams[].models[]` 这种两层数组，Right Code 靠它把上游名当分组名。

## 计费口径

- **按用量分档合成一行。** 上下文长度档（`<200K` / `>200K`）不再并列成多行，一个模型只出一行，取当前单次请求长度命中的那一档。长度取自站点画像的 `tokensPerRequest`，没配就用估算用量的均值（计费 token 总量 ÷ 请求次数），都没有时退回最低档。改用量或改画像长度，这行会跟着换档。
- **时段分档各自成行。** 站点按时间段报价时，每个时段一行，标签形如 `工作日 09:00–18:00 ×1.5`。sub2api 的 `time_pricing.periods` 与表达式里的 `weekday()` / `hour()` 三元分支都走这条规则，不做加权。
- **顺带修掉一处系数丢失。** AbuAPI 的 tier 参数自带括号，形如 `tier("peak", (p*2+c*8+cr*0.04))`，旧解析器遇到 `(p*2` 匹配不上 `p`，整条输入价丢失，`deepseek-flash` 解析出来输入价是 0。现在先剥外层括号和顶层倍率再取系数，该站从 609 行 / 7 个未解析变成 633 行 / 5 个未解析。

## 识别与匹配

- **模型漏答不再算报错。** 发给模型的候选里，响应缺了某个模型（模型没答这条）以前记 `failed`，界面显示「失败：模型没答这条」并计入失败统计。现在按「清单里没有」处理，归到待确认，可以人工指定或重试。接口报错与请求超时仍记失败，两者原因分开写。旧缓存里的漏答记录读出来按新口径处理，不用清缓存。

## 破坏性变更

- v0.24.0 的说明里写过「长上下文两个档位都保留，不合并取一档」。这条作废，现在合成一行。想看两个档的差价，把站点画像里的单次请求长度改成跨阈值前后的值，切回面板即可看到换档。

## 兼容性

- 无新增扩展权限，站点域名继续由插件目录决定。
- `initapi` 需要登录：插件读页面 localStorage 里的 `auth_token`，检测不到就直接失败并提示先登录，不猜。`abuapi`、`axis`、`yescode`、`crab`、`rightcode`、`nexaix` 目前匿名可读。
- `nexaix` 的币种与充值口径未验证（`nexaix.ai` 在部分网络下直连不通），插件里标了 `rechargeRateVerified: false`，数据能取到但折算依据待核。

## 附件

- `ai-relay-price-extension-v0.25.0.zip`：可直接加载的扩展目录包。
- `ai-price-analyzer-v0.25.0-source.zip`：扩展与插件两仓的源码快照。
- `SHA256SUMS.txt`、`update.json`、`update.ps1`：校验与签名更新清单。
