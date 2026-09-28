const ICON_PATHS = {
  "arrow-up-right": '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  "building-2": '<path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18"/><path d="M6 10h12"/><path d="M6 14h12"/><path d="M6 18h12"/><path d="M9 6h.01"/><path d="M15 6h.01"/><path d="M9 10h.01"/><path d="M15 10h.01"/>',
  "layers-3": '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
  "arrow-down-up": '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/>',
  "refresh-cw": '<path d="M21 12a9 9 0 0 0-15.3-6.3L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 15.3 6.3L21 16"/><path d="M16 16h5v5"/>',
  "loader-circle": '<path d="M21 12a9 9 0 1 1-6.7-8.7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4.3-4.3"/>',
  "sliders-horizontal": '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="1" y2="7"/><line x1="8" x2="8" y1="9" y2="15"/><line x1="16" x2="16" y1="17" y2="23"/>',
  "scan-line": '<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><path d="M7 12h10"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  "trending-down": '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
  "clock-3": '<circle cx="12" cy="12" r="9"/><path d="M12 7v5h4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  "circle-alert": '<circle cx="12" cy="12" r="9"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/>',
  calculator: '<rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" x2="16" y1="6" y2="6"/><line x1="8" x2="8" y1="10" y2="10"/><line x1="12" x2="12" y1="10" y2="10"/><line x1="16" x2="16" y1="10" y2="10"/><line x1="8" x2="8" y1="14" y2="14"/><line x1="12" x2="12" y1="14" y2="14"/><line x1="16" x2="16" y1="14" y2="14"/><line x1="8" x2="8" y1="18" y2="18"/><line x1="12" x2="12" y1="18" y2="18"/><line x1="16" x2="16" y1="18" y2="18"/>',
  "badge-check": '<path d="M3.85 8.62a4 4 0 0 1 4.77-4.77 4 4 0 0 1 6.76 0 4 4 0 0 1 4.77 4.77 4 4 0 0 1 0 6.76 4 4 0 0 1-4.77 4.77 4 4 0 0 1-6.76 0 4 4 0 0 1-4.77-4.77 4 4 0 0 1 0-6.76Z"/><path d="m9 12 2 2 4-4"/>',
  "settings-2": '<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  "trash-2": '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6v14H5V6"/><path d="M10 11v5"/><path d="M14 11v5"/>',
  "bookmark-plus": '<path d="M19 21 12 17l-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z"/><path d="M12 7v6"/><path d="M9 10h6"/>',
  "plug-zap": '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v3a6 6 0 0 1-12 0V8Z"/><path d="m14 14-2 3h4l-2 3"/>',
  "wand-sparkles": '<path d="m15 4 1 1"/><path d="m17 2-1 1"/><path d="m19 4-1 1"/><path d="M3 20 15 8"/><path d="m14 7 3 3"/><path d="M5 3v4"/><path d="M3 5h4"/><path d="M19 15v4"/><path d="M17 17h4"/>',
  download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
  upload: '<path d="M12 3v12"/><path d="m17 8-5-5-5 5"/><path d="M5 21h14"/>',
  "external-link": '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3"/><path d="m18 5 3 3"/>',
  bot: '<rect width="14" height="10" x="5" y="8" rx="2"/><path d="M12 4v4"/><path d="M8 13h.01"/><path d="M16 13h.01"/><path d="M9 18v2"/><path d="M15 18v2"/>',
  "file-code-2": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="m10 13-2 2 2 2"/><path d="m14 13 2 2-2 2"/>',
  "circle-help": '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 1 1 5.8 1c0 2-3 2-3 4"/><path d="M12 17h.01"/>',
  "chevron-right": '<path d="m9 18 6-6-6-6"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  "panel-top": '<rect width="18" height="15" x="3" y="3" rx="2"/><path d="M3 8h18"/><path d="M8 3v5"/>',
  "sparkles": '<path d="m12 3-1.5 5.5L5 10l5.5 1.5L12 17l1.5-5.5L19 10l-5.5-1.5Z"/><path d="m19 16-.7 2.3L16 19l2.3.7L19 22l.7-2.3L22 19l-2.3-.7Z"/>'
};

export function callService(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) return reject(new Error(response?.error || "操作失败"));
      resolve(response.data);
    });
  });
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function icon(name, { size = 16, className = "icon", label = "" } = {}) {
  const title = label ? `<title>${escapeHtml(label)}</title>` : "";
  return `<svg class="lucide ${className}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="${label ? "false" : "true"}"${label ? ' role="img"' : ""}>${title}${ICON_PATHS[name] || ICON_PATHS["circle-help"]}</svg>`;
}

export function hydrateIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach(node => {
    node.outerHTML = icon(node.dataset.icon, {
      size: Number(node.dataset.size) || 16,
      className: node.className || "icon",
      label: node.dataset.label || ""
    });
  });
}

export function formatMoney(value, currency = "¥") {
  if (value === null || value === undefined || value === "") return "—";
  return Number.isFinite(Number(value)) ? `${currency}${Number(value).toFixed(4)}` : "—";
}

export function formatDate(value) {
  return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "medium" }).format(new Date(value)) : "—";
}

export function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
