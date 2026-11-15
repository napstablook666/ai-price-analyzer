export const UPDATE_REPO = "napstablook666/ai-price-analyzer";
export const UPDATE_PROJECT_URL = "https://github.com/napstablook666/ai-price-analyzer";
export const UPDATE_RELEASES_URL = `${UPDATE_PROJECT_URL}/releases`;
export const UPDATE_DOCS_URL = "https://napstablook666.github.io/ai-price-analyzer/";
export const UPDATE_ISSUES_URL = `${UPDATE_PROJECT_URL}/issues`;
export const UPDATE_LICENSE_URL = `${UPDATE_PROJECT_URL}/blob/main/LICENSE`;
export const UPDATE_LICENSE_NAME = "GPL-3.0";

const UPDATE_API_BASE = `https://api.github.com/repos/${UPDATE_REPO}`;

export const UPDATE_CHANNELS = [
  { id: "stable", label: "稳定版", hint: "只提示正式发布" },
  { id: "prerelease", label: "每个版本", hint: "含预发布版本" }
];

export const UPDATE_INTERVAL_OPTIONS = [
  { minutes: 60, label: "1 小时" },
  { minutes: 360, label: "6 小时" },
  { minutes: 1440, label: "24 小时" }
];

export const DEFAULT_UPDATE_CHANNEL = "stable";
export const DEFAULT_UPDATE_INTERVAL_MINUTES = 360;
const RELEASES_PER_PAGE = 10;

export function normalizeUpdateChannel(value) {
  return UPDATE_CHANNELS.some(channel => channel.id === value) ? value : DEFAULT_UPDATE_CHANNEL;
}

export function normalizeUpdateInterval(value) {
  const minutes = Number(value);
  return UPDATE_INTERVAL_OPTIONS.some(option => option.minutes === minutes) ? minutes : DEFAULT_UPDATE_INTERVAL_MINUTES;
}

// 版本号按语义化版本比较：v 前缀与构建元数据忽略，预发布标识按 semver 规则排在正式版之前。
export function parseVersion(value) {
  const text = String(value ?? "").trim().replace(/^v/i, "");
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : []
  };
}

function comparePrereleaseIdentifiers(left, right) {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index];
    const b = right[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);
    if (aNumeric && bNumeric) {
      const diff = Number(a) - Number(b);
      if (diff) return diff < 0 ? -1 : 1;
      continue;
    }
    if (aNumeric) return -1;
    if (bNumeric) return 1;
    if (a === b) continue;
    return a < b ? -1 : 1;
  }
  return 0;
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return null;
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;
  return comparePrereleaseIdentifiers(a.prerelease, b.prerelease);
}

export function isNewerVersion(latest, current) {
  return compareVersions(latest, current) === 1;
}

export function releaseApiUrl(channel) {
  return normalizeUpdateChannel(channel) === "prerelease"
    ? `${UPDATE_API_BASE}/releases?per_page=${RELEASES_PER_PAGE}`
    : `${UPDATE_API_BASE}/releases/latest`;
}

export function normalizeRelease(payload) {
  if (!payload || typeof payload !== "object" || payload.draft) return null;
  const tag = String(payload.tag_name || payload.name || "").trim();
  if (!tag) return null;
  return {
    version: tag.replace(/^v/i, ""),
    tag,
    name: String(payload.name || tag).trim(),
    url: String(payload.html_url || UPDATE_RELEASES_URL),
    notes: String(payload.body || ""),
    publishedAt: String(payload.published_at || ""),
    prerelease: Boolean(payload.prerelease)
  };
}

