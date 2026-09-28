const REQUEST_TYPE = "AI_RELAY_PAGE_BRIDGE_REQUEST";
const CAPTURE_REQUEST_TYPE = "AI_RELAY_PAGE_CAPTURE_REQUEST";
const RESPONSE_TYPE = "AI_RELAY_PAGE_BRIDGE_RESPONSE";
const ALLOWED_METHODS = new Set(["GET", "POST"]);
const ALLOWED_HEADERS = new Set(["accept", "content-type", "authorization", "x-api-key", "x-trpc-source"]);
let capturedPricing = null;
const MAX_CAPTURE_BYTES = 512 * 1024;
const CAPTURE_TTL_MS = 30_000;
const PRICING_KEYS = new Set([
  "model_ratio", "ratio", "input_ratio", "input_price", "inputPrice", "input", "prompt_price",
  "output_price", "outputPrice", "output", "completion_price", "cache_read_price", "cacheReadPrice",
  "cache_write_price", "cacheWritePrice", "request_price", "requestPrice", "image_price", "imagePrice",
  "per_image_price", "image_output_price", "imageOutputPrice", "image_token_price", "billing_expr", "price"
].map(key => key.toLowerCase()));
const PRICING_CONTAINERS = new Set([
  "data", "models", "pricing", "groups", "providers", "model_info", "group_prices", "model_group",
  "modelprice", "modelratio", "price_info", "billing", "default"
].map(key => key.toLowerCase()));

function isPricingUrl(value) {
  try {
    const path = new URL(String(value || ""), window.location.href).pathname;
    return /(?:\/api\/(?:ai\/)?pricing|\/api\/v1\/model-plaza|\/extension\/api\/trpc\/extension\.modelMarket|\/api\/models)/i.test(path);
  } catch {
    return false;
  }
}

function payloadFitsCaptureLimit(payload) {
  try { return JSON.stringify(payload).length <= MAX_CAPTURE_BYTES; } catch { return false; }
}

function hasPricingShape(value, depth = 0) {
  if (!value || depth > 4) return false;
  if (Array.isArray(value)) return value.some(item => hasPricingShape(item, depth + 1));
  if (typeof value !== "object") return false;
  for (const [key, current] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (PRICING_KEYS.has(normalizedKey)) {
      if (normalizedKey === "billing_expr") {
        if (typeof current === "string" && current.includes("tier(")) return true;
      } else if (typeof current === "object" && current) {
        if (hasPricingShape(current, depth + 1)) return true;
      } else if (current !== "" && Number.isFinite(Number(current))) {
        return true;
      }
    }
    if (PRICING_CONTAINERS.has(normalizedKey)) {
      if (normalizedKey === "modelratio" && current && typeof current === "object" && Object.values(current).some(value => value !== "" && Number.isFinite(Number(value)))) return true;
      if (hasPricingShape(current, depth + 1)) return true;
    }
  }
  return false;
}

function rememberPricing(payload, source) {
  if (!payload || typeof payload !== "object" || !payloadFitsCaptureLimit(payload)) return;
  const candidate = payload.data?.json || payload.data || payload.result?.data?.json || payload.result?.data || payload.result || payload;
  if (hasPricingShape(candidate)) capturedPricing = { payload, source, url: window.location.href, capturedAt: Date.now() };
}

function takeCapturedPricing() {
  const current = capturedPricing;
  capturedPricing = null;
  if (!current || current.url !== window.location.href || Date.now() - current.capturedAt > CAPTURE_TTL_MS) return null;
  return current.payload;
}

function firstNumber(text) {
  const match = String(text || "").replace(/,/g, "").match(/-?(?:\d+(?:\.\d+)?|\.\d+)/);
  return match ? Number(match[0]) : null;
}

function detectPriceCurrency(text) {
  return /credits?/i.test(text) ? "CREDITS" : /cny|rmb|¥|￥/i.test(text) ? "CNY" : "USD";
}

function directText(node) {
  return Array.from(node?.childNodes || []).filter(child => child.nodeType === 3).map(child => child.textContent).join(" ").trim();
}

function findExactTextElement(root, labels) {
  const wanted = labels.map(value => String(value || "").trim().toLowerCase().replace(/[：:]\s*$/, ""));
  return Array.from(root.querySelectorAll("*")).find(element => element.children.length === 0 && wanted.includes(String(element.textContent || "").trim().toLowerCase().replace(/[：:]\s*$/, "")));
}

