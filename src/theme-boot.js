/* 主题引导：在样式生效前同步跑，避免刷新时闪一下白底。
   主题存 localStorage；没存过就跟随系统。 */
(() => {
  const KEY = "model-atlas:theme";
  const root = document.documentElement;
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");

  const stored = () => {
    try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
  };
  const resolved = () => stored() || (media?.matches ? "dark" : "light");

  const paint = (theme) => {
    root.dataset.theme = theme;
    const dark = theme === "dark";
    for (const button of document.querySelectorAll("[data-theme-toggle]")) {
      button.title = dark ? "切换到白天" : "切换到夜晚";
      button.setAttribute("aria-label", dark ? "切换到白天主题" : "切换到夜晚主题");
      button.setAttribute("aria-pressed", String(dark));
    }
  };

  paint(resolved());

  document.addEventListener("DOMContentLoaded", () => paint(root.dataset.theme || resolved()));

  document.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-theme-toggle]");
    if (!button) return;
    const next = root.dataset.theme === "dark" ? "light" : "dark";
    try { localStorage.setItem(KEY, next); } catch { /* 隐私模式写不进去，本次仍然生效 */ }
    paint(next);
  });

  media?.addEventListener?.("change", (event) => {
    if (stored()) return;
    paint(event.matches ? "dark" : "light");
  });
})();