# 生态 🌐

扩展不自己发明标准，价格和模型身份尽量对齐现有的公开来源。

## 模型身份

| 来源 | 作用 |
| --- | --- |
| [OpenRouter](https://openrouter.ai) | 规范模型表的身份入口集合 |
| [models.dev](https://models.dev) | 补厂商原生写法的别名 |

规范模型表只收 OpenRouter 收录的身份，models.dev 独有的身份以别名并进相邻组。规则见[规范模型表](./development/canonical)。

## 价格数据

| 来源 | 作用 |
| --- | --- |
| OpenRouter 模型列表 | 基准价的补充参考 |
| [ExchangeRate-API](https://www.exchangerate-api.com/) / [Frankfurter（ECB）](https://frankfurter.dev/) | USD/CNY 每日参考汇率，主源失败后使用备用源 |
| 各中转站自己的接口/页面 | 站点实际报价 |

汇率拉不到时沿用最近成功的缓存并显示警告，不阻塞界面；从未成功获取过时标为应急估算。支付渠道的实际换汇价单独填入该站充值配置。

## 站点知识

采集逻辑放在独立仓库 [ai-price-analyzer-plugins](https://github.com/napstablook666/ai-price-analyzer-plugins)，一个站点一个目录：

```
plugins/<id>/manifest.json    名称、域名、标签
plugins/<id>/plugin.js        接口、解析、登录方式
plugins/<id>/models.json      模型别名
```

构建脚本把它生成到 `src/site-plugins/`。协议见[扩展侧插件协议](./plugin-development)。

## 贡献

- 新站点：提 PR 到插件仓库，只动 `plugins/<id>/`。
- 核心逻辑：改 `src/core/`，带测试。
- 文档：改 `docs/`，跑一次 `npm run docs:build`。

## 相关

- [开发总览](./development/)
- [架构与数据流](./architecture)
- [发布流程](./development/release)