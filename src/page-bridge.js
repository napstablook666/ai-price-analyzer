(() => {
  const PAGE_BRIDGE_VERSION = 6;
  // MAIN world 的脚本活到页面关闭为止，扩展重载它也不会退场。旧实现靠一个手写版本号决定
  // 「要不要重新注入」：改完行为忘记把数字加 1，页面里就一直跑着几个月前的逻辑，扩展还以为
  // 它是最新的，报出来的错也是旧的。现在每次注入都先把上一轮装的 listener 与 fetch/XHR 补丁
  // 拆干净再重装，重复注入等于原地升级，正确性不再依赖人工记版本号。
  const previousTeardown = window.__AI_PRICING_PAGE_BRIDGE_TEARDOWN__;
  if (typeof previousTeardown === "function") {
    try { previousTeardown(); } catch {}
  }
  const nativeFetch = typeof window.fetch === "function" ? window.fetch : null;
  const nativeXhrOpen = XMLHttpRequest.prototype.open;
  const nativeXhrSend = XMLHttpRequest.prototype.send;
  const nativePushState = history.pushState;
  const nativeReplaceState = history.replaceState;
  window.__AI_PRICING_PAGE_BRIDGE__ = true;
  window.__AI_PRICING_PAGE_BRIDGE_VERSION__ = PAGE_BRIDGE_VERSION;
const PAGE_WINDOW_REQUEST_TYPE = "AI_RELAY_PAGE_BRIDGE_REQUEST_V6";
const PAGE_WINDOW_CAPTURE_REQUEST_TYPE = "AI_RELAY_PAGE_CAPTURE_REQUEST_V6";
const PAGE_WINDOW_RESPONSE_TYPE = "AI_RELAY_PAGE_BRIDGE_RESPONSE_V6";
const PAGE_WINDOW_AUTH_RENEWAL_TYPE = "AI_RELAY_PAGE_AUTH_RENEWAL_V6";
const ALLOWED_METHODS = new Set(["GET", "POST"]);
const ALLOWED_HEADERS = new Set(["accept", "content-type", "authorization", "x-api-key", "x-trpc-source", "x-user-ui-request", "new-api-user"]);
const ALLOWED_CREDENTIALS = new Set(["omit", "same-origin", "include"]);
// 不少站点把裸域 301 到 www（jiji.cc → www.jiji.cc）。插件里写的裸域地址原样发出去，
// 浏览器先吃一次跨域重定向，而 fetch 在跨域重定向时会把 Authorization 丢掉，接口那边就成了未登录。
// 所以 www 与非 www 视为同一个站点，但请求必须落到页面当前 origin，一个字节都不外送。
function isSameSiteOrigin(origin, reference) {
  if (origin === reference) return true;
  let left;
  let right;
  try {
    left = new URL(origin);
    right = new URL(reference);
  } catch {
    return false;
  }
  if (left.protocol !== right.protocol || left.port !== right.port) return false;
  return left.hostname.toLowerCase().replace(/^www\./, "") === right.hostname.toLowerCase().replace(/^www\./, "");
}

function alignToPageOrigin(url) {
  if (url.origin === window.location.origin) return url;
  const page = new URL(window.location.href);
  url.protocol = page.protocol;
  url.hostname = page.hostname;
  url.port = page.port;
  return url;
}
let capturedPricing = null;
const MAX_CAPTURE_BYTES = 512 * 1024;
const CAPTURE_TTL_MS = 30_000;
const PRICING_KEYS = new Set([
  "model_ratio", "ratio", "input_ratio", "input_price", "inputPrice", "input", "prompt_price",
  "output_price", "outputPrice", "output", "completion_price", "cache_read_price", "cacheReadPrice",
  "cache_write_price", "cacheWritePrice", "request_price", "requestPrice", "image_price", "imagePrice",
  "per_image_price", "image_output_price", "imageOutputPrice", "image_token_price", "inputPer1M", "outputPer1M", "cacheReadPer1M", "cacheCreatePer1M", "cacheCreate1hPer1M", "billingMultiplier", "billing_expr", "price"
].map(key => key.toLowerCase()));
const PRICING_CONTAINERS = new Set([
  "data", "models", "pricing", "groups", "providers", "channels", "platforms", "supported_models", "group_pricing", "sections",
  "model_info", "group_prices", "model_group", "modelprice", "modelratio", "price_info", "billing", "effective", "base", "default"
].map(key => key.toLowerCase()));

function isFastAiChannelsUrl(value) {
  try {
    const url = new URL(String(value || ""), window.location.href);
    return url.hostname.toLowerCase().replace(/^www\./, "") === "fastaitoken.com" && url.pathname === "/api/v1/channels/available";
  } catch {
    return false;
  }
}

function isHepinganChannelsUrl(value) {
  try {
    const url = new URL(String(value || ""), window.location.href);
    return url.hostname.toLowerCase() === "api.hepingan.top" && url.pathname === "/api/v1/channels/available";
  } catch {
    return false;
  }
}


function isPricingUrl(value) {
  try {
    const path = new URL(String(value || ""), window.location.href).pathname;
    return isFastAiChannelsUrl(value) || isHepinganChannelsUrl(value) || /(?:\/api\/(?:ai\/)?pricing|\/api\/v1\/model-plaza|\/api\/v1\/channels\/catalog|\/extension\/api\/trpc\/extension\.modelMarket|\/api\/models|\/api\/me\/model-catalog)/i.test(path);
  } catch {
    return false;
  }
}

function payloadFitsCaptureLimit(payload) {
  try { return JSON.stringify(payload).length <= MAX_CAPTURE_BYTES; } catch { return false; }
}

function hasPricingShape(value, depth = 0) {
  if (!value || depth > 8) return false;
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
  return Array.from(root.querySelectorAll("*")).find(element => {
    if (element.children.length !== 0) return false;
    const text = String(element.textContent || "").trim().toLowerCase().replace(/[：:]\s*$/, "");
    return wanted.some(label => label.endsWith("*") ? text.startsWith(label.slice(0, -1)) : text === label);
  });
}

function readTokenPrice(card, labels, unitPattern = /(?:credits?|usd|cny|rmb|[$€¥￥])?\s*\/\s*(?:m|1m|million|百万|tokens?)/i) {
  const label = findExactTextElement(card, labels);
  const block = label?.parentElement;
  if (!block) return null;
  const sibling = label.nextElementSibling;
  const unit = sibling && unitPattern.test(sibling.textContent)
    ? sibling
    : Array.from(block.querySelectorAll("*")).find(element => element.children.length === 0 && unitPattern.test(element.textContent.trim()));
  if (!unit) return null;
  const priceNode = unit === sibling ? unit : unit.parentElement;
  if (!priceNode) return null;
  const valueNode = priceNode.querySelector("b, strong, .font-semibold, .value");
  const value = firstNumber(valueNode?.textContent || priceNode.textContent);
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

function addDomPricingItem(data, info, inputPrice, outputPrice, requestPrice, cachePrice, groupName, cacheWritePrice = null, imageOutputPrice = null, imagePrice = null) {
  const hasTokenPrice = inputPrice?.value !== null && inputPrice?.value >= 0 && outputPrice?.value !== null && outputPrice?.value >= 0;
  const hasRequestPrice = requestPrice?.value !== null && requestPrice?.value >= 0;
  const hasImageOutputPrice = imageOutputPrice?.value !== null && imageOutputPrice?.value >= 0;
  const hasImagePrice = imagePrice?.value !== null && imagePrice?.value >= 0;
  if (!info.modelName || (!hasTokenPrice && !hasRequestPrice && !hasImageOutputPrice && !hasImagePrice)) return;
  const fallbackPrice = requestPrice || imagePrice || imageOutputPrice;
  const tokenInput = hasTokenPrice ? inputPrice : { value: 0, approximateRmb: null, currency: fallbackPrice?.currency || "USD" };
  const tokenOutput = hasTokenPrice ? outputPrice : { value: 0, approximateRmb: null, currency: tokenInput.currency };
  const useRmb = hasTokenPrice && tokenInput.currency !== "CREDITS" && tokenInput.approximateRmb !== null && tokenOutput.approximateRmb !== null;
  const inputValue = useRmb ? tokenInput.approximateRmb : tokenInput.value;
  const outputValue = useRmb ? tokenOutput.approximateRmb : tokenOutput.value;
  const cacheValue = cachePrice && Number.isFinite(cachePrice.value) ? (useRmb ? cachePrice.approximateRmb : cachePrice.value) : null;
  const cacheWriteValue = cacheWritePrice && Number.isFinite(cacheWritePrice.value) ? (useRmb ? cacheWritePrice.approximateRmb : cacheWritePrice.value) : null;
  data.push({
    model_name: info.modelName,
    model_display_name: info.displayName,
    input_price: inputValue,
    output_price: outputValue,
    model_ratio: inputValue / 2,
    completion_ratio: inputValue > 0 ? outputValue / inputValue : 1,
    request_price: hasRequestPrice ? requestPrice.value : null,
    image_output_price: hasImageOutputPrice ? imageOutputPrice.value : null,
    image_price: hasImagePrice ? imagePrice.value : null,
    cache_read_price: Number.isFinite(cacheValue) ? cacheValue : null,
    cache_write_price: Number.isFinite(cacheWriteValue) ? cacheWriteValue : null,
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

function readCheapRouterPrice(card, labels) {
  const text = String(card.textContent || "").replace(/\s+/g, " ").trim();
  for (const label of labels) {
    const start = text.toLowerCase().indexOf(String(label).toLowerCase());
    if (start < 0) continue;
    const rest = text.slice(start + String(label).length);
    const boundary = rest.search(/(?:输入|输出|缓存|cache|按次|request|图像|image)/i);
    const section = rest.slice(0, boundary < 0 ? 200 : boundary);
    const match = section.match(/实付价[^0-9¥￥$€]{0,60}([¥￥$€]?)\s*(-?(?:\d+(?:\.\d+)?|\.\d+))/i);
    if (!match) continue;
    const value = Number(match[2]);
    if (!Number.isFinite(value) || value < 0) continue;
    return { value, approximateRmb: null, currency: /[¥￥]/.test(match[1]) ? "CNY" : detectPriceCurrency(section) };
  }
  return null;
}

function cheapRouterGroupName(card) {
  return Array.from(card.querySelectorAll("span,div,p"))
    .map(element => element.children.length === 0 ? element.textContent.trim() : "")
    .find(text => text && text.length <= 80 && /分组$|group$/i.test(text) && !/同模型共/i.test(text)) || "cheaprouter.cc";
}

function parseCheapRouterPricingCards() {
  const url = new URL(window.location.href);
  if (url.hostname.toLowerCase().replace(/^www\./, "") !== "cheaprouter.cc" || url.pathname.replace(/\/$/, "") !== "/models") return null;
  const data = [];
  document.querySelectorAll('article, [role="article"]').forEach(card => {
    if (card.querySelector('article, [role="article"]')) return;
    addDomPricingItem(
      data,
      getCardModelInfo(card),
      readCheapRouterPrice(card, ["输入", "input"]),
      readCheapRouterPrice(card, ["输出", "output"]),
      null,
      readCheapRouterPrice(card, ["缓存读取", "缓存读", "cache read"]),
      cheapRouterGroupName(card),
      readCheapRouterPrice(card, ["缓存写入", "缓存写", "cache write"])
    );
  });
  return data.length ? { sourceFormat: "cheaprouter-dom", data, group_ratio: {} } : null;
}

function parseSoleApiPricingCards() {
  if (window.location.hostname.toLowerCase().replace(/^www\./, "") !== "soleapi.com") return null;
  const groupName = "soleapi.com";
  const data = [];
  const seen = new Set();
  for (const link of document.querySelectorAll('a[href*="/models/"]')) {
    const href = link.href;
    if (seen.has(href)) continue;
    let card = link.parentElement;
    while (card && card !== document.body) {
      if (card.querySelectorAll('a[href*="/models/"]').length === 1) {
        const input = readTokenPrice(card, ["输入", "输入价格", "input"]);
        const output = readTokenPrice(card, ["输出", "输出价格", "output"]);
        const request = readRequestPrice(card);
        const imageOutput = readTokenPrice(card, ["图像输出（通用）", "图像输出", "image output"]);
        const imagePrice = readTokenPrice(card, ["图像输出（通用）", "图像输出", "image output"], /(?:credits?|usd|cny|rmb|[$€¥￥])?\s*\/\s*(?:images?|张|图片|次)/i);
        if (input || output || request || imageOutput || imagePrice) {
          const before = data.length;
          addDomPricingItem(data, getCardModelInfo(card), input, output, request, readTokenPrice(card, ["缓存", "缓存读取", "cache", "cache read"]), groupName, readTokenPrice(card, ["缓存写入*", "cache write*"]), imageOutput, imagePrice);
          if (data.length > before) {
            seen.add(href);
            break;
          }
        }
      }
      card = card.parentElement;
    }
  }
  return data.length ? { sourceFormat: "dom", data, group_ratio: { [groupName]: 1 } } : null;
}

function parseModelPricingCards() {
  const groupName = window.location.hostname.replace(/^www\./i, "") || "页面价格";
  const data = [];
  document.querySelectorAll("article, div.group.relative, .aml-card-item, .aml-row").forEach(card => {
    if (card.querySelector("article, div.group.relative, .aml-card-item, .aml-row")) return;
    const info = getCardModelInfo(card);
    addDomPricingItem(data, info, readTokenPrice(card, ["输入", "输入价格", "input"]), readTokenPrice(card, ["输出", "输出价格", "output"]), readRequestPrice(card), readTokenPrice(card, ["缓存", "缓存读取", "cache", "cache read"]), groupName, readTokenPrice(card, ["缓存写入*", "cache write*"]));
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
  return parseSinanPricingTable() || parseCheapRouterPricingCards() || takeCapturedPricing() || parseSoleApiPricingCards() || parseModelPricingCards();
}

async function capturePricing() {
  return scanPricing();
}

function hasHeader(headers, name) {
  return Object.keys(headers).some(current => current.toLowerCase() === name.toLowerCase());
}

function readStorageValue(storage, key) {
  try {
    return storage ? String(storage.getItem(key) || "") : "";
  } catch {
    return "";
  }
}
function readStoredPageToken(pageAuth) {
  const storageKey = String(pageAuth?.storageKey || "");
  if (!storageKey) throw new Error("页面认证策略缺少存储键");
  // 部分站点在「不记住我」时把令牌落到 sessionStorage，两处都要读。
  const raw = String(readStorageValue(window.localStorage, storageKey) || readStorageValue(window.sessionStorage, storageKey) || "").trim();
  if (!raw) return "";
  const paths = Array.isArray(pageAuth?.storagePaths) ? pageAuth.storagePaths : [];
  if (!paths.length) return raw;
  let payload;
  try { payload = JSON.parse(raw); } catch { return raw.startsWith("{") ? "" : raw; }
  for (const path of paths) {
    const value = pathValue(payload, String(path));
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

// 采不到要说清采不到在哪：是页面停在别处，还是本机存储里压根没这个键。
// 只报键名与页面路径，令牌本身一个字都不带出来。
function listStorageKeys(storage, limit) {
  const keys = [];
  try {
    for (let index = 0; index < storage.length && keys.length < limit; index += 1) {
      const key = String(storage.key(index) || "");
      if (key) keys.push(key);
    }
  } catch {
    return [];
  }
  return keys;
}

function describePageAuthState(pageAuth) {
  const storageKey = String(pageAuth?.storageKey || "");
  const tokens = listStorageKeys(window.localStorage, 60);
  const refreshTokenKey = String(pageAuth?.refresh?.refreshTokenStorageKey || "");
  const parts = [`页面 ${window.location.pathname || "/"}`];
  parts.push(tokens.includes(storageKey) ? `${storageKey} 有键但值为空` : `localStorage 里没有 ${storageKey}`);
  if (refreshTokenKey) parts.push(tokens.includes(refreshTokenKey) ? `有 ${refreshTokenKey} 但续期没成功` : `也没有 ${refreshTokenKey}`);
  parts.push(`现有键：${tokens.length ? tokens.slice(0, 12).join("、") : "无"}`);
  return `（${parts.join("；")}）`;
}

function readStoredPath(storageKey, path) {
  if (!storageKey || !path) return "";
  let payload;
  try { payload = JSON.parse(String(window.localStorage.getItem(storageKey) || "")); } catch { return ""; }
  const value = pathValue(payload, String(path));
  return typeof value === "string" ? value.trim() : "";
}

function writeStoredPath(storageKey, path, value) {
  const keys = String(path || "").split(".").filter(Boolean);
  if (!storageKey || !keys.length) return false;
  let payload;
  try { payload = JSON.parse(String(window.localStorage.getItem(storageKey) || "")); } catch { return false; }
  if (!payload || typeof payload !== "object") return false;
  let cursor = payload;
  for (const key of keys.slice(0, -1)) {
    if (!cursor[key] || typeof cursor[key] !== "object") return false;
    cursor = cursor[key];
  }
  cursor[keys[keys.length - 1]] = value;
  window.localStorage.setItem(storageKey, JSON.stringify(payload));
  return true;
}

// 页面里的 refresh 令牌：优先按 refreshTokenPath 从存储 JSON 里取，否则按
// refreshTokenStorageKey 直接读。cookieOnly 的站没有这把令牌，换令牌只认页面 cookie。
function readStoredRefreshToken(pageAuth) {
  const refresh = pageAuth?.refresh || {};
  if (refresh.cookieOnly === true) return "";
  const refreshTokenPath = String(refresh.refreshTokenPath || "");
  if (refreshTokenPath) return readStoredPath(pageAuth.storageKey, refreshTokenPath);
  const refreshTokenKey = String(refresh.refreshTokenStorageKey || "");
  if (!refreshTokenKey) return "";
  return String(readStorageValue(window.localStorage, refreshTokenKey) || readStorageValue(window.sessionStorage, refreshTokenKey) || "").trim();
}

function writeStoredPageToken(pageAuth, token) {
  const storageKey = String(pageAuth?.storageKey || "");
  if (!storageKey) return false;
  const paths = Array.isArray(pageAuth?.storagePaths) ? pageAuth.storagePaths : [];
  if (!paths.length) {
    window.localStorage.setItem(storageKey, token);
    return true;
  }
  return writeStoredPath(storageKey, paths[0], token);
}

async function applyPageAuth(headers, pageAuth) {
  if (!pageAuth) return;
  if (typeof pageAuth !== "object" || !["cookie", "localStorage"].includes(pageAuth.source)) throw new Error("页面认证策略不受支持");
  if (pageAuth.source === "cookie") return;
  const header = String(pageAuth.header || "");
  if (!ALLOWED_HEADERS.has(header.toLowerCase())) throw new Error("页面认证请求头不受支持");
  if (hasHeader(headers, header)) return;
  let token = readStoredPageToken(pageAuth);
  if (!token && pageAuth.refresh) {
    const renewed = await refreshPageAuth(pageAuth);
    if (persistPageAuth(pageAuth, renewed)) {
      postAuthRenewal(pageAuth, renewed);
      token = readStoredPageToken(pageAuth);
    }
  }
  if (!token) throw new Error(`${pageAuth.missingMessage || "未找到页面登录凭据，请先在当前 Chrome 配置文件登录后重试"}${describePageAuthState(pageAuth)}`);
  headers[header] = pageAuth.scheme ? `${pageAuth.scheme} ${token}` : token;
  // New-Api-User 是站点用户 ID，不是秘密也不参与过期。报给 service worker 存进凭据仓，
  // 之后它自己就能拼出这个头去探活，不必为判一次存亡再开标签页。
  if (header.toLowerCase() === "new-api-user") postAuthIdentity(pageAuth, token);
  // 顺手把页面里的 refresh 令牌报一次：仓里有了它，浏览器不常开的时候 service worker
  // 也能自己续期，不用等到下一次页面续期才第一次拿到。
  const seedRefreshToken = readStoredRefreshToken(pageAuth);
  if (seedRefreshToken) postAuthRefreshSeed(pageAuth, seedRefreshToken);
}

async function validateRequest(request) {
  if (!request || typeof request.url !== "string") throw new Error("页面请求缺少地址");
  const url = new URL(request.url, window.location.href);
  if (!isSameSiteOrigin(url.origin, window.location.origin)) throw new Error("页面请求必须同源");
  alignToPageOrigin(url);
  const method = String(request.method || "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new Error("页面请求方式不受支持");
  const credentials = request.credentials == null ? "omit" : String(request.credentials);
  if (!ALLOWED_CREDENTIALS.has(credentials)) throw new Error("页面请求 credentials 不受支持");
  const headers = {};
  for (const [name, value] of Object.entries(request.headers || {})) if (ALLOWED_HEADERS.has(name.toLowerCase()) && typeof value === "string") headers[name] = value;
  await applyPageAuth(headers, request.pageAuth);
  return { url: url.toString(), method, headers, credentials, body: method === "POST" && typeof request.body === "string" ? request.body : undefined };
}

function pathValue(value, path) {
  return String(path || "").split(".").filter(Boolean).reduce((current, key) => current && typeof current === "object" ? current[key] : undefined, value);
}

// 续期只负责把新令牌交给调用方：落 localStorage 归 persistPageAuth（网页里要留一份给站点自己用，
// service worker 侧要落凭据仓），这里写死落盘会让无头续期拿不到结果。
// 返回 { ok:false } 或 { ok:true, accessToken, refreshToken, expiresAt }。
async function refreshPageAuth(pageAuth) {
  const refresh = pageAuth?.refresh;
  if (!refresh || typeof refresh !== "object") return { ok: false };
  let refreshUrl;
  try { refreshUrl = new URL(String(refresh.endpoint || ""), window.location.href); } catch { return { ok: false }; }
  if (!isSameSiteOrigin(refreshUrl.origin, window.location.origin)) return { ok: false };
  alignToPageOrigin(refreshUrl);
  const cookieOnly = refresh.cookieOnly === true;
  const refreshToken = readStoredRefreshToken(pageAuth);
  if (!cookieOnly && !refreshToken) return { ok: false };
  const headers = { Accept: "application/json", "Content-Type": "application/json" };
  const accessToken = readStoredPageToken(pageAuth);
  const authHeader = String(pageAuth.header || "");
  if (refresh.includeAccessToken === true && accessToken && ALLOWED_HEADERS.has(authHeader.toLowerCase())) headers[authHeader] = pageAuth.scheme ? `${pageAuth.scheme} ${accessToken}` : accessToken;
  const credentials = ALLOWED_CREDENTIALS.has(String(refresh.credentials || "omit")) ? String(refresh.credentials || "omit") : "omit";
  let response;
  try {
    response = await fetch(refreshUrl.toString(), {
      method: "POST",
      headers,
      credentials,
      body: cookieOnly ? undefined : JSON.stringify({ [String(refresh.requestTokenKey || "refresh_token")]: refreshToken })
    });
    if (!response.ok) return { ok: false };
    const payload = await response.json();
    const data = pathValue(payload, refresh.responsePath || "data");
    if (!data || typeof data !== "object") return { ok: false };
    const accessKey = String(refresh.accessTokenKey || "access_token");
    const nextAccessToken = String(data[accessKey] || "").trim();
    if (!nextAccessToken) return { ok: false };
    const nextRefreshToken = String(data[String(refresh.refreshTokenKey || "refresh_token")] || "").trim();
    const expiresIn = Number(data[String(refresh.expiresInKey || "")]);
    return {
      ok: true,
      accessToken: nextAccessToken,
      refreshToken: nextRefreshToken,
      expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + Math.ceil(expiresIn * 1000) : null
    };
  } catch {
    return { ok: false };
  }
}

// 令牌写回页面存储：网页里那一份要跟着更新，否则站点自己的界面还拿着旧令牌。
// 写不进去就不算续期成功，否则调用方会以为页面已同步。
function persistPageAuth(pageAuth, renewed) {
  if (!renewed?.ok) return false;
  if (!writeStoredPageToken(pageAuth, renewed.accessToken)) return false;
  const refresh = pageAuth?.refresh || {};
  const refreshTokenKey = String(refresh.refreshTokenStorageKey || "");
  const refreshTokenPath = String(refresh.refreshTokenPath || "");
  if (renewed.refreshToken) {
    if (refreshTokenPath) writeStoredPath(pageAuth.storageKey, refreshTokenPath, renewed.refreshToken);
    else if (refreshTokenKey) window.localStorage.setItem(refreshTokenKey, renewed.refreshToken);
  }
  const expiresAtKey = String(refresh.expiresAtStorageKey || "");
  if (expiresAtKey && Number.isFinite(renewed.expiresAt)) window.localStorage.setItem(expiresAtKey, String(renewed.expiresAt));
  return true;
}

// 续期结果要回给 service worker 落仓，否则页面一关令牌就丢，下一轮刷新又得重新续。
// 只回 access 令牌、轮换后的 refresh 令牌与过期时间。refresh 令牌必须回传：
// 站点每次续期都换一对，页面关掉之后无头续期只能用仓里那一份，不回传第二次必然 401。
function postAuthIdentity(pageAuth, identity) {
  const value = String(identity || "").trim();
  const stationId = String(pageAuth?.stationId || "");
  if (!value || !stationId) return;
  window.postMessage({
    type: PAGE_WINDOW_AUTH_RENEWAL_TYPE,
    renewal: { identity: value, stationId }
  }, window.location.origin);
}

function postAuthRenewal(pageAuth, renewed) {
  if (!renewed?.ok) return;
  window.postMessage({
    type: PAGE_WINDOW_AUTH_RENEWAL_TYPE,
    renewal: {
      accessToken: renewed.accessToken,
      ...(renewed.refreshToken ? { refreshToken: renewed.refreshToken } : {}),
      expiresAt: renewed.expiresAt,
      storageKey: String(pageAuth?.storageKey || ""),
      stationId: String(pageAuth?.stationId || "")
    }
  }, window.location.origin);
}

// 只报 refresh 令牌。仓里缺的就是这一块，access 令牌和登录状态留给下一次真正续期
// 的结果去写，免得「读到令牌」被当成「会话还活着」。
function postAuthRefreshSeed(pageAuth, refreshToken) {
  const value = String(refreshToken || "").trim();
  const stationId = String(pageAuth?.stationId || "");
  if (!value || !stationId) return;
  window.postMessage({
    type: PAGE_WINDOW_AUTH_RENEWAL_TYPE,
    renewal: { refreshToken: value, stationId }
  }, window.location.origin);
}

function shouldRefreshPageAuth(pageAuth, response) {
  const refresh = pageAuth?.refresh;
  const statuses = Array.isArray(refresh?.statuses) ? refresh.statuses : pageAuth?.sessionFailureStatuses;
  return Boolean(refresh && Array.isArray(statuses) && statuses.includes(Number(response?.status)));
}

async function executeRequest(request) {
  const safeRequest = await validateRequest(request);
  const { url, ...init } = safeRequest;
  return fetch(url, init);
}

function clearCapturedPricing() {
  capturedPricing = null;
}

function rememberNavigation() {
  history.pushState = function(...args) {
    const result = nativePushState.apply(this, args);
    clearCapturedPricing();
    return result;
  };
  history.replaceState = function(...args) {
    const result = nativeReplaceState.apply(this, args);
    clearCapturedPricing();
    return result;
  };
  window.addEventListener("popstate", clearCapturedPricing);
}

function rememberFetches() {
  if (nativeFetch) window.fetch = async function(...args) {
    const response = await nativeFetch.apply(this, args);
    if (isPricingUrl(args[0])) {
      const contentLength = Number(response.headers?.get?.("content-length"));
      if (!Number.isFinite(contentLength) || contentLength <= MAX_CAPTURE_BYTES) response.clone().json().then(payload => rememberPricing(payload, "fetch")).catch(() => {});
    }
    return response;
  };
  XMLHttpRequest.prototype.open = function(method, url) { this.__aiRelayUrl = url; return nativeXhrOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function(...args) {
    if (isPricingUrl(this.__aiRelayUrl)) this.addEventListener("load", () => { try { if (this.responseText.length <= MAX_CAPTURE_BYTES) rememberPricing(JSON.parse(this.responseText), "xhr"); } catch {} }, { once: true });
    return nativeXhrSend.apply(this, args);
  };
}

rememberNavigation();
rememberFetches();
async function onMessage(event) {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const { type, id, request } = event.data || {};
  if (typeof id !== "string" || !id) return;
  if (type === PAGE_WINDOW_CAPTURE_REQUEST_TYPE) {
    const payload = await capturePricing();
    window.postMessage({ type: PAGE_WINDOW_RESPONSE_TYPE, id, ok: Boolean(payload), response: { ok: Boolean(payload), status: payload ? 200 : 404, body: payload || { data: [], group_ratio: {} } } }, window.location.origin);
    return;
  }
  if (type !== PAGE_WINDOW_REQUEST_TYPE) return;
  try {
    let response = await executeRequest(request);
    if (!response.ok && shouldRefreshPageAuth(request?.pageAuth, response)) {
      const renewed = await refreshPageAuth(request.pageAuth);
      if (persistPageAuth(request.pageAuth, renewed)) {
        postAuthRenewal(request.pageAuth, renewed);
        response = await executeRequest(request);
      }
    }
    const contentType = response.headers.get("content-type") || "";
    const body = contentType.includes("json") ? await response.json() : await response.text();
    if (!payloadFitsCaptureLimit(body)) throw new Error("页面响应过大");
    rememberPricing(body, "bridge");
    window.postMessage({ type: PAGE_WINDOW_RESPONSE_TYPE, id, ok: true, response: { ok: response.ok, status: response.status, body } }, window.location.origin);
  } catch (error) {
    window.postMessage({ type: PAGE_WINDOW_RESPONSE_TYPE, id, ok: false, error: error.message }, window.location.origin);
  }
}

window.addEventListener("message", onMessage);

// 下一次注入会先调这个，把这一轮装上去的一切（listener、fetch/XHR 补丁、history 包装）
// 还原干净，脚本就可以反复注入而不叠加。
window.__AI_PRICING_PAGE_BRIDGE_TEARDOWN__ = () => {
  window.removeEventListener("message", onMessage);
  window.removeEventListener("popstate", clearCapturedPricing);
  if (nativeFetch && window.fetch !== nativeFetch) window.fetch = nativeFetch;
  XMLHttpRequest.prototype.open = nativeXhrOpen;
  XMLHttpRequest.prototype.send = nativeXhrSend;
  history.pushState = nativePushState;
  history.replaceState = nativeReplaceState;
  capturedPricing = null;
  delete window.__AI_PRICING_PAGE_BRIDGE__;
  delete window.__AI_PRICING_PAGE_BRIDGE_VERSION__;
  delete window.__AI_PRICING_PAGE_BRIDGE_TEARDOWN__;
};
})();
