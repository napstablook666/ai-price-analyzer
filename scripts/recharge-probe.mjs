#!/usr/bin/env node
// 充值取证第一步：把站点公开的充值口径落成 JSON。
//   - 匿名阶段：依次试 /api/status、/api/v1/status、/status，取第一个能解析出充值字段的
//   - 登录态阶段：带 auth.json 里的 cookie 打 /api/user/aff（New API 系的账号档位）
//   - 收银台金额脚本拿不到（Antom / Stripe 是跨域托管页），payments 留空等人工补
// 产出落 extension/out/recharge/<host>.json，再由 recharge-apply.mjs 合进插件。

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRechargeStatus } from "../src/core/recharge.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = path.resolve(here, "..");
const WORKSPACE_DIR = path.resolve(EXTENSION_DIR, "..");
const PLUGINS_DIR = path.join(WORKSPACE_DIR, "plugins");
const OUT_DIR = path.join(EXTENSION_DIR, "out", "recharge");
const AUTH_FILE = path.join(OUT_DIR, "auth.json");

const STATUS_PATHS = ["/api/status", "/api/v1/status", "/status"];
const AFF_PATH = "/api/user/aff";
const TIMEOUT_MS = 12_000;
const CONCURRENCY = 4;
const USER_AGENT = "ai-price-analyzer-recharge-probe/1";

function parseArgs(argv) {
  const args = { all: false, hosts: [], ids: [], help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--from-plugins" || arg === "--all") args.all = true;
    else if (arg === "--host") args.hosts.push(String(argv[++index] || "").trim());
    else if (arg === "--id") args.ids.push(String(argv[++index] || "").trim());
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  if (!args.all && args.hosts.filter(Boolean).length === 0 && args.ids.filter(Boolean).length === 0) args.all = true;
  return args;
}

function printHelp() {
  console.log(`用法：
  node scripts/recharge-probe.mjs                   扫全部插件（同 --from-plugins）
  node scripts/recharge-probe.mjs --id openlux      只采指定插件
  node scripts/recharge-probe.mjs --host a.com      只采指定域名

登录态：在 extension/out/recharge/auth.json 里按域名给 cookie 或 authorization，
        形如 { "www.openlux.ai": { "cookie": "session=..." } }。不写就不带登录态。`);
}

async function loadPlugins() {
  const entries = await readdir(PLUGINS_DIR, { withFileTypes: true });
  const plugins = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let manifest;
    try {
      manifest = JSON.parse(await readFile(path.join(PLUGINS_DIR, entry.name, "manifest.json"), "utf8"));
    } catch {
      continue;
    }
    // manifest 有两种写法：单域名 host，或 host 列表 hosts。
    const declared = Array.isArray(manifest?.hosts) && manifest.hosts.length
      ? manifest.hosts
      : typeof manifest?.host === "string" && manifest.host ? [manifest.host] : [];
    const usable = declared.filter(host => typeof host === "string" && host);
    if (!manifest?.id || usable.length === 0) continue;
    plugins.push({ id: manifest.id, name: manifest.name || manifest.id, hosts: usable });
  }
  return plugins.filter(plugin => plugin.hosts.length > 0);
}

async function loadAuth() {
  try {
    const parsed = JSON.parse(await readFile(AUTH_FILE, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function requestJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json", "user-agent": USER_AGENT, ...headers },
      redirect: "follow",
      signal: controller.signal
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { ok: response.ok, status: response.status, json };
  } catch (error) {
    return { ok: false, status: 0, json: null, error: String(error?.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

async function probeHost(plugin, host, auth) {
  const record = {
    plugin: plugin.id,
    name: plugin.name,
    host,
    collectedAt: new Date().toISOString(),
    status: null,
    aff: null,
    payments: [],
    notes: []
  };
  const headers = {};
  if (auth?.cookie) headers.cookie = auth.cookie;
  if (auth?.authorization) headers.authorization = auth.authorization;

  for (const pathname of STATUS_PATHS) {
    const result = await requestJson(`https://${host}${pathname}`, headers);
    if (!result.ok || !result.json) continue;
    const parsed = parseRechargeStatus(result.json);
    if (!parsed) continue;
    record.status = { url: `https://${host}${pathname}`, http: result.status, parsed };
    break;
  }
  if (!record.status) record.notes.push("三个 status 路径都没有可解析的充值口径");

  if (headers.cookie || headers.authorization) {
    const result = await requestJson(`https://${host}${AFF_PATH}`, headers);
    if (result.ok && result.json) {
      record.aff = { url: `https://${host}${AFF_PATH}`, http: result.status, body: result.json };
    } else {
      record.notes.push(`/api/user/aff 不可用（http ${result.status}）`);
    }
  } else {
    record.notes.push("未提供登录态，账号档位没采");
  }

  if (!record.status && !record.aff) record.notes.push("无可用证据，只能靠收银台人工补");
  return record;
}

async function runPool(items, worker, size) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

function fileNameFor(host) {
  return `${host.replace(/[^a-z0-9.-]/gi, "_")}.json`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const plugins = await loadPlugins();
  const targets = [];
  const seen = new Set();
  for (const plugin of plugins) {
    if (!args.all && !args.ids.includes(plugin.id)) continue;
    const host = plugin.hosts[0];
    if (seen.has(host)) continue;
    seen.add(host);
    targets.push({ plugin, host });
  }
  for (const host of args.hosts.filter(Boolean)) {
    if (seen.has(host)) continue;
    const owner = plugins.find(plugin => plugin.hosts.includes(host));
    seen.add(host);
    targets.push({ plugin: owner || { id: host, name: host, hosts: [host] }, host });
  }
  if (targets.length === 0) {
    console.error("没有匹配到站点。用 --id / --host 指定，或去掉参数扫全部插件。");
    process.exitCode = 1;
    return;
  }

  const auth = await loadAuth();
  await mkdir(OUT_DIR, { recursive: true });
  const records = await runPool(targets, ({ plugin, host }) => probeHost(plugin, host, auth[host]), CONCURRENCY);
  for (const record of records) {
    await writeFile(path.join(OUT_DIR, fileNameFor(record.host)), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  const withStatus = records.filter(record => record.status).length;
  const withTiers = records.filter(record => (record.status?.parsed?.tiers?.length || 0) > 0).length;
  const withChannels = records.filter(record => (record.status?.parsed?.channels?.length || 0) > 0).length;
  const withAff = records.filter(record => record.aff).length;
  console.log(`采了 ${records.length} 个站 → ${path.relative(EXTENSION_DIR, OUT_DIR)}`);
  console.log(`  status 可读 ${withStatus} · 带档位 ${withTiers} · 带渠道 ${withChannels} · 账号档位 ${withAff}`);
  const gaps = records.filter(record => !record.status && !record.aff);
  if (gaps.length) console.log(`  无证据 ${gaps.length}：${gaps.map(record => record.host).join("、")}`);
  console.log("收银台金额需要人工补进各 JSON 的 payments，再跑 npm run recharge:apply");
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