function readTokenPrice(card, labels) {
  const label = findExactTextElement(card, labels);
  const block = label?.parentElement;
  if (!block) return null;
  const unit = Array.from(block.querySelectorAll("*")).find(element => element.children.length === 0 && /(?:credits?|usd|cny|rmb|[$€¥￥])?\s*\/\s*(?:m|1m|million|百万|tokens?)/i.test(element.textContent.trim()));
  if (!unit?.parentElement) return null;
  const priceNode = unit.parentElement;
  const direct = Array.from(priceNode.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent).join(" ");
  const value = firstNumber(direct) ?? firstNumber(priceNode.textContent);
  const approximateNode = priceNode.parentElement && Array.from(priceNode.parentElement.querySelectorAll("*")).find(element => /≈\s*[¥￥]/.test(element.textContent) && Array.from(element.childNodes).some(node => node.nodeType === 3 && /[¥￥]\s*\d/.test(node.textContent)));
  const approximateText = approximateNode ? Array.from(approximateNode.childNodes).filter(node => node.nodeType === 3).map(node => node.textContent).join(" ") : "";
  const approximateValue = firstNumber(approximateText);
  return { value: Number.isFinite(value) ? value : null, approximateRmb: Number.isFinite(approximateValue) ? approximateValue : null, currency: detectPriceCurrency(unit.textContent) };
}

function readRequestPrice(card) {
  const label = findExactTextElement(card, ["按次计费", "按次", "request"]);
  const block = label?.parentElement;
  if (!block) return null;
  const value = firstNumber((block.querySelector(".value") || block).textContent);
  return { value: Number.isFinite(value) ? value : null, approximateRmb: null, currency: detectPriceCurrency(block.textContent) };
}

function readTablePrice(cell) {
  const text = cell?.textContent?.trim() || "";
  const value = firstNumber(text);
  return Number.isFinite(value) ? { value, approximateRmb: null, currency: detectPriceCurrency(text) } : null;
}

function getCardModelInfo(card) {
  const id = (card.id || card.dataset.modelId || card.dataset.model || "").trim();
  const link = card.querySelector('a[href*="/models/"]');
  const nameNode = card.querySelector(".aml-model-name, .name") || card.querySelector(".aml-name-cell > div > div");
  const amlName = directText(nameNode) || nameNode?.textContent?.trim() || "";
  const displayName = (link?.textContent || card.querySelector("h2,h3,h4")?.textContent || amlName || id).trim();
  const codeName = card.querySelector(".font-mono")?.textContent.trim();
  const providerNode = card.querySelector(".aml-tag.alt, .aml-pill") || Array.from(card.querySelectorAll("span,div")).find(element => {
    const text = element.textContent.trim();
    return element.children.length === 0 && /[·•]/.test(text) && /(上下文|context)/i.test(text);
  });
  const provider = providerNode ? providerNode.textContent.split(/[·•]/)[0].trim() : "";
  return { modelName: id || codeName || amlName || displayName, displayName: displayName || id, provider };
}

function addDomPricingItem(data, info, inputPrice, outputPrice, requestPrice, cachePrice, groupName) {
  const hasTokenPrice = inputPrice?.value !== null && inputPrice?.value >= 0 && outputPrice?.value !== null && outputPrice?.value >= 0;
  const hasRequestPrice = requestPrice?.value !== null && requestPrice?.value >= 0;
  if (!info.modelName || (!hasTokenPrice && !hasRequestPrice)) return;
  const tokenInput = hasTokenPrice ? inputPrice : { value: 0, approximateRmb: null, currency: requestPrice.currency };
  const tokenOutput = hasTokenPrice ? outputPrice : { value: 0, approximateRmb: null, currency: tokenInput.currency };
  const useRmb = hasTokenPrice && tokenInput.approximateRmb !== null && tokenOutput.approximateRmb !== null;
  const inputValue = useRmb ? tokenInput.approximateRmb : tokenInput.value;
  const outputValue = useRmb ? tokenOutput.approximateRmb : tokenOutput.value;
  const cacheValue = cachePrice && Number.isFinite(cachePrice.value) ? (useRmb ? cachePrice.approximateRmb : cachePrice.value) : null;
  data.push({
    model_name: info.modelName,
    model_display_name: info.displayName,
    input_price: inputValue,
    output_price: outputValue,
    model_ratio: inputValue / 2,
    completion_ratio: inputValue > 0 ? outputValue / inputValue : 1,
    request_price: hasRequestPrice ? requestPrice.value : null,
    cache_read_price: Number.isFinite(cacheValue) ? cacheValue : null,
    price_currency: useRmb ? "CNY" : tokenInput.currency,
    enable_groups: [groupName],
    proxy_group_name: groupName,
    evidence: "dom"
  });
}

function parseSinanPricingTable() {
  if (!/compute\.sinanlab\.com$/i.test(window.location.hostname) || window.location.pathname !== "/") return null;
  const modelId = window.location.hash.slice(3);
  const table = document.querySelector("#tbl");
  if (!table || !modelId) return null;
  const data = Array.from(table.querySelectorAll("tbody tr"), row => {
    const cells = Array.from(row.children, cell => cell.textContent.trim());
    const channel = cells[0]?.replace(/\s+/g, " ");
    const outputPrice = firstNumber(cells[1]);
    const inputPrice = firstNumber(cells[2]);
    if (!channel || !Number.isFinite(inputPrice) || !Number.isFinite(outputPrice)) return null;
    return { model_name: modelId, model_display_name: modelId, input_price: inputPrice, output_price: outputPrice, model_ratio: inputPrice / 2, completion_ratio: inputPrice > 0 ? outputPrice / inputPrice : 1, request_price: null, cache_read_price: null, cache_write_price: null, price_currency: "USD", enable_groups: [channel], proxy_group_name: channel, group_ratio: 1, evidence: "dom" };
  }).filter(Boolean);
  return data.length ? { sourceFormat: "sinan-dom", data, group_ratio: Object.fromEntries(data.map(item => [item.proxy_group_name, 1])) } : null;
}

