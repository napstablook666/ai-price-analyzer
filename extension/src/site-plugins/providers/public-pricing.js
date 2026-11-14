// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { PUBLIC_PRICING_HOSTS, publicPricingProvider } from "../../core/provider-registry.js";

const pluginSource = {
  ...publicPricingProvider("public-pricing", "nomissapi.com"),
  matches: ({ hostname }) => PUBLIC_PRICING_HOSTS.has(hostname) && !["dddai.dev", "liuguang.ai"].includes(hostname)
};

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
