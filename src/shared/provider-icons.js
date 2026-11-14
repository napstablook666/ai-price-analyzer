import { PROVIDER_LOGOS } from "./provider-logos.js";

// 供应商 id 与应用里出现的写法差异较大（z-ai / zai-org、x-ai / xai、meta-llama…），
// 这里统一收口到一个 slug，图标数据只在 provider-logos.js 里。
const ALIASES = {
  "openai": "openai",
  "azure": "openai",
  "qwen": "qwen",
  "qwq": "qwen",
  "dashscope": "qwen",
  "google": "google",
  "googlegemini": "google",
  "deepmind": "google",
  "anthropic": "anthropic",
  "claude": "anthropic",
  "mistral": "mistralai",
  "mistralai": "mistralai",
  "z-ai": "zai",
  "zai": "zai",
  "zai-org": "zai",
  "zhipu": "zai",
  "zhipuai": "zai",
  "glm": "zai",
  "deepseek": "deepseek",
  "deepseek-ai": "deepseek",
  "moonshot": "moonshotai",
  "moonshotai": "moonshotai",
  "kimi": "moonshotai",
  "meta": "meta",
  "meta-llama": "meta",
  "llama": "meta",
  "tencent": "tencentqq",
  "tencentqq": "tencentqq",
  "hunyuan": "tencentqq",
  "nvidia": "nvidia",
  "nemotron": "nvidia",
  "x-ai": "xai",
  "xai": "xai",
  "grok": "xai",
  "openrouter": "openrouter",
  "cohere": "cohere",
  "xiaomi": "xiaomi",
  "perplexity": "perplexity",
  "amazon": "amazon",
  "aws": "amazon",
  "bedrock": "amazon",
  "nova": "amazon",
  "minimax": "minimax",
  "bytedance": "bytedance",
  "bytedance-seed": "bytedance",
  "doubao": "bytedance",
  "seed": "bytedance",
  "baidu": "baidu",
  "ernie": "baidu",
  "ibm": "ibm",
  "ibm-granite": "ibm",
  "granite": "ibm",
  "alibaba": "alibabacloud",
  "alibabacloud": "alibabacloud",
  "liquid": "liquid",
  "liquidai": "liquid",
  "thinkingmachines": "thinkingmachines",
  "thinking-machines": "thinkingmachines",
  "huggingface": "huggingface",
  "hugging-face": "huggingface",
  "ollama": "ollama",
  "lmstudio": "lmstudio",
  "lm-studio": "lmstudio",
  "stepfun": "stepfun",
  "step-3": "stepfun"
};

// 模型名里出现这些词就按对应供应商上图标，兜住“未匹配”的报价行。
const NAME_HINTS = [
  [/deepseek/i, "deepseek"],
  [/\b(gpt|chatgpt|dall-?e|whisper|o[1-9](-mini|-pro)?)\b/i, "openai"],
  [/claude|anthropic/i, "anthropic"],
  [/gemini|gemma|palm/i, "google"],
  [/qwen|qwq|tongyi/i, "qwen"],
  [/\bglm|zhipu|z-?ai\b/i, "zai"],
  [/kimi|moonshot/i, "moonshotai"],
  [/grok/i, "xai"],
  [/llama|meta-/i, "meta"],
  [/mistral|mixtral|codestral|devstral|pixtral/i, "mistralai"],
  [/doubao|bytedance|seed-|seed_/i, "bytedance"],
  [/hunyuan/i, "tencentqq"],
  [/ernie/i, "baidu"],
  [/minimax|abab/i, "minimax"],
  [/\bmimo\b/i, "xiaomi"],
  [/sonar/i, "perplexity"],
  [/nemotron/i, "nvidia"],
  [/granite/i, "ibm"],
  [/command|cohere/i, "cohere"]
];

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/^~+/, "").replace(/\s+/g, "-");
}

export function providerLogoSlug(value) {
  const key = normalize(value);
  if (!key) return "";
  const alias = ALIASES[key];
  if (alias) return alias;
  if (PROVIDER_LOGOS[key]) return key;
  for (const [pattern, slug] of NAME_HINTS) if (pattern.test(String(value || ""))) return slug;
  return "";
}

// 第一个能对上图标的候选值胜出：先看匹配到的供应商，再退到模型名。
export function providerLogoFor(values) {
  for (const value of [].concat(values)) {
    const slug = providerLogoSlug(value);
    if (slug && PROVIDER_LOGOS[slug]) return slug;
  }
  return "";
}

function escapeAttr(value) {
  return String(value || "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function fallbackInitials(value) {
  const text = String(value || "").replace(/^~+/, "").replace(/[^A-Za-z0-9\u4e00-\u9fa5]/g, "");
  if (!text) return "?";
  const ascii = text.match(/^[A-Za-z0-9]+/)?.[0];
  return (ascii ? ascii.slice(0, 2) : text.slice(0, 1)).toUpperCase();
}

// 图标块：有品牌图形就内联 SVG（单色，跟随 currentColor），没有就落成首字母色块。
export function providerIconMarkup(values, { size = 17, label = "" } = {}) {
  const list = [].concat(values);
  const slug = providerLogoFor(list);
  const logo = slug ? PROVIDER_LOGOS[slug] : null;
  if (!logo) {
    const initials = escapeAttr(fallbackInitials(list.find(value => String(value || "").trim()) || ""));
    return `<span class="model-logo is-neutral" aria-hidden="true"><span>${initials}</span></span>`;
  }
  const title = escapeAttr(label || logo.title);
  const style = logo.hex ? ` style="--brand:${logo.hex}"` : "";
  const paths = logo.paths.map(d => `<path d="${d}"></path>`).join("");
  return `<span class="model-logo"${style} title="${title}" aria-hidden="true"><svg viewBox="${logo.viewBox}" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${paths}</svg></span>`;
}