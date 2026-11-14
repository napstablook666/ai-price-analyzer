import { publicPricingProvider } from "@app/core/provider-registry.js";

const preset = {
  id: "dddai",
  name: "dddai.dev",
  baseUrl: "https://dddai.dev/pricing",
  enabled: true,
  mode: "direct",
  auth: { type: "none" },
  adapter: { kind: "public-pricing", endpoint: "/api/pricing", method: "GET", responseFormat: "auto" }
};

export const sitePlugin = publicPricingProvider("dddai", "dddai.dev", preset);
