import { PUBLIC_PRICING_HOSTS, publicPricingProvider } from "@app/core/provider-registry.js";

export const sitePlugin = {
  ...publicPricingProvider("public-pricing", "nomissapi.com"),
  matches: ({ hostname }) => PUBLIC_PRICING_HOSTS.has(hostname) && !["dddai.dev", "liuguang.ai"].includes(hostname)
};
