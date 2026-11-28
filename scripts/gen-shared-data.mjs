// 把 src/shared 里的纯数据表搬进 rust/shared-rs/src/data.json，供 port.rs 用 include_str! 读。
// JS 与 Rust 都用的表（图标映射、站点表、默认设置、图标路径）以 JS 模块为准，每次构建重算；
// 只有 Rust 用的表（供应商别名、名称提示、品牌图形）以 data.json 为准，本脚本原样保留。
// 用法：node scripts/gen-shared-data.mjs
import fs from "node:fs";
import vm from "node:vm";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PROVIDER_BRANDS } from "../src/shared/provider-identity.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SHARED = join(ROOT, "src", "shared");
const OUT = join(ROOT, "rust", "shared-rs", "src", "data.json");

/** 从模块里取出 `const NAME = <字面量>` 的字面量本身（不求值整个模块）。 */
function literalOf(file, name) {
  const text = fs.readFileSync(file, "utf8");
  const at = text.indexOf(`const ${name} = `);
  if (at < 0) throw new Error(`${file} 里没有 const ${name}`);
  const start = text.indexOf("=", at) + 1;
  const from = start + text.slice(start).search(/[[{]/);
  const opener = text[from];
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let end = from;
  for (; end < text.length; end += 1) {
    const ch = text[end];
    if (ch === opener) depth += 1;
    else if (ch === closer) {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return vm.runInNewContext(`(${text.slice(from, end + 1)})`, Object.create(null));
}

const { SITE_LOGOS } = await import("../src/shared/site-logos.js");
const { DEFAULT_STATION } = await import("../src/shared/schema.js");

// 别名表与名称提示只有 Rust 用，它们的家在 data.json，这里原样带过去。
const step = JSON.parse(fs.readFileSync(OUT, "utf8"));
const iconPaths = literalOf(join(SHARED, "ui.js"), "ICON_PATHS");
const aliases = { ...step.aliases, "azure-cognitive-services": "azure" };
for (const brand of PROVIDER_BRANDS) {
  if (!step.providerLogos[brand.logo || brand.id]) continue;
  for (const alias of [brand.id, brand.label, ...(brand.aliases || [])]) {
    aliases[alias.trim().toLowerCase().replace(/\s+/g, "-")] = brand.logo || brand.id;
  }
}

const data = {
  aliases,
  nameHints: step.nameHints,
  iconPaths,
  providerLogos: step.providerLogos,
  siteLogos: SITE_LOGOS,
  defaultStation: DEFAULT_STATION
};

fs.writeFileSync(OUT, JSON.stringify(data));
const counts = Object.fromEntries(
  Object.entries(data).map(([key, value]) => [key, Array.isArray(value) ? value.length : Object.keys(value).length])
);
console.log(`rust/shared-rs/src/data.json ${JSON.stringify(counts)}`);
