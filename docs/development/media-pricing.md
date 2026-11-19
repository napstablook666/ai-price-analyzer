# 生图与视频比价坐标 📐

这份文档定义「哪些报价能放在同一张表里比大小」。生图和视频都不像文本模型那样只有 token 一个维度：同一个模型换个尺寸、加条音轨，价格能差十几倍。维度不统一时强行折算排序，算出来的名次是假的。

坐标分四层，每层只和同一层的对象比：

| 层级 | 字段 | 取值 | 决定 |
| --- | --- | --- | --- |
| 一 | `media_type` | `text` / `image` / `video` | 进哪个页签 |
| 二 | `request_unit` | `token` / `张` / `次` / `second` / `megapixel` | 进哪个榜单 |
| 三 | `tier_name` | `480P` / `768P` / `1K` / `1.5K` / `2K` / `4K` | 榜内怎么分组 |
| 四 | 质量档 | `low` / `high` / `unstated` | 与三组合成最终组 |

前两层在 `src/core/pricing.js` 与 `src/core/media.js` 已有实现，第三层视频部分已有（`request_unit = "second"` 的分辨率档各自成行），生图部分还没有字段承载。第四层完全没有。

## 一、第一层：输出类型

`media_type` 三个值，互相不可比，各自一个页签。判定顺序见 `src/core/media.js:mediaTypeForPricing`：

1. 显式 `media_type` / `modality` / `media`
2. `supported_endpoint_types` 里出现 video / image
3. `billing_usage_schema` 有 `seconds` 键
4. `billing_mode` 是 `per_image*` / `per_video*` / `per_second`
5. 兜底：`image_price > 0` 判生图，否则 `text`

判不出来的一律 `text`，不猜。

## 二、第二层：计费单位

单位不同就是不能比。`元/张` 和 `元/1M 图输出 token` 之间差一个「每张多少 token」的系数，那个系数官方常常没公布。折算值可以当注释显示，不能当排序键。

| 单位 | 适用 | 站内字段 | 官方字段 |
| --- | --- | --- | --- |
| `张` 元/张 | 生图 | `image_price` | `pricing[].unit = image` |
| `token` 元/1M 图输出 token | 生图 | `image_output_price` | `pricing[].unit = token` |
| `megapixel` 元/MP | 生图 | 无 | `pricing[].unit = megapixel` |
| `次` 元/次 | 生图 / 视频 | `request_price` | `pricing[].unit = request` |
| `second` 元/秒 | 视频 | `per_second_prices` | `cost_per_second`、`duration_seconds*` |
| `token` 元/1M 视频 token | 视频 | 无 | `video_token_pricing.tiers` |

一行的单位由**它自己报的那个字段**决定，不是由模型决定。同一个模型，站里报张价就进「元/张」榜，官方报 token 就进「元/1M」榜，两行分居两榜，不给互相比较的百分比。

## 三、第三层：规格档

### 3.1 生图：尺寸 × 质量

| 键 | 枚举 | 站内 | OpenRouter | Vercel AI Gateway |
| --- | --- | --- | --- | --- |
| 尺寸 | `768` `1K` `1.5K` `2K` `4K` `unstated` | 无 | `pricing[].variant` | `image_dimension_quality_pricing[].size`（`768x768`、`1024x1024`…） |
| 质量 | `low` `high` `unstated` | 无 | `pricing[].variant` 里的 `low` / `high` | `image_dimension_quality_pricing[].quality` |

归一规则：

- 尺寸：`1k` / `1024x1024` / `1K` → `1K`，`1536x1536` → `1.5K`，`2048x2048` → `2K`，`4096x4096` → `4K`，`768` / `768x768` → `768`，其余丢进 `unstated`
- 质量：只有 `low` 和 `high` 明确出现时才记，`medium` 与缺省一律 `unstated`（大部分平台把 medium 当默认，不写在价格里）
- 尺寸和质量写在同一个 variant 里时（`2048x2048/low`）两个都要拆出来，不能整串当一个标签

### 3.2 视频：分辨率 × 音轨 × 模式

