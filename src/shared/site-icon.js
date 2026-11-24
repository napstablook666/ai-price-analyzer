// 站点图标的对外接口：图片路径由 plugin-build.mjs 生成在 site-logos.js，取图标的函数在 Rust 里。
import * as rust from "./rust-shim.js";

export { siteLogoFor, siteInitial } from "./site-logos.js";

export function siteLogoUrl(id) {
  return rust.siteLogoUrl(id);
}

// 站点图标：插件带了图标就用图片，没有就退回首字母色块，和模型图标同一套观感。
export function siteIconMarkup(id, name, { size = 16, label = "" } = {}) {
  return rust.siteIconMarkup(id, name, { size, label });
}
