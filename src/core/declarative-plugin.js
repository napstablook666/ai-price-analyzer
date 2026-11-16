// 声明式插件：仓库只下发 JSON 规格，扩展用这里的构造器把它变成 provider。
// MV3 不允许执行远端代码，所以仓库插件只能是「数据」，不能是 JS。
// 需要自定义采集代码的站点在仓库里标 needsCode: true，只能随扩展发布。

import { requestPolicy } from "./provider-registry.js";
import { isSupportedResponseFormat, RESPONSE_FORMAT_DEFINITIONS } from "./response-formats.js";

export const PLUGIN_REGISTRY_SCHEMA_VERSION = 1;
export const DEFAULT_PLUGIN_REGISTRY_URL = "https://raw.githubusercontent.com/napstablook666/ai-price-analyzer-plugins/main/plugins.json";

export const PLUGIN_SOURCE_LABELS = { bundled: "内置", registry: "仓库", local: "本地插件" };
export const PLUGIN_SOURCE_ORDER = ["bundled", "registry", "local"];
export const PLUGIN_DECLARATIVE_KIND = "declarative";

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION_PATTERN = /^\d+\.\d+(?:\.\d+)*(?:-[0-9A-Za-z.-]+)?$/;
const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const KINDS = new Set(["price", "checkin"]);
const CATEGORIES = new Set(["paid", "public", "benchmark"]);
const MODES = new Set(["direct", "page"]);
const ENDPOINT_CANDIDATES = new Set(["provider", "configured", "automatic"]);
const CREDENTIALS = new Set(["omit", "include", "same-origin"]);
const CHECKIN_FIELDS = ["canClaim", "streak", "rewardAmount", "bonusPercent", "totalClaimed", "lastClaim"];

const PRESET_NUMBER_FIELDS = ["rechargeRmb", "rechargeCredits", "basePricePerMillion"];
const PRESET_RATE_FIELDS = ["rechargeRateVerified", "priceCurrencyVerified"];

function fail(message) {
  throw new Error(message);
}

function text(value, field, { max = 400, required = true } = {}) {
  const result = String(value ?? "").trim();
  if (!result) {
    if (required) fail(`插件字段 ${field} 不能为空`);
    return "";
  }
  if (result.length > max) fail(`插件字段 ${field} 过长（上限 ${max} 字符）`);
  return result;
}

function endpoint(value, field) {
  const result = text(value, field, { max: 512 });
  if (!result.startsWith("/") || result.startsWith("//")) fail(`插件字段 ${field} 必须是站内相对路径（以 / 开头）`);
  if (/[\s\\]/.test(result)) fail(`插件字段 ${field} 不能包含空白或反斜杠`);
  return result;
}

function host(value) {
  const result = text(value, "hosts", { max: 253 }).toLowerCase().replace(/\.$/, "");
  if (!HOST_PATTERN.test(result)) fail(`插件域名不合法：${result}`);
  return result;
}

function stringMap(value, field, { maxKeys = 16 } = {}) {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) fail(`插件字段 ${field} 必须是对象`);
  const entries = Object.entries(value);
  if (entries.length > maxKeys) fail(`插件字段 ${field} 最多 ${maxKeys} 项`);
  const result = {};
  for (const [key, raw] of entries) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(key)) fail(`插件字段 ${field} 含非法键名：${key}`);
    const current = String(raw ?? "").trim();
    if (current.length > 512) fail(`插件字段 ${field}.${key} 过长`);
    result[key] = current;
  }
  return result;
}

function normalizePreset(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) fail("插件字段 preset 必须是对象");
  const preset = {};
  if (raw.name) preset.name = text(raw.name, "preset.name", { max: 120 });
  if (raw.baseUrl) {
    const url = new URL(String(raw.baseUrl));
    if (url.protocol !== "https:") fail("插件字段 preset.baseUrl 必须是 HTTPS");
    preset.baseUrl = url.toString();
  }
  if (raw.category !== undefined) {
    if (!CATEGORIES.has(raw.category)) fail(`插件字段 preset.category 不合法：${raw.category}`);
    preset.category = raw.category;
  }
  for (const field of PRESET_NUMBER_FIELDS) {
    if (raw[field] === undefined) continue;
    const value = Number(raw[field]);
    if (!Number.isFinite(value) || value < 0) fail(`插件字段 preset.${field} 必须是非负数字`);
    preset[field] = value;
  }
  for (const field of PRESET_RATE_FIELDS) {
    if (raw[field] !== undefined) preset[field] = Boolean(raw[field]);
  }
  for (const field of ["priceCurrency", "priceCurrencyNote", "rechargeRateNote"]) {
    if (raw[field] === undefined) continue;
    preset[field] = text(raw[field], `preset.${field}`, { max: 240, required: false });
  }
  if (preset.priceCurrency !== undefined && !["CNY", "USD", "CREDITS", "UNKNOWN"].includes(preset.priceCurrency)) {
    fail(`插件字段 preset.priceCurrency 不合法：${preset.priceCurrency}`);
  }
  return Object.keys(preset).length ? preset : null;
}

