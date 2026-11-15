import test from "node:test";
import assert from "node:assert/strict";
import {
  checkForUpdate,
  compareVersions,
  fetchLatestRelease,
  isNewerVersion,
  normalizeRelease,
  normalizeUpdateChannel,
  normalizeUpdateInterval,
  parseVersion,
  releaseApiUrl,
  summarizeReleaseNotes
} from "../src/core/update-check.js";
import { normalizeSettings } from "../src/shared/schema.js";

function fakeResponse(payload, status = 200, headers = {}, extra = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: name => headers[String(name).toLowerCase()] ?? null },
    json: async () => payload,
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
    url: extra.url || "",
    ...extra
  };
}

function fakeFetch(payload, status = 200, calls = []) {
  return async (url, options) => {
    calls.push({ url, options });
    return fakeResponse(payload, status);
  };
}

function routeFetch(routes) {
  return async (url, options) => {
    const href = String(url);
    for (const [fragment, handler] of routes) {
      if (href.includes(fragment)) return handler(href, options);
    }
    throw new Error(`未预料的请求：${href}`);
  };
}

test("版本号解析接受 v 前缀与构建元数据", () => {
  assert.deepEqual(parseVersion("v0.3.0"), { major: 0, minor: 3, patch: 0, prerelease: [] });
  assert.deepEqual(parseVersion("1.2.3-beta.1+sha.abc"), { major: 1, minor: 2, patch: 3, prerelease: ["beta", "1"] });
  assert.equal(parseVersion("最新"), null);
  assert.equal(parseVersion("1.2"), null);
});

test("版本比较按 semver 规则，预发布排在正式版之前", () => {
  assert.equal(compareVersions("0.3.0", "0.3.0"), 0);
  assert.equal(compareVersions("0.3.1", "0.3.0"), 1);
  assert.equal(compareVersions("0.2.9", "0.3.0"), -1);
  assert.equal(compareVersions("v0.4.0", "0.3.0"), 1);
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0"), -1);
  assert.equal(compareVersions("1.0.0-rc.2", "1.0.0-rc.1"), 1);
  assert.equal(compareVersions("1.0.0-beta.2", "1.0.0-beta.10"), -1);
  assert.equal(compareVersions("坏版本", "1.0.0"), null);
  assert.equal(isNewerVersion("0.3.1", "0.3.0"), true);
  assert.equal(isNewerVersion("0.3.0", "0.3.0"), false);
});

test("渠道与间隔只接受白名单值", () => {
  assert.equal(normalizeUpdateChannel("prerelease"), "prerelease");
  assert.equal(normalizeUpdateChannel("nightly"), "stable");
  assert.equal(normalizeUpdateChannel(undefined), "stable");
  assert.equal(normalizeUpdateInterval(60), 60);
  assert.equal(normalizeUpdateInterval("1440"), 1440);
  assert.equal(normalizeUpdateInterval(5), 360);
  assert.equal(normalizeUpdateInterval("180"), 360);
  assert.equal(releaseApiUrl("stable"), "https://api.github.com/repos/napstablook666/ai-price-analyzer/releases/latest");
  assert.match(releaseApiUrl("prerelease"), /\/releases\?per_page=10$/);
});

test("release 载荷归一，草稿与空标签丢回 null", () => {
  assert.deepEqual(normalizeRelease({ tag_name: "v0.4.0", name: "0.4.0", html_url: "https://x/1", body: "说明", published_at: "2026-11-15T00:00:00Z", prerelease: false }), {
    version: "0.4.0",
    tag: "v0.4.0",
    name: "0.4.0",
    url: "https://x/1",
    notes: "说明",
    publishedAt: "2026-11-15T00:00:00Z",
    prerelease: false
  });
  assert.equal(normalizeRelease({ tag_name: "v0.4.0", draft: true }), null);
  assert.equal(normalizeRelease({ tag_name: "" }), null);
  assert.equal(normalizeRelease(null), null);
});

test("发布说明压成纯文本并按长度截断", () => {
  assert.equal(summarizeReleaseNotes("## 新增\n\n- 关于页\n- 更新检测\n"), "新增\n- 关于页\n- 更新检测");
  assert.equal(summarizeReleaseNotes(""), "");
  const long = summarizeReleaseNotes("a".repeat(400), { maxLength: 10 });
  assert.equal(long, `${"a".repeat(10)}…`);
});

