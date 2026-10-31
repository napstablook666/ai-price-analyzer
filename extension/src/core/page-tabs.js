import {
  CONTENT_BRIDGE_VERSION,
  CONTENT_PROBE_REQUEST_TYPE,
  CONTENT_PROBE_RESPONSE_TYPE,
  LEGACY_PAGE_WINDOW_CAPTURE_REQUEST_TYPE,
  LEGACY_PAGE_WINDOW_RESPONSE_TYPE,
  PAGE_BRIDGE_VERSION
} from "./bridge-protocol.js";
import { providerForStation } from "./provider-registry.js";
export function selectPageTab(tabs, origin, preferredTabId, preferredPath) {
  const matchingTabs = tabs.filter(tab => tab.id !== undefined && tab.url?.startsWith(`${origin}/`));
  const preferred = matchingTabs.find(tab => tab.id === preferredTabId);
  if (preferred) return preferred;
  if (matchingTabs.length === 1) return matchingTabs[0];
  if (preferredPath) {
    let preferredUrl;
    try { preferredUrl = new URL(preferredPath, origin); } catch { return null; }
    const pathMatches = matchingTabs.filter(tab => {
      try {
        const tabUrl = new URL(tab.url);
        return tabUrl.pathname === preferredUrl.pathname && (!preferredUrl.hash || tabUrl.hash === preferredUrl.hash);
      } catch { return false; }
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
      if (removedId === tabId) finish(new Error("采集页面提前关闭"));
    };
    const timer = setTimeout(() => finish(new Error("采集页面加载超时")), 30000);
    tabs.onUpdated.addListener(onUpdated);
    tabs.onRemoved?.addListener(onRemoved);
    tabs.get(tabId).then(tab => {
      if (tab.status === "complete") finish(null, tab);
    }, error => finish(error));
  });
}

export async function findOrOpenPageTab(tabs, station, preferredTabId, { allowTemporaryWhenAmbiguous = false, keepOnLoadFailure = false } = {}) {
  const url = new URL(station.adapter?.pageUrl || station.baseUrl);
  const candidates = await tabs.query({});
  let tab = selectPageTab(candidates, url.origin, preferredTabId, url.toString());
  const provider = providerForStation(station, { forPrepare: true });
  if (tab) return { tab, temporary: false };
  if (!allowTemporaryWhenAmbiguous && candidates.filter(candidate => candidate.id !== undefined && candidate.url?.startsWith(`${url.origin}/`)).length > 1) return { tab: null, temporary: false };
  if (provider?.openTemporaryPage !== true) return { tab: null, temporary: false };
  const created = await tabs.create({ url: url.toString(), active: false });
  try {
    return { tab: await waitForTab(tabs, created.id), temporary: true };
  } catch (error) {
    if (keepOnLoadFailure) {
      error.tabId = created.id;
      error.temporary = true;
    } else {
      await tabs.remove(created.id).catch(() => {});
    }
    throw error;
  }
}

// The old MAIN-world proxy survives extension reloads and cannot be unregistered.
function probePageBridge(requiredVersion, responseType, captureRequestType) {
  if (window.__AI_PRICING_PAGE_BRIDGE__ && window.__AI_PRICING_PAGE_BRIDGE_VERSION__ >= requiredVersion) return { current: true };
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
      if (event.source !== window || event.origin !== window.location.origin || message.type !== responseType || message.id !== id) return;
      finish({ legacy: true, capture: message.response });
    };
    window.addEventListener("message", onMessage);
    timer = setTimeout(() => finish({ current: false }), 100);
    window.postMessage({ type: captureRequestType, id }, window.location.origin);
  });
}

function probeContentBridge(requestType, responseType) {
  return new Promise(resolve => {
    const id = `ai-relay-content-probe-${Date.now()}-${Math.random()}`;
    let timer;
    const finish = present => {
      clearTimeout(timer);
      window.removeEventListener("message", onResponse);
      resolve(present);
    };
    const onResponse = event => {
      const message = event.data || {};
      if (event.source !== window || event.origin !== window.location.origin || message.type !== responseType || message.id !== id) return;
      finish({ version: message.version });
    };
    window.addEventListener("message", onResponse);
    timer = setTimeout(() => finish(false), 200);
    window.postMessage({ type: requestType, id }, window.location.origin);
  });
}


export function resetContentBridge() {
  const dispose = globalThis.__AI_PRICING_CONTENT_BRIDGE_DISPOSE__;
  if (typeof dispose === "function") dispose();
  delete globalThis.__AI_PRICING_CONTENT_BRIDGE__;
  delete globalThis.__AI_PRICING_CONTENT_BRIDGE_VERSION__;
  delete globalThis.__AI_PRICING_CONTENT_BRIDGE_DISPOSE__;
}


function markLegacyPageBridge() {
  window.__AI_PRICING_PAGE_BRIDGE_LEGACY__ = true;
}

export async function ensurePageBridge(scripting, tabId, { forceContent = false } = {}) {
  const target = { tabId };
  const [pageProbe] = await scripting.executeScript({ target, world: "MAIN", func: probePageBridge, args: [PAGE_BRIDGE_VERSION, LEGACY_PAGE_WINDOW_RESPONSE_TYPE, LEGACY_PAGE_WINDOW_CAPTURE_REQUEST_TYPE] });
  let initialCapture = null;
  if (pageProbe?.result?.legacy) {
    if (pageProbe.result.capture?.ok) initialCapture = pageProbe.result.capture;
    await scripting.executeScript({ target, world: "MAIN", func: markLegacyPageBridge });
    await scripting.executeScript({ target, files: ["src/page-bridge.js"], world: "MAIN" });
  } else if (!pageProbe?.result?.current) {
    await scripting.executeScript({ target, files: ["src/page-bridge.js"], world: "MAIN" });
  }
  const [contentProbe] = await scripting.executeScript({ target, world: "ISOLATED", func: probeContentBridge, args: [CONTENT_PROBE_REQUEST_TYPE, CONTENT_PROBE_RESPONSE_TYPE] });
  if (forceContent || !contentProbe?.result || contentProbe.result.version < CONTENT_BRIDGE_VERSION) {
    await scripting.executeScript({ target, world: "ISOLATED", func: resetContentBridge });
    await scripting.executeScript({ target, files: ["src/content-bridge.js"] });
  }
  return initialCapture;
}