function normalizePrepare(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) fail("插件字段 prepare 必须是对象");
  const prepare = {};
  if (raw.baseUrlPath !== undefined) prepare.baseUrlPath = endpoint(raw.baseUrlPath, "prepare.baseUrlPath");
  if (raw.baseUrl !== undefined) {
    const url = new URL(String(raw.baseUrl));
    if (url.protocol !== "https:") fail("插件字段 prepare.baseUrl 必须是 HTTPS");
    prepare.baseUrl = url.toString();
  }
  if (raw.category !== undefined) {
    if (!CATEGORIES.has(raw.category)) fail(`插件字段 prepare.category 不合法：${raw.category}`);
    prepare.category = raw.category;
  }
  for (const field of ["priceCurrency", "priceCurrencyNote", "rechargeRateNote"]) {
    if (raw[field] !== undefined) prepare[field] = text(raw[field], `prepare.${field}`, { max: 240, required: false });
  }
  for (const field of ["priceCurrencyVerified", "rechargeRateVerified"]) {
    if (raw[field] !== undefined) prepare[field] = Boolean(raw[field]);
  }
  return Object.keys(prepare).length ? prepare : null;
}
// 签到插件只描述站点签到端点与字段映射，签到逻辑留在扩展里（MV3 不能下发代码）。
function normalizeCheckin(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) fail("插件字段 checkin 必须是对象");
  const checkin = {};
  for (const field of ["statusPath", "claimPath"]) checkin[field] = endpoint(raw[field], `checkin.${field}`);
  checkin.claimMethod = String(raw.claimMethod || "POST").toUpperCase() === "GET" ? "GET" : "POST";
  for (const field of ["tokenStorageKey", "tokenCookieName"]) {
    checkin[field] = text(raw[field], `checkin.${field}`, { max: 120, required: false });
  }
  const loginPath = text(raw.loginPath, "checkin.loginPath", { max: 120, required: false });
  if (loginPath && !loginPath.startsWith("/")) fail("插件字段 checkin.loginPath 必须以 / 开头");
  checkin.loginPath = loginPath;
  checkin.tokenHint = text(raw.tokenHint, "checkin.tokenHint", { max: 160, required: false });
  const source = raw.fields && typeof raw.fields === "object" && !Array.isArray(raw.fields) ? raw.fields : {};
  const fields = {};
  for (const field of CHECKIN_FIELDS) {
    fields[field] = text(source[field] ?? field, `checkin.fields.${field}`, { max: 64, required: false }) || field;
  }
  checkin.fields = fields;
  const cooldown = raw.cooldownHours === undefined ? 24 : Number(raw.cooldownHours);
  if (!Number.isFinite(cooldown) || cooldown <= 0 || cooldown > 720) fail("插件字段 checkin.cooldownHours 必须是 0-720 之间的数字");
  checkin.cooldownHours = cooldown;
  return checkin;
}

function normalizeAliases(raw) {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) fail("插件字段 modelAliases 必须是数组");
  return raw.map((item) => {
    const alias = String(item?.alias || "").trim().slice(0, 160);
    const canonicalId = String(item?.canonicalId || "").trim().slice(0, 160);
    if (!alias || !canonicalId) fail("插件字段 modelAliases 需要 alias 与 canonicalId");
    return { alias, canonicalId };
  });
}

