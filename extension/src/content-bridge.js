(() => {
  const BRIDGE_VERSION = 2;
  if (globalThis.__AI_PRICING_CONTENT_BRIDGE__ && globalThis.__AI_PRICING_CONTENT_BRIDGE_VERSION__ >= BRIDGE_VERSION) return;
  globalThis.__AI_PRICING_CONTENT_BRIDGE__ = true;
  globalThis.__AI_PRICING_CONTENT_BRIDGE_VERSION__ = BRIDGE_VERSION;
const RESPONSE_TYPE = "AI_RELAY_PAGE_BRIDGE_RESPONSE_V2";
const LEGACY_RESPONSE_TYPE = "AI_RELAY_PAGE_BRIDGE_RESPONSE";
const REQUEST_TYPE = "AI_RELAY_PAGE_BRIDGE_REQUEST_V2";
const CAPTURE_REQUEST_TYPE = "AI_RELAY_PAGE_CAPTURE_REQUEST_V2";
const LEGACY_REQUEST_TYPE = "AI_RELAY_PAGE_BRIDGE_REQUEST";
const LEGACY_CAPTURE_REQUEST_TYPE = "AI_RELAY_PAGE_CAPTURE_REQUEST";
const PROBE_REQUEST_TYPE = "AI_RELAY_CONTENT_BRIDGE_PROBE_REQUEST";
const PROBE_RESPONSE_TYPE = "AI_RELAY_CONTENT_BRIDGE_PROBE_RESPONSE";

function onWindowMessage(event) {
  const message = event.data || {};
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (message.type === PROBE_REQUEST_TYPE) {
    if (typeof message.id === "string" && message.id) window.postMessage({ type: PROBE_RESPONSE_TYPE, id: message.id, version: BRIDGE_VERSION }, window.location.origin);
    return;
  }
  if (message.type !== RESPONSE_TYPE && message.type !== LEGACY_RESPONSE_TYPE) return;
  window.dispatchEvent(new CustomEvent(`ai-relay-page-response:${message.id}`, { detail: message }));
}

window.addEventListener("message", onWindowMessage);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const isFetch = message?.type === "PAGE_FETCH_V2";
  const isCapture = message?.type === "PAGE_CAPTURE_V2";
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
  window.postMessage({ type: isCapture ? CAPTURE_REQUEST_TYPE : REQUEST_TYPE, id, request: message.request }, window.location.origin);
  return true;
});
})();
