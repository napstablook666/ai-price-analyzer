export function selectPageTab(tabs, origin, preferredTabId, preferredPath) {
  const matchingTabs = tabs.filter(tab => tab.id !== undefined && tab.url?.startsWith(`${origin}/`));
  const preferred = matchingTabs.find(tab => tab.id === preferredTabId);
  if (preferred) return preferred;
  if (matchingTabs.length === 1) return matchingTabs[0];
  if (preferredPath) {
    let pathname;
    try { pathname = new URL(preferredPath, origin).pathname; } catch { return null; }
    const pathMatches = matchingTabs.filter(tab => {
      try { return new URL(tab.url).pathname === pathname; } catch { return false; }
    });
    if (pathMatches.length === 1) return pathMatches[0];
  }
  return null;
}

function waitForTab(tabs, tabId) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      tabs.onUpdated.removeListener(onUpdated);
      tabs.onRemoved?.removeListener(onRemoved);
    };
    const finish = (error, tab) => {
      cleanup();
      error ? reject(error) : resolve(tab);
    };
    const onUpdated = (updatedId, changeInfo) => {
      if (updatedId !== tabId || changeInfo.status !== "complete") return;
      tabs.get(tabId).then(tab => finish(null, tab), error => finish(error));
    };
    const onRemoved = removedId => {
      if (removedId === tabId) finish(new Error("FastAIToken 页面提前关闭"));
    };
    const timer = setTimeout(() => finish(new Error("FastAIToken 页面加载超时")), 30000);
    tabs.onUpdated.addListener(onUpdated);
    tabs.onRemoved?.addListener(onRemoved);
    tabs.get(tabId).then(tab => {
      if (tab.status === "complete") finish(null, tab);
    }, error => finish(error));
  });
}

export async function findOrOpenPageTab(tabs, station, preferredTabId) {
  const url = new URL(station.baseUrl);
  const candidates = await tabs.query({});
  let tab = selectPageTab(candidates, url.origin, preferredTabId, url.pathname);
  const isFastAiToken = url.hostname.toLowerCase().replace(/^www\./, "") === "fastaitoken.com";
  const isCheapRouter = url.hostname.toLowerCase().replace(/^www\./, "") === "cheaprouter.cc" && url.pathname.replace(/\/$/, "") === "/models";
  if (tab || !(isFastAiToken || isCheapRouter)) return { tab, temporary: false };
  tab = candidates.find(candidate => candidate.id !== undefined && candidate.url?.startsWith(`${url.origin}/`));
  if (tab) return { tab, temporary: false };
  const created = await tabs.create({ url: url.toString(), active: false });
  try {
    return { tab: await waitForTab(tabs, created.id), temporary: true };
  } catch (error) {
    await tabs.remove(created.id).catch(() => {});
    throw error;
  }
}

// The old MAIN-world proxy survives extension reloads and cannot be unregistered.
function probePageBridge() {
  if (window.__AI_PRICING_PAGE_BRIDGE__) return { current: true };
  const fetchSource = String(window.fetch || "");
  const xhrSendSource = String(window.XMLHttpRequest?.prototype?.send || "");
  if (fetchSource.includes("isPricingUrl") || xhrSendSource.includes("isPricingUrl")) return { legacy: true };
  return new Promise(resolve => {
    const id = `ai-pricing-probe-${Date.now()}-${Math.random()}`;
    let timer;
    const finish = result => {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(result);
    };
    const onMessage = event => {
      const message = event.data || {};
      if (event.source !== window || event.origin !== window.location.origin || message.type !== "AI_RELAY_PAGE_BRIDGE_RESPONSE" || message.id !== id) return;
      finish({ legacy: true, capture: message.response });
    };
    window.addEventListener("message", onMessage);
    timer = setTimeout(() => finish({ current: false }), 100);
    window.postMessage({ type: "AI_RELAY_PAGE_CAPTURE_REQUEST", id }, window.location.origin);
  });
}

function probeContentBridge() {
  if (globalThis.__AI_PRICING_CONTENT_BRIDGE__) return true;
  return new Promise(resolve => {
    const id = `ai-pricing-probe-${Date.now()}-${Math.random()}`;
    const eventName = `ai-relay-page-response:${id}`;
    let timer;
    const finish = present => {
      clearTimeout(timer);
      window.removeEventListener(eventName, onResponse);
      resolve(present);
    };
    const onResponse = event => {
      if (event.detail?.id === id) finish(true);
    };
    window.addEventListener(eventName, onResponse);
    timer = setTimeout(() => finish(false), 50);
    window.postMessage({ type: "AI_RELAY_PAGE_BRIDGE_RESPONSE", id, ok: false, error: "probe" }, window.location.origin);
  });
}

function markLegacyPageBridge() {
  window.__AI_PRICING_PAGE_BRIDGE_LEGACY__ = true;
}

export async function ensurePageBridge(scripting, tabId) {
  const target = { tabId };
  const [pageProbe] = await scripting.executeScript({ target, world: "MAIN", func: probePageBridge });
  let initialCapture = null;
  if (pageProbe?.result?.legacy) {
    if (pageProbe.result.capture?.ok) initialCapture = pageProbe.result.capture;
    await scripting.executeScript({ target, world: "MAIN", func: markLegacyPageBridge });
    await scripting.executeScript({ target, files: ["src/page-bridge.js"], world: "MAIN" });
  } else if (!pageProbe?.result?.current) {
    await scripting.executeScript({ target, files: ["src/page-bridge.js"], world: "MAIN" });
  }
  const [contentProbe] = await scripting.executeScript({ target, world: "ISOLATED", func: probeContentBridge });
  if (!contentProbe?.result) await scripting.executeScript({ target, files: ["src/content-bridge.js"] });
  return initialCapture;
}
