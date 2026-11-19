# 价格映射文档 📐

映射分两层。`src/core/price-maps/<形状>.js` 描述一种报文形状（`base`），注册在 `PRICE_MAP_BASES` 里；站点自己在 `adapter.priceMap` 里声明用哪个 base、覆盖哪几个字段。**只是字段名不同，写声明，不动代码。** 形状真的不一样，才加一份 base。

`src/core/price-map.js` 是解释器，不含任何站点的名字。

## 为什么

原来 `src/core/normalizers.js` 里一个站点一个 `ParsingStrategy` 子类，字段名写死在 `parse()` 里。站方把 `model_ratio` 改成 `ratio`，就得发版。

现在把「字段名 → 语义」抽成数据，代码只负责按规则取值、套倍率、算表达式。

## 文档结构

```js
export const tokenfluxPriceMap = {
  schemaVersion: "price-map/1",
  source: "tokenflux",
  rootPath: "/data",                 // 模型数组的位置
  nameField: "model_name",
  labelField: "model_name",
  currency: "USD",                   // 缺省币种，行上带的优先；见下文「币种怎么定」
  groups: {                          // 分组倍率怎么读
    listPath: "enable_groups",
    ratioPath: "/group_ratio",
    usablePath: "/usable_group"
  },
  rules: [ /* 按顺序匹配，第一条命中的生效 */ ]
};
```

`rootPath`、`groups.*` 都是 JSON Pointer，也可以写成 `data.0.pricing` 这种点号路径。

分组还有一种摆法：模型只带一个外键，分组名和倍率在站点另一处的数组里，两边分开存。这时把 `groups` 写成查表式，`listPath` 换成 `lookupPath`：

```js
groups: {
  lookupPath: "/data/groups",   // 分组表在哪
  keyPath: "id",                // 表里哪一列是主键
  refPath: "group_id",          // 模型身上哪一列是外键
  namePath: "name",
  ratioPath: "rate_multiplier"
}
```

外键查不到就记 `unresolved`，不退回默认倍率——分组名都不知道，报出来的价没意义。

外键写成数组时是一对多：一份价挂好几个分组，每个分组按自己的倍率各出一行。

```js
refPath: "group_ids"   // 模型身上是 [46, 180]
```

### 倍率可以分层

分组倍率不一定只有一个字段。常见的两种分叉：促销期压过常规价、图片单独定倍率。这时把 `ratio` 写成链，从前往后试，第一条取到数的生效：

```js
groups: {
  lookupPath: "/data/groups",
  ratio: [
    { when: { path: "promo_active", equals: true }, path: "promo_rate_multiplier" },
    { path: "effective_rate_multiplier" },
    { path: "rate_multiplier" }
  ],
  // 站点开着图片独立倍率时，图片价按这个算，文本价不变
  mediaRatio: [
    { when: { path: "image_rate_independent", equals: true }, path: "image_rate_multiplier" }
  ]
}
```

`mediaRatio` 管三类价：出图模型的按张价（`request` 规则、`unit: "image"`）、token 规则里的 `imageInput` / `imageOutput`。取不到就退回 `ratio`，所以不做图片独立定价的站点不用写。反过来，站点给了开关却没人读，图片价会被文本倍率打折，5 倍差价能把一个站错送上榜首。

## 规则的四种 kind

### `token`

按 token 计费，价格单位是每 1M token。

```js
{
  kind: "token",
  input: "model_ratio",
  output: "model_ratio * completion_ratio",
  cacheRead: "model_ratio * cache_ratio",
  cacheWrite: "model_ratio * create_cache_ratio",
  mediaType: { path: "supported_endpoint_types", map: { "image-generation": "image" } },
  mediaSpecsPath: "billing_usage_schema",
  tierName: "标准"
}
```

冒号后面是表达式，不是字段名。`model_ratio` 就是字段，`model_ratio * completion_ratio` 是算出来的。


上下文长度分档用 `tiers` 声明，档位数组里每一项单独出价，一档一行：

```js
{
  kind: "token",
  input: "effective_pricing_usd.input_per_mtok_usd",
  output: "effective_pricing_usd.output_per_mtok_usd",
  tiers: {
    path: "pricing_details.intervals",
    nameField: "tier_label",
    minField: "min_tokens",
    maxField: "max_tokens",
    input: "input_per_mtok_usd",
    output: "output_per_mtok_usd",
    cacheRead: "cache_read_per_mtok_usd",
    cacheWrite: "cache_write_per_mtok_usd"
  }
}
```

`tiers` 里的表达式对着**档位对象**求值，规则顶层的对着**整条模型记录**求值，两条路互不干扰。数组缺失或一档都算不出来时，退回顶层那一组表达式只出一行。

