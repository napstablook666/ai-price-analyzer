# 生图与视频字段 📐

本项目只做文本模型比价。生图和视频的报价仍然会被采集下来，但不进比价表、不参与月成本、不出页签。

## 采集侧还在解析什么

插件的 `PRICE_MAP` 和 `src/core/media.js` 照旧认这些字段，因为站点报价本身就长这样，不解析等于把同一张卡片里的文本报价一起丢掉：

| 字段 | 取值 | 用在哪 |
| --- | --- | --- |
| `media_type` | `text` / `image` / `video` | 只用来判定「这条是不是文本」，非 `text` 一律丢弃 |
| `request_unit` | `token` / `次` / `张` / `second` / `megapixel` | 同上，`second` / `megapixel` 直接判非文本 |
| `image_price` / `image_output_price` | 元/张、元/1M 图输出 token | 保留在归一结果里，比价层不再读 |
| `per_second_prices` / `cost_per_second` | 元/秒 | 保留在归一结果里，比价层不再读 |
| `media_specs` | 尺寸、分辨率、音轨、模式枚举 | 保留在归一结果里，比价层不再读 |

## 比价侧怎么拦

`src/core/pricing.js` 的 `buildComparisonRows` 在入口处调用 `mediaTypeForPricing()` 判定，判定为非文本的条目整条跳过，`mediaType` / `mediaSpecs` / `mediaUnitPrice` 都不再写进报价行。所以下游不需要任何「遇到生图怎么办」的分支：`billingMode` 只有 `token` 和 `request` 两种。

## 为什么留着解析

删掉解析会让插件里的 `media_type`、`per_second_prices` 声明变成死配置，站点改版时也看不出是哪一类报价没读进来。解析是数据层的活，比价是产品口径的活，两者分开：哪天要恢复生图比价，接的是 `mediaTypeForPricing()` 这一处开关，不是重新写一遍采集。

## 相关

- [价格映射文档](./price-map)
- [规范模型表](./canonical)
