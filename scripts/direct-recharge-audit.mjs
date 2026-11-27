// direct 站充值比例只读审计。
// 只请求固定 allowlist 的 GET 接口，不带凭据、不带请求体，不创建订单、不付款。
// 代码里的 rechargeRateVerified / rechargePaymentsVerified 只作为声明记录，不能替代站点证据。

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { directEntries, inventory } from "./direct-audit.mjs";
import { parseRechargeStatus } from "../src/core/recharge.js";


const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 12_000;
const USER_AGENT = "ai-price-analyzer-recharge-audit/1";

export const READ_ENDPOINTS = Object.freeze([
  { kind: "status", path: "/api/status" },
  { kind: "status", path: "/api/v1/status" },
  { kind: "status", path: "/status" },
  { kind: "topup-info", path: "/api/user/topup/info" },
  { kind: "topup-orders", path: "/api/user/topup/self?page=1&page_size=20" },
  { kind: "checkout-info", path: "/api/v1/payment/checkout-info" },
  { kind: "payment-orders", path: "/api/v1/payment/orders/my?page=1&page_size=20" }
]);

const ALLOWED_PATHS = new Set(READ_ENDPOINTS.map(endpoint => endpoint.path));
const asArray = value => Array.isArray(value) ? value : [];
const finite = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const text = value => typeof value === "string" ? value.trim() : "";

function safeDate(value) {
  const valueText = text(value);
  if (!/^\d{4}-\d{2}-\d{2}/.test(valueText)) return null;
  const date = new Date(valueText);
  return Number.isNaN(date.getTime()) ? null : valueText.slice(0, 10);
}

function providerPreset(provider) {
  const preset = typeof provider?.preset === "function" ? provider.preset({}) : provider?.preset;
  return preset && typeof preset === "object" ? preset : {};
}

