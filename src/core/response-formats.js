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
  "tokenflux": { label: "TokenFlux 定价", explicit: true, strategy: "tokenflux" },
  // 这三家报文都是 tokenflux 换一套字段映射，用 price-map 处理器 + 兜底声明就能覆盖；
  // 保留各自的枚举值是为了老配置里的 responseFormat 还能认，新站直接写 "price-map"。
  "newcodex": { label: "NewCodex 定价", explicit: true, strategy: "price-map", priceMap: { base: "newcodex" } },
  "allrouter": { label: "AllRouter 定价", explicit: true, strategy: "price-map", priceMap: { base: "allrouter" } },
  "windhub": { label: "WindHub 公开定价", explicit: true, strategy: "windhub" },
  "stellaisle": { label: "Star API 公开定价", explicit: true, strategy: "stellaisle" },
  "stellaisle-carpool": { label: "Star API 拼车市场", explicit: true, strategy: "stellaisle-carpool" },
  "relayrouter": { label: "RelayRouter 定价", explicit: true, strategy: "price-map", priceMap: { base: "relayrouter" } },
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