| 键 | 枚举 | 站内 | OpenRouter | Vercel AI Gateway |
| --- | --- | --- | --- | --- |
| 分辨率 | `480P` `720P` `768P` `1080P` `2K` `4K` `unstated` | `per_second_prices` 的键 | SKU 键后缀 `_480p` `_720p` `_768p` `_1080p` `_2k` `_4k` | `video_duration_pricing[].resolution` |
| 音轨 | `audio` `noaudio` `unstated` | 无 | SKU 键里的 `_with_audio` / `_without_audio` | `video_duration_pricing[].audio` |
| 模式 | `std` `pro` `unstated` | 无 | 键前缀 `text_to_video_` / `image_to_video_`（这是任务型不是模式，见下） | `video_duration_pricing[].mode` |

OpenRouter 把模式揉进了键名里，需要用一张后缀表拆，拆不出来的一律 `unstated`。Vercel 的 `video_duration_pricing` 已经把三个维度拆成数组项，直接用。

分辨率档已经是独立行（`src/core/normalizers.js` 里展开分辨率档，每档一条 `request_unit: "second"`），不要把它们加权合并成一条「平均每秒价」。

## 四、档位斜率

同一个模型在不同档位上的相对价格不一样，所以「哪家便宜」在不同档位下会换答案。这个必须记录并展示。

实测两组，以 1K 为 1：

| 模型 | 768 | 1K | 1.5K | 2K | 4K |
| --- | --- | --- | --- | --- | --- |
| `black-forest-labs/flux-3-image` | 0.85× | 1× | 1.46× | 2.08× | 12.6× |
| `black-forest-labs/flux-3-image-klein` | 0.89× | 1× | 1.22× | 1.56× | 4.0× |

同样从 1K 升到 4K，大模型涨 12.6 倍，小模型只涨 4 倍。把这两个放进一个榜单按「元/张」排序，结论完全取决于选了哪个档。

还有反例：`google/gemini-3-pro-image` 的 1K 和 2K 同价，都是 $0.1344，只有 4K 才到 $0.24。所以斜率不是单调倍数，不能用公式推，只能存实测表。

## 五、降级规则

每行按顺序判定归属，判不出来就降级，绝不猜。

1. 有明确规格档 → 进对应组
2. 规格档缺失 → 进 `unstated` 组
3. `unstated` 组内的行可以互相排（同为站内口径，同样是含糊的「一张」），但不能并进具名组，也不给跨组百分比
4. 单位判不出来 → 不渲染，或渲染成纯文本行

以现在的中转站数据为例：它们只报一个 `image_price`，完全没有尺寸字段。所以整个「元/张」榜的站内行会全部落进 `unstated` 组，而官方的 `1K` 组只有官方自己一两家。这不是 bug，这就是现实：中转站的「一张」和官方的「1K 一张」不是一回事。

## 六、附加成本项

这些不进单价，但会改变实际花费，单独列为行尾标记。

| 项 | 适用 | 字段 | 说明 |
| --- | --- | --- | --- |
| 最低消费 | 生图 / 视频 | `minimum_cents_per_generation` | 一次请求最少扣多少，出小图时按次算远高于按张算 |
| 参考图加价 | 视频 | `reference_images` | `minimax/hailuo-3` 每张 +$0.04 |
| 失败计费 | 通用 | 无 API | 中转站失败扣不扣额度，只能实测 |
| 并发上限 | 通用 | 无 API | 低价档常见 1 到 2 并发，批量出图时时间成本超过钱 |

前两项能自动读，后两项只能靠站点实测填进站点画像。

## 七、明确不做

- **跨单位折算排名**。折算值可以当行尾注释，不能当排序键。
- **把 `unstated` 并进具名档**。中转站没标尺寸，不等于它是 1K。
- **质量归一**。2048² 的 seedream 和 1024² 的 flux 比每张多少钱，结论会反转，且没有客观依据判定谁质量高。
- **性价比评分**。只给同规格单价，质量差异交给模型名和用户自己判断。
- **把分辨率档加权合并**。`480P` / `768P` / `2K` 是并列选项，用户选一个，不是同时买三个。

