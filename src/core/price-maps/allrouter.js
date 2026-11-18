// AllRouter（allrouter.cc）的价格映射。
//
// 报文和 tokenflux 那套行数组不一样：/api/ratio_config 的 data 是 New API 的列式结构，
// 每张表都是「模型名 → 值」，行要按模型名拼出来（拼接在 normalizers.js 的
// AllRouterPricingStrategy 里做）。拼好之后字段和 tokenflux 同构，规则整份复用。
//
// 站点口径（2026-11-18 实测）：
//   model_ratio 1 = $2/百万 token，与 billing_expr 里的美元系数对得上；
//   抽样：claude-haiku-4-5 ratio 0.5 → $1/M，gemini-3.8-flash ratio 0.375 → $0.75/M。
//   所以倍率类的价格要乘 2，和 newcodex 那份映射同一个理由。
//
// 分时计价（DeepSeek 三个）写在表达式里：工作日 9–12 点与 14–18 点走 peak 系数，
// 其余时段与法定节假日走 off_peak（半价）。解析器只认识长度条件，不认 time 谓词，
// 结果就是同一个模型出两行（peak / off_peak），档位名自己说明了适用哪一段。
//
// 在售清单：站点按分组开模型，/api/user/models 是唯一权威来源且需要登录（插件不登录），
// 而 model_ratio 里那 486 条绝大多数是 New API 出厂默认表、站点根本不卖。
// 所以这里写死 default 分组的 49 个在售模型，采多采少都不如采准。
// 站点上新模型时改这份清单，别去掉白名单去赌 ratio 表。

// default 分组在售的 49 个模型（2026-11-18 取自 /api/user/models，全部能在 ratio_config 里对上）。
export const ALLROUTER_MODELS = [
  "claude-fable-5",
  "claude-fable-5-1",
  "claude-fable-5-2",
  "claude-haiku-4-5",
  "claude-haiku-5-5",
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-opus-5-5",
  "claude-opus-5-5[1m]",
  "claude-sonnet-5",
  "claude-sonnet-5-5",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "deepseek-v4.1-flash",
  "gemini-3.1-pro-preview",
  "gemini-3.8-flash",
  "gemini-4-argon",
  "gemini-4-carbon",
  "glm-5.2",
  "glm-5.3",
  "glm-5.3-flash",
  "gpt-5.4",
  "gpt-5.4-pro",
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-luna-openai-compact",
  "gpt-5.6-sol",
  "gpt-5.6-sol-openai-compact",
  "gpt-5.6-terra",
  "gpt-5.6-terra-openai-compact",
  "gpt-6-astra",
  "gpt-6-astra-openai-compact",
  "gpt-6-luna",
  "gpt-6-luna-openai-compact",
  "gpt-6-sol",
  "gpt-6-sol-openai-compact",
  "gpt-6.1-sol",
  "gpt-6.1-sol-openai-compact",
  "gpt-6.1-terra",
  "gpt-6.1-terra-openai-compact",
  "gpt-image-2.5",
  "gpt-image-2.5-flare",
  "gpt-image-2.5-sunburst",
  "grok-4.7",
  "kimi-k3",
  "kimi-k3.1-pro",
  "kimi-k3.1-pro-highspeed"
];
// 出图模型：表达式里照样是 token 价（p / c），但站内只用来出图，得进生图榜。
// 站点报文里没有 supported_endpoint_types，拼行时按这张表补上，定价规则就能用同一个字段判断媒体类型。
export const ALLROUTER_IMAGE_MODELS = new Set(["gpt-image-2.5", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"]);

const IMAGE_ENDPOINT = { path: "supported_endpoint_types", map: { "image-generation": "image" } };

export const allrouterPriceMap = {
  schemaVersion: "price-map/1",
  source: "allrouter",
  rootPath: "/data",
  nameField: "model_name",
  labelField: "model_name",
  currency: "USD",
  // 站点没有公开分组倍率表（/api/user/groups 要登录），出的是基准价。
  // 不声明 unlisted 的话，每条都会被判成「没有可用分组」直接丢掉。
  groups: { unlisted: { group: "基准价", ratio: 1 } },
  rules: [
    {
      when: { path: "billing_expr", present: true },
      kind: "expression",
      exprPath: "billing_expr",
      mediaType: IMAGE_ENDPOINT
    },
    {
      when: { path: "model_price", gt: 0 },
      kind: "request",
      price: "model_price",
      unit: "request",
      mediaType: IMAGE_ENDPOINT
    },
    {
      kind: "token",
      input: "model_ratio * 2",
      output: "model_ratio * 2 * completion_ratio",
      cacheRead: "model_ratio * 2 * cache_ratio",
      cacheWrite: "model_ratio * 2 * create_cache_ratio",
      // 写回 model_ratio 时按站点的 1 = $2 口径，和输入价保持一致。
      ratioBase: 2,
      mediaType: IMAGE_ENDPOINT,
      tierName: "标准"
    }
  ]
};
