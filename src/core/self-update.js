// 自更新的版本元数据：结构校验、签名校验、文件差异计算。
// 这里只管「拿到的数据能不能信」，落盘与界面在别的模块。
// 签名口径必须和 scripts/build-update-manifest.mjs、update.ps1 三处保持一致，改动要同时改。

import { compareVersions, parseVersion } from "./update-check.js";

const REPO = "napstablook666/ai-price-analyzer";

// releases/latest 只指向最新的正式版，预发布版拿不到自更新，只能手动下载。
export const UPDATE_MANIFEST_URL = `https://github.com/${REPO}/releases/latest/download/update.json`;

// 签名公钥，生成后硬编码在这里，不从网络取。对应私钥只在 GitHub Secrets。
export const UPDATE_SIGNING_KEY = {
  kty: "EC",
  crv: "P-256",
  x: "wmVTXpGty2hNwtaLw2xpWFh8olyVheHL-2UCeg0tlG4",
  y: "vvXf4B1lNijl16o1EGZU69Z22wjAtN6W5VWVvCzBtms"
};

export const UPDATE_MANIFEST_MAX_BYTES = 2 * 1024 * 1024;
export const UPDATE_ZIP_MAX_BYTES = 64 * 1024 * 1024;
export const UPDATE_FETCH_TIMEOUT_MS = 30000;

// 权限清单用这个字段判断「要不要重新启用扩展」，更新包里改了权限就得提醒用户。
const REQUIRED_ENTRY = "manifest.json";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function isSafeRelativePath(value) {
  if (typeof value !== "string") return false;
  if (!value || value.length > 512) return false;
  // 反斜杠、盘符、协议头一律不认，路径分隔符只允许正斜杠。
  if (value.includes("\\") || value.includes(":")) return false;
  if (value.startsWith("/")) return false;
  // 控制字符与空字节会绕过后续判断。
  if (/[\u0000-\u001f]/.test(value)) return false;
  return value.split("/").every(segment => segment && segment !== "." && segment !== "..");
}

function fail(message) {
  throw new Error(message);
}

function normalizeHttpsUrl(value) {
  if (typeof value !== "string" || !value) fail("update.json 缺少 zip.url");
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`update.json 的 zip.url 不是合法地址：${value}`);
  }
  if (parsed.protocol !== "https:") fail(`update.json 的 zip.url 必须是 https：${value}`);
  return parsed.href;
}

function normalizeFiles(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("update.json 缺少 files");
  const files = {};
  for (const [path, hash] of Object.entries(input)) {
    if (!isSafeRelativePath(path)) fail(`update.json 的 files 里有不安全路径：${path}`);
    if (typeof hash !== "string" || !SHA256_PATTERN.test(hash)) fail(`update.json 的 files 里 ${path} 的 sha256 不合法`);
    files[path] = hash;
  }
  if (!Object.keys(files).length) fail("update.json 的 files 是空的");
  if (!(REQUIRED_ENTRY in files)) fail(`update.json 的 files 缺少 ${REQUIRED_ENTRY}`);
  return files;
}

function normalizeDeleted(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) fail("update.json 的 deleted 必须是数组");
  const deleted = [];
  for (const path of input) {
    if (!isSafeRelativePath(path)) fail(`update.json 的 deleted 里有不安全路径：${path}`);
    if (!deleted.includes(path)) deleted.push(path);
  }
  return deleted;
}

// 接受字符串或已解析对象，返回规范化后的清单。结构不对直接抛错，调用方负责转成界面文案。
export function parseUpdateManifest(raw) {
  let payload = raw;
  if (typeof raw === "string") {
    try {
      payload = JSON.parse(raw);
    } catch {
      fail("update.json 不是合法 JSON");
    }
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) fail("update.json 结构不对");

  const version = String(payload.version ?? "").trim();
  if (!parseVersion(version)) fail(`update.json 的 version 不是语义化版本：${version || "(空)"}`);

  const minShell = String(payload.minShell ?? "").trim();
  if (minShell && !parseVersion(minShell)) fail(`update.json 的 minShell 不是语义化版本：${minShell}`);

  const zip = payload.zip;
  if (!zip || typeof zip !== "object") fail("update.json 缺少 zip");
  const sha256 = String(zip.sha256 ?? "").trim().toLowerCase();
  if (!SHA256_PATTERN.test(sha256)) fail("update.json 的 zip.sha256 不合法");
  const size = Number(zip.size);
  if (!Number.isInteger(size) || size <= 0) fail("update.json 的 zip.size 不合法");
  if (size > UPDATE_ZIP_MAX_BYTES) fail(`更新包超过上限 ${UPDATE_ZIP_MAX_BYTES} 字节`);

  const signature = String(payload.signature ?? "").trim();
  if (!signature) fail("update.json 缺少 signature");

  return {
    version,
    minShell: minShell || version,
    publishedAt: String(payload.publishedAt ?? "").trim(),
    zip: { url: normalizeHttpsUrl(zip.url), size, sha256 },
    files: normalizeFiles(payload.files),
    deleted: normalizeDeleted(payload.deleted),
    signature
  };
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text, subtle) {
  const bytes = new TextEncoder().encode(text);
  return toHex(await subtle.digest("SHA-256", bytes));
}

