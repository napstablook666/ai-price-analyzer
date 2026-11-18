// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { publicPricingProvider } from "../../core/provider-registry.js";

const preset = {
  id: "liuguang",
  name: "liuguang.ai",
  baseUrl: "https://www.liuguang.ai/pricing",
  rechargeRateVerified: false,
  rechargeRateNote: "站点充值折算尚未核验，当前仅保留站点原始报价，不用于已验证人民币成本比价。",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "public-pricing", endpoint: "/api/models", method: "GET", responseFormat: "auto" }
};

const pluginSource = publicPricingProvider("liuguang", "liuguang.ai", preset);

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