export function normalizePluginSpec(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("插件规格必须是对象");
  const id = text(raw.id, "id", { max: 64 });
  if (!ID_PATTERN.test(id)) fail(`插件 id 只能用小写字母、数字与连字符：${id}`);
  const version = text(raw.version, "version", { max: 40 });
  if (!VERSION_PATTERN.test(version)) fail(`插件 ${id} 的版本号不合法：${version}`);
  const mode = raw.mode === undefined ? "direct" : raw.mode;
  if (!MODES.has(mode)) fail(`插件 ${id} 的 mode 不合法：${mode}`);
  const category = raw.category === undefined ? "paid" : raw.category;
  if (!CATEGORIES.has(category)) fail(`插件 ${id} 的 category 不合法：${category}`);
  const kind = raw.kind === undefined ? "price" : raw.kind;
  if (!KINDS.has(kind)) fail(`插件 ${id} 的 kind 不合法：${kind}`);
  const hosts = [...new Set((Array.isArray(raw.hosts) ? raw.hosts : [raw.host]).filter(Boolean).map(host))];
  if (!hosts.length) fail(`插件 ${id} 至少要声明一个域名`);
  if (hosts.length > 8) fail(`插件 ${id} 最多声明 8 个域名`);
  const paths = Array.isArray(raw.paths) && raw.paths.length ? [...new Set(raw.paths.map(value => endpoint(value, "paths")))] : null;

  const checkin = normalizeCheckin(raw.checkin);
  if (kind === "checkin" && !checkin) fail(`插件 ${id} 是签到插件，必须声明 checkin 端点`);
  const request = kind === "checkin" ? null : raw.request && typeof raw.request === "object" ? raw.request : { endpoint: raw.endpoint };
  if (kind !== "checkin" && !request.endpoint) fail(`插件 ${id} 缺少采集端点 request.endpoint`);
  const endpointCandidates = request?.endpointCandidates === undefined ? "provider" : request.endpointCandidates;
  if (!ENDPOINT_CANDIDATES.has(endpointCandidates)) fail(`插件 ${id} 的 request.endpointCandidates 不合法：${endpointCandidates}`);
  const credentials = request?.credentials === undefined ? "omit" : request.credentials;
  if (!CREDENTIALS.has(credentials)) fail(`插件 ${id} 的 request.credentials 不合法：${credentials}`);
  const responseFormat = raw.responseFormat === undefined ? "auto" : raw.responseFormat;
  if (!isSupportedResponseFormat(responseFormat)) fail(`插件 ${id} 的 responseFormat 不受支持：${responseFormat}，可用值 ${Object.keys(RESPONSE_FORMAT_DEFINITIONS).join("/")}`);

  return {
    schemaVersion: PLUGIN_REGISTRY_SCHEMA_VERSION,
    id,
    version,
    name: text(raw.name || id, "name", { max: 120 }),
    description: text(raw.description, "description", { max: 400, required: false }),
    hosts,
    paths,
    mode,
    category,
    kind,
    addable: kind === "checkin" ? false : raw.addable !== false,
    preservePriceCurrency: raw.preservePriceCurrency !== false,
    preserveRechargeRateVerification: Boolean(raw.preserveRechargeRateVerification),
    responseFormat,
    request: kind === "checkin" ? null : {
      endpoint: endpoint(request.endpoint, "request.endpoint"),
      endpointCandidates,
      method: String(request.method || "GET").toUpperCase() === "POST" ? "POST" : "GET",
      credentials,
      headers: stringMap(request.headers, "request.headers"),
      pageHeaders: Array.isArray(request.pageHeaders) ? [...new Set(request.pageHeaders.map(value => String(value).trim()).filter(Boolean))].slice(0, 8) : [],
      query: stringMap(request.query, "request.query", { maxKeys: 8 }),
      skipCapture: request.skipCapture === true,
      pageAuth: null
    },
    checkin,
    preset: normalizePreset(raw.preset),
    prepare: normalizePrepare(raw.prepare),
    modelAliases: normalizeAliases(raw.modelAliases)
  };
}

export function normalizePluginSpecList(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const specs = [];
  const rejected = [];
  const seen = new Set();
  for (const item of list) {
    try {
      const spec = normalizePluginSpec(item);
      if (seen.has(spec.id)) {
        rejected.push({ id: spec.id, error: "插件 id 重复" });
        continue;
      }
      seen.add(spec.id);
      specs.push(spec);
    } catch (error) {
      rejected.push({ id: String(item?.id || ""), error: error.message || String(error) });
    }
  }
  return { specs, rejected };
}

