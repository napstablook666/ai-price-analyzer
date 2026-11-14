import { siteLogoFor, siteInitial } from "./site-logos.js";

// 扩展页面里图片走 chrome-extension:// 绝对地址；测试环境没有 chrome，退回相对路径。
const EXTENSION_BASE = (() => {
  try {
    return globalThis.chrome?.runtime?.getURL?.("") || "";
  } catch {
    return "";
  }
})();

function escapeAttr(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

export function siteLogoUrl(id) {
  const file = siteLogoFor(id);
  return file ? `${EXTENSION_BASE}${file}` : "";
}

// 站点图标：插件带了图标就用图片，没有就退回首字母色块，和模型图标同一套观感。
export function siteIconMarkup(id, name, { size = 16, label = "" } = {}) {
  const url = siteLogoUrl(id);
  const title = escapeAttr(label || name || id || "");
  const box = `width:${size}px;height:${size}px`;
  if (!url) {
    return `<span class="site-logo is-neutral" style="${box}" title="${title}" aria-hidden="true">${escapeAttr(siteInitial(name || id))}</span>`;
  }
  return `<img class="site-logo" src="${escapeAttr(url)}" style="${box}" width="${size}" height="${size}" alt="" title="${title}" loading="lazy" decoding="async">`;
}
