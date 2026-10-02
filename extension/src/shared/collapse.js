import { icon } from "./ui.js";

const STORAGE_PREFIX = "modelAtlas:collapse:";

function readStore(pageKey) {
  try { return JSON.parse(localStorage.getItem(STORAGE_PREFIX + pageKey)) || {}; } catch { return {}; }
}

function writeStore(pageKey, store) {
  try { localStorage.setItem(STORAGE_PREFIX + pageKey, JSON.stringify(store)); } catch {}
}

// 卡片折叠：目标元素带 data-collapsible，标题必须是它的第一个子元素。
export function initCollapsibleCards(pageKey, root = document) {
  const store = readStore(pageKey);
  const setters = [...root.querySelectorAll("[data-collapsible]")].filter(card => card.firstElementChild).map(card => {
    const key = card.dataset.collapseKey || card.id;
    const title = card.querySelector("h2, h3")?.textContent.trim() || card.getAttribute("aria-label")?.trim() || "";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-quiet button-small collapse-toggle";
    button.dataset.collapseToggle = key;
    const set = collapsed => {
      store[key] = collapsed;
      writeStore(pageKey, store);
      card.dataset.collapsed = String(collapsed);
      button.innerHTML = icon(collapsed ? "chevrons-down-up" : "chevrons-up-down", { className: "icon" });
      button.setAttribute("aria-expanded", String(!collapsed));
      button.setAttribute("aria-label", `${collapsed ? "展开" : "折叠"}${title}`);
      button.title = collapsed ? "展开" : "折叠";
    };
    set(Boolean(store[key]));
    button.addEventListener("click", () => set(card.dataset.collapsed !== "true"));
    card.firstElementChild.appendChild(button);
    return set;
  });
  return { setAll: collapsed => setters.forEach(set => set(collapsed)) };
}
