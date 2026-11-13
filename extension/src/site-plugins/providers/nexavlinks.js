import { NEXA_CHANNEL_CATALOG_ENDPOINT, requestPolicy } from "../../core/provider-registry.js";

const preset = {
  id: "nexavlinks",
  name: "NexaVlinks",
  baseUrl: "https://www.nexavlinks.com/modelsmarket",
  enabled: true,
  mode: "page",
  auth: { type: "none" },
  adapter: { endpoint: NEXA_CHANNEL_CATALOG_ENDPOINT, method: "GET", responseFormat: "auto" }
};

export const sitePlugin = {
  id: "nexavlinks",
  host: "nexavlinks.com",
  matches: ({ hostname }) => hostname === "nexavlinks.com",
  prepare: (stationInput, { url }) => ({
    ...stationInput,
    baseUrl: `${url.origin}/modelsmarket`,
    mode: "page",
    auth: { type: "none" },
    adapter: { ...(stationInput.adapter || {}), endpoint: NEXA_CHANNEL_CATALOG_ENDPOINT, method: "GET", responseFormat: "auto" }
  }),
  mode: "page",
  openTemporaryPage: true,
  rationale: "NexaVlinks 通过已登录页面读取模型渠道",
  preset,
  request: requestPolicy(() => NEXA_CHANNEL_CATALOG_ENDPOINT, { credentials: "include" })
};
