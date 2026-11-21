# 项目结构与数据流

浏览器扩展从多个 AI 中转站采集模型报价，归一报价结构和模型身份后，与 OpenRouter 基准价对齐，生成同模型的比价行。

## 一条数据从哪来、到哪去

```text
plugins/<id>/{manifest.json,plugin.js,models.json}   插件仓库手写源
  ↓ scripts/plugin-build.mjs
src/site-plugins/{providers/<id>.js,catalog.js,...}   扩展仓库生成物
  ↓ 插件激活、站点准备
core/request-strategy.js::resolveStationCollection   解析请求策略与 endpoint
  ↓ service-worker.js::collect
core/collectors.js::collectStation                  按 direct/page 与认证策略请求
  ↓ core/normalizers.js::normalizePricingPayload
规范报价数组 + group_ratio + 计费元数据
  ↓ IndexedDB snapshot
{ stationId, collectedAt, status, source, normalized, rawMeta, ... }
  ↓ service-worker.js::dashboard
最新有效 snapshot + references + 设置中的覆盖/插件别名/AI 缓存
  ↓ core/pricing.js::buildComparisonRows
按模型身份和报价组生成 comparisons/offers
  ↓ dashboard.js / dashboard-pricing.js
筛选、排序、计价模式展示与月成本排名
```

快照的报价数据在 `snapshot.normalized.data`，采集时间是 `snapshot.collectedAt`。`normalized` 还承载 `sourceFormat`、分组倍率和归一诊断；`rawMeta` 保存请求 URL、HTTP 状态及诊断镜像。页面拿到的比价结果由后台从最新 snapshot、基准 references 和当前设置计算，并有短期内存缓存，不是直接读取原始响应。

消息入口在 `src/service-worker.js`：`REFRESH_ALL` / `REFRESH_STATION` 触发采集，`FETCH_REFERENCES` 刷新基准参考，`GET_DASHBOARD` 返回比价数据，`ADAPT_STATION` 识别站点地址。请求策略与页面认证的准备由 `core/request-strategy.js`、插件定义和后台采集协调共同完成；响应格式解析入口是 `core/normalizers.js::normalizePricingPayload`，`core/adapters.js` 主要负责从站点配置推断 adapter，不是报价解析主入口。

## 统一模型是怎么做到的

模型身份通过通用归一、站点别名、人工确认和可选 AI 缓存逐层解析。实际匹配优先级如下：

1. **人工覆盖** `modelMatchOverrides`：用户确认的站点写法映射，优先级最高。
2. **插件别名** `plugins/<id>/models.json`：仅覆盖该站点声明的拼写。
3. **AI 匹配缓存** `llmMatchCache`：已接受的站点写法与官方模型映射；它是独立缓存，不写入人工覆盖。
4. **规范模型匹配**：`core/canonical.js` 使用 `canonical-table.js` 将常见路径、版本和装饰写法归到规范身份。
5. **内置规则**：精确、后缀、忽略版本、模糊匹配，作为兜底。

前四层的入口是 `core/matching.js::matchModelWithOverrides`；规范模型与内置规则在 `matchModel` 中处理。规范表由 `canonical/build.mjs` 生成，OpenRouter 提供可比价的模型身份，models.dev 补充厂商原生别名。AI 只提供经过缓存的可选辅助判断，不能替代规范身份；站点专属差异优先放插件别名，用户纠正放人工覆盖。

## 按次计费与充值阶梯怎么进比价

按次计价的站（`quota_type` = 1，`model_price` 是「一次」的价）不能直接塞进按 token 的混合单价里，否则会把按次成本摊进 token 分母，得出一个没有意义的数。约定如下：

