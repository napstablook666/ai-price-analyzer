import { publicPricingProvider } from "../../core/provider-registry.js";

const preset = {
  id: "liuguang",
  name: "liuguang.ai",
  baseUrl: "https://www.liuguang.ai/pricing",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "public-pricing", endpoint: "/api/models", method: "GET", responseFormat: "auto" }
};

export const sitePlugin = publicPricingProvider("liuguang", "liuguang.ai", preset);