// 仓库索引：条目可以是声明式插件（带完整规格），也可以是需要内置代码的站点（needsCode）。
export function normalizeRegistryPayload(payload) {
  const source = Array.isArray(payload) ? payload : payload?.plugins;
  if (!Array.isArray(source)) fail("插件仓库格式不正确：缺少 plugins 数组");
  const entries = [];
  const rejected = [];
  const seen = new Set();
  for (const item of source) {
    const id = String(item?.id || "").trim();
    try {
      if (!ID_PATTERN.test(id)) fail(`插件 id 不合法：${id || "(空)"}`);
      if (seen.has(id)) fail(`插件 id 重复：${id}`);
      const version = String(item?.version || "").trim();
      if (!VERSION_PATTERN.test(version)) fail(`插件 ${id} 的版本号不合法：${version || "(空)"}`);
      seen.add(id);
      if (item?.needsCode === true) {
        entries.push({
          id,
          name: String(item.name || id).trim(),
          version,
          description: String(item.description || "").trim(),
          hosts: Array.isArray(item.hosts) ? item.hosts.map(value => String(value || "").toLowerCase()).filter(Boolean) : [],
          needsCode: true,
          spec: null
        });
        continue;
      }
      const spec = normalizePluginSpec({ ...item, id, version });
      entries.push({
        id,
        name: spec.name,
        version: spec.version,
        description: spec.description,
        hosts: spec.hosts,
        needsCode: false,
        spec
      });
    } catch (error) {
      rejected.push({ id, error: error.message || String(error) });
    }
  }
  return { entries, rejected };
}

export function comparePluginVersions(left, right) {
  const parse = value => String(value || "0").split(/[.+-]/).filter(Boolean).map(part => (/^\d+$/.test(part) ? Number(part) : part));
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const x = a[index];
    const y = b[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === "number" && typeof y === "number") {
      if (x !== y) return x < y ? -1 : 1;
      continue;
    }
    const result = String(x).localeCompare(String(y));
    if (result !== 0) return result < 0 ? -1 : 1;
  }
  return 0;
}

// 已装插件的更新判定。采集代码随扩展打包的插件（builtin）没有可下载的新代码，
// 装与不装跑的都是扩展里这一份，版本号只是跟着扩展发版同步跳号；
// 拿它跟仓库里的版本比，扩展每发一次版就会把所有已装插件都算成「有更新」。
export function pluginUpdateState({ record, entry, codeBundled = false, bundledVersion = "" } = {}) {
  if (!record) return { installed: false, installedVersion: "", updateAvailable: false };
  const installedVersion = codeBundled ? String(bundledVersion || "") : String(record.version || "");
  const updateAvailable = !codeBundled && comparePluginVersions(record.version, entry?.version) < 0;
  return { installed: true, installedVersion, updateAvailable };
}

export function normalizeRegistryState(input = {}) {
  const raw = input && typeof input === "object" ? input : {};
  let url = DEFAULT_PLUGIN_REGISTRY_URL;
  const candidate = String(raw.url || "").trim();
  if (candidate) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "https:") url = parsed.toString();
    } catch {
      url = DEFAULT_PLUGIN_REGISTRY_URL;
    }
  }
  const entries = Array.isArray(raw.entries)
    ? raw.entries.filter(entry => entry && typeof entry === "object" && typeof entry.id === "string" && typeof entry.version === "string")
      .map(entry => ({
        id: entry.id,
        name: String(entry.name || entry.id),
        version: entry.version,
        description: String(entry.description || ""),
        hosts: Array.isArray(entry.hosts) ? entry.hosts.map(value => String(value || "")) : [],
        needsCode: entry.needsCode === true,
        spec: entry.needsCode === true ? null : entry.spec || null
      }))
      .filter(entry => entry.needsCode || entry.spec)
    : [];
  // 装过就记住，不跟仓库刷新结果走：仓库拉取失败或暂时少了这个条目，不该把插件一起清掉。
  const installed = {};
  for (const [id, record] of Object.entries(raw.installed && typeof raw.installed === "object" ? raw.installed : {})) {
    if (!id) continue;
    installed[id] = { version: String(record?.version || ""), installedAt: Number(record?.installedAt) || 0 };
  }
  return {
    url,
    fetchedAt: Number(raw.fetchedAt) || 0,
    error: String(raw.error || ""),
    entries,
    installed
  };
}


// 刷新仓库只替换条目清单，安装记录原样保留：needsCode 插件的采集代码随扩展打包，
// 清掉记录会让已装插件在界面上变回「未安装」；已装版本也不能被仓库版本顶掉，
// 否则 updateAvailable 永远算不出「有更新」。
export function registryStateAfterRefresh(current = {}, { url, entries, fetchedAt = Date.now() } = {}) {
  const previous = normalizeRegistryState(current);
  return normalizeRegistryState({
    ...previous,
    url: url || previous.url,
    fetchedAt,
    error: "",
    entries,
    installed: previous.installed
  });
}
export function normalizeLocalPlugins(input) {
  const { specs, rejected } = normalizePluginSpecList(input);
  return { specs, rejected };
}

