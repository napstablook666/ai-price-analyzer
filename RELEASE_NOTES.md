# AI Price Analyzer v0.23.0

## 新功能

- **新增 eapi 插件。** 匿名读取 `https://eapi.site/api/pricing`，收录 41 条模型报价：33 个按 token 计价、8 个按张计价的图像模型。按 token 的报价取报文里的折后单价（`model_ratio × 2`，与 `input_price_micros` 逐条复算一致），按张的取 `model_price`，不另乘折扣。
- **新增 moonup 插件。** 订阅制 API 转换平台，直接采公开模型广场；分组倍率取报文自带字段，图像模型按 1K / 2K / 4K 档报单价，fast 通道价单独取字段，不猜。
- **充值比例写实。** eapi 在登录态钱包接口取到 `fxRateUsdCny=7`：CNY 档 ¥20 到账 $2.857143 额度，即 **¥7 = $1 额度**，无档位折扣。moonup 的充值接口匿名 401，记为未验证，不写比例、不参与折算。

## 计费口径

- eapi 的 `cache_*_price_micros` 字段恒等于输入价，与 `cache_ratio` 矛盾，判为站点展示层坏字段；缓存读写价按 `cache_ratio` / `create_cache_ratio` 从输入价推算，与站点文档示例逐项吻合。
- `deepseek-v4.1-flash` 有闲时/忙时两档，插件取报文头部当前生效价，忙时价格翻倍由站点自行切换。
- 规范模型表按缓存重建；gpt-image-2.5 / 2.6 一类图像模型允许以 models.dev 来源进场，避免整族落进未匹配。

## 兼容性

- 无新增扩展权限。
- 站点域名继续由插件目录决定，加站不需要重新申请权限。
- 旧设置里的手动充值比例与充值方案照旧保留。

## 附件

- `ai-relay-price-extension-v0.23.0.zip`：可直接加载的扩展目录包。
- `ai-price-analyzer-v0.23.0-source.zip`：扩展与插件两仓的源码快照。
- `SHA256SUMS.txt`、`update.json`、`update.ps1`：校验与签名更新清单。
