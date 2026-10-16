# 普通站点范围扩展记录

## 用户确认

用户确认：不只有 T蜜，其他普通中转站也出现“币种待核验”；所有未明确列入 KillAI、fuck-everyone 等未核验 provider 的站点，都按项目约定的 `CREDITS` 处理。

## 实现约束

- 普通站点和无注册 provider 的普通站点统一 `priceCurrency: "CREDITS"`、`priceCurrencyVerified: true`。
- 未核验 provider 通过 provider registry 显式标记保留 false，不靠 dashboard 标签或 pricing 全局兜底。
- refresh 与 dashboard 必须共用 prepared station。
- NORMALIZATION_VERSION 从 23 增到 24。