// 已安装且可用的声明式插件：仓库安装的 + 开发模式下的本地插件（本地优先）。
// 已安装且可用的声明式插件：仓库安装的 + 开发模式下的本地插件（本地优先）。
function installedSpecs(settings, kind) {
  const registry = normalizeRegistryState(settings.pluginRegistry);
  const local = normalizeLocalPlugins(settings.devMode === true ? settings.localPlugins : []).specs
    .map(spec => ({ ...spec, source: "local" }))
    .filter(spec => (spec.kind || "price") === kind);
  const localIds = new Set(local.map(spec => spec.id));
  const registrySpecs = registry.entries
    .filter(entry => !entry.needsCode && entry.spec && registry.installed[entry.id] && !localIds.has(entry.id))
    .map(entry => ({ ...entry.spec, source: "registry" }))
    .filter(spec => (spec.kind || "price") === kind);
  return [...local, ...registrySpecs];
}

export function installedPluginSpecs(settings = {}) {
  return installedSpecs(settings, "price");
}

// 签到插件只提供站点签到适配，不参与价格采集。
export function installedCheckinSpecs(settings = {}) {
  return installedSpecs(settings, "checkin");
}

export function providerFromSpec(spec) {
  if (!spec || !spec.id || !Array.isArray(spec.hosts) || !spec.hosts.length) throw new Error("声明式插件规格不完整");
  if (spec.kind === "checkin") throw new Error("签到插件不参与价格采集");
  const hosts = spec.hosts;
  const paths = Array.isArray(spec.paths) && spec.paths.length ? spec.paths : null;
  const prepare = spec.prepare || {};
  const request = spec.request || {};
  const adapter = {
    kind: PLUGIN_DECLARATIVE_KIND,
    endpoint: request.endpoint,
    method: request.method || "GET",
    responseFormat: spec.responseFormat || "auto"
  };
  return {
    kind: PLUGIN_DECLARATIVE_KIND,
    id: spec.id,
    host: hosts[0],
    hosts,
    version: spec.version,
    mode: spec.mode || "direct",
    authType: "none",
    responseFormat: spec.responseFormat || "auto",
    name: spec.name,
    description: spec.description || "",
    category: spec.category || "paid",
    addable: spec.addable !== false,
    source: spec.source || "registry",
    rationale: spec.description || `通过 ${hosts[0]} 的公开接口直连采集`,
    preservePriceCurrency: spec.preservePriceCurrency !== false,
    preserveRechargeRateVerification: spec.preserveRechargeRateVerification === true,
    matches: ({ hostname, path, hashPath }) => hosts.includes(hostname) && (!paths || paths.includes(path) || paths.includes(hashPath)),
    prepareMatches: ({ hostname }) => hosts.includes(hostname),
    prepare: (stationInput, { url }) => ({
      ...stationInput,
      ...(prepare.baseUrl ? { baseUrl: prepare.baseUrl } : {}),
      ...(prepare.baseUrlPath ? { baseUrl: `${url.origin}${prepare.baseUrlPath}` } : {}),
      ...(prepare.category ? { category: prepare.category } : {}),
      ...(prepare.priceCurrency ? { priceCurrency: prepare.priceCurrency } : {}),
      ...(prepare.priceCurrencyNote !== undefined ? { priceCurrencyNote: prepare.priceCurrencyNote } : {}),
      ...(prepare.priceCurrencyVerified !== undefined ? { priceCurrencyVerified: prepare.priceCurrencyVerified } : {}),
      ...(prepare.rechargeRateNote !== undefined ? { rechargeRateNote: prepare.rechargeRateNote } : {}),
      ...(prepare.rechargeRateVerified !== undefined ? { rechargeRateVerified: prepare.rechargeRateVerified } : {}),
      mode: spec.mode || "direct",
      auth: { type: "none" },
      adapter: { ...(stationInput.adapter || {}), ...adapter }
    }),
    request: requestPolicy(request.endpoint, {
      endpointCandidates: request.endpointCandidates || "provider",
      headers: request.headers || {},
      pageHeaders: request.pageHeaders || [],
      credentials: request.credentials || "omit",
      query: request.query || null,
      skipCapture: request.skipCapture === true
    }),
    preset: spec.preset || undefined,
    modelAliases: Array.isArray(spec.modelAliases) ? spec.modelAliases : []
  };
}