function sortedKeys(record) {
  return Object.keys(record).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

// files 与 deleted 各自压成一个摘要，签名只覆盖两个摘要而不是整份文件表：
// ps1 侧拼字符串算 sha256 比序列化整个 JSON 稳，也不会因为键顺序不同而验签失败。
export async function manifestDigests(manifest, { subtle = globalThis.crypto.subtle } = {}) {
  const files = sortedKeys(manifest.files).map(path => `${path}\n${manifest.files[path]}\n`).join("");
  const deleted = [...manifest.deleted].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map(path => `${path}\n`).join("");
  return {
    files: await sha256Hex(files, subtle),
    deleted: await sha256Hex(deleted, subtle)
  };
}

// 签名串：版本、最低壳版本、包摘要、文件表摘要、删除表摘要，五行，末尾不带换行。
// minShell 也要签：不然改它就能把用户的扩展卡在「必须手动下载」上。
export async function manifestSigningPayload(manifest, options = {}) {
  const digests = await manifestDigests(manifest, options);
  const minShell = manifest.minShell || manifest.version;
  return `v${manifest.version}\n${minShell}\n${manifest.zip.sha256}\n${digests.files}\n${digests.deleted}`;
}

export function base64ToBytes(value) {
  const cleaned = String(value).replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  const padded = cleaned + "=".repeat((4 - (cleaned.length % 4)) % 4);
  let binary;
  try {
    binary = atob(padded);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export async function verifyUpdateSignature(manifest, { publicKey = UPDATE_SIGNING_KEY, subtle = globalThis.crypto.subtle } = {}) {
  const signature = base64ToBytes(manifest?.signature);
  if (!signature || !signature.length) return false;
  let key;
  try {
    key = await subtle.importKey("jwk", publicKey, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  } catch {
    return false;
  }
  const payload = new TextEncoder().encode(await manifestSigningPayload(manifest, { subtle }));
  try {
    return await subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, payload);
  } catch {
    return false;
  }
}

// 判断当前这一版能不能自更新。minShell 高于当前版本说明协议已经变过一轮，只能手动装。
export function canSelfUpdate(currentVersion, manifest) {
  const diff = compareVersions(manifest?.minShell || "0.0.0", currentVersion);
  return diff === null ? false : diff <= 0;
}

// manifest.json 永远排在最后写：中途失败时旧清单还在，扩展至少还能加载起来。
function writeRank(path) {
  return path === REQUIRED_ENTRY ? 1 : 0;
}

// localHashes 是目标目录里现有的 { 路径: sha256 }，缺的文件视为需要写入。
export function diffFiles(localHashes, manifest) {
  const local = localHashes && typeof localHashes === "object" ? localHashes : {};
  const write = [];
  for (const path of sortedKeys(manifest.files)) {
    if (local[path] !== manifest.files[path]) write.push(path);
  }
  write.sort((a, b) => {
    const rank = writeRank(a) - writeRank(b);
    if (rank !== 0) return rank;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const remove = manifest.deleted.filter(path => path in local);
  return { write, remove };
}

function readTimeout(options) {
  const value = Number(options.timeoutMs ?? UPDATE_FETCH_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : UPDATE_FETCH_TIMEOUT_MS;
}

// 拉清单只做一次重试：多源镜像没有，网络抖一下重试一次足够，再失败就让用户手动下载。
export async function fetchUpdateManifest({
  fetchImpl = fetch,
  url = UPDATE_MANIFEST_URL,
  retries = 1,
  timeoutMs,
  now = Date.now,
  publicKey = UPDATE_SIGNING_KEY
} = {}) {
  const attemptLimit = Math.max(0, Number(retries) || 0) + 1;
  let lastError = "";
  for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), readTimeout({ timeoutMs })) : null;
    try {
      const response = await fetchImpl(`${url}${url.includes("?") ? "&" : "?"}_=${now()}`, {
        cache: "no-store",
        signal: controller?.signal
      });
      if (!response.ok) throw new Error(`下载 update.json 失败：HTTP ${response.status}`);
      const text = await response.text();
      if (text.length > UPDATE_MANIFEST_MAX_BYTES) throw new Error("update.json 体积异常，已中止");
      const manifest = parseUpdateManifest(text);
      if (!(await verifyUpdateSignature(manifest, { publicKey }))) throw new Error("update.json 签名校验失败，已中止");
      return { manifest, fetchedAt: now() };
    } catch (error) {
      lastError = String(error?.message || error || "下载 update.json 失败");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw new Error(lastError);
}
