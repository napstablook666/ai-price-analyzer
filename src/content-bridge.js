(() => {
  const CONTENT_BRIDGE_VERSION = 5;
  if (globalThis.__AI_PRICING_CONTENT_BRIDGE__ && globalThis.__AI_PRICING_CONTENT_BRIDGE_VERSION__ >= CONTENT_BRIDGE_VERSION) return;
  globalThis.__AI_PRICING_CONTENT_BRIDGE__ = true;
  globalThis.__AI_PRICING_CONTENT_BRIDGE_VERSION__ = CONTENT_BRIDGE_VERSION;
const PAGE_WINDOW_RESPONSE_TYPE = "AI_RELAY_PAGE_BRIDGE_RESPONSE_V6";
const LEGACY_PAGE_WINDOW_RESPONSE_TYPE = "AI_RELAY_PAGE_BRIDGE_RESPONSE";
const PAGE_WINDOW_REQUEST_TYPE = "AI_RELAY_PAGE_BRIDGE_REQUEST_V6";
const PAGE_WINDOW_CAPTURE_REQUEST_TYPE = "AI_RELAY_PAGE_CAPTURE_REQUEST_V6";
const CONTENT_PROBE_REQUEST_TYPE = "AI_RELAY_CONTENT_BRIDGE_PROBE_REQUEST_V5";
const CONTENT_PROBE_RESPONSE_TYPE = "AI_RELAY_CONTENT_BRIDGE_PROBE_RESPONSE_V5";
const PAGE_RUNTIME_FETCH_TYPE = "PAGE_FETCH_V5";
const PAGE_RUNTIME_CAPTURE_TYPE = "PAGE_CAPTURE_V5";
function onWindowMessage(event) {
  const message = event.data || {};
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (message.type === CONTENT_PROBE_REQUEST_TYPE) {
    if (typeof message.id === "string" && message.id) window.postMessage({ type: CONTENT_PROBE_RESPONSE_TYPE, id: message.id, version: CONTENT_BRIDGE_VERSION }, window.location.origin);
    return;
  }
  if (message.type !== PAGE_WINDOW_RESPONSE_TYPE && message.type !== LEGACY_PAGE_WINDOW_RESPONSE_TYPE) return;
  window.dispatchEvent(new CustomEvent(`ai-relay-page-response:${message.id}`, { detail: message }));
}

window.addEventListener("message", onWindowMessage);

function onRuntimeMessage(message, _sender, sendResponse) {
  const isFetch = message?.type === PAGE_RUNTIME_FETCH_TYPE;
  const isCapture = message?.type === PAGE_RUNTIME_CAPTURE_TYPE;
  if (!isFetch && !isCapture) return undefined;
  const id = crypto.randomUUID();
  const eventName = `ai-relay-page-response:${id}`;
  const timeout = setTimeout(() => {
    window.removeEventListener(eventName, onResponse);
    sendResponse({ ok: false, error: "页面请求超时" });
  }, 15000);
  function onResponse(event) {
    const detail = event.detail;
    if (detail?.id !== id || typeof detail.ok !== "boolean") return;
    if (detail.ok) {
      const response = detail.response;
      if (!response || typeof response !== "object" || typeof response.ok !== "boolean" || !Number.isInteger(response.status) || response.status < 100 || response.status > 599 || !Object.prototype.hasOwnProperty.call(response, "body")) return;
    } else if (typeof detail.error !== "string") return;
    clearTimeout(timeout);
    window.removeEventListener(eventName, onResponse);
    sendResponse(detail.ok ? { ok: true, response: detail.response } : { ok: false, error: detail.error });
  }
  window.addEventListener(eventName, onResponse);
  window.postMessage({ type: isCapture ? PAGE_WINDOW_CAPTURE_REQUEST_TYPE : PAGE_WINDOW_REQUEST_TYPE, id, request: message.request }, window.location.origin);
  return true;
}

chrome.runtime.onMessage.addListener(onRuntimeMessage);
globalThis.__AI_PRICING_CONTENT_BRIDGE_DISPOSE__ = () => {
  window.removeEventListener("message", onWindowMessage);
  chrome.runtime.onMessage.removeListener?.(onRuntimeMessage);
};
})();
