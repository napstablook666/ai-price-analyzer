// Direct 站在线完整性审计。
//
// 只审计可添加的 direct 插件；page 站与 addable:false 的通用适配器不混进来。
// 在线审计沿用扩展实际的 prepare/request/collect/normalize 链路，但只输出计数和诊断，
// 不把响应正文、请求头、cookie 或 token 写进报告。
//
// 用法：
//   node scripts/direct-audit.mjs --inventory
//   node scripts/direct-audit.mjs --online --json ../.omt3/evidence/direct-audit.json

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_PLUGIN_CATALOG } from "../src/site-plugins/catalog.js";
import { collectStation } from "../src/core/collectors.js";
import { normalizePricingPayload } from "../src/core/normalizers.js";
import { registerSiteProvider, resetProviderRegistry } from "../src/core/provider-registry.js";
import { resolveStationCollection } from "../src/core/request-strategy.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_DIR = path.resolve(process.env.PLUGIN_DIR || path.join(ROOT, "..", "plugins"));
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 600;

const asArray = value => Array.isArray(value) ? value : [];
const unique = values => [...new Set(values
  .filter(value => value !== null && value !== undefined && String(value).trim() !== "")
  .map(String))].sort();
const finite = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

export function directEntries(catalog = SITE_PLUGIN_CATALOG) {
  return catalog.filter(entry => entry.mode === "direct" && entry.addable !== false);
}

function manifestIds(pluginDir) {
  try {
    return readdirSync(pluginDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
      .filter(entry => {
        try {
          readFileSync(path.join(pluginDir, entry.name, "manifest.json"), "utf8");
          return true;
        } catch {
          return false;
        }
      })
      .map(entry => entry.name)
      .sort();
  } catch {
    return [];
  }
}

export function inventory({ catalog = SITE_PLUGIN_CATALOG, pluginDir = PLUGIN_DIR } = {}) {
  const manifests = manifestIds(pluginDir);
  const direct = catalog.filter(entry => entry.mode === "direct");
  const page = catalog.filter(entry => entry.mode === "page");
  const excludedGeneric = direct.filter(entry => entry.addable === false).map(entry => entry.id).sort();
  return {
    manifests: manifests.length,
    direct: direct.length,
    page: page.length,
    directSitePlugins: directEntries(catalog).length,
    excludedGeneric,
    manifestIds: manifests
  };
}

function providerPreset(provider) {
  const preset = typeof provider?.preset === "function" ? provider.preset({}) : provider?.preset;
  return preset && typeof preset === "object" ? preset : {};
}

function stationInputFor(entry, provider) {
  const preset = providerPreset(provider);
  return {
    ...preset,
    id: `direct-audit-${entry.id}`,
    name: entry.name || entry.id,
    pluginId: entry.id,
    baseUrl: preset.baseUrl || `https://${entry.host}/pricing`,
    mode: "direct",
    // 在线审计不读取用户保存的认证信息，也不把它带入请求。
    auth: { type: "none" },
    adapter: { ...(preset.adapter || {}) }
  };
}

function rawModelItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.models)) return payload.models;
  if (Array.isArray(payload.available_models)) return payload.available_models;
  if (Array.isArray(payload.data)) return payload.data;
  const data = payload.data;
  if (!data || typeof data !== "object") return [];
  for (const key of ["models", "list", "model_info", "items", "providers"]) {
    if (Array.isArray(data[key])) return data[key];
  }
  if (Array.isArray(data.groups)) return data.groups.flatMap(group => Array.isArray(group?.models) ? group.models : []);
  return [];
}

function billingModeOf(row) {
  const media = String(row?.media_type || "").trim().toLowerCase();
  if (media === "video") return "video";
  if (media === "image") return "image";
  const unit = String(row?.billing_unit || "").trim().toLowerCase();
  if (unit === "request") return "request";
  if (unit === "image") return "image";
  if (unit === "second" || unit === "minute") return unit;
  if (unit === "character") return "character";
  return "token";
}

