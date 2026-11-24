// JS 值与 wasm 导出之间的编码层：结构由 scripts/rust-build.mjs 生成，这里只管两件事——
// 把 JS 语义（undefined / NaN / 孤立代理项 / 错误名）编成 Rust 侧读得懂的 JSON 文本，再解回来。
const UNDEFINED = "$undefined";
const NUMBER = "$num";
const UTF16 = "$utf16";

function codeUnits(text) {
  const units = new Array(text.length);
  for (let index = 0; index < text.length; index += 1) units[index] = text.charCodeAt(index);
  return units;
}

function hasLoneSurrogate(text) {
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit < 0xd800 || unit > 0xdfff) continue;
    if (unit <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
    }
    return true;
  }
  return false;
}

/** JS 值 → Rust 侧读得懂的 JSON 文本。 */
export function encode(value) {
  const text = JSON.stringify(value, (key, item) => {
    if (item === undefined) return { [UNDEFINED]: true };
    if (typeof item === "number") {
      if (Number.isNaN(item)) return { [NUMBER]: "NaN" };
      if (item === Infinity) return { [NUMBER]: "Infinity" };
      if (item === -Infinity) return { [NUMBER]: "-Infinity" };
      if (Object.is(item, -0)) return { [NUMBER]: "-0" };
    }
    if (typeof item === "string" && hasLoneSurrogate(item)) return { [UTF16]: codeUnits(item) };
    return item;
  });
  return text === undefined ? JSON.stringify({ [UNDEFINED]: true }) : text;
}

/** Rust 侧写回的 JSON 文本 → JS 值。 */
export function decode(text) {
  return JSON.parse(text, (key, item) => {
    if (item === null || typeof item !== "object") return item;
    const keys = Object.keys(item);
    if (keys.length !== 1) return item;
    if (item[UNDEFINED] === true) return undefined;
    if (typeof item[NUMBER] === "string") return Number(item[NUMBER]);
    if (Array.isArray(item[UTF16])) return String.fromCharCode(...item[UTF16]);
    return item;
  });
}

const ERROR_NAMES = ["TypeError", "RangeError", "SyntaxError", "Error"];

/** Rust 的 `Err("TypeError: …")` 还原成同名的 JS 错误。 */
export function throwAs(error) {
  const message = String(error?.message ?? error);
  const name = ERROR_NAMES.find((candidate) => message.startsWith(`${candidate}: `));
  if (name) {
    const rest = message.slice(name.length + 2);
    throw new (globalThis[name] ?? Error)(rest);
  }
  throw error instanceof Error ? error : new Error(message);
}


/** 调一个 wasm 导出：参数逐个编码，结果解回来。 */
export function callWith(wasm, name, args) {
  const entry = wasm[name];
  if (typeof entry !== "function") throw new Error(`rust-dist 里没有 ${name}`);
  try {
    return decode(entry(...args.map((arg) => encode(arg === undefined ? null : arg))));
  } catch (error) {
    throwAs(error);
  }
}