function originFor(entry, preset) {
  const candidate = text(preset.baseUrl) || `https://${entry.host}`;
  const url = new URL(candidate);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`充值审计拒绝非 HTTPS 站点: ${entry.id}`);
  }
  // 只取 origin：baseUrl 里的路径和查询串（如 /model-plaza?embedded=1）不参与任何请求，
  // 不该因为插件把页面地址写进 baseUrl 就让站点判 FAIL。凭据仍在 origin 之外，继续拒绝。
  // authority 里带 @ 就说明有 userinfo（用户名或密码，含空用户名 + 密码的写法）。
  const authority = url.href.slice(url.protocol.length + 2).split(/[\/?#]/, 1)[0];
  if (authority.includes("@")) {
    throw new Error(`充值审计拒绝带凭据的站点地址: ${entry.id}`);
  }
  return url.origin;
}

function safePath(pathname) {
  if (!ALLOWED_PATHS.has(pathname)) throw new Error(`充值审计端点不在 allowlist: ${pathname}`);
  return pathname;
}

function endpointUrl(origin, pathname) {
  const url = new URL(origin);
  const safe = safePath(pathname);
  const [pathPart, query = ""] = safe.split("?", 2);
  url.pathname = pathPart;
  url.search = query ? `?${query}` : "";
  url.hash = "";
  return url.href;
}

// 跳转能把请求带离 allowlist：目标 origin 或路径/查询串跟请求时不一样，就不再算「本端点成功」。
function escapedAllowlist(finalUrl, requestedUrl) {
  try {
    const final = new URL(finalUrl);
    const requested = new URL(requestedUrl);
    const strip = pathname => pathname.replace(/\/+$/, "");
    // 查询串比语义而不是字节：参数顺序不同不算跳出 allowlist，值变了才算。
    const norm = search => JSON.stringify(
      [...new URLSearchParams(search || "").entries()].sort((a, b) => `${a[0]}\u0000${a[1]}`.localeCompare(`${b[0]}\u0000${b[1]}`))
    );
    return final.origin !== requested.origin
      || norm(final.search) !== norm(requested.search)
      || strip(final.pathname) !== strip(requested.pathname);
  } catch {
    return true;
  }
}

function requestClass(status, networkError = false) {
  if (networkError) return "network";
  if (status === 401 || status === 403) return "auth";
  if (status >= 200 && status < 300) return "success";
  if (status >= 400) return "http";
  return "unknown";
}

function sanitizeTiers(value) {
  return asArray(value).map(item => {
    if (!item || typeof item !== "object") return null;
    const amount = finite(item.amount);
    const discount = finite(item.discount);
    const bonus = finite(item.bonus);
    const bonusRate = finite(item.bonusRate);
    if (amount === null || amount <= 0) return null;
    return {
      amount,
      ...(discount === null ? {} : { discount }),
      ...(bonus === null ? {} : { bonus }),
      ...(bonusRate === null ? {} : { bonusRate })
    };
  }).filter(Boolean);
}

function sanitizePayments(value) {
  return asArray(value).map(item => {
    if (!item || typeof item !== "object") return null;
    const faceAmount = finite(item.faceAmount);
    const payAmount = finite(item.payAmount);
    const paidRmb = finite(item.paidRmb);
    return {
      channel: text(item.channel) || "other",
      ...(faceAmount === null ? {} : { faceAmount }),
      ...(payAmount === null ? {} : { payAmount }),
      currency: text(item.currency).toUpperCase() || null,
      ...(paidRmb === null ? {} : { paidRmb }),
      ...(safeDate(item.at) ? { at: safeDate(item.at) } : {}),
      ...(text(item.status) ? { status: text(item.status).slice(0, 32) } : {})
    };
  }).filter(Boolean);
}

function declaredRate(preset) {
  const rate = finite(preset.rechargeRmb ?? preset.rechargeRate);
  return rate !== null && rate > 0 ? rate : null;
}

function liveStatusEvidence(requests) {
  const result = requests.find(request => request.kind === "status" && request.parsed);
  if (!result) return null;
  return {
    endpoint: result.path,
    rate: result.parsed.rate,
    originalPrice: result.parsed.originalPrice,
    quotaPerUnit: result.parsed.quotaPerUnit,
    exchangeRate: result.parsed.exchangeRate,
    tiers: sanitizeTiers(result.parsed.tiers),
    channels: asArray(result.parsed.channels).map(channel => ({
      channel: text(channel.channel) || "other",
      type: text(channel.type) || null,
      name: text(channel.name) || null
    }))
  };
}

function hasEvidenceSource(value) {
  return value === true || (value && typeof value === "object");
}

export function classifyEvidence({ rawReport = false, page = false, statement = false, completedPayment = false, blocked = false } = {}) {
  const sources = { rawReport, page, statement, completedPayment };
  const threeSources = rawReport && page && statement;
  let level = "unverified";
  if (threeSources) level = "confirmed";
  else if (blocked && !rawReport && !page && !statement) level = "blocked";
  else if (rawReport || page || statement) level = "probable";

  const missing = [];
  if (!rawReport) missing.push("原始充值报文");
  if (!page) missing.push("页面渲染结果");
  if (!statement) missing.push("站点自述/文档");
  if (!completedPayment) missing.push("已完成支付记录（不影响三证等级）");
  return { level, sources, missing };
}

function evidenceFor(preset, requests, checkedAt) {
  const live = liveStatusEvidence(requests);
  const declaration = preset.rechargeEvidence && typeof preset.rechargeEvidence === "object"
    ? preset.rechargeEvidence : {};
  const payments = sanitizePayments(preset.rechargePayments);
  // 插件里的 rechargeEvidence 是插件作者的断言，不是这次审计看到的东西：脚本没渲染页面，
  // 也没读过站点文档。声明单独记进 declaredSources，不给等级加分，否则源码声明会被混成 confirmed。
  const declaredSources = {
    page: hasEvidenceSource(declaration.page),
    statement: hasEvidenceSource(declaration.statement),
    completedPayment: hasEvidenceSource(declaration.completedPayment)
  };
  const rawReport = Boolean(live && (live.rate !== null || live.tiers.length || live.channels.length));
  // 站点全被认证或网络挡住时先记 blocked，声明再多也不能把阻断说成 probable。
  const blocked = requests.length > 0 && requests.every(request => ["auth", "network"].includes(request.classification));
  const classification = classifyEvidence({ rawReport, blocked });
  const rate = live?.rate ?? declaredRate(preset);
  const rateSource = live?.rate !== null && live?.rate !== undefined
    ? { kind: "live-status", endpoint: live.endpoint, rate: live.rate }
    : rate === null ? null : { kind: "plugin-declaration", field: "rechargeRmb/rechargeRate", rate };
  const declaredTiers = sanitizeTiers([...(preset.rechargeTiers || []), ...(preset.rechargePlans || [])]);
  const evidenceDate = safeDate(declaration.date) || payments.map(payment => payment.at).filter(Boolean).sort().at(-1) || null;

  return {
    evidenceLevel: classification.level,
    rateSource,
    rate,
    tiers: live?.tiers.length ? live.tiers : declaredTiers,
    tiersSource: live?.tiers.length ? "live-status" : declaredTiers.length ? "plugin-declaration" : null,
    payments,
    evidenceDate,
    checkedAt,
    missingEvidence: classification.missing,
    evidenceSources: classification.sources,
    declaredSources,
    codeFlags: {
      rechargeRateVerified: preset.rechargeRateVerified === true,
      rechargePaymentsVerified: preset.rechargePaymentsVerified === true
    }
  };
}

async function requestRead(origin, endpoint, fetchImpl, timeoutMs) {
  const url = endpointUrl(origin, endpoint.path);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const result = {
    kind: endpoint.kind,
    path: endpoint.path,
    url,
    method: "GET",
    body: null,
    status: null,
    classification: "unknown",
    parsed: null
  };
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      redirect: "follow",
      signal: controller.signal
    });
    result.status = Number.isInteger(response?.status) ? response.status : null;
    // 跟出去的落点记下来；出了 allowlist 就不算本端点成功。
    const finalUrl = text(response?.url);
    const redirected = Boolean(finalUrl) && escapedAllowlist(finalUrl, url);
    if (redirected) result.finalUrl = finalUrl;
    result.classification = redirected ? "cross-origin" : requestClass(result.status);
    if (result.classification === "success") {
      const contentType = text(response?.headers?.get?.("content-type")).toLowerCase();
      let body;
      try {
        body = contentType.includes("json") && response.json ? await response.json() : JSON.parse(await response.text());
      } catch {
        result.classification = "non-json";
        return result;
      }
      if (endpoint.kind === "status") result.parsed = parseRechargeStatus(body);
    }
    return result;
  } catch (error) {
    result.classification = requestClass(null, true);
    result.error = String(error?.name === "AbortError" ? "timeout" : error?.message || error).slice(0, 120);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function stateFor(requests, evidence) {
  const success = requests.some(request => request.classification === "success");
  const allBlocked = requests.length > 0 && requests.every(request => ["auth", "network"].includes(request.classification));
  if (allBlocked && evidence.evidenceLevel === "blocked") return "BLOCKED";
  if (!success) return "WARN";
  return evidence.evidenceLevel === "confirmed" ? "OK" : "WARN";
}

export async function auditRechargeEntry(entry, {
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = new Date()
} = {}) {
  const checkedAt = now.toISOString();
  let preset;
  let origin;
  try {
    const provider = entry.load().sitePlugin;
    preset = providerPreset(provider);
    origin = originFor(entry, preset);
  } catch (error) {
    return {
      id: entry.id,
      name: entry.name || entry.id,
      host: entry.host,
      state: "FAIL",
      evidenceLevel: "unverified",
      rateSource: null,
      rate: null,
      tiers: [],
      payments: [],
      evidenceDate: null,
      checkedAt,
      missingEvidence: ["插件配置", "原始充值报文", "页面渲染结果", "站点自述/文档"],
      evidenceSources: { rawReport: false, page: false, statement: false, completedPayment: false },
      codeFlags: {},
      requests: [],
      reason: String(error?.message || error).slice(0, 240)
    };
  }

  const requests = [];
  for (const endpoint of READ_ENDPOINTS) {
    requests.push(await requestRead(origin, endpoint, fetchImpl, timeoutMs));
  }
  const evidence = evidenceFor(preset, requests, checkedAt);
  const allRequests = requests.map(request => ({
    kind: request.kind,
    path: request.path,
    url: request.url,
    method: request.method,
    body: request.body,
    status: request.status,
    ...(request.finalUrl ? { finalUrl: request.finalUrl } : {}),
    classification: request.classification,
    ...(request.error ? { error: request.error } : {})
  }));
  return {
    id: entry.id,
    name: entry.name || entry.id,
    host: entry.host,
    state: stateFor(requests, evidence),
    ...evidence,
    requests: allRequests
  };
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function auditDirectRecharge({ entries = directEntries(), fetchImpl = globalThis.fetch, concurrency = DEFAULT_CONCURRENCY, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  return mapLimit(entries, concurrency, entry => auditRechargeEntry(entry, { fetchImpl, timeoutMs }));
}

export function summarizeEvidence(results, inventoryResult = null) {
  const levels = { confirmed: 0, probable: 0, unverified: 0, blocked: 0 };
  const states = { ok: 0, warn: 0, fail: 0, blocked: 0 };
  for (const result of results) {
    const level = String(result.evidenceLevel || "unverified").toLowerCase();
    if (level in levels) levels[level] += 1;
    const state = String(result.state || "").toLowerCase();
    if (state in states) states[state] += 1;
  }
  return {
    total: results.length,
    ...levels,
    states,
    inventory: inventoryResult
  };
}

export function exitCodeForEvidence(summary) {
  if (summary.states.fail > 0) return 1;
  if (summary.total === 0) return 2;
  if (summary.blocked === summary.total) return 2;
  return 0;
}

function parseArgs(args) {
  const jsonIndex = args.indexOf("--json");
  const idIndex = args.indexOf("--id");
  return {
    directOnly: args.includes("--direct-only"),
    jsonPath: jsonIndex >= 0 ? args[jsonIndex + 1] : "",
    id: idIndex >= 0 ? args[idIndex + 1] : ""
  };
}

function printResult(result) {
  console.log(`${String(result.id).padEnd(18)} ${String(result.evidenceLevel).padEnd(10)} ${String(result.state).padEnd(7)} rate=${result.rate ?? "-"} source=${result.rateSource?.kind || "-"}`);
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (!options.directOnly && !options.id) {
    console.error("充值审计必须显式使用 --direct-only 或 --id；只读 GET，不创建订单、不付款。");
    return 2;
  }
  const entries = options.id ? directEntries().filter(entry => entry.id === options.id) : directEntries();
  if (!entries.length) {
    console.error("没有匹配到 direct 插件。");
    return 1;
  }
  const results = await auditDirectRecharge({ entries });
  const summary = summarizeEvidence(results, inventory());
  results.forEach(printResult);
  console.log(`\nconfirmed=${summary.confirmed} probable=${summary.probable} unverified=${summary.unverified} blocked=${summary.blocked}`);
  console.log(`state ok=${summary.states.ok} warn=${summary.states.warn} fail=${summary.states.fail} blocked=${summary.states.blocked}`);
  if (options.jsonPath) {
    const output = path.resolve(process.cwd(), options.jsonPath);
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...summary, results }, null, 2)}\n`, "utf8");
    console.log(`报告已写入 ${output}`);
  }
  return exitCodeForEvidence(summary);
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