- **标模式不分表**：`core/pricing.js` 给每条报价打 `billingMode`（`token` / `request` / `image`），三类都进同一张主表，展示时按模式换算法。用户明确要求不要拆成独立区块：分开放很丑，合起来只是算法不一样。
- **单价单元格分派**：`dashboard.js` 的 `priceCellMarkup` 按 `billingMode` 选渲染器 —— `priceGridMarkup`（按 token，两行费用项加柱状图）、`requestPriceGridMarkup`（按次，单次价加折算 / 平衡点 / 你的单次）、`imagePriceGridMarkup`（按张，站内元/张对基准元/张加折合）。中转站列用 `billingModeTagMarkup` 补「按次」「按张」小标签。
- **按张计费**：站点只报了 `image_price`（元/张）、没有任何 token 维度的价时判成 `image`。这种报价的 token 成本恒为 0，摊进混合单价会显示成 `¥0.0000` 加「低 100%」，所以不参与混合单价和价差，用「站内元/张」对「基准元/张」比，基准值取 OpenRouter `pricing.image` 乘汇率；没填图像请求数时不算月成本，只提示去填。
- **折算**：`requestUnitPriceOf(requestRmb, tokensPerRequest)` 把单次价摊成每百万 token 价，分母是「一次请求平均多少 token」。这个值优先取站点自己配置的 `billingProfile.tokensPerRequest`，没配就退回全局估算用量，并在界面上标「估算」。
- **与按量比的可比性**：折算后按次也落在元/1M，可以和按量报价同列排序（`unitPriceSortValue` 用 `requestUnitPrice`）。按张是元/张，量纲不同，排序时置 `null` 落末尾。
- **平衡点**：`breakEvenTokens` = 同模型按量报价的单价换算出的临界单次 token 数。一次跑得比它长，同组按量报价更便宜。
- **充值阶梯**：站点可配 `rechargeTiers: [{ amount, credit }]`，`pickRechargeTier()` 按估算月用量挑**刚好覆盖**的最小一档，`monthlyCostPaid` = 面值月成本 × 该档折扣。主表的月成本、同模型名次、柱长全部按实付金额走，不混用面值。
- 站点已经在自身价格里折过充值比例时，`billingProfile` 会被标记，避免二次打折。


## 目录职责

| 路径 | 职责 | 能不能手改 |
| --- | --- | --- |
| `../plugins/<id>/` | 站点插件唯一手写源（插件仓库） | 是 |
| `src/site-plugins/providers/` | 由 `../plugins/` 生成 | 否 |
| `src/site-plugins/catalog.js` | 首页站点目录，生成物 | 否 |
| `src/shared/plugin-order.js` | 站点排序，生成物 | 否 |
| `src/shared/provider-logos.js` | 模型图标数据（models.dev + simple-icons），生成物 | 否 |
| `src/core/canonical.js` | 规范模型归一逻辑 | 是 |
| `src/core/canonical-table.js` | 规范模型表，生成物 | 否 |
| `canonical/build.mjs` | 规范表生成器（靠齐 OpenRouter 列表，models.dev 补别名） | 是 |
| `scripts/plugin-build.mjs` | 插件构建器 | 是 |
| `scripts/model-lookup.mjs` | 查规范模型 id 的小工具 | 是 |
| `scripts/provider-logos.mjs` | 品牌图标抓取生成器 | 是 |
| `src/core/` | 采集、匹配、比价、存储、凭据 | 是 |
| `test/` | 全部测试 | 是 |

## 两个仓库（已落地）

形态：**扩展仓库**（本仓库：核心、UI、构建脚本、文档）＋ **插件仓库**（[`napstablook666/ai-price-analyzer-plugins`](https://github.com/napstablook666/ai-price-analyzer-plugins)，一个站点一个目录）。插件源码不引用扩展内部相对路径，只写 `@app/core/…`、`@app/shared/…`，构建时改写成真实路径，目录搬走后零改动。

- 工作区里两个仓库并排：`extension/`（本仓库）与 `plugins/`。扩展仓库不跟踪插件文件，构建器默认读上一级的 `plugins/`，签出到别处时用 `PLUGIN_DIR` 指过去。
- `PLUGIN_DIR=/path/to/plugins node scripts/plugin-build.mjs --check` 可校验任意外部插件源与扩展内生成物是否同步。
- 扩展侧 `site-plugins.test.js` 继续盯生成物漂移；插件的目录契约（manifest / plugin.js / models.json、字段白名单）由 `plugin-build.mjs` 兜住。

## 常用命令

```bash
npm test                                  # 全部扩展测试
node scripts/plugin-build.mjs              # 改完 plugins/ 后重新生成
node scripts/plugin-build.mjs --check      # 只校验漂移
node scripts/model-lookup.mjs claude 4.6   # 查规范模型 id
node scripts/provider-logos.mjs            # 重新抓品牌图标并生成 provider-logos.js
node canonical/build.mjs --offline         # 用缓存重算规范表（联网可去掉 --offline）
npm run version:patch                      # 扩展版本号同步
```

## 验证标准

改任何一层之后至少要满足：

- `npm test` 全绿。
- `node scripts/plugin-build.mjs --check` 无漂移。
- 采集链路：首页能加站点、能采集、比价表里模型有数；模型名改了写法之后仍然归到同一行。
- 设置里带旧字段（如 `llm` / `jev` / `modelMatchOverrides`）的历史数据能正常加载，不报错、不丢覆盖。