# 生图模型计费适配与比价 🖼️

生图模型的计价方式和文本模型不是一回事。文本模型永远能写成「单价 × token 数」，生图模型可能按张、按图 token、按像素、按次收钱。把生图模型塞进现有的 token 比价管线，会算出三个假结论。这份文档定义一套独立的口径。

> **修订**：本文 2.2 和第五章把「折合元/张」当主指标并参与排序，这个做法后来被推翻了。理由是同一个模型在不同尺寸档上的涨幅不一样，把各家折到 1024² 再排名，名次会随选择的档位翻转。现行的坐标系定义见 [生图与视频比价坐标](./media-pricing)，本文保留作为口径分类和分道规则的依据，凡与那一篇冲突以那一篇为准。

## 一、现状为什么错

现有管线是 `workloadCost` → `blendedUnitPrice` → `classifyOffer` → 排序，全程假设「按 token」。生图模型进去会坏三处：

| 症状 | 原因 |
| --- | --- |
| 月成本算成 ¥0，标「低 100%」 | 用户没填出图张数，`usage.images = 0`，成本只剩文本 prompt 的几厘钱；`classifyOffer` 拿月成本比值分档，0 自然是最低 |
| 混合单价 ¥0.0000/M | `blendedUnitPrice = cost / token 总数`，分母里没有「张」，而成本主要在「张」上 |
| 官方价 `—`，`对比官方` 空 | 现在取的是 `pricing.image`（美元/**输入**图），语义就不是出图价；而且 OpenRouter `/models` 只有 68 个生图模型里的 10 个 |

还有一处结构性错误：`billingModeOf` 只在「有 `image_price` 且完全没有任何 token 价」时才判成生图道。真实的生图模型常常同时报文本 prompt 的 token 价和出图的张价，于是被判成 token 道，直接掉进上面三个坑。

## 二、口径建模

### 2.1 四个计费维度

| 维度 | 站内字段 | 官方字段（images API） | 单位 |
| --- | --- | --- | --- |
| 张 | `image_price` | `output_image` / `unit: image` | 元/张 |
| 图输出 token | `image_output_price` | `output_image` / `unit: token` | 元/1M token |
| 像素 | 无 | `output_image` / `unit: megapixel` | 元/MP |
| 次 | `request_price` | `output_image` / `unit: request` | 元/次 |

输入侧另有 `input_image`（image / token / megapixel 三种）、`input_text`、`input_reference`、`input_font`。输入侧不参与主比价，只在成本估算里计。68 个官方生图模型里，`output_image` 的单位分布是 token 25 个、image 38 个、megapixel 4 个。

### 2.2 主指标：折合元/张

主指标定成 **折合元/张（标准出图规格）**，理由：用户问的是「出一张图多少钱」，不是「一兆 token 多少钱」。

标准出图规格 `IMAGE_REFERENCE`：

```
尺寸 1024 × 1024
质量 medium
面积 1,048,576 px = 1.048576 MP
```

跨口径换算：

| 源口径 | 折合元/张 |
| --- | --- |
| `per_image` | 价 |
| `per_megapixel` | 价 × 1.048576 |
| `per_image_token` | 价 × tokensPerImage / 1e6 |
| `per_request` | 价 / imagesPerRequest（默认 1） |

### 2.3 tokensPerImage 锚定表

`per_image_token` 和 `per_image` 之间隔着「一张图多少 token」，这个数只能抄官方公开值，不许估。只登记查得到的：

| 模型族 | 1024² medium 的 token 数 | 依据 |
| --- | --- | --- |
| `openai/gpt-image-*` | 1056 | OpenAI token 表：low 272 / medium 1056 / high 4160 |
| `google/gemini-2.5-flash-image` | 1290 | Google 官方每张 1290 tokens |

表里没有的模型族一律不换算。查不到就只显示原单位，绝不编一个系数出来。

## 三、分道规则

```
hasImagePrice      = image_price > 0        （元/张，必然进生图道）
hasImageTokenPrice = image_output_price > 0 （元/1M 图输出 token）
isImageModel       = 官方 architecture.output_modalities 含 image

if request_price > 0        → request 道（沿用现有）
else if hasImagePrice       → image 道（新）
else                        → token 道（沿用现有）
```

与现状的关键差别是**取消「无 token 价」这个前提**。原来要「有 `image_price` 且一个 token 价都没有」才判生图道，而生图模型常常同时报文本 prompt 的 token 价和出图的张价，于是被判成文本模型，掉进三个坑。

只报「元/1M 图输出 token」的报价仍留在 token 道。它和 token 同一量纲，用量里的「图像输出（M tokens）」能覆盖它，月成本算得出来。真正没有 token 维度的是「元/张」。

`isImageModel` 不单独决定分道：官方说是生图模型，但站点只按 token 报价的，就该按 token 比。

## 四、官方参照

### 4.1 换数据源

弃用 `/api/v1/models` 的 `pricing.image`（那是美元/输入图），改用生图专用接口：

```
GET /api/v1/images/models                        → 68 个模型 id
GET /api/v1/images/models/{id}/endpoints         → billable / unit / cost_usd / variant
```

每条 `pricing` 长这样：

```json
{ "billable": "output_image", "unit": "image", "cost_usd": 0.02, "variant": "high_resolution" }
```

### 4.2 取哪条

- 只认 `billable === "output_image"`。
- 按 `variant` 分档。无 variant 或 `1k` 的当主档；`768` / `1.5k` / `2k` / `4k` / `high_resolution` / `low_1k` 之类进档位附表，不和主档混排。
- 同档多条 provider 取最低价（比价场景要的是「你能拿到的最低价」），provider 名放 tooltip。
- 18 个模型有 variant，其余没有。

### 4.3 缓存

68 个模型就是 68 次 endpoint 请求，不能每次刷新都拉。放 `chrome.storage.local`，TTL 24 小时，并发 6 拉一次约 3–5 秒。刷新时先读缓存，过期才后台补。

### 4.4 兜底

`/api/v1/models` 的 `pricing.image_output` 是美元/图输出 token，配上锚定表可以换算成元/张。仅在 images API 拉不到时用，并标成估算。

## 五、比价与分档

### 5.1 三条泳道

同一个区块里分三条泳道，泳道内才比（现行实现已把「折算比」整条泳道删掉，见 [比价坐标](./media-pricing)）：

| 泳道 | 站内口径 | 官方口径 | 比法 |
| --- | --- | --- | --- |
| 直比 | `per_image` | `output_image / image` | 直接百分比 |
| token 比 | `per_image_token` | `output_image / token` | 同单位，直接百分比 |
| 折算比 | 任一口径 | 另一口径 | 双方都折成元/张，百分比加 `≈` |

跨泳道不出百分比。拿「元/张」和「元/1M token」直接比大小是没有意义的。

### 5.2 分档

| 参照情况 | 分档 | 参与排序 | 参与推荐 |
| --- | --- | --- | --- |
| 直比 / token 比 | 正常低/持平/高 | 是 | 是 |
| 折算比 | 不出档位 | 否 | 否 |
| 规格对不上 | 不出档位，标「规格不同」 | 否 | 否 |
| 官方无图价 | `—` | 否，沉底 | 否 |

折算比既不排档也不参与排序。锚定表的系数可能和站点实际的出图规格对不上，拿它算出来的名次是估出来的名次。折合元/张只在行尾当注释显示。

规格对不上指站内报价没标尺寸、官方标了 `1k` / `2k` 这类具名档，两边说的不是同一张图，同单位也不给百分比。中转站的「一张」只有站内自己互相可比，见 [比价坐标](./media-pricing) 第五节的降级规则。

### 5.3 零值保护

任何「月成本 = 0」的行不得参与分档和排序，标「未填出图张数」。现在的「低 100%」绿标就是这条没做。

### 5.4 月成本

```
imageMonthlyCost = 月出图张数 × 折合元/张 × 充值档折扣
```

月出图张数复用现有 `usage.images`，`options.html` 里的标签从「图像请求数」改成「月出图张数」。

## 六、UI

独立区块「生图模型」，列：

| 列 | 内容 |
| --- | --- |
| 模型 | 名称 + 站点 |
| 分组 | 组名 / 倍率 |
| 计费单位 | `元/张`、`元/1M 图token`、`元/MP`、`元/次` |
| 站内价 | 原单位价，带 `/张` `/1M` `/MP` `/次` 后缀 |
| 官方价 | 同口径官方价，拿不到写 `—` |
| 折合元/张 | 锚定表命中才给值，加 `≈`，hover 显示「按 1056 tokens/张 折算」 |
| 对比官方 | 直比 `低 86.1%`；折算 `≈低 12%`；不可比 `—` |
| 月成本 | 填了张数才显示金额，否则「填出图张数」 |

排序键：折合元/张升序，不可比的沉底。

## 七、落地拆解

| 文件 | 改动 |
| --- | --- |
| `src/core/image-billing.js`（新） | `IMAGE_REFERENCE` 常量、`tokensPerImage()` 锚定表、`toPerImage()` 归一、`compareImage()` 分泳道 |
| `src/core/openrouter.js` | 新增 `fetchImageEndpoints()`，带 24h 缓存 |
| `src/core/pricing.js` | `billingModeOf` 改分道；`resolveRow` 输出 `imageQuote` / `imageReference` / `imageCompare` |
| `src/dashboard.js`、`dashboard.html` | 区块按上表改造 |
| `test/image-billing.test.js`（新） | 锚定表、跨口径换算、零值保护、variant 选档 |
| `options.html` | 「图像请求数」→「月出图张数」 |

## 八、明确不做

- 不猜 `tokensPerImage`。查不到只显示原单位。
- 折算价不参与推荐。
- 2K / 4K 档位不并入主排序，档位不同不可比。
- 不用 `pricing.image`（输入图价）当输出图价。
- 不做「平均一张图多少 token」这类站点侧反推，站点不披露质量档，反推出来的是噪声。
