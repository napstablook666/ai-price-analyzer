const definitions = {
  auto: { label: "自动识别", explicit: false, strategy: null },
  pqh: { label: "P站 / PQH", explicit: true, strategy: "pqh" },
  sora: { label: "Sora", explicit: true, strategy: "sora" },
  "aiapi-model-catalog": { label: "AIAPI 模型目录", explicit: true, strategy: "aiapi" },
  "nodeai-model-plaza": { label: "NodeAI 模型广场", explicit: true, strategy: "model-plaza", profile: "nodeai" },
  "sevenai-model-plaza": { label: "SevenAI 模型广场", explicit: true, strategy: "model-plaza", profile: "sevenai" },
  "killai-model-plaza": { label: "KillAI 模型广场", explicit: true, strategy: "model-plaza", profile: "killai" },
  "all-in-one-models": { label: "all-in-one.icu 租户模型", explicit: true, strategy: "all-in-one-models" },
  "fuck-everyone-model-plaza": { label: "fuck-everyone 模型广场", explicit: true, strategy: "model-plaza", profile: "fuck-everyone" },
  "kelaode-model-plaza": { label: "克劳德 APi 模型广场", explicit: true, strategy: "model-plaza", profile: "kelaode" },
  "tokenflux": { label: "TokenFlux 定价", explicit: true, strategy: "tokenflux" },
  "windhub": { label: "WindHub 公开定价", explicit: true, strategy: "windhub" },
  "stellaisle": { label: "Star API 公开定价", explicit: true, strategy: "stellaisle" },
  "stellaisle-carpool": { label: "Star API 拼车市场", explicit: true, strategy: "stellaisle-carpool" },
  // 声明式映射：报文形状由 adapter.priceMap 描述，站点差异写在插件里，不占新的枚举值。
  "price-map": { label: "声明式价格映射", explicit: true, strategy: "price-map" },
};

export const RESPONSE_FORMAT_DEFINITIONS = Object.freeze(definitions);
const RESPONSE_FORMATS = new Set(Object.keys(definitions));

const strategyHandlers = new Map();

export function registerResponseFormatHandler(strategy, factory) {
  if (!strategy || typeof factory !== "function") throw new TypeError("响应格式处理器必须提供 strategy 和 factory");
  if (strategyHandlers.has(strategy)) throw new Error(`重复注册响应格式处理器：${strategy}`);
  strategyHandlers.set(strategy, factory);
}

export function getResponseFormatHandler(strategy) {
  return strategyHandlers.get(strategy) || null;
}

export function assertResponseFormatHandlers() {
  const missing = Object.entries(RESPONSE_FORMAT_DEFINITIONS)
    .filter(([, definition]) => definition.explicit && !getResponseFormatHandler(definition.strategy))
    .map(([format, definition]) => `${format}:${definition.strategy}`);
  if (missing.length) throw new Error(`缺少响应格式处理器：${missing.join(", ")}`);
  return true;
}

export function getResponseFormatDefinition(format = "auto") {
  return RESPONSE_FORMAT_DEFINITIONS[String(format || "auto")] || null;
}

export function isSupportedResponseFormat(format) {
  return RESPONSE_FORMATS.has(format);
}
// 退役的枚举值 → 现在的等价声明。
//
// 这三家报文都是 tokenflux 换一套字段映射，price-map 引擎加一份声明就能覆盖。
// 当年各占一个枚举值，是因为映射引擎还没写；引擎上线后（4b3793b）枚举值就只剩
// 「别让 11 月 18 日那天手填过的站点解析失败」这一个作用。
// 长期挂着一张别名表，等于让历史版本的配置永久占用公开词表——所以改成读到就换掉：
//
// 摘除条件（写在这里，免得它变成下一代的遗留）：这三个值只服务「升级前手填过、
// 之后一次都没再保存过设置」的站点。任何一次保存都会把 adapter 写回新形态，
// 所以发满两个 minor（或线上再收不到这三个值相关的问题）就整张表删掉。
// 一起删：这张表、migrateStationAdapter、schema.js 里的那一次调用、
// test/response-formats.test.js 的四条用例、docs/development/price-map.md 的「退役的枚举值」。
// normalizeStation 按这张表把旧值就地改写成新声明，存储里不再有旧值。
export const LEGACY_RESPONSE_FORMATS = Object.freeze({
  // newcodex 原本是独立 base，只为把倍率乘 2；倍率基准归到 tokenflux 的 ratioBase 之后，
  // 它跟 tokenflux 就没有任何差异了，直接退化成同一份声明。
  newcodex: { format: "price-map", priceMap: Object.freeze({ base: "tokenflux" }) },
  allrouter: { format: "price-map", priceMap: Object.freeze({ base: "allrouter" }) },
  relayrouter: { format: "price-map", priceMap: Object.freeze({ base: "relayrouter" }) }
});

// 纯函数、幂等：不认识的值原样返回；已经是新形态的再跑一遍不变。
// 只补空缺，不覆盖站点自己写的 priceMap。
export function migrateStationAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") return adapter;
  const legacy = LEGACY_RESPONSE_FORMATS[String(adapter.responseFormat || "")];
  if (!legacy) return adapter;
  return {
    ...adapter,
    responseFormat: legacy.format,
    ...(adapter.priceMap ? {} : { priceMap: { ...legacy.priceMap } })
  };
}
