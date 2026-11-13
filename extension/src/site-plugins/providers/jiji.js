import { localStoragePageAuth, normalizeHostname, normalizePath, requestPolicy, stationContext } from "../../core/provider-registry.js";

const HOST = "jiji.cc";
const MODEL_PAGE = "/custom/13235f4cd3f1e94e";
const LEGACY_MODEL_PAGE = "/extension/models";
const MODEL_API = "/extension/api/model-market";
const MODEL_PATHS = new Set(["/", MODEL_PAGE, LEGACY_MODEL_PAGE, MODEL_API].map(normalizePath));
const isModelPath = path => MODEL_PATHS.has(normalizePath(path));

function requestConfig(value) {
  const url = value instanceof URL ? value : stationContext({ baseUrl: value }).url;
  if (!url || normalizeHostname(url.hostname) !== HOST || !isModelPath(url.pathname)) return null;
  const token = url.searchParams.get("token") || "";
  const endpoint = new URL(MODEL_API, url.origin);
  return { baseUrl: `${url.origin}${MODEL_PAGE}`, endpoint: endpoint.toString(), token };
}

function prepare(stationInput, { url }) {
  const config = requestConfig(url);
  if (!config) return stationInput;
  const inputAuth = stationInput.auth || {};
  const token = String(inputAuth.token || config.token || "").trim();
  return {
    ...stationInput,
    baseUrl: config.baseUrl,
    mode: "page",
    auth: token ? { ...inputAuth, type: "bearer", token } : inputAuth,
    adapter: { ...(stationInput.adapter || {}), kind: "jiji", endpoint: config.endpoint, method: "GET", responseFormat: "auto" }
  };
}

export const sitePlugin = {
  id: "jiji",
  host: HOST,
  matches: ({ hostname, path }) => hostname === HOST && isModelPath(path),
  prepareMatches: ({ hostname, path }) => hostname === HOST && isModelPath(path),
  prepare,
  mode: "direct",
  openTemporaryPage: true,
  rationale: "通过吉吉模型市场 API 直连采集",
  request: requestPolicy(() => MODEL_API, {
    endpointCandidates: "provider",
    credentials: "omit",
    pageHeaders: ["Authorization"],
    pageAuth: localStoragePageAuth("auth_token", "Authorization", "未找到 Jiji 登录凭据，请先在当前 Chrome 配置文件登录后重试", "Bearer", [401])
  })
};
