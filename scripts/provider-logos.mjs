// 抓取品牌图标并生成 src/shared/provider-logos.js。
// 图形来自 models.dev/logos 与 simple-icons（CC0 1.0），只保留 <path d="…">，单色渲染。
// 用法：node scripts/provider-logos.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const OUTPUT = fileURLToPath(new URL("../src/shared/provider-logos.js", import.meta.url));
const MODELS_DEV = "https://models.dev/logos/";
const SIMPLE_ICONS = "https://cdn.jsdelivr.net/npm/simple-icons@latest/icons/";

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
  lmstudio: [SIMPLE_ICONS, "lmstudio.svg", null, "LM Studio"]
};

const PATH_CHARS = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\-+eE\s]+$/;

// models.dev 的 alt-*.svg 是通用占位图（三颗小星），不能当品牌图标用。
function isPlaceholder(paths) {
  return paths.length === 3 && paths.every(d => d.startsWith("M9.8132 15.9038"));
}
function extract(svg, file) {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1];
  if (!viewBox) throw new Error(`viewBox missing: ${file}`);
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

const body = rows.map(([slug, logo]) => {
  const paths = logo.paths.map(d => `      ${JSON.stringify(d)}`).join(",\n");
  const hex = logo.hex ? `"${logo.hex}"` : "null";
  return `  ${JSON.stringify(slug)}: {\n    title: ${JSON.stringify(logo.title)},\n    hex: ${hex},\n    viewBox: ${JSON.stringify(logo.viewBox)},\n    paths: [\n${paths}\n    ]\n  }`;
}).join(",\n");

const source = `// 由 scripts/provider-logos.mjs 抓取生成，不要手改。
// 图形来自 models.dev/logos 与 simple-icons（CC0 1.0），单色，用 currentColor 上色。
export const PROVIDER_LOGOS = {
${body}
};
`;

writeFileSync(OUTPUT, source, "utf8");
console.log(`wrote src/shared/provider-logos.js (${rows.length} logos, ${(Buffer.byteLength(source) / 1024).toFixed(1)} KB)`);