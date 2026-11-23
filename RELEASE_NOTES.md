# AI Price Analyzer v0.22.0

## 新功能

- **新增 velamost 插件。** 匿名读取 `https://velamost.com/api/pricing`，收录 126 条模型报价、7 个公开分组，价格以美元展示，分组倍率取自报文自带的 `group_ratio`，与页面「起」价逐项一致。
- **分组倍率口径沿用站点公开报文。** 页面起价等于报文单价乘最小启用分组倍率，插件不另写换算常数，换分组或改倍率时跟着报文走。

## 充值与计费证据

- velamost 的充值档位接口（`/api/user/topup`、`/api/user/self`）匿名返回 401，记作未验证，不写充值比例，不参与充值折算。
- 模型单价只采公开的 `/api/pricing`，需要登录态的接口一律不碰。
- 按模型的分组起价与页面渲染价对齐，`claude-sonnet-5` 在 `Claude- lite` 分组为入`$2.7`/出`$13.5`，`gpt-5.4-mini` 在 `official-lite` 分组为入`$225`/出`$1350`，`gemini-4-carbon` 为入`$1.8`/出`$9`。

## 兼容性

- 无新增扩展权限。
- 站点域名继续由插件目录决定，加站不需要重新申请权限。
- 旧设置里的手动充值比例与充值方案照旧保留。

## 附件

- `ai-relay-price-extension-v0.22.0.zip`：可直接加载的扩展目录包。
- `ai-price-analyzer-v0.22.0-source.zip`：扩展与插件两仓的源码快照。
- `SHA256SUMS.txt`、`update.json`、`update.ps1`：校验与签名更新清单。