// 发布说明只保留可读的纯文本片段，Markdown 符号与空行压掉。
export function summarizeReleaseNotes(notes, { maxLength = 320 } = {}) {
  const text = String(notes || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/\r/g, "")
    .replace(/\n{2,}/g, "\n")
    .replace(/[*_`>]/g, "")
    .trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trimEnd()}…`;
}

function requestErrorMessage(status) {
  if (status === 404) return "仓库或发布信息不存在";
  return `GitHub 接口返回 HTTP ${status}`;
}

function headerValue(response, name) {
  try {
    return response?.headers?.get?.(name) ?? null;
  } catch {
    return null;
  }
}

function clock(now) {
  return typeof now === "function" ? Number(now()) || Date.now() : Number(now) || Date.now();
}

function readRateLimitResetAt(response, nowMs) {
  const reset = Number(headerValue(response, "x-ratelimit-reset"));
  if (Number.isFinite(reset) && reset > 0) return reset * 1000;
  const retryAfter = Number(headerValue(response, "retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) return nowMs + retryAfter * 1000;
  return 0;
}

// 配额用完时给个人话的时间，避免用户立刻反复重试继续烧配额。
export function cooldownMessage(resetAt, nowMs = Date.now()) {
  const left = Number(resetAt) - Number(nowMs);
  if (!Number.isFinite(left) || left <= 0) return "稍后再试";
  return `约 ${Math.max(1, Math.ceil(left / 60000))} 分钟后可再试`;
}

function releaseFromTag(tag) {
  const cleaned = String(tag || "").trim();
  if (!cleaned) return null;
  return normalizeRelease({
    tag_name: cleaned,
    html_url: `${UPDATE_PROJECT_URL}/releases/tag/${cleaned}`,
    prerelease: /-/.test(cleaned.replace(/^v/i, ""))
  });
}

// 接口配额用完时退回公开的 releases 页面：不占 API 配额，代价是没有发布说明。
export async function fetchReleaseFromHtml({ channel = DEFAULT_UPDATE_CHANNEL, fetchImpl = fetch } = {}) {
  const stable = normalizeUpdateChannel(channel) === "stable";
  const response = await fetchImpl(stable ? `${UPDATE_PROJECT_URL}/releases/latest` : `${UPDATE_PROJECT_URL}/releases`, {
    headers: { accept: "text/html" },
    cache: "no-store"
  });
  if (!response?.ok) return null;
  if (stable && response.url) {
    const redirected = /\/releases\/tag\/([^/?#]+)/.exec(String(response.url));
    if (redirected) return releaseFromTag(decodeURIComponent(redirected[1]));
  }
  const html = await response.text();
  const tags = [...String(html || "").matchAll(/\/releases\/tag\/([^"?#]+)/g)].map(match => decodeURIComponent(match[1]));
  const unique = [...new Set(tags)];
  const picked = stable ? unique.find(tag => !/-/.test(tag.replace(/^v/i, ""))) : unique[0];
  return picked ? releaseFromTag(picked) : null;
}

// 先读公开的 releases 页面：不占接口配额，正式版靠重定向后的地址拿到标签。
async function readHtmlRelease({ channel, fetchImpl }) {
  return fetchReleaseFromHtml({ channel, fetchImpl }).catch(() => null);
}

export async function requestLatestRelease({
  channel = DEFAULT_UPDATE_CHANNEL,
  fetchImpl = fetch,
  etag = "",
  cachedRelease = null,
  now = Date.now,
  htmlFallback = true,
  preferHtml = false
} = {}) {
  const normalizedChannel = normalizeUpdateChannel(channel);
  if (preferHtml) {
    const release = await readHtmlRelease({ channel: normalizedChannel, fetchImpl });
    if (release) return { release, etag, notModified: false, source: "html", resetAt: 0 };
  }

  const headers = { accept: "application/vnd.github+json" };
  if (etag) headers["if-none-match"] = etag;
  const response = await fetchImpl(releaseApiUrl(normalizedChannel), { headers, cache: "no-store" });

  // 条件请求命中 304 不消耗配额，直接复用上次结果。
  if (response.status === 304) {
    return { release: cachedRelease || null, etag, notModified: true, source: "cache", resetAt: 0 };
  }
  // 还没有发布过版本时 GitHub 直接 404，不算错误。
  if (response.status === 404) {
    return { release: null, etag: headerValue(response, "etag") || "", notModified: false, source: "api", resetAt: 0 };
  }
  if (response.status === 403 || response.status === 429) {
    const nowMs = clock(now);
    const resetAt = readRateLimitResetAt(response, nowMs);
    if (htmlFallback) {
      const fallback = await readHtmlRelease({ channel: normalizedChannel, fetchImpl });
      if (fallback) return { release: fallback, etag: "", notModified: false, source: "html", resetAt };
    }
    const error = new Error(`GitHub 接口请求过于频繁，${cooldownMessage(resetAt, nowMs)}`);
    error.rateLimited = true;
    error.resetAt = resetAt;
    throw error;
  }
  if (!response.ok) throw new Error(requestErrorMessage(response.status));

  const payload = await response.json();
  const items = Array.isArray(payload) ? payload : [payload];
  let release = null;
  for (const item of items) {
    release = normalizeRelease(item);
    if (release) break;
  }
  return { release, etag: headerValue(response, "etag") || "", notModified: false, source: "api", resetAt: 0 };
}

export async function fetchLatestRelease(options = {}) {
  const { release } = await requestLatestRelease(options);
  return release;
}

// 页面取到的版本不带发布说明：先看缓存，再试一次接口，拿不到就留空，不因此判失败。
async function withReleaseNotes(release, { channel, fetchImpl, cachedRelease, now = Date.now }) {
  if (cachedRelease && cachedRelease.version === release.version && cachedRelease.notes) {
    return { ...release, notes: cachedRelease.notes };
  }
  try {
    const api = await requestLatestRelease({ channel, fetchImpl, now, htmlFallback: false, preferHtml: false });
    if (api.release && api.release.version === release.version) {
      return { ...release, notes: api.release.notes, publishedAt: release.publishedAt || api.release.publishedAt };
    }
  } catch {
    // 接口不可用只影响发布说明，不影响「有没有新版本」的结论。
  }
  return release;
}

export async function checkForUpdate({
  currentVersion,
  channel = DEFAULT_UPDATE_CHANNEL,
  fetchImpl = fetch,
  now = Date.now,
  etag = "",
  cachedRelease = null,
  htmlFallback = true,
  preferHtml = true
} = {}) {
  const normalizedChannel = normalizeUpdateChannel(channel);
  const checkedAt = clock(now);
  const current = String(currentVersion || "").trim();
  try {
    const result = await requestLatestRelease({
      channel: normalizedChannel,
      fetchImpl,
      etag,
      cachedRelease,
      now,
      htmlFallback,
      preferHtml
    });
    const base = {
      channel: normalizedChannel,
      currentVersion: current,
      checkedAt,
      etag: result.etag || "",
      resetAt: result.resetAt || 0,
      source: result.source,
      notModified: Boolean(result.notModified)
    };
    if (!result.release) {
      return { ...base, status: "none", latestVersion: "", hasUpdate: false, releaseUrl: UPDATE_RELEASES_URL, notes: "", publishedAt: "", error: "" };
    }
    const release = result.source === "html"
      ? await withReleaseNotes(result.release, { channel: normalizedChannel, fetchImpl, cachedRelease, now })
      : result.release;
    const hasUpdate = isNewerVersion(release.version, current);
    return {
      ...base,
      status: hasUpdate ? "update" : "latest",
      latestVersion: release.version,
      hasUpdate,
      releaseUrl: release.url,
      notes: summarizeReleaseNotes(release.notes),
      publishedAt: release.publishedAt || "",
      error: ""
    };
  } catch (error) {
    return {
      status: "error",
      channel: normalizedChannel,
      currentVersion: current,
      latestVersion: "",
      hasUpdate: false,
      releaseUrl: UPDATE_RELEASES_URL,
      notes: "",
      publishedAt: "",
      checkedAt,
      etag: "",
      resetAt: Number(error?.resetAt) || 0,
      source: "api",
      notModified: false,
      error: String(error?.message || error || "检查更新失败")
    };
  }
}