## 八、数据源

| 源 | 生图 | 视频 | 备注 |
| --- | --- | --- | --- |
| `https://openrouter.ai/api/v1/images/models` + `/endpoints` | 68 个模型，`billable` / `unit` / `variant` / `cost_usd` | | 单位分布 image 38、token 25、megapixel 4 |
| `https://openrouter.ai/api/v1/videos/models` | | 32 个模型，`pricing_skus` 55 种键名归七类 | 全部 32 个都有 SKU |
| `https://ai-gateway.vercel.sh/v1/models` | `pricing.image`、`image_dimension_quality_pricing` | `video_duration_pricing`、`video_token_pricing` | 视频结构最干净，三个维度已拆成数组项 |
| `https://fal.ai/api/models?limit=2000` | 有 | 480 个视频模型 | 价格是 Markdown 叙述，只作兜底 |

两家的模型 ID 命名体系不同，不能靠字符串对齐：

| OpenRouter | Vercel AI Gateway |
| --- | --- |
| `alibaba/wan-3.0` | `alibaba/wan-v3.0-video` |
| `minimax/hailuo-3` | `minimax/minimax-h3` |
| `kwaivgi/kling-v3.0-pro` | `klingai/kling-v3.0-*` |
| `google/veo-3.1-fast` | `google/veo-3.1-fast-generate-001` |

需要一张别名表，逐条登记，不做前缀猜测。

数值上两家大部分吻合：`veo-3.1` 720p 无音轨 $0.20/s、有音轨 $0.40/s，`wan-3.0` 720p $0.10/s，`grok-imagine-video-1.5` 720p $0.14/s，`hailuo-3-max` 768p $0.08/s，完全相同。有差异的保留差异，不取平均：`google/veo-3.1-fast` 是 $0.08 对 $0.10，`kwaivgi/kling-v3.0-std` 是 $0.084 对 $0.168，差一倍。取平均会把这个信号抹掉。

## 九、与现有实现的对照

| 项 | 位置 | 状态 |
| --- | --- | --- |
| 三页签切换 | `src/core/media.js`、`src/dashboard.js` 的页签渲染 | 已有 |
| 视频分辨率档独立成行 | `src/core/normalizers.js` 的分钟/秒档展开，`request_unit: "second"` | 已有 |
| 生图按单位分榜 | `src/core/pricing.js` 的 `mediaUnitOf`、`src/dashboard.js` 的 `sortRows` | 已做 |
| 生图尺寸档 / 质量档 | `src/core/image-billing.js` 的 `imageTierOf` | 已做，站内恒为 `unstated` |
| 规格不同不给百分比 | `compareImageQuote` 的 `tier-mismatch` | 已做 |
| 分榜横条 | `src/dashboard.js` 的 `unitGroupMarkup` | 已做 |
| 视频音轨 / 模式 | `tier_name` | 未做，官方数据里还没归一 |
| 附加成本项 | `minimum_cents_per_generation`、`reference_images` | 未做 |

### 落地细节

`mediaUnit` 是分榜键，一行只属于一个榜：

- `billingMode === "image"` → 取站内实际报价的 `unit`（`image` / `token` / `megapixel`），不再是折算后的元/张
- `billingMode === "request"` 且 `request_unit === "second"` → `second`
- 其余按次 → `request`
- 文本行 → `null`

`mediaUnitPrice` 从「折合元/张」改为「原始单位价」。折合值仍留在 `imagePerImage`，只做注释，不做排序键。

分榜只在「单位价格」排序下生效，其他排序键不承诺分组。每页第一行若是上一页同组的延续，插一条带「（续）」的横条。

站内报价没有尺寸字段，所以 `imageTierLabel` 恒返回「规格未标注」。官方 `variant` 一旦是 `1k`、`2k` 这类具名档，两边口径不同，`compareImageQuote` 返回 `tier-mismatch`，不给百分比也不给档位，只把两个数并排放着。
