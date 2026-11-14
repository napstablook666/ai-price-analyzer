import { providerForStation, stationContext } from "./provider-registry.js";

const AUTH_TYPES = new Set(["none", "bearer", "api-key", "basic"]);

function normalizeEndpoint(value) {
  const endpoint = String(value || "").trim();
  if (!endpoint) return "";
  if (/^https?:\/\//i.test(endpoint)) return new URL(endpoint).pathname || "/";
  return endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
}

export function inferStationAdapter(station = {}) {
  const url = stationContext(station).url;
  const signal = `${station.name || ""} ${station.baseUrl || ""} ${url?.pathname || ""}`.toLowerCase();
  const current = station.adapter || {};
  const provider = providerForStation(station);
  const context = stationContext(station);
  const inferredPath = url?.pathname && url.pathname !== "/" ? url.pathname : "/api/ai/pricing";
  const inferredEndpoint = /^(?:\/api|\/v\d+|\/openai|\/anthropic|\/extension)(?:\/|$)/i.test(inferredPath) ? inferredPath : `/api${inferredPath}`;
  const providerEndpoint = provider?.request?.endpoint;
  const knownEndpoint = (typeof providerEndpoint === "function" ? providerEndpoint(context) : providerEndpoint) || "";
  const endpoint = knownEndpoint || (current.endpoint && current.endpoint !== "/api/ai/pricing"
    ? normalizeEndpoint(current.endpoint)
    : inferredEndpoint);
  const isKnownApi = provider?.mode === "direct";
  const isKnownPage = provider?.mode === "page";
  const responseFormat = provider?.responseFormat || (isKnownApi || isKnownPage ? "auto" : signal.includes("sora") ? "sora" : signal.includes("pqh") || signal.includes("p站") ? "pqh" : "auto");
  const mode = isKnownApi ? "direct" : isKnownPage || station.mode === "page" ? "page" : "direct";
  return {
    mode,
    endpoint,
    method: isKnownApi || isKnownPage ? "GET" : current.method === "POST" ? "POST" : "GET",
    responseFormat,
    authType: provider?.authType === "none" ? "none" : AUTH_TYPES.has(station.auth?.type) ? station.auth.type : "none",
    source: "local",
    confidence: isKnownApi || isKnownPage ? 96 : responseFormat === "auto" && endpoint === "/api/ai/pricing" ? 48 : 72,
    rationale: provider?.rationale || "已按站点地址和现有采集规则推断"
  };
}
