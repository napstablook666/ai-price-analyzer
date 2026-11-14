import { icon } from "./ui.js";

const STORAGE_PREFIX = "modelAtlas:collapse:";

function readStore(pageKey) {
  try { return JSON.parse(localStorage.getItem(STORAGE_PREFIX + pageKey)) || {}; } catch { return {}; }
}

function writeStore(pageKey, store) {
  try { localStorage.setItem(STORAGE_PREFIX + pageKey, JSON.stringify(store)); } catch {}
}

// 卡片折叠：目标元素带 data-collapsible，标题必须是它的第一个子元素。
export function initCollapsibleCards(pageKey, root = document, onChange) {
  const store = readStore(pageKey);
  const entries = [...root.querySelectorAll("[data-collapsible]")].filter(card => card.firstElementChild).map(card => {
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
    return { card, set };
  });
  const allCollapsed = () => entries.every(({ card }) => card.dataset.collapsed === "true");
  const setAll = collapsed => {
    entries.forEach(({ set }) => set(collapsed));
    onChange?.(allCollapsed());
  };
  return {
    allCollapsed,
    setAll,
    toggleAll: () => { const next = !allCollapsed(); setAll(next); return next; }
  };
}
// 顶栏的「折叠全部 / 展开全部」是一个按钮：点一下按当前状态整体切换，文案和图标跟着走。
export function initCardCollapse(pageKey, root = document, toggleId = "collapse-toggle") {
  const button = root.querySelector(`#${toggleId}`);
  const sync = allCollapsed => {
    if (!button) return;
    const label = allCollapsed ? "展开全部" : "折叠全部";
    const labelNode = button.querySelector("[data-collapse-label]");
    if (labelNode) labelNode.textContent = label;
    const iconNode = button.querySelector(".icon");
    if (iconNode) iconNode.outerHTML = icon(allCollapsed ? "chevrons-down-up" : "chevrons-up-down", { className: "icon" });
    button.title = `${label}卡片`;
    button.setAttribute("aria-label", `${label}卡片`);
    button.setAttribute("aria-pressed", String(allCollapsed));
  };
  const cards = initCollapsibleCards(pageKey, root, sync);
  if (button) {
    button.addEventListener("click", () => cards.toggleAll());
    // 用户单独折叠某张卡片后按实际状态校正按钮，打开菜单时同步一次
    button.closest(".top-menu")?.addEventListener("toggle", event => {
      if (event.target.open) sync(cards.allCollapsed());
    });
  }
  sync(cards.allCollapsed());
  return cards;
}
