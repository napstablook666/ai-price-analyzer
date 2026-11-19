// RelayRouter 的价格映射文档。
//
// 站是标准 New API 的形状（model_ratio + completion_ratio + 分组倍率表），
// 两处和常见版本不一样：
//
// 1. 缓存写拆成 5 分钟 / 1 小时两个字段，老的 cache_creation_ratio 只有
//    8 个模型还在发，所以缓存写写成回落链，两种字段名都能取到价。
// 2. 长上下文分档放在 step_ratios 里，档位对象只给「输入超过多少 token」的
//    上限和各档系数，模型倍率留在外面——靠档位表达式回落到整条记录取值。
//
// 没映射的字段：cache_creation_12h_ratio（12 小时缓存写）、audio_ratio（音频
// 输入倍率）、video_resolution_ratios（只有 wan3.0-video 一个模型带，按键名
// 分档而不是按长度，先按统一价出）。

// 模型类型是中文标签，接口报文的端点类型是英文。两处都认，谁命中用谁。
const RELAY_ROUTER_MEDIA_TYPES = [
  { path: "model_type", map: { "图像": "image", "音视频": "video", "视频": "video", "audio": "audio" } },
  { path: "supported_endpoint_types", map: { "image-generation": "image", "video-generation": "video" } }
];

export const relayRouterPriceMap = {
  schemaVersion: "price-map/1",
  source: "relayrouter",
  rootPath: "/data",
  nameField: "model_name",
  labelField: "model_name",
  currency: "USD",
  groups: {
    listPath: "enable_groups",
    ratioPath: "/group_ratio",
    usablePath: "/usable_group"
  },
  rules: [
    {
      // 按次计价：图片、视频、音频这批给的是每次多少钱，不按 token 走。
      when: { path: "quota_type", equals: 1 },
      kind: "request",
      price: "model_price",
      unit: "request",
      mediaType: RELAY_ROUTER_MEDIA_TYPES,
      tierName: "标准"
    },
    {
      kind: "token",
      // 倍率的基准是 2 美元/M token，这个系数在 ratioBase 里声明，表达式只写 model_ratio。
      input: "model_ratio",
      output: "model_ratio * completion_ratio",
      cacheRead: "model_ratio * cache_ratio",
      cacheWrite: [
        "model_ratio * cache_creation_5m_ratio",
        "model_ratio * cache_creation_ratio"
      ],
      cacheWrite1h: "model_ratio * cache_creation_1h_ratio",
      // 图片 token 走站点的图片独立倍率；输出 token 不论文本还是图片一律按 completion_ratio 计。
      imageInput: "model_ratio * image_ratio",
      imageOutput: "model_ratio * completion_ratio",
      mediaType: RELAY_ROUTER_MEDIA_TYPES,
      tierName: "标准",
      // 档内倍率是整段生效，不是只对超出的那部分加价。
      // 档位只给上限，下限由引擎按上一档的上限补。
      tiers: {
        path: "step_ratios",
        upperField: "step_size",
        input: "model_ratio * prompt_step_ratio",
        output: "model_ratio * completion_ratio * completion_step_ratio",
        cacheRead: "model_ratio * cache_ratio * cache_step_ratio",
        cacheWrite: [
          "model_ratio * cache_creation_5m_ratio * cache_step_ratio",
          "model_ratio * cache_creation_ratio * cache_step_ratio"
        ]
      }
    }
  ]
};