function parseModelPricingCards() {
  const groupName = window.location.hostname.replace(/^www\./i, "") || "页面价格";
  const data = [];
  document.querySelectorAll("article, div.group.relative, .aml-card-item, .aml-row").forEach(card => {
    if (card.querySelector("article, div.group.relative, .aml-card-item, .aml-row")) return;
    const info = getCardModelInfo(card);
    addDomPricingItem(data, info, readTokenPrice(card, ["输入", "输入价格", "input"]), readTokenPrice(card, ["输出", "输出价格", "output"]), readRequestPrice(card), readTokenPrice(card, ["缓存", "缓存读取", "cache", "cache read"]), groupName);
  });
  document.querySelectorAll(".aml-table tbody tr").forEach(row => {
    const info = getCardModelInfo(row);
    const cells = Array.from(row.querySelectorAll("td.num"));
    if (cells.length === 1 && /\/\s*(?:次|request)/i.test(cells[0].textContent)) addDomPricingItem(data, info, null, null, readTablePrice(cells[0]), null, groupName);
    else addDomPricingItem(data, info, readTablePrice(cells[0]), readTablePrice(cells[1]), null, readTablePrice(cells[2]), groupName);
  });
  return data.length ? { sourceFormat: "dom", data, group_ratio: { [groupName]: 1 } } : null;
}

function scanPricing() {
  return parseSinanPricingTable() || takeCapturedPricing() || parseModelPricingCards();
}

async function capturePricing() {
  return scanPricing();
}

function validateRequest(request) {
  if (!request || typeof request.url !== "string") throw new Error("页面请求缺少地址");
  const url = new URL(request.url, window.location.href);
  if (url.origin !== window.location.origin) throw new Error("页面请求必须同源");
  const method = String(request.method || "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new Error("页面请求方式不受支持");
  const headers = {};
  for (const [name, value] of Object.entries(request.headers || {})) if (ALLOWED_HEADERS.has(name.toLowerCase()) && typeof value === "string") headers[name] = value;
  return { url: url.toString(), method, headers, body: method === "POST" && typeof request.body === "string" ? request.body : undefined };
}

function clearCapturedPricing() {
  capturedPricing = null;
}

function rememberNavigation() {
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function(...args) {
      const result = original.apply(this, args);
      clearCapturedPricing();
      return result;
    };
  }
  window.addEventListener("popstate", clearCapturedPricing);
}

function rememberFetches() {
  const nativeFetch = window.fetch;
  if (typeof nativeFetch === "function") window.fetch = async function(...args) {
    const response = await nativeFetch.apply(this, args);
    if (isPricingUrl(args[0])) {
      const contentLength = Number(response.headers?.get?.("content-length"));
      if (!Number.isFinite(contentLength) || contentLength <= MAX_CAPTURE_BYTES) response.clone().json().then(payload => rememberPricing(payload, "fetch")).catch(() => {});
    }
    return response;
  };
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) { this.__aiRelayUrl = url; return nativeOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function(...args) {
    if (isPricingUrl(this.__aiRelayUrl)) this.addEventListener("load", () => { try { if (this.responseText.length <= MAX_CAPTURE_BYTES) rememberPricing(JSON.parse(this.responseText), "xhr"); } catch {} }, { once: true });
    return nativeSend.apply(this, args);
  };
}

rememberNavigation();
rememberFetches();
window.addEventListener("message", async event => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const { type, id, request } = event.data || {};
  if (typeof id !== "string" || !id) return;
  if (type === CAPTURE_REQUEST_TYPE) {
    const payload = await capturePricing();
    window.postMessage({ type: RESPONSE_TYPE, id, ok: Boolean(payload), response: { ok: Boolean(payload), status: payload ? 200 : 404, body: payload || { data: [], group_ratio: {} } } }, window.location.origin);
    return;
  }
  if (type !== REQUEST_TYPE) return;
  try {
    const safeRequest = validateRequest(request);
    const { url, ...init } = safeRequest;
    const response = await fetch(url, { ...init, credentials: "include" });
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("json") ? await response.json() : await response.text();
    if (!payloadFitsCaptureLimit(body)) throw new Error("页面响应过大");
    rememberPricing(body, "bridge");
    window.postMessage({ type: RESPONSE_TYPE, id, ok: true, response: { ok: response.ok, status: response.status, body } }, window.location.origin);
  } catch (error) {
    window.postMessage({ type: RESPONSE_TYPE, id, ok: false, error: error.message }, window.location.origin);
  }
});