按长度分档写 `tier_name`，出图 / 视频的规格档（1K / 2K / 4K）写 `size_tier`，两者互不干扰：前者参与上下文分档的流量加权，后者只是这一行的规格标签，用来跟官方 `variant` 对齐。

站点没给 `completion_ratio` 时，按 `output / input` 推，不硬写 1。

`ratioBase` 是 `model_ratio` 一个单位值多少（美元 / 1M token）。New API 派生的一族站点里，`model_ratio` 是「官方价 ÷ 2」这类相对倍率，换算系数由站点自己定。引擎的缺省值就是系统基准 `SYSTEM_BASE_PRICE_PER_1M`（2 美元/百万），所以这一族站点不用声明，规则里只写 `model_ratio`：

```js
// price-maps/tokenflux.js：缺省即 2 美元/百万，不写 ratioBase
{ kind: "token", input: "model_ratio", output: "model_ratio * completion_ratio" }
```

站点偏离基准时在自己的声明里写 `ratioBase`（如 `{ base: "tokenflux", ratioBase: 1 }`），引擎会把它下发到每条 token 规则，不必复制整份 `rules` 数组。

这个缺省值原先写死成 1，和系统基准对不上：同一个常数散在四处表达式和一处声明里，改一边忘一边就整站报低一半。2026-11-19 就是这样发现的，tokenflux 系的 `model_ratio` 一直按 ×1 算，倍率行的价全是真实价的一半。现在常数只剩 `SYSTEM_BASE_PRICE_PER_1M` 一处，`test/price-map.test.js` 用官方 sonnet 价（ratio 1.5 必须出 $3）把它钉住。

图片 token 价（图片输入、图片输出）和「写缓存 1 小时」价也能一起带出来，各写一行：

```js
{
  kind: "token",
  input: "input_price * 1000000",
  output: "output_price * 1000000",
  cacheRead: "cache_read_price * 1000000",
  cacheWrite: "cache_write_price * 1000000",
  cacheWrite1h: "cache_write_1h_price * 1000000",
  imageInput: "image_input_price * 1000000",
  imageOutput: "image_output_price * 1000000"
}
```

`imageInput` / `imageOutput` 走分组里的图片倍率（见下面的 `mediaRatio`），其余走文本倍率。站点不做图片独立定价时，两者是同一个数，写不写没区别。
### `request`

按次计费。出图按张、视频按秒都走这条，区别只在 `unit`。

```js
{
  when: [{ path: "supported_endpoint_types", contains: "image-generation" }, { path: "model_price", gt: 0 }],
  kind: "request",
  price: "model_price",
  unit: "image",
  mediaType: "image",
  sizeTiers: { path: "image_billing_rule.resolution_tiers", nameField: "name", factorField: "ratio" }
}
```

`sizeTiers` 存在时，一行摊成多行。档位价有两种写法：给倍率的填 `factorField`，`image_price = model_price × 倍率`；直接给这一档多少钱的填 `priceField`，`image_price` 就是那个数。站内给了 1K / 2K / 4K，就用站内的，不从图像尺寸反推。

分出来的几档要是同一个价，会并回一行，不把同一笔钱重复记三遍。只有价格真的拉开才拆。

`unit` 可以是字符串、单个候选、或候选数组：

```js
unit: [
  { path: "supported_endpoint_types", map: { "video-generation": "second" } },
  { path: "billing_usage_schema.seconds", present: "second" },
  { fallback: "request" }
]
```

按顺序试，`fallback` 兜底。这样同一份文档能同时覆盖「按张」「按秒」「按次」三种站。

### `expression`

价格由字符串表达式给出，通常带上下文长度分段。

```js
{ when: { path: "billing_expr", present: true }, kind: "expression", exprPath: "billing_expr" }
```

表达式里的变量从模型对象取，形如 `x` 或 `x / 1000`。标识符可以写点路径和下标，`effective_pricing_usd.input_per_mtok_usd`、`intervals[0].output_per_mtok_usd` 都按整串当路径读，不用先取值再算。

只认数字、标识符、`+ - * /`、括号。函数调用、模板串、运算符以外的东西一律报错。标识符只查自己这一层的键，原型链上的 `constructor` 之类摸不到，也不会被执行。写不了的事不要硬写，回退成 `token` 规则。

### 条件 `when`

单个对象或数组。数组是与关系。

| 写法 | 含义 |
| --- | --- |
| `{ path: "x", present: true }` | 字段存在 |
| `{ path: "x", equals: 1 }` | 等于（宽松比较数字字符串） |
| `{ path: "x", gt: 0 }` | 大于 |
| `{ path: "x", contains: "y" }` | 数组包含或字符串包含 |