function billingModesOf(rows) {
  const counts = {};
  for (const row of rows) {
    const mode = billingModeOf(row);
    counts[mode] = (counts[mode] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function primaryRecord(records) {
  return records.find(record => record.normalized)
    || records.find(record => record.status >= 200 && record.status < 300 && record.payload !== undefined)
    || records.find(record => record.status === 401 || record.status === 403)
    || records.find(record => record.primary)
    || records[0]
    || null;
}

function responseContentType(response) {
  return String(response?.headers?.get?.("content-type") || "").toLowerCase();
}

async function recordPayload(record, response) {
  if (response?.clone) {
    try {
      const payload = await response.clone().json();
      record.payload = payload;
      return payload;
    } catch {
      record.nonJson = true;
      return null;
    }
  }
  if (response?.body && typeof response.body === "object") {
    record.payload = response.body;
    return response.body;
  }
  return null;
}

function safeReason(message) {
  return String(message || "未知错误").replace(/[\r\n]+/g, " ").slice(0, 240);
}
// fetch 把真正的原因塞在 cause 里（ECONNRESET / ENOTFOUND / UND_ERR_CONNECT_TIMEOUT），
// 只看 error.message 永远是「fetch failed」，站点体检的判读全靠这串码。
function networkCauseOf(error) {
  const cause = error?.cause;
  const code = cause?.code || error?.code || "";
  const detail = String(cause?.message || error?.message || error || "未知错误");
  return code && !detail.includes(code) ? `${code} ${detail}` : detail;
}

function resultBase(entry, station, collection, records) {
  const primary = primaryRecord(records);
  const normalized = primary?.normalized || null;
  const rows = asArray(normalized?.data);
  const priceMap = station?.adapter?.priceMap;
  const ratioBase = finite(priceMap?.ratioBase);
  return {
    id: entry.id,
    name: entry.name || entry.id,
    endpoint: primary?.url || collection?.endpoints?.[0] || null,
    httpStatus: primary?.status ?? null,
    responseFormat: normalized?.sourceFormat || station?.adapter?.responseFormat || "unknown",
    rawModels: rawModelItems(primary?.payload).length,
    // 有的插件把价格埋在自己解析的页面里，原始条目的容器形状认不出来时 rawModels 会是 0；
    // 标记出来，别让读者把「没数到」当成「站点没有模型」。
    rawModelsUnknown: rawModelItems(primary?.payload).length === 0 && rows.length > 0,
    pricedModels: unique(rows.map(row => row?.model_name)).length,
    rows: rows.length,
    billingModes: billingModesOf(rows),
    currency: unique(rows.map(row => row?.price_currency)),
    ratioBase,
    groupRatios: normalized?.group_ratio && typeof normalized.group_ratio === "object" ? normalized.group_ratio : {},
    unpriced: asArray(normalized?.unpricedModels),
    unsupported: asArray(normalized?.unsupportedBillingModes),
    invalid: asArray(normalized?.invalidPricingValues),
    unsupportedPriceItems: asArray(normalized?.unsupportedPriceItems),
    unpricedChannels: asArray(normalized?.unpricedChannels),
    requests: records.length
  };
}
// 体检用的价格样本：只取「模型名 + 输入价 + 输出价」，按模型名排序保证可比。
// 默认不输出，避免 direct-audit 的报告被几百行价格撑大。
function roundPrice(value) {
  return value === null ? null : Math.round(value * 1e6) / 1e6;
}

function priceSamplesOf(rows, limit = 400) {
  const samples = [];
  for (const row of rows) {
    const model = String(row?.model_name ?? "").trim();
    if (!model) continue;
    const input = finite(row?.input_price);
    const output = finite(row?.output_price);
    if (input === null && output === null) continue;
    samples.push([model, roundPrice(input), roundPrice(output)]);
    if (samples.length >= limit) break;
  }
  return samples.sort((left, right) => String(left[0]).localeCompare(String(right[0])));
}

function diagnosticsOf(normalized) {
  return [
    ...asArray(normalized?.unpricedModels),
    ...asArray(normalized?.unsupportedBillingModes),
    ...asArray(normalized?.invalidPricingValues),
    ...asArray(normalized?.unsupportedPriceItems),
    ...asArray(normalized?.unpricedChannels)
  ];
}

function blockedResult(entry, station, collection, records, category, reason) {
  return {
    ...resultBase(entry, station, collection, records),
    state: "BLOCKED",
    reason: safeReason(reason),
    reasonCategory: category
  };
}

function failedResult(entry, station, collection, records, category, reason) {
  return {
    ...resultBase(entry, station, collection, records),
    state: "FAIL",
    reason: safeReason(reason),
    reasonCategory: category
  };
}

function emptyConfigResult(entry, error) {
  return {
    id: entry.id,
    name: entry.name || entry.id,
    endpoint: null,
    httpStatus: null,
    responseFormat: "unknown",
    rawModels: 0,
    rawModelsUnknown: false,
    pricedModels: 0,
    rows: 0,
    billingModes: {},
    currency: [],
    ratioBase: null,
    groupRatios: {},
    unpriced: [],
    unsupported: [],
    invalid: [],
    unsupportedPriceItems: [],
    unpricedChannels: [],
    requests: 0,
    state: "FAIL",
    reason: safeReason(error?.message || error),
    reasonCategory: "plugin-or-request-config"
  };
}

export async function auditEntry(entry, { fetchImpl = globalThis.fetch, retries = DEFAULT_RETRIES, retryDelayMs = DEFAULT_RETRY_DELAY_MS, includeSamples = false } = {}) {
  let station;
  let collection;
  const records = [];

  try {
    const provider = entry.load().sitePlugin;
    if (!provider || provider.id !== entry.id) throw new Error(`插件身份不匹配: ${entry.id}`);
    registerSiteProvider(provider);
    collection = resolveStationCollection(stationInputFor(entry, provider));
    station = collection.station;
  } catch (error) {
    return emptyConfigResult(entry, error);
  }

  const primaryEndpoint = collection.endpoints[0];
  const wrappedFetch = async (url, init = {}) => {
    const record = {
      url: String(url),
      method: String(init.method || "GET").toUpperCase(),
      primary: String(url) === String(primaryEndpoint),
      status: null,
      contentType: ""
    };
    records.push(record);
    try {
      const response = await fetchImpl(url, {
        ...init,
        headers: { "user-agent": UA, ...(init.headers || {}) }
      });
      record.status = Number.isInteger(response?.status) ? response.status : null;
      record.ok = response?.ok !== false;
      record.contentType = responseContentType(response);
      const payload = await recordPayload(record, response);
      if (record.primary && payload && typeof payload === "object") {
        try {
          record.normalized = normalizePricingPayload(
            payload,
            station.adapter?.responseFormat || "auto",
            {
              priceMap: station.adapter?.priceMap || null,
              priceCurrency: station.priceCurrency,
              priceCurrencyVerified: station.priceCurrencyVerified,
              modelListCurrency: station.priceCurrency
            }
          );
        } catch {
          // collectStation 负责给出最终解析错误；这里只保留原始响应摘要。
        }
      }
      return response;
    } catch (error) {
      record.networkError = safeReason(networkCauseOf(error));
      throw error;
    }
  };

  try {
    const snapshot = await collectStation(station, {
      collection,
      fetchImpl: wrappedFetch,
      retries,
      retryDelayMs
    });
    const normalized = snapshot?.normalized || {};
    const rows = asArray(normalized.data);
    const primary = primaryRecord(records);
    if (primary) primary.normalized = normalized;
    const base = resultBase(entry, station, collection, records);
    if (includeSamples) base.priceSamples = priceSamplesOf(rows);
    // 响应不是 JSON 也可能被插件自己解析成报价（模型广场把数据嵌在 HTML 里）。
    // 只有连一行都没解析出来，才算 non-json 失败。
    if (primaryRecord(records)?.nonJson && !rows.length) {
      return failedResult(entry, station, collection, records, "non-json", "响应不是 JSON");
    }
    if (!rows.length) return failedResult(entry, station, collection, records, "zero-rows", "解析出 0 行");
    const diagnostics = diagnosticsOf(normalized);
    return {
      ...base,
      state: diagnostics.length || normalized.incomplete ? "WARN" : "OK",
      reason: diagnostics.length || normalized.incomplete ? "部分覆盖或部分字段未解析" : "完整解析",
      reasonCategory: diagnostics.length || normalized.incomplete ? "partial-coverage" : "complete"
    };
  } catch (error) {
    const primary = primaryRecord(records);
    if (primary?.status === 401 || primary?.status === 403) return blockedResult(entry, station, collection, records, "auth", `HTTP ${primary.status} 认证/权限阻断`);
    if (records.some(record => record.networkError)) {
      const detail = records.find(record => record.networkError)?.networkError;
      return blockedResult(entry, station, collection, records, "network", `网络请求失败：${detail}`);
    }
    // 只有 2xx 的响应才谈得上「不是 JSON」；4xx/5xx 是 HTTP 失败，分类不能被 non-json 抢走。
    if (primary?.nonJson && primary?.status >= 200 && primary.status < 300) {
      return failedResult(entry, station, collection, records, "non-json", "响应不是 JSON");
    }
    if (!primary?.contentType?.includes("json") && primary?.status >= 200 && primary?.status < 300) {
      return failedResult(entry, station, collection, records, "non-json", "响应不是 JSON");
    }
    if (primary?.status && primary.status >= 400) return failedResult(entry, station, collection, records, "http", `HTTP ${primary.status}`);
    return failedResult(entry, station, collection, records, "collection", error?.message || error);
  }
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

export async function auditDirectSites({ entries = directEntries(), fetchImpl = globalThis.fetch, concurrency = DEFAULT_CONCURRENCY, retries = DEFAULT_RETRIES, retryDelayMs = DEFAULT_RETRY_DELAY_MS, includeSamples = false } = {}) {
  resetProviderRegistry();
  try {
    return await mapLimit(entries, concurrency, entry => auditEntry(entry, { fetchImpl, retries, retryDelayMs, includeSamples }));
  } finally {
    resetProviderRegistry();
  }
}

export function summarize(results, inventoryResult = null) {
  const counts = { ok: 0, warn: 0, fail: 0, blocked: 0 };
  for (const result of results) {
    const key = String(result.state || "").toLowerCase();
    if (key in counts) counts[key] += 1;
  }
  return {
    total: results.length,
    ...counts,
    coverageComplete: results.length > 0 && results.every(result => result.state === "OK"),
    inventory: inventoryResult
  };
}

export function exitCodeForSummary(summary) {
  if (summary.fail > 0) return 1;
  // 一条结果都没有等于没形成覆盖，不能算通过。
  if (summary.total === 0) return 2;
  if (summary.ok === 0 && summary.warn === 0 && summary.blocked > 0) return 2;
  return 0;
}

function parseArgs(args) {
  const jsonIndex = args.indexOf("--json");
  return {
    inventory: args.includes("--inventory"),
    online: args.includes("--online"),
    jsonPath: jsonIndex >= 0 ? args[jsonIndex + 1] : ""
  };
}

function printInventory(value) {
  console.log(`manifests=${value.manifests} direct=${value.direct} page=${value.page} directSitePlugins=${value.directSitePlugins}`);
  if (value.excludedGeneric.length) console.log(`排除 addable:false：${value.excludedGeneric.join(", ")}`);
}

function printResult(result) {
  const detail = result.state === "OK" || result.state === "WARN"
    ? `rows=${result.rows} rawModels=${result.rawModelsUnknown ? "?" : result.rawModels} pricedModels=${result.pricedModels} modes=${Object.keys(result.billingModes).join(",") || "none"}`
    : `${result.reasonCategory}: ${result.reason}`;
  console.log(`${String(result.id).padEnd(18)} ${result.state.padEnd(7)} ${detail}`);
}

export async function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const inventoryResult = inventory();
  if (options.inventory || !options.online) printInventory(inventoryResult);
  if (!options.online) return 0;

  const results = await auditDirectSites();
  const summary = summarize(results, inventoryResult);
  for (const result of results) printResult(result);
  console.log(`\nok=${summary.ok} warn=${summary.warn} fail=${summary.fail} blocked=${summary.blocked} coverageComplete=${summary.coverageComplete}`);

  if (options.jsonPath) {
    const output = path.resolve(process.cwd(), options.jsonPath);
    mkdirSync(path.dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...summary, results }, null, 2)}\n`);
    console.log(`报告已写入 ${output}`);
  }
  return exitCodeForSummary(summary);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
