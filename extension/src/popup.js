import { currentSiteOrigin } from "./shared/schema.js";
import { callService, hydrateIcons } from "./shared/ui.js";

const activePage = document.querySelector("#current-page");
const addCurrentSiteButton = document.querySelector("#add-current-site");
const refreshButton = document.querySelector("#refresh-all");
const status = document.querySelector("#popup-status");
let activeTab;
let siteOrigin = "";

function setStatus(message, type = "") {
  status.textContent = message;
  status.hidden = !message;
  status.classList.toggle("is-error", type === "error");
  status.classList.toggle("is-success", type === "success");
}

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
  setStatus("正在刷新全部站点…");
  try {
    await callService("REFRESH_ALL");
    setStatus("站点报价已刷新", "success");
  } catch (error) {
    setStatus(error.message || "刷新失败", "error");
  } finally {
    refreshButton.disabled = false;
  }
});

hydrateIcons();
loadActivePage();
