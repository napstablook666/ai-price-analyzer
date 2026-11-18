// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { publicPricingProvider } from "../../core/provider-registry.js";

const preset = {
  id: "dddai",
  name: "dddai.dev",
  baseUrl: "https://dddai.dev/pricing",
  rechargeRateVerified: false,
  rechargeRateNote: "站点充值折算尚未核验，当前仅保留站点原始报价，不用于已验证人民币成本比价。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "public-pricing", endpoint: "/api/pricing", method: "GET", responseFormat: "auto" }
};

const pluginSource = publicPricingProvider("dddai", "dddai.dev", preset);

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