没有 `when` 的规则永远命中，所以它必须是最后一条。

## 单位与媒体类型

`unit` 只能是 `image` / `token` / `megapixel` / `request` / `second`。
`mediaType` 只能是 `image` / `video`，解析不出来就是不标（文本）。

词表外的单位不丢，挂到 `raw_unit` 原样显示、不参与排序。宁可显示「元/次（原样）」，也不猜。

### 币种怎么定

`currency` 写的是「行里这些数字用哪种货币标的」，只从站点定价页读，不看「充值 1 元换多少额度」那句营销话术。2026-11-19 在 ego-lite 里数符号定下来的：

| 站点 | 定价页 | 声明 |
| --- | --- | --- |
| tokenflux.cloud | 57 个 `$`，0 个 `¥` | USD |
| maolaoapi.com | 44 个 `$`，0 个 `¥` | USD |
| ai.centos.hk | `¥3 / 1M` | CNY |

它只决定换算系数：`CNY` 固定 1，`USD` / `CREDITS` 取充值倍率（`rechargeRmb / rechargeCredits`，来自站点 `/api/status` 的 `price`）。所以充值是 1:1 的站改币种不动数字，标的数字照样是错的：哪天站点改成 1 元买 0.8 美元额度，币种写错就会整站报错价。

倍率族站点跟着基座取 USD，按人民币标价的站点在自己的声明里覆盖，例如 `{ base: "tokenflux", currency: "CNY" }`。
## 取值纪律

数字一律从原始 payload 读，任何环节都不重新构造。

- `readPath` 取不到就是 `undefined`，绝不退化成 `0`。否则「不知道价格」会变成「免费」。
- 表达式缺变量返回 `null`，落成 `input_price: null`，不是 `0`。
- 分组在 `enable_groups` 里但 `group_ratio` 里没倍率，这个模型进 `unresolved`，不出行。按 1 算会把价格报高，按 0 算会报成免费。
- 没有任何规则命中的模型同样进 `unresolved`，不静默丢。


按次规则的顶层价可以缺，只要 `sizeTiers` 每一档自带绝对价（`priceField`）。有的站点只给 1K / 2K / 4K 三档价，不给统一价，这时不该整条丢掉。

现有的 base：`tokenflux`、`newcodex`、`allrouter`、`relayrouter`、`stellaisle`、`stellaisle-plaza`、`stellaisle-carpool`、`cheaprouter`、`true-sota`、`sidrune`。`newcodex`、`allrouter`、`stellaisle` 三份是在 `tokenflux` 上展开再改几个键，其余各有各的报文形状。

同一个 New API 报文，字段名不一样的站点各写一份映射就行。`relayrouter` 这一份就是样板：缓存写拆成 `cache_creation_5m_ratio` / `cache_creation_1h_ratio`，用数组写成回落链，老字段 `cache_creation_ratio` 排在后面兜底；长上下文档位在 `step_ratios` 里，档内表达式可以回落读父级记录，所以模型倍率只写在外层。
`unresolved` 会上浮到 `unsupportedBillingModes` 和 `unpricedModels`，在站点卡片上看得见。

## 新增一个站点

1. 抓一份真实 payload 存到 `test/fixtures/<站点>-pricing.json`
2. 报文能和现有 base 对上，就在插件 `adapter.priceMap` 里写 `{ base: "<base>", source: "<站点>", currency: "USD", rules: { … } }`，只写要覆盖的键
3. 对不上，才新增 `src/core/price-maps/<形状>.js` 并在 `index.js` 的 `PRICE_MAP_BASES` 里注册
4. 用旧实现和新实现逐字段对比，差异归零后再切

第 4 步不能省。`test/price-map.test.js` 里的 fixture 断言只保证口径对，逐字段对比才保证不丢字段。补了 fixture 的新 base 还要 `node scripts/price-map-golden.mjs --update`，把快照一起提交。

## 退役的枚举值

`responseFormat` 一度给每个同形状站点各留一个值（`newcodex`、`allrouter`、`relayrouter`）。引擎上线后这些值只剩兼容作用，现在改成「读到就迁移」：

- `LEGACY_RESPONSE_FORMATS` 记着旧值对应的新声明
- `normalizeStation` 在归一化时把旧值就地改写成 `price-map` + `priceMap`，存储里不再留旧值
- 站点下一次保存设置也会写成新形态

摘除条件写在 `src/core/response-formats.js` 的注释里：发满两个 minor，或确认不再有人带着旧值升级，就把这张表连同 `migrateStationAdapter` 和对应测试一起删。**不要再往里加新条目**，新站点一律写 `priceMap` 声明。
