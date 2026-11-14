// 顶栏菜单：一个 details 装住按钮和下拉面板，开合交给浏览器，这里只补点外部和 Esc 收起。
export function initTopMenu(id = "top-menu") {
  const menu = document.getElementById(id);
  if (!menu) return null;
  const summary = menu.querySelector(":scope > summary");
  const sync = () => summary?.setAttribute("aria-expanded", String(menu.open));
  const close = () => { menu.open = false; sync(); };

  menu.addEventListener("toggle", sync);
  menu.addEventListener("click", event => {
    const item = event.target.closest(".top-menu-item");
    // data-menu-stay 的条目在面板内展开二级内容，不收起菜单
    if (!item || item.hasAttribute("data-menu-stay")) return;
    close();
  });
  document.addEventListener("pointerdown", event => {
    if (menu.open && !menu.contains(event.target)) close();
  }, true);
  document.addEventListener("keydown", event => {
    if (event.key !== "Escape" || !menu.open) return;
    close();
    summary?.focus();
  });
  sync();
  return { close };
}