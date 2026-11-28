// 抓取品牌图标并写进 rust/shared-rs/src/data.json 的 providerLogos。
// 图形来自 models.dev/logos 与 simple-icons（CC0 1.0），只保留 <path d="…">，单色渲染。
// 用法：node scripts/provider-logos.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUTPUT = fileURLToPath(new URL("../rust/shared-rs/src/data.json", import.meta.url));
const MODELS_DEV = "https://models.dev/logos/";
const SIMPLE_ICONS = "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/";
// 固定版本，新增品牌图形来自 Lobe Icons（MIT，见 THIRD_PARTY_NOTICES.md）。
const LOBE_ICONS = "https://unpkg.com/@lobehub/icons-static-svg@1.106.0/icons/";

// slug → [来源, 文件名, 品牌色(null 跟随主题), 显示名]
const ENTRIES = {
  openai: [MODELS_DEV, "openai.svg", "#10A37F", "OpenAI"],
  google: [MODELS_DEV, "google.svg", "#8E75B2", "Google Gemini"],
  anthropic: [MODELS_DEV, "anthropic.svg", "#D97757", "Anthropic"],
  deepseek: [MODELS_DEV, "deepseek.svg", "#4D6BFE", "DeepSeek"],
  meta: [MODELS_DEV, "meta.svg", "#0866FF", "Meta"],
  minimax: [MODELS_DEV, "minimax.svg", "#E7355F", "MiniMax"],
  moonshotai: [MODELS_DEV, "moonshotai.svg", null, "Moonshot AI"],
  nvidia: [MODELS_DEV, "nvidia.svg", "#76B900", "NVIDIA"],
  xiaomi: [MODELS_DEV, "xiaomi.svg", "#FF6900", "Xiaomi"],
  openrouter: [MODELS_DEV, "openrouter.svg", null, "OpenRouter"],
  perplexity: [MODELS_DEV, "perplexity.svg", "#1FB8CD", "Perplexity"],
  cohere: [MODELS_DEV, "cohere.svg", "#39594D", "Cohere"],
  thinkingmachines: [MODELS_DEV, "thinkingmachines.svg", null, "Thinking Machines"],
  zai: [MODELS_DEV, "zai.svg", null, "Z.AI"],
  xai: [MODELS_DEV, "xai.svg", null, "xAI"],
  liquid: [MODELS_DEV, "liquid.svg", null, "Liquid AI"],
  stepfun: [MODELS_DEV, "stepfun.svg", null, "StepFun"],
  qwen: [SIMPLE_ICONS, "qwen.svg", "#6950EF", "Qwen"],
  mistralai: [SIMPLE_ICONS, "mistralai.svg", "#FA520F", "Mistral AI"],
  tencentqq: [SIMPLE_ICONS, "tencentqq.svg", "#1EBEFF", "Tencent"],
  bytedance: [SIMPLE_ICONS, "bytedance.svg", "#3C8CFF", "ByteDance"],
  baidu: [SIMPLE_ICONS, "baidu.svg", "#2932E1", "Baidu"],
  alibabacloud: [SIMPLE_ICONS, "alibabacloud.svg", "#FF6A00", "Alibaba Cloud"],
  amazon: [SIMPLE_ICONS, "amazon.svg", "#FF9900", "Amazon"],
  ibm: [SIMPLE_ICONS, "ibm.svg", "#052FAD", "IBM"],
  huggingface: [SIMPLE_ICONS, "huggingface.svg", null, "Hugging Face"],
  ollama: [SIMPLE_ICONS, "ollama.svg", null, "Ollama"],
  lmstudio: [SIMPLE_ICONS, "lmstudio.svg", null, "LM Studio"],
  microsoft: [LOBE_ICONS, "microsoft.svg", null, "Microsoft"],
  azure: [LOBE_ICONS, "azure.svg", "#0078D4", "Azure"],
  "aion-labs": [LOBE_ICONS, "aionlabs.svg", null, "Aion Labs"],
  nousresearch: [LOBE_ICONS, "nousresearch.svg", null, "Nous Research"],
  upstage: [LOBE_ICONS, "upstage.svg", null, "Upstage"],
  rekaai: [LOBE_ICONS, "reka.svg", null, "Reka AI"],
  fireworks: [LOBE_ICONS, "fireworks.svg", null, "Fireworks"],
  morph: [LOBE_ICONS, "morph.svg", null, "Morph"],
  sakana: [LOBE_ICONS, "sakana.svg", null, "Sakana AI"],
  venice: [LOBE_ICONS, "venice.svg", null, "Venice"],
  relace: [LOBE_ICONS, "relace.svg", null, "Relace"],
  perceptron: [LOBE_ICONS, "perceptron.svg", null, "Perceptron"],
  reflection: [LOBE_ICONS, "reflection.svg", null, "Reflection"],
  llmgateway: [LOBE_ICONS, "llmgateway.svg", null, "LLM Gateway"],
  "nano-gpt": [MODELS_DEV, "nano-gpt.svg", null, "NanoGPT"],
  unbiased: [MODELS_DEV, "unbiased.svg", null, "Unbiased"]
};

const PATH_CHARS = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\-+eE\s]+$/;

// models.dev 的 alt-*.svg 是通用占位图（三颗小星），不能当品牌图标用。
function isPlaceholder(paths) {
  return paths.length === 3 && paths.some(d => d.startsWith("M9.8132 15.9038"));
}
function extract(svg, file) {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
  if (!viewBox) throw new Error(`viewBox missing: ${file}`);
  if (!/^[-+\d.eE\s]+$/.test(viewBox) || viewBox.trim().split(/\s+/).length !== 4) throw new Error(`invalid viewBox: ${file}`);
  const paths = [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(match => match[1].replace(/\s+/g, " ").trim());
  if (!paths.length) throw new Error(`path missing: ${file}`);
  if (isPlaceholder(paths)) throw new Error(`placeholder logo: ${file}`);
  for (const d of paths) if (!PATH_CHARS.test(d)) throw new Error(`unexpected path chars: ${file}`);
  return { viewBox, paths };
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

const rows = [];
for (const [slug, [base, file, hex, title]] of Object.entries(ENTRIES)) {
  const { viewBox, paths } = extract(await download(base + file), file);
  rows.push([slug, { title, hex, viewBox, paths }]);
}
rows.sort((a, b) => a[0].localeCompare(b[0]));

// 品牌图形只有 Rust 用，直接写进 crate 的数据表；data.json 其余键原样保留。
const data = JSON.parse(readFileSync(OUTPUT, "utf8"));
data.providerLogos = Object.fromEntries(rows);
writeFileSync(OUTPUT, JSON.stringify(data));
console.log(`rust/shared-rs/src/data.json providerLogos ${rows.length} 个`);
