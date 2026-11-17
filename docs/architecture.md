# 项目结构与数据流

浏览器扩展：抓取多个 AI 中转站的模型价格，把同一模型在不同站的价格和倍率对齐，出一张比价表。

## 一条数据从哪来、到哪去

```
站点插件采集          src/site-plugins/providers/<id>.js
  ↓  请求策略          core/provider-registry.js  requestPolicy / localStoragePageAuth / cookiePageAuth / cookieRefreshAuth
  ↓  响应解析          core/adapters.js  normalizeEndpoint + responseFormat 分支
快照（每站一份）      { stationId, models: [{ model_name, price… }], capturedAt }
  ↓
基准参考价            core/openrouter.js  parseOpenRouterData（OpenRouter 模型目录）
  ↓
匹配                  core/matching.js  matchModelWithOverrides
  ↓
比价行                core/pricing.js   buildComparisonRows
  ↓
界面                  dashboard.js / dashboard-pricing.js
```

消息入口在 `src/service-worker.js`：`REFRESH_ALL` / `REFRESH_STATION` 采集，`FETCH_REFERENCES` 拉基准价，`GET_DASHBOARD` 出比价数据，`ADAPT_STATION` 识别站点地址。

## 统一模型是怎么做到的

同一个模型在各站叫法不同（`GLM-5.3` / `z-ai/glm-5.3` / `glm-5.3:thinking`），靠三层收敛，不需要人工维护映射表：

1. **规范模型层** `core/canonical.js` + `core/canonical-table.js`
   表由 `canonical/build.mjs` 生成，入口集合直接靠齐 OpenRouter 的模型列表：每个 OpenRouter 模型一个规范 id（`glm-5-3`），名称与拼写以 OpenRouter 为准，models.dev 的厂商原生写法并进来当别名；OpenRouter 没有的模型不进表（匹配不到基准价格，留着只会白占体积）。查表时先归一：取 id 末段、去 `:free` `@eu` `-v1` `-日期` 这类装饰、小写、空格与 `.` `_` 统一成 `-`。
   → `matchModel` 里作为最高优先级的 `canonical` 规则，把站内写法和基准模型对上。
2. **插件别名** `plugins/<id>/models.json`
   自动归一还是认错时，插件自己声明 `"站内写法": "规范模型 id"`，只影响这个站。
3. **人工覆盖** `modelMatchOverrides`
   用户在界面上确认过的匹配，优先级最高，存进设置里。

统一模型身份不靠 LLM：身份来自规范表，站点差异交给插件别名，个别错配留给人工覆盖。
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