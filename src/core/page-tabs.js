import {
  CONTENT_BRIDGE_VERSION,
  CONTENT_PROBE_REQUEST_TYPE,
  CONTENT_PROBE_RESPONSE_TYPE
} from "./bridge-protocol.js";
import { normalizeHostname, providerForStation } from "./provider-registry.js";
// 站点常把裸域 301 到 www（jiji.cc → www.jiji.cc）。两边要算同一个站点，
// 否则浏览器里明明开着那个页面也认不出来，每次都白开一个新标签页。
function sameSiteUrl(value, origin) {
  if (typeof value !== "string" || !value) return false;
  if (value.startsWith(`${origin}/`)) return true;
  try {
    const left = new URL(value);
    const right = new URL(origin);
    return left.protocol === right.protocol && left.port === right.port && normalizeHostname(left.hostname) === normalizeHostname(right.hostname);
  } catch {
    return false;
  }
}

export function selectPageTab(tabs, origin, preferredTabId, preferredPath) {
  const matchingTabs = tabs.filter(tab => tab.id !== undefined && sameSiteUrl(tab.url, origin));
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
    if (pathMatches.length) return pathMatches.find(tab => tab.active) || pathMatches[0];
  }
  return null;
}

const ERROR_PAGE_PREFIX = "chrome-error://";

function isErrorPage(tab) {
  return String(tab?.url || "").startsWith(ERROR_PAGE_PREFIX);
}

function waitForTab(tabs, tabId, { reload = false } = {}) {
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
    if (reload) {
      // 重载后 status 会短暂停在 complete，只能等 onUpdated 再判，不能看初始快照。
      Promise.resolve(tabs.reload(tabId)).catch(error => finish(error));
      return;
    }
    tabs.get(tabId).then(tab => {
      if (tab.status === "complete") finish(null, tab);
    }, error => finish(error));
  });
}

// 导航失败时 Chrome 会停在自己的错误页上，此时 tab.status 已经是 complete，
// 直接注入只会抛 `Frame with ID 0 is showing error page`；重载一次再判断，仍失败就报站点不可达。
async function reloadErrorPage(tabs, tab) {
  if (!isErrorPage(tab)) return tab;
  if (typeof tabs.reload !== "function") throw new Error("采集页面加载失败：站点无法访问");
  const reloaded = await waitForTab(tabs, tab.id, { reload: true });
  if (isErrorPage(reloaded)) throw new Error("采集页面加载失败：站点无法访问");
  return reloaded;
}

export async function findOrOpenPageTab(tabs, station, preferredTabId, { keepOnLoadFailure = false, onTemporaryTabCreated } = {}) {
  const url = new URL(station.adapter?.pageUrl || station.baseUrl);
  const candidates = await tabs.query({});
  let tab = selectPageTab(candidates, url.origin, preferredTabId, url.toString());
  const provider = providerForStation(station, { forPrepare: true });
  if (!tab && provider?.reuseAmbiguousOriginTab === true) {
    const sameOrigin = candidates.filter(candidate => candidate.id !== undefined && sameSiteUrl(candidate.url, url.origin));
    tab = sameOrigin.find(candidate => candidate.active) || sameOrigin[0] || null;
  }
  if (tab) return { tab: await reloadErrorPage(tabs, tab), temporary: false };
  // 同源开着好几个页面、但路径都不在采集页上时不猜用户那个，可也不能直接放弃：
  // 采集层只有一句「请先登录」，用户明明登录着也会被挡在这里。支持临时开页的插件
  // 就开一个干净的采集页；不支持的说清是「页面太杂」还是「根本打不开站点」。
  if (provider?.openTemporaryPage !== true) {
    const sameSite = candidates.filter(candidate => candidate.id !== undefined && sameSiteUrl(candidate.url, url.origin));
    return { tab: null, temporary: false, reason: sameSite.length ? "ambiguous" : "absent" };
  }
  const created = await tabs.create({ url: url.toString(), active: false });
  try {
    await onTemporaryTabCreated?.(created);
    return { tab: await reloadErrorPage(tabs, await waitForTab(tabs, created.id)), temporary: true };
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
// 页面里的旧桥不会因为扩展重载而退场。这里只判断它还活着没有；要不要重新注入由
// ensurePageBridge 统一决定（每次都注入），不再靠版本号比较来推断「是不是最新的」。
function probePageBridge() {
  // MAIN world 的注入物没有卸载通道：旧版脚本既不会拆掉自己的 listener，也没法把它包过的
  // window.fetch 还原回去。这种页面只能先把上下文整个重建一次。
  if (window.__AI_PRICING_PAGE_BRIDGE__ === true) return typeof window.__AI_PRICING_PAGE_BRIDGE_TEARDOWN__ === "function" ? { upgradeable: true } : { stale: true };
  const fetchSource = String(window.fetch || "");
  const xhrSendSource = String(window.XMLHttpRequest?.prototype?.send || "");
  if (fetchSource.includes("isPricingUrl") || xhrSendSource.includes("isPricingUrl")) return { stale: true };
  return { current: false };
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



export async function ensurePageBridge(scripting, tabId, { forceContent = false, tabs = null } = {}) {
  const target = { tabId };
  // 每次都注入。脚本顶部会先把自己上一轮装的 listener、fetch/XHR 补丁、history 包装全拆回去
  // 再重装，所以重复注入就是原地升级。以前只在版本号偏小时才注入，改完行为忘了把数字加一，
  // 页面里就一直在跑旧逻辑，扩展还以为它是最新的，报出来的也是旧错误。
  const [pageProbe] = await scripting.executeScript({ target, world: "MAIN", func: probePageBridge });
  if (pageProbe?.result?.stale) {
    // 页面里挂着一份没带 teardown 的旧桥，它拆不掉也盖不住：旧 listener 会重复响应、
    // 旧 fetch 包装会继续拒绝新逻辑认可的请求。只有重建页面上下文能清掉那批闭包。
    if (!tabs) throw new Error("页面里存在无法升级的旧版页面桥，请刷新该页面后重试");
    await waitForTab(tabs, tabId, { reload: true });
  }
  await scripting.executeScript({ target, files: ["src/page-bridge.js"], world: "MAIN" });
  const [contentProbe] = await scripting.executeScript({ target, world: "ISOLATED", func: probeContentBridge, args: [CONTENT_PROBE_REQUEST_TYPE, CONTENT_PROBE_RESPONSE_TYPE] });
  if (forceContent || !contentProbe?.result || contentProbe.result.version < CONTENT_BRIDGE_VERSION) {
    await scripting.executeScript({ target, world: "ISOLATED", func: resetContentBridge });
    await scripting.executeScript({ target, files: ["src/content-bridge.js"] });
  }
}
