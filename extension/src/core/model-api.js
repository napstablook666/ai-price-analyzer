import { isSecureRemoteUrl } from "../shared/schema.js";

export const MODEL_REQUEST_TIMEOUT_MS = 15000;

const JEV_PROBE_STATE = {
  judgment_language: "zh",
  translation_note: "state 为中文原文，答案可直接用于中文流程。",
  jd: "岗位职责：负责门店客户接待。任职要求：能接受排班。薪资：无责底薪 4000，达标才发足，未达标按提成计。"
};

const JEV_PROBE_QUESTIONS = {
  income_hype: {
    type: "noul",
    instructions: "岗位是否用「无责底薪 / 达标才发足」这类收入话术描述薪酬？"
  }
};

function normalizeModelBaseUrl(value) {
  const input = String(value || "").trim();
  if (!input) throw new Error("请先填写模型 API 地址");
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("模型 API 地址必须是完整的 http(s) 地址");
  }
  if (!isSecureRemoteUrl(url)) throw new Error("模型 API 地址仅允许 HTTPS；HTTP 只允许 localhost");
  if (url.username || url.password || url.search || url.hash) throw new Error("模型 API 地址不能包含用户名、密码、查询参数或 hash");
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

function jevApiUrl(baseUrl, path) {
  const url = new URL(normalizeModelBaseUrl(baseUrl));
  const pathname = url.pathname.replace(/\/+$/, "");
  const root = pathname.replace(/\/systemone$/i, "");
  url.pathname = path === "/models" ? `${root}/models` : `${root}/systemone`;
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

export function parseModelCatalog(payload, kind = "llm") {
  const rows = rowsFromPayload(payload);
  const models = rows.map(row => {
    const value = typeof row === "string" ? { id: row } : row || {};
    return {
      id: String(value.id || value.model || value.name || "").trim(),
      name: String(value.name || value.id || value.model || "").trim(),
      kind: String(value.kind || "").trim(),
      enabled: value.enabled !== false,
      owner: String(value.owned_by || value.ownedBy || "").trim()
    };
  }).filter(model => model.id && model.enabled);

  const unique = [...new Map(models.map(model => [model.id, model])).values()];
  if (kind !== "jev") return unique.sort((a, b) => a.id.localeCompare(b.id));
  return unique.filter(model => /^jev(?:-|$)/i.test(model.id))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function fetchModelCatalog({ baseUrl, apiKey, kind = "llm", fetchImpl = fetch, signal, timeoutMs } = {}) {
  if (!String(baseUrl || "").trim()) throw new Error("请先填写模型 API 地址");
  if (!String(apiKey || "").trim()) throw new Error("请先填写模型 API Key");
  const endpoint = kind === "jev" ? jevApiUrl(baseUrl, "/models") : apiUrl(baseUrl, "/models");
  const response = await request(fetchImpl, endpoint, {
    method: "GET",
    headers: headers(String(apiKey).trim())
  }, { signal, timeoutMs });
  return {
    endpoint: response.url || endpoint,
    models: parseModelCatalog(await response.json(), kind)
  };
}

export async function testModelConnection({ baseUrl, apiKey, model, kind = "llm", fetchImpl = fetch, signal, timeoutMs } = {}) {
  if (!String(baseUrl || "").trim()) throw new Error("请先填写模型 API 地址");
  if (!String(apiKey || "").trim()) throw new Error("请先填写模型 API Key");
  if (!String(model || "").trim()) throw new Error("请先选择或填写模型");

  const normalizedModel = String(model).trim();
  const isJev = kind === "jev";
  const endpoint = isJev ? jevApiUrl(baseUrl, "/systemone") : apiUrl(baseUrl, "/chat/completions");
  const response = await request(fetchImpl, endpoint, {
    method: "POST",
    headers: headers(String(apiKey).trim(), true),
    body: JSON.stringify(isJev ? {
      model: normalizedModel,
      state: JEV_PROBE_STATE,
      questions: JEV_PROBE_QUESTIONS
    } : {
      model: normalizedModel,
      messages: [{ role: "user", content: "请仅回复：连接正常" }],
      max_tokens: 32,
      temperature: 0
    })
  }, { signal, timeoutMs });
  const data = await response.json();

  if (isJev && (!data || typeof data.answers !== "object" || Array.isArray(data.answers))) {
    throw new Error("JEV 响应缺少 answers 对象");
  }
  if (!isJev && (!data || !Array.isArray(data.choices))) {
    throw new Error("LLM 响应缺少 choices 数组");
  }
  return {
    model: String(data.model || normalizedModel),
    usage: data.usage || null,
    response: data
  };
}

export { apiUrl, jevApiUrl, normalizeModelBaseUrl };
