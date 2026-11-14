// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { publicPricingProvider } from "../../core/provider-registry.js";

const pluginSource = publicPricingProvider("soleapi", "soleapi.com", null, "SoleAPI 通过公开模型价格 API 采集");

const MODEL_ALIASES = [];

export const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };
