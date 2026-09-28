const RESPONSE_TYPE = "AI_RELAY_PAGE_BRIDGE_RESPONSE";
const REQUEST_TYPE = "AI_RELAY_PAGE_BRIDGE_REQUEST";
const CAPTURE_REQUEST_TYPE = "AI_RELAY_PAGE_CAPTURE_REQUEST";

window.addEventListener("message", event => {
  if (event.source !== window || event.data?.type !== RESPONSE_TYPE) return;
  window.dispatchEvent(new CustomEvent(`ai-relay-page-response:${event.data.id}`, { detail: event.data }));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const isFetch = message?.type === "PAGE_FETCH";
  const isCapture = message?.type === "PAGE_CAPTURE";
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
