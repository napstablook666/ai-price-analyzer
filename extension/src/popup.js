import { currentSiteOrigin } from "./shared/schema.js";
import { callService, formatRefreshSummary, hydrateIcons, onRefreshProgress } from "./shared/ui.js";

const activePage = document.querySelector("#current-page");
const addCurrentSiteButton = document.querySelector("#add-current-site");
const refreshButton = document.querySelector("#refresh-all");
const checkinButton = document.querySelector("#checkin-now");
const checkinNote = document.querySelector("#checkin-note");
const status = document.querySelector("#popup-status");
const refreshProgress = document.querySelector("#refresh-progress");
let lastRefreshSummary = null;
let activeRefreshPreflight = null;
let activeTab;
let siteOrigin = "";

function setStatus(message, type = "") {
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle("is-error", type === "error");
  status.classList.toggle("is-success", type === "success");
}

onRefreshProgress(progress => {
  const total = Math.max(0, Number(progress.total) || 0);
  refreshProgress.max = Math.max(total, 1);
  refreshProgress.value = Math.min(Number(progress.completed) || 0, refreshProgress.max);
  if (progress.phase === "start") {
    lastRefreshSummary = null;
    refreshProgress.hidden = false;
    setStatus(total ? `准备查询 ${total} 个启用站点` : "没有启用的站点可查询");
  } else if (progress.phase === "references") {
    setStatus(progress.message);
  } else if (progress.phase === "station") {
    if (progress.status === "running") setStatus(`正在查询 ${progress.stationName}（并行槽位 ${progress.current}）`);
    else if (progress.status === "error") setStatus(`${progress.stationName} 查询失败：${progress.error}`, "error");
    else if (progress.status === "partial") setStatus(`${progress.stationName} 部分查询到 ${progress.modelCount} 个模型：${progress.error || "存在未解析计费模式"}`);
    else setStatus(`${progress.stationName} 已查询 ${progress.modelCount} 个模型`);
  } else if (progress.phase === "complete") {
    lastRefreshSummary = progress.summary;
    const summary = progress.summary;
    const message = formatRefreshSummary(summary);
    setStatus(message, summary.errorCount ? "error" : "success");
  } else if (progress.phase === "error") {
    setStatus(progress.message, "error");
  }
});

function siteParams(key) {
  if (!siteOrigin) return {};
  return {
    [key]: siteOrigin,
    ...(Number.isInteger(activeTab?.id) ? { sourceTabId: activeTab.id } : {})
  };
}

async function openPage(path, params = {}) {
  const target = new URL(chrome.runtime.getURL(path));
  for (const [key, value] of Object.entries(params)) target.searchParams.set(key, String(value));
  try {
    await chrome.tabs.create({ url: target.toString() });
  } catch (error) {
    setStatus(error.message || "无法打开页面", "error");
  }
}

async function loadActivePage() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    activeTab = tabs[0];
    siteOrigin = currentSiteOrigin(activeTab?.url);
  } catch {
    activePage.textContent = "无法读取当前页面";
    return;
  }

  if (!siteOrigin) {
    activePage.textContent = "当前页面不支持站点识别";
    return;
  }

  activePage.textContent = `当前页面：${new URL(siteOrigin).host}`;
  addCurrentSiteButton.disabled = false;
}

document.querySelector("#open-dashboard").addEventListener("click", () => {
  openPage("dashboard.html", siteParams("siteOrigin"));
});
document.querySelector("#open-settings").addEventListener("click", () => openPage("options.html"));
addCurrentSiteButton.addEventListener("click", () => openPage("options.html", siteParams("addSite")));
function setRefreshButtonStage(preflight) {
  const title = refreshButton.querySelector("strong");
  const detail = refreshButton.querySelector("small");
  title.textContent = preflight ? "确认开始刷新全部" : "检查登录状态";
  detail.textContent = preflight ? "登录后再次点击以开始采集" : "先检查需要登录的站点";
}

refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  try {
    if (!activeRefreshPreflight) {
      const preflight = await callService("REFRESH_PREFLIGHT");
      activeRefreshPreflight = preflight;
      const counts = { ready: 0, needsLogin: 0, uncertain: 0, noLoginRequired: 0 };
      for (const result of preflight.results) counts[result.status] = (counts[result.status] || 0) + 1;
      const needsLogin = preflight.results.filter(result => result.status === "needsLogin").map(result => result.stationName);
      const uncertain = preflight.results.filter(result => result.status === "uncertain").map(result => result.stationName);
      const summary = [`已登录 ${counts.ready}`, `需要登录 ${counts.needsLogin}`, `需人工确认 ${counts.uncertain}`, `无需登录 ${counts.noLoginRequired}`];
      if (needsLogin.length) summary.push(`登录站点：${needsLogin.join("、")}`);
      if (uncertain.length) summary.push(`待确认站点：${uncertain.join("、")}`);
      setStatus(`预检完成：${summary.join("；")}。再次点击确认开始刷新全部`);
      setRefreshButtonStage(true);
      return;
    }

    refreshProgress.hidden = false;
    lastRefreshSummary = null;
    setStatus("正在开始刷新");
    const data = await callService("REFRESH_ALL", { preflightToken: activeRefreshPreflight.token, confirmed: true });
    activeRefreshPreflight = null;
    lastRefreshSummary = data.refreshSummary || lastRefreshSummary;
    if (lastRefreshSummary) {
      setStatus(formatRefreshSummary(lastRefreshSummary), lastRefreshSummary.errorCount ? "error" : "success");
    }
  } catch (error) {
    setStatus(error.message || "查询失败", "error");
    if (error.code === "REFRESH_CONFIRMATION_REQUIRED") activeRefreshPreflight = null;
  } finally {
    refreshButton.disabled = false;
    if (!activeRefreshPreflight) setRefreshButtonStage(false);
  }
});

async function loadCheckin() {
  if (!siteOrigin || !checkinButton) return;
  try {
    const data = await callService("CHECKIN_STATUS", { stationOrigin: siteOrigin });
    if (!data.results?.length) return;
    const result = data.results[0];
    checkinButton.hidden = false;
    checkinNote.textContent = result.error || result.message || "复用登录态直接签到";
  } catch {
    // 查询失败时保持隐藏
  }
}
checkinButton?.addEventListener("click", async () => {
  checkinButton.disabled = true;
  checkinNote.textContent = "正在签到…";
  try {
    const data = await callService("CHECKIN_NOW", { stationOrigin: siteOrigin });
    const result = (data.results || [])[0];
    if (result?.error) throw new Error(result.error);
    checkinNote.textContent = result?.message || "签到成功";
    setStatus(result?.message || "签到成功", "success");
  } catch (error) {
    checkinNote.textContent = error.message || "签到失败";
    setStatus(error.message || "签到失败", "error");
  } finally {
    checkinButton.disabled = false;
  }
});
hydrateIcons();
loadActivePage();
loadCheckin();
