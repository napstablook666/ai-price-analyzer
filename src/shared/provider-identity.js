// 只合并明确的厂商品牌别名，不使用模型名提示、模糊相似度或托管关系。
// logo 使用现有图标 slug；同一份别名由 gen-shared-data 同步给离线图标。
export const PROVIDER_BRANDS = [
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Google", aliases: ["google-gemini", "googlegemini", "deepmind"] },
  { id: "anthropic", label: "Anthropic" },
  { id: "deepseek", label: "DeepSeek", aliases: ["deepseek-ai"] },
  { id: "meta", label: "Meta", aliases: ["meta-llama"] },
  { id: "qwen", label: "Qwen" },
  { id: "mistralai", label: "Mistral AI", aliases: ["mistral", "mistral-ai"] },
  { id: "zai", label: "Z.AI", aliases: ["z-ai", "zai-org", "zhipu", "zhipuai"] },
  { id: "moonshotai", label: "Moonshot AI", aliases: ["moonshot", "moonshot-ai"] },
  { id: "minimax", label: "MiniMax" },
  { id: "tencent", label: "Tencent", aliases: ["tencentqq"], logo: "tencentqq" },
  { id: "bytedance", label: "ByteDance", aliases: ["bytedance-seed"] },
  { id: "xai", label: "xAI", aliases: ["x-ai"] },
  { id: "ibm", label: "IBM", aliases: ["ibm-granite"] },
  { id: "liquid", label: "Liquid AI", aliases: ["liquidai", "liquid-ai"] },
  { id: "thinkingmachines", label: "Thinking Machines", aliases: ["thinking-machines"] },
  { id: "stepfun", label: "StepFun" },
  { id: "nvidia", label: "NVIDIA" },
  { id: "amazon", label: "Amazon" },
  { id: "baidu", label: "Baidu" },
  { id: "cohere", label: "Cohere" },
  { id: "perplexity", label: "Perplexity" },
  { id: "xiaomi", label: "Xiaomi" },
  { id: "alibabacloud", label: "Alibaba Cloud", aliases: ["alibaba-cloud"] },
  { id: "openrouter", label: "OpenRouter" },
  { id: "huggingface", label: "Hugging Face", aliases: ["hugging-face"] },
  { id: "lmstudio", label: "LM Studio", aliases: ["lm-studio"] },
  { id: "ollama", label: "Ollama" },
  { id: "microsoft", label: "Microsoft" },
  { id: "azure", label: "Azure" },
  { id: "nousresearch", label: "Nous Research", aliases: ["nous-research"] },
  { id: "upstage", label: "Upstage" },
  { id: "rekaai", label: "Reka AI", aliases: ["reka-ai"] },
  { id: "writer", label: "Writer" },
  { id: "inclusionai", label: "InclusionAI", aliases: ["inclusion-ai"] },
  { id: "aion-labs", label: "Aion Labs" },
  { id: "anthracite-org", label: "Anthracite" }
];

function cleanProvider(value) {
  return typeof value === "string" ? value.trim().replace(/^~+/, "").trim().toLowerCase() : "";
}

const byAlias = new Map();
for (const brand of PROVIDER_BRANDS) {
  for (const alias of [brand.id, brand.label, ...(brand.aliases || [])]) {
    byAlias.set(cleanProvider(alias), brand);
  }
}

export function normalizeProvider(value) {
  const key = cleanProvider(value);
  return byAlias.get(key)?.id || key;
}

export function providerLabel(value) {
  return byAlias.get(cleanProvider(value))?.label || (typeof value === "string" ? value.trim().replace(/^~+/, "").trim() : "");
}

export function providerSearchText(value) {
  const brand = byAlias.get(cleanProvider(value));
  return brand ? [brand.id, brand.label, ...(brand.aliases || [])].join(" ") : cleanProvider(value);
}

// null 是全选，[] 是主动清空；未知供应商不能丢，否则旧设置会意外扩大筛选。
export function normalizeProviderSelection(values) {
  if (!Array.isArray(values)) return null;
  return [...new Set(values.map(normalizeProvider).filter(Boolean))];
}
