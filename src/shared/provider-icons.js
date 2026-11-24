// 供应商图标的对外接口。别名表、品牌图形和匹配顺序都在 rust/shared-rs/src/port.rs 里，
// 数据（别名表、品牌图形、图标路径）由 scripts/gen-shared-data.mjs 从 src/shared 同步进 rust/shared-rs/src/data.json。
import * as rust from "./rust-shim.js";

export function providerLogoSlug(value) {
  return rust.providerLogoSlug(value);
}

// 第一个能对上图标的候选值胜出：先看匹配到的供应商，再退到模型名。
export function providerLogoFor(values) {
  return rust.providerLogoFor(values);
}

// 图标块：有品牌图形就内联 SVG（单色，跟随 currentColor），没有就落成首字母色块。
export function providerIconMarkup(values, { size = 17, label = "" } = {}) {
  return rust.providerIconMarkup(values, { size, label });
}
