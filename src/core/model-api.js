import { isSecureRemoteUrl } from "../shared/schema.js";

const MODEL_REQUEST_TIMEOUT_MS = 15000;

function normalizeModelBaseUrl(value) {
  const input = String(value || "").trim();
  if (!input) throw new Error("请先填写模型服务地址");
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("模型服务地址必须是完整的 http(s) 地址");
  }
  if (!isSecureRemoteUrl(url)) throw new Error("模型服务地址仅允许 HTTPS；HTTP 只允许 localhost");
  if (url.username || url.password || url.search || url.hash) throw new Error("模型服务地址不能包含用户名、密码、查询参数或 hash");
  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = /\/v1(?:\/|$)/i.test(pathname) ? pathname : `${pathname}/v1`;
  return url.toString().replace(/\/$/, "");
}

function apiUrl(baseUrl, path) {
  const url = new URL(normalizeModelBaseUrl(baseUrl));
  const currentPath = url.pathname.replace(/\/+$/, "");
  if (!currentPath.endsWith(path)) url.pathname = `${currentPath}${path}`;
  return url.toString();
}

function headers(apiKey, json = false) {
  return {
    ...(json ? { "Content-Type": "application/json" } : {}),
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
  };
}

async function responseError(response) {
  let detail = "";
  try {
    detail = typeof response.text === "function" ? await response.text() : "";
  } catch {
    detail = "";
  }
  return new Error(`HTTP ${response.status}${detail ? `: ${detail.slice(0, 160)}` : ""}`);
}

async function request(fetchImpl, url, init, { signal, timeoutMs = MODEL_REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!response.ok) throw await responseError(response);
    return response;
  } catch (error) {
    if (timedOut) throw new Error(`模型请求超时（${Math.ceil(timeoutMs / 1000)} 秒）`);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function rowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.models)) return payload.models;
  return [];
}

export function parseModelCatalog(payload) {
  const rows = rowsFromPayload(payload);
  const models = rows.map(row => {
    const value = typeof row === "string" ? { id: row } : row || {};
    return {
      id: String(value.id || value.model || value.name || "").trim(),
      name: String(value.name || value.id || value.model || "").trim(),
      enabled: value.enabled !== false,
      owner: String(value.owned_by || value.ownedBy || "").trim()
    };
  }).filter(model => model.id && model.enabled);

  return [...new Map(models.map(model => [model.id, model])).values()].sort((a, b) => a.id.localeCompare(b.id));
}

export async function fetchModelCatalog({ baseUrl, apiKey, fetchImpl = fetch, signal, timeoutMs } = {}) {
  if (!String(baseUrl || "").trim()) throw new Error("请先填写模型服务地址");
  if (!String(apiKey || "").trim()) throw new Error("请先填写模型服务密钥");
  const endpoint = apiUrl(baseUrl, "/models");
  const response = await request(fetchImpl, endpoint, {
    method: "GET",
    headers: headers(String(apiKey).trim())
  }, { signal, timeoutMs });
  return {
    endpoint: response.url || endpoint,
    models: parseModelCatalog(await response.json())
  };
}

export async function testModelConnection({ baseUrl, apiKey, model, fetchImpl = fetch, signal, timeoutMs } = {}) {
  if (!String(baseUrl || "").trim()) throw new Error("请先填写模型服务地址");
  if (!String(apiKey || "").trim()) throw new Error("请先填写模型服务密钥");
  if (!String(model || "").trim()) throw new Error("请先选择或填写模型");

  const normalizedModel = String(model).trim();
  const endpoint = apiUrl(baseUrl, "/chat/completions");
  const response = await request(fetchImpl, endpoint, {
    method: "POST",
    headers: headers(String(apiKey).trim(), true),
    body: JSON.stringify({
      model: normalizedModel,
      messages: [{ role: "user", content: "请仅回复：连接正常" }],
      max_tokens: 32,
      temperature: 0
    })
  }, { signal, timeoutMs });
  const data = await response.json();
  if (!data || !Array.isArray(data.choices)) throw new Error("模型响应缺少 choices 数组");
  return {
    model: String(data.model || normalizedModel),
    usage: data.usage || null,
    response: data
  };
}

export async function completeChat({ baseUrl, apiKey, model, messages, temperature = 0, maxTokens = 0, fetchImpl = fetch, signal, timeoutMs } = {}) {
  if (!String(baseUrl || "").trim()) throw new Error("请先填写模型服务地址");
  if (!String(apiKey || "").trim()) throw new Error("请先填写模型服务密钥");
  if (!String(model || "").trim()) throw new Error("请先选择或填写模型");
  const endpoint = apiUrl(baseUrl, "/chat/completions");
  const limit = Math.trunc(Number(maxTokens) || 0);
  const response = await request(fetchImpl, endpoint, {
    method: "POST",
    headers: headers(String(apiKey).trim(), true),
    body: JSON.stringify({
      model: String(model).trim(),
      messages: Array.isArray(messages) ? messages : [],
      temperature: Math.min(1, Math.max(0, Number(temperature) || 0)),
      ...(limit > 0 ? { max_tokens: limit } : {})
    })
  }, { signal, timeoutMs: timeoutMs || 60000 });
  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("模型响应缺少正文");
  return { content, usage: data.usage || null, response: data };
}

export { normalizeModelBaseUrl, apiUrl };