test("稳定渠道打到 releases/latest，每个版本渠道打到列表", async () => {
  const calls = [];
  await fetchLatestRelease({ channel: "stable", fetchImpl: fakeFetch({ tag_name: "v0.4.0" }, 200, calls) });
  await fetchLatestRelease({ channel: "prerelease", fetchImpl: fakeFetch([{ tag_name: "v0.5.0-beta.1", prerelease: true }], 200, calls) });
  assert.match(calls[0].url, /releases\/latest$/);
  assert.match(calls[1].url, /releases\?per_page=10$/);
  assert.equal(calls[0].options.cache, "no-store");
});

test("列表渠道跳过草稿取第一条可用版本", async () => {
  const release = await fetchLatestRelease({ channel: "prerelease", fetchImpl: fakeFetch([{ tag_name: "v0.5.0", draft: true }, { tag_name: "v0.4.1" }]) });
  assert.equal(release.version, "0.4.1");
});

test("404 视为仓库还没发版本", async () => {
  assert.equal(await fetchLatestRelease({ channel: "stable", fetchImpl: fakeFetch({ message: "Not Found" }, 404) }), null);
  const result = await checkForUpdate({ currentVersion: "0.3.0", fetchImpl: fakeFetch({ message: "Not Found" }, 404), now: () => 1700000000000 });
  assert.equal(result.status, "none");
  assert.equal(result.hasUpdate, false);
  assert.equal(result.error, "");
  assert.equal(result.checkedAt, 1700000000000);
});

test("有更高版本时给出 update 与发布页", async () => {
  const result = await checkForUpdate({
    currentVersion: "0.3.0",
    channel: "stable",
    preferHtml: false,
    fetchImpl: fakeFetch({ tag_name: "v0.4.0", html_url: "https://github.com/x/releases/tag/v0.4.0", body: "## 修复\n- 某个问题", published_at: "2026-11-15T02:00:00Z" }),
    now: () => 1700000000000
  });
  assert.equal(result.status, "update");
  assert.equal(result.hasUpdate, true);
  assert.equal(result.latestVersion, "0.4.0");
  assert.equal(result.releaseUrl, "https://github.com/x/releases/tag/v0.4.0");
  assert.equal(result.notes, "修复\n- 某个问题");
  assert.equal(result.error, "");
});

test("同版本或本地更高时判为最新", async () => {
  const same = await checkForUpdate({ currentVersion: "0.4.0", fetchImpl: fakeFetch({ tag_name: "v0.4.0" }) });
  assert.equal(same.status, "latest");
  assert.equal(same.hasUpdate, false);
  const newer = await checkForUpdate({ currentVersion: "0.5.0", fetchImpl: fakeFetch({ tag_name: "v0.4.0" }) });
  assert.equal(newer.status, "latest");
});

test("接口报错归成 error 不抛异常", async () => {
  const result = await checkForUpdate({ currentVersion: "0.3.0", fetchImpl: async () => { throw new Error("网络断了"); } });
  assert.equal(result.status, "error");
  assert.equal(result.error, "网络断了");
  assert.equal(result.hasUpdate, false);

  const limited = await checkForUpdate({ currentVersion: "0.3.0", fetchImpl: fakeFetch({}, 403) });
  assert.equal(limited.status, "error");
  assert.match(limited.error, /过于频繁/);

  const serverError = await checkForUpdate({ currentVersion: "0.3.0", fetchImpl: fakeFetch({}, 500) });
  assert.equal(serverError.status, "error");
  assert.match(serverError.error, /HTTP 500/);
});

test("设置新增更新项有默认值并且归一非法值", () => {
  const defaults = normalizeSettings({});
  assert.equal(defaults.updateAutoCheck, true);
  assert.equal(defaults.updateIntervalMinutes, 360);
  assert.equal(defaults.updateChannel, "stable");

  const custom = normalizeSettings({ updateAutoCheck: false, updateIntervalMinutes: 60, updateChannel: "prerelease" });
  assert.equal(custom.updateAutoCheck, false);
  assert.equal(custom.updateIntervalMinutes, 60);
  assert.equal(custom.updateChannel, "prerelease");

  const invalid = normalizeSettings({ updateAutoCheck: "yes", updateIntervalMinutes: 7, updateChannel: "nightly" });
  assert.equal(invalid.updateAutoCheck, true);
  assert.equal(invalid.updateIntervalMinutes, 360);
  assert.equal(invalid.updateChannel, "stable");
});
test("配额用完时给出恢复时间而不是笼统报错", async () => {
  const resetAt = 1700003600;
  const result = await checkForUpdate({
    currentVersion: "0.3.0",
    fetchImpl: routeFetch([
      ["api.github.com", () => fakeResponse({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetAt) })],
      ["github.com", () => fakeResponse("", 503)]
    ]),
    now: () => 1700000000000,
    htmlFallback: true
  });
  assert.equal(result.status, "error");
  assert.equal(result.resetAt, resetAt * 1000);
  assert.match(result.error, /过于频繁/);
  assert.match(result.error, /约 60 分钟后可再试/);
});

test("默认先读 releases 页面，不碰接口配额", async () => {
  const calls = [];
  const result = await checkForUpdate({
    currentVersion: "0.3.0",
    channel: "stable",
    fetchImpl: routeFetch([
      ["api.github.com", () => { calls.push("api"); return fakeResponse({}, 403); }],
      ["releases/latest", () => { calls.push("html"); return fakeResponse("<html></html>", 200, {}, { url: "https://github.com/napstablook666/ai-price-analyzer/releases/tag/v0.4.0" }); }]
    ]),
    now: () => 1700000000000
  });
  assert.equal(result.status, "update");
  assert.equal(result.latestVersion, "0.4.0");
  assert.equal(result.source, "html");
  assert.equal(result.releaseUrl, "https://github.com/napstablook666/ai-price-analyzer/releases/tag/v0.4.0");
  assert.equal(result.notes, "");
  assert.equal(result.resetAt, 0);
  assert.deepEqual(calls, ["html", "api"], "页面拿到版本后只拿接口补发布说明");
});

test("每个版本渠道从 releases 页面挑第一个标签", async () => {
  const html = '<a href="/napstablook666/ai-price-analyzer/releases/tag/v0.5.0-beta.1">x</a>';
  const result = await checkForUpdate({
    currentVersion: "0.3.0",
    channel: "prerelease",
    fetchImpl: routeFetch([
      ["api.github.com", () => fakeResponse({}, 429)],
      ["/releases", () => fakeResponse(html, 200, {}, { url: "https://github.com/napstablook666/ai-price-analyzer/releases" })]
    ]),
    now: () => 1700000000000
  });
  assert.equal(result.status, "update");
  assert.equal(result.latestVersion, "0.5.0-beta.1");
  assert.equal(result.source, "html");
});

test("带 ETag 的条件请求命中 304 时复用上次结果", async () => {
  const calls = [];
  const result = await checkForUpdate({
    currentVersion: "0.3.0",
    etag: 'W/"abc123"',
    preferHtml: false,
    cachedRelease: { version: "0.3.0", tag: "v0.3.0", name: "0.3.0", url: "https://github.com/x/releases/tag/v0.3.0", notes: "修复", publishedAt: "2026-11-15T00:00:00Z" },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return fakeResponse(null, 304, { etag: 'W/"abc123"' });
    },
    now: () => 1700000000000
  });
  assert.equal(calls[0].options.headers["if-none-match"], 'W/"abc123"');
  assert.equal(result.status, "latest");
  assert.equal(result.latestVersion, "0.3.0");
  assert.equal(result.notModified, true);
  assert.equal(result.source, "cache");
});

test("首次请求不带条件头，成功后回传 ETag", async () => {
  const calls = [];
  const result = await checkForUpdate({
    currentVersion: "0.3.0",
    preferHtml: false,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return fakeResponse({ tag_name: "v0.4.0" }, 200, { etag: 'W/"new"' });
    }
  });
  assert.equal(calls[0].options.headers["if-none-match"], undefined);
  assert.equal(result.status, "update");
  assert.equal(result.etag, 'W/"new"');
  assert.equal(result.source, "api");
});

test("冷却提示文案按剩余分钟向上取整", async () => {
  const { cooldownMessage } = await import("../src/core/update-check.js");
  assert.equal(cooldownMessage(0, 1700000000000), "稍后再试");
  assert.equal(cooldownMessage(1700000000000 + 5 * 60000, 1700000000000), "约 5 分钟后可再试");
  assert.equal(cooldownMessage(1700000000000 + 61000, 1700000000000), "约 2 分钟后可再试");
});