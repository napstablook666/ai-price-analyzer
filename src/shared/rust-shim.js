// 调用 rust-dist/shared-rs 的 wasm 导出，把 JS 值编成 JSON 文本送过去、再把结果解回来。
// 结构由 scripts/rust-build.mjs 生成；这里的包装只负责 JS 语义（undefined / NaN / 孤立代理项 / 默认参数）。
// 不要手改导出名：名字与 src/shared 下的原函数一一对应，只是实现换成了 Rust。
import * as wasm from "../../rust-dist/shared-rs/index.js";

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
function encode(value) {
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
function decode(text) {
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
function throwAs(error) {
  const message = String(error?.message ?? error);
  const name = ERROR_NAMES.find((candidate) => message.startsWith(`${candidate}: `));
  if (name) {
    const rest = message.slice(name.length + 2);
    throw new (globalThis[name] ?? Error)(rest);
  }
  throw error instanceof Error ? error : new Error(message);
}

/** 调一个 wasm 导出：参数逐个编码，结果解回来。 */
function call(name, args) {
  const entry = wasm[name];
  if (typeof entry !== "function") throw new Error(`rust-dist 里没有 ${name}`);
  try {
    return decode(entry(...args.map((arg) => encode(arg === undefined ? null : arg))));
  } catch (error) {
    throwAs(error);
  }
}

export function redactStation(station = {}) {
  return call("redactStation", [station]);
}

export function stripModelDecoration(value) {
  return call("stripModelDecoration", [value]);
}

export function bareModelSpelling(id) {
  return call("bareModelSpelling", [id]);
}

export function canonicalModelKey(value) {
  return call("canonicalModelKey", [value]);
}

export function effectiveMonthlyCost(row) {
  return call("effectiveMonthlyCost", [row]);
}

export function providerLogoSlug(value) {
  return call("providerLogoSlug", [value]);
}

export function providerLogoFor(values) {
  return call("providerLogoFor", [values]);
}

export function providerIconMarkup(values, { size = 17, label = "" } = {}) {
  return call("providerIconMarkup", [values, { size, label }]);
}

export function normalizeRechargePayments(input) {
  return call("normalizeRechargePayments", [input]);
}

export function rechargePaymentRate(payment) {
  return call("rechargePaymentRate", [payment]);
}

export function cheapestRechargePayment(payments) {
  return call("cheapestRechargePayment", [payments]);
}

export function representativeRechargePayment(payments, faceSpend = null) {
  return call("representativeRechargePayment", [payments, faceSpend]);
}

export function normalizeRechargeTiers(input) {
  return call("normalizeRechargeTiers", [input]);
}

export function normalizeRechargePlans(input) {
  return call("normalizeRechargePlans", [input]);
}

export function convertRechargeAmount(amount, fromCurrency, toCurrency, exchangeRate) {
  return call("convertRechargeAmount", [amount, fromCurrency, toCurrency, exchangeRate]);
}

export function usagePresetUsage(id, magpieSync = null) {
  return call("usagePresetUsage", [id, magpieSync]);
}

export function usagePresetOptions(magpieSync = null) {
  return call("usagePresetOptions", [magpieSync]);
}

export function usagePresetId(usage, magpieSync = null) {
  return call("usagePresetId", [usage, magpieSync]);
}

export function isSecureRemoteUrl(value) {
  return call("isSecureRemoteUrl", [value]);
}

export function currentSiteOrigin(value) {
  return call("currentSiteOrigin", [value]);
}

export function normalizeBillingProfile(input) {
  return call("normalizeBillingProfile", [input]);
}

export function cloneDefaultStation() {
  return call("cloneDefaultStation", []);
}

export function normalizeUrl(value) {
  return call("normalizeUrl", [value]);
}

export function siteLogoUrl(id) {
  return call("siteLogoUrl", [id]);
}

export function siteIconMarkup(id, name, { size = 16, label = "" } = {}) {
  return call("siteIconMarkup", [id, name, { size, label }]);
}

export function siteLogoFor(id) {
  return call("siteLogoFor", [id]);
}

export function siteInitial(name) {
  return call("siteInitial", [name]);
}

export function escapeHtml(value) {
  return call("escapeHtml", [value]);
}

export function icon(name, { size = 16, className = "icon", label = "" } = {}) {
  return call("icon", [name, { size, className, label }]);
}

export function formatMoney(value, currency = "¥") {
  // `currency` 是 wasm 的原始 Option<String> 参数，不走 JSON 编码。
  try {
    return decode(wasm.formatMoney(encode(value), currency === undefined ? null : currency));
  } catch (error) {
    throwAs(error);
  }
}

export function formatRefreshSummary(summary = {}) {
  return call("formatRefreshSummary", [summary]);
}
