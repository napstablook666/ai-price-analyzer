import { currentSiteOrigin } from "./shared/schema.js";
import { callService, hydrateIcons, onRefreshProgress } from "./shared/ui.js";

const activePage = document.querySelector("#current-page");
const addCurrentSiteButton = document.querySelector("#add-current-site");
const refreshButton = document.querySelector("#refresh-all");
const checkinButton = document.querySelector("#checkin-now");
const checkinNote = document.querySelector("#checkin-note");
const status = document.querySelector("#popup-status");
const refreshProgress = document.querySelector("#refresh-progress");
let lastRefreshSummary = null;
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
    if (progress.status === "running") setStatus(`正在查询 ${progress.current}/${total}：${progress.stationName}`);
    else if (progress.status === "error") setStatus(`${progress.stationName} 查询失败：${progress.error}`, "error");
    else setStatus(`${progress.stationName} 已查询 ${progress.modelCount} 个模型`);
  } else if (progress.phase === "complete") {
    lastRefreshSummary = progress.summary;
    const summary = progress.summary;
    const message = summary.total
      ? `查询完成：${summary.successCount} 成功，${summary.errorCount} 失败，共 ${summary.totalModels} 个模型 · ${(summary.durationMs / 1000).toFixed(1)} 秒`
      : "没有启用的站点可查询";
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
refreshButton.addEventListener("click", async () => {
  refreshButton.disabled = true;
  refreshProgress.hidden = false;
  lastRefreshSummary = null;
  setStatus("正在准备查询站点模型");
  try {
    const data = await callService("REFRESH_ALL");
    lastRefreshSummary = data.refreshSummary || lastRefreshSummary;
    if (lastRefreshSummary) {
      const { successCount, errorCount, total } = lastRefreshSummary;
      setStatus(total ? `查询完成：${successCount} 成功，${errorCount} 失败` : "没有启用的站点可查询", errorCount ? "error" : "success");
    }
  } catch (error) {
    setStatus(error.message || "查询失败", "error");
  } finally {
    refreshButton.disabled = false;
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
