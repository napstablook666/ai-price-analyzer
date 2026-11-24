// 调用 rust-dist/shared-rs 的 wasm 导出，把 JS 值编成 JSON 文本送过去、再把结果解回来。
// 结构由 scripts/rust-build.mjs 生成；这里的包装只负责 JS 语义（undefined / NaN / 孤立代理项 / 默认参数）。
// 不要手改导出名：名字与 src/shared 下的原函数一一对应，只是实现换成了 Rust。
import * as wasm from "../../rust-dist/shared-rs/index.js";

import { callWith, decode, encode, throwAs } from "./rust-wire.js";

function call(name, args) {
  return callWith(wasm, name, args);
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
