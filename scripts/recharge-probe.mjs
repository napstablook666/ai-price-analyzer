#!/usr/bin/env node
// 开发者维护工具：只读充值状态、渠道与历史订单，不创建充值订单。
// 先复用已有证据；缺失时由开发者在浏览器核验一次待支付金额，不付款。
// 产出落 extension/out/recharge/<host>.json，再由 recharge-apply.mjs 合进插件。
// 普通用户使用发布的插件数据，本脚本不在扩展运行时执行。

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseRechargeStatus } from "../src/core/recharge.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION_DIR = path.resolve(here, "..");
const WORKSPACE_DIR = path.resolve(EXTENSION_DIR, "..");
const PLUGINS_DIR = path.join(WORKSPACE_DIR, "plugins");
const OUT_DIR = path.join(EXTENSION_DIR, "out", "recharge");
const AUTH_FILE = path.join(OUT_DIR, "auth.json");
// 登录态要打的两套后台：New API（魔改）和 Sub2API。
// New API 缺 New-Api-User 头会返回「未提供 New-Api-User」，Sub2API 走 Bearer。
const NEW_API_INFO_PATH = "/api/user/topup/info";
const NEW_API_ORDERS_PATH = "/api/user/topup/self?page=1&page_size=20";
const SUB2_CHECKOUT_PATH = "/api/v1/payment/checkout-info";
const SUB2_ORDERS_PATH = "/api/v1/payment/orders/my?page=1&page_size=20";

// 两套后台的渠道名映射到 normalizeRechargePayments 认的六个值。
const CHANNEL_BY_TYPE = {
  alipay: "alipay",
  wxpay: "wechat",
  wechat: "wechat",
  stripe: "stripe",
  antom: "card",
  antom_card: "card",
  antom_wechat: "wechat",
  antom_applepay: "other",
  antom_googlepay: "other",
  sunrate: "card",
  ccpayment: "crypto",
  stablepay: "crypto"
};

export function channelFor(value) {
  return CHANNEL_BY_TYPE[String(value || "").trim().toLowerCase()] || "other";
}
const STATUS_PATHS = ["/api/status", "/api/v1/status", "/status"];
const AFF_PATH = "/api/user/aff";
const TIMEOUT_MS = 12_000;
const CONCURRENCY = 4;
const USER_AGENT = "ai-price-analyzer-recharge-probe/1";

export function parseArgs(argv) {
  const args = { developer: false, all: false, hosts: [], ids: [], help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--developer") args.developer = true;
    else if (arg === "--from-plugins" || arg === "--all") args.all = true;
    else if (arg === "--host") args.hosts.push(String(argv[++index] || "").trim());
    else if (arg === "--id") args.ids.push(String(argv[++index] || "").trim());
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`用法：
  node scripts/recharge-probe.mjs --developer --id openlux   定向采集插件
  node scripts/recharge-probe.mjs --developer --host a.com   定向采集域名
  node scripts/recharge-probe.mjs --developer --from-plugins 全量维护扫描

仅供开发者维护：只读状态和历史订单，不创建订单、不付款。
优先 --id 定向更新；已有证据先复用，缺失时才在浏览器补一次待支付取证。

登录态：在 extension/out/recharge/auth.json 里按域名给凭据，不写就不带登录态。形如：
  {
    "token.stellaisle.com": { "cookie": "session=...", "newApiUser": "1527" },
    "jiji.cc": { "authorization": "Bearer eyJ..." }
  }
  New API 系的站要 newApiUser（localStorage.user.id），Sub2API 系的站要 authorization。
  带凭据时会自动拉 topup/info、topup/self、payment/checkout-info、payment/orders/my，
  订单里的收银台金额直接生成 payments。`);
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
// New API 的 /api/user/topup/info：档位赠送、渠道费率、门槛都在这。
export function readNewApiTopupInfo(json) {
  const data = json?.data;
  if (!data || typeof data !== "object") return null;
  const channels = [];
  for (const method of Array.isArray(data.pay_methods) ? data.pay_methods : []) {
    const type = String(method?.type || "").trim();
    if (!type) continue;
    // fee_rate 的单位是百分比："1" 表示 1%，不是 100%。
    const feeRate = Number(method?.fee_rate);
    const minAmount = Number(method?.min_topup);
    channels.push({
      channel: channelFor(type),
      type,
      name: String(method?.name || type),
      ...(Number.isFinite(feeRate) && feeRate > 0 ? { feeRate: feeRate / 100 } : {}),
      ...(Number.isFinite(minAmount) && minAmount > 0 ? { minAmount } : {})
    });
  }
  const bonusTiers = [];
  const bonus = data.amount_bonus && typeof data.amount_bonus === "object" ? data.amount_bonus : {};
  for (const [amount, bonusAmount] of Object.entries(bonus)) {
    const faceAmount = Number(amount);
    const value = Number(bonusAmount);
    if (!Number.isFinite(faceAmount) || faceAmount <= 0 || !Number.isFinite(value)) continue;
    bonusTiers.push({ amount: faceAmount, bonus: value });
  }
  return {
    backend: "new-api",
    channels,
    bonusTiers: bonusTiers.sort((left, right) => left.amount - right.amount),
    minAmount: Number(data.min_topup) || null,
    notice: String(data.recharge_notice || "").trim().slice(0, 200) || null
  };
}

// New API 的 /api/user/topup/self：每单都带收银台金额，直接就是实证。
export function readNewApiTopupOrders(json) {
  const items = Array.isArray(json?.data?.items) ? json.data.items : [];
  const payments = [];
  for (const order of items) {
    const faceAmount = Number(order?.amount);
    if (!Number.isFinite(faceAmount) || faceAmount <= 0) continue;
    const minor = Number(order?.expected_payment_amount_minor);
    const money = Number(order?.money);
    const payAmount = Number.isFinite(minor) && minor > 0 ? minor / 100 : money;
    if (!Number.isFinite(payAmount) || payAmount <= 0) continue;
    const currency = String(order?.expected_payment_currency || "CNY").trim().toUpperCase();
    const fee = Number(order?.payment_fee);
    const createdAt = Number(order?.create_time);
    payments.push({
      channel: channelFor(order?.payment_method),
      faceAmount,
      payAmount,
      currency: currency === "USD" ? "USD" : "CNY",
      ...(Number.isFinite(fee) && fee > 0 && Number.isFinite(money) && money > 0
        ? { feeRate: Math.round((fee / money) * 10000) / 10000 }
        : {}),
      ...(createdAt > 0 ? { at: new Date(createdAt * 1000).toISOString().slice(0, 10) } : {}),
      note: `订单 ${order?.id ?? "?"} ${order?.payment_method ?? ""} ${order?.status ?? ""}`.trim()
    });
  }
  return payments;
}

// Sub2API 的 /api/v1/payment/checkout-info：渠道、门槛、赠送档位。
export function readSub2Checkout(json) {
  const data = json?.data;
  if (!data || typeof data !== "object") return null;
  const channels = [];
  const methods = data.methods && typeof data.methods === "object" ? data.methods : {};
  for (const [type, method] of Object.entries(methods)) {
    const feeRate = Number(method?.fee_rate);
    const minAmount = Number(method?.single_min);
    channels.push({
      channel: channelFor(type),
      type,
      name: String(method?.label || method?.name || type),
      currency: String(method?.currency || "").toUpperCase() || null,
      ...(Number.isFinite(feeRate) && feeRate > 0 ? { feeRate: feeRate / 100 } : {}),
      ...(Number.isFinite(minAmount) && minAmount > 0 ? { minAmount } : {})
    });
  }
  const bonusTiers = [];
  const tiers = Array.isArray(data.recharge_bonus_tiers) ? data.recharge_bonus_tiers : [];
  for (const entry of tiers) {
    for (const [amount, rate] of Object.entries(entry && typeof entry === "object" ? entry : {})) {
      const faceAmount = Number(amount);
      const value = Number(rate);
      if (!Number.isFinite(faceAmount) || faceAmount <= 0 || !Number.isFinite(value)) continue;
      bonusTiers.push({ amount: faceAmount, bonusRate: value });
    }
  }
  return {
    backend: "sub2api",
    channels,
    bonusTiers: bonusTiers.sort((left, right) => left.amount - right.amount),
    minAmount: Number(data.global_min) || null,
    helpText: String(data.help_text || "").trim().slice(0, 200) || null
  };
}

// Sub2API 的 /api/v1/payment/orders/my：pay_amount 就是收银台金额。
export function readSub2Orders(json) {
  const items = Array.isArray(json?.data?.items) ? json.data.items : [];
  const payments = [];
  for (const order of items) {
    const faceAmount = Number(order?.amount);
    const payAmount = Number(order?.pay_amount);
    if (!Number.isFinite(faceAmount) || faceAmount <= 0) continue;
    if (!Number.isFinite(payAmount) || payAmount <= 0) continue;
    const currency = String(order?.currency || "").trim().toUpperCase();
    const feeRate = Number(order?.fee_rate);
    const createdAt = order?.created_at ? String(order.created_at) : "";
    payments.push({
      channel: channelFor(order?.payment_type),
      faceAmount,
      payAmount,
      currency: currency === "USD" ? "USD" : "CNY",
      ...(Number.isFinite(feeRate) && feeRate > 0 ? { feeRate: feeRate / 100 } : {}),
      ...(createdAt ? { at: createdAt.slice(0, 10) } : {}),
      note: `订单 ${order?.id ?? "?"} ${order?.payment_type ?? ""} ${order?.status ?? ""}`.trim()
    });
  }
  return payments;
}

// 同一渠道同一面值同一币种只留一条：手抄的优先，脚本自己写的「订单 …」允许被刷新。
function paymentKey(payment) {
  return `${payment.channel}:${payment.faceAmount}:${payment.currency}`;
}

function usablePayment(payment) {
  if (!payment || typeof payment !== "object") return false;
  const faceAmount = Number(payment.faceAmount);
  const payAmount = Number(payment.payAmount);
  return Number.isFinite(faceAmount) && faceAmount > 0 && Number.isFinite(payAmount) && payAmount > 0;
}

export function mergePayments(existing, fresh) {
  const merged = existing.filter(usablePayment);
  const index = new Map(merged.map((payment, at) => [paymentKey(payment), at]));
  for (const payment of fresh) {
    if (!usablePayment(payment)) continue;
    const key = paymentKey(payment);
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, merged.length);
      merged.push(payment);
      continue;
    }
    // 手抄的条目优先留下；上一轮的「订单 …」是脚本自己写的，让新数据顶掉。
    if (!String(merged[at].note || "").startsWith("订单")) continue;
    merged[at] = payment;
  }
  return merged;
}


async function probeHost(plugin, host, auth) {
  const record = {
    plugin: plugin.id,
    name: plugin.name,
    host,
    collectedAt: new Date().toISOString(),
    status: null,
    aff: null,
    topup: null,
    payments: await loadPreviousPayments(host),
    notes: []
  };
  const headers = {};
  if (auth?.cookie) headers.cookie = auth.cookie;
  if (auth?.authorization) headers.authorization = auth.authorization;
  // New API 的接口要带 New-Api-User，缺了会返回「未提供 New-Api-User」。
  if (auth?.newApiUser) headers["new-api-user"] = String(auth.newApiUser);
  for (const pathname of STATUS_PATHS) {
    const result = await requestJson(`https://${host}${pathname}`, headers);
    if (!result.ok || !result.json) continue;
    const parsed = parseRechargeStatus(result.json);
    if (!parsed) continue;
    record.status = { url: `https://${host}${pathname}`, http: result.status, parsed };
    break;
  }
  if (!record.status) record.notes.push("三个 status 路径都没有可解析的充值口径");

  const authed = Boolean(headers.cookie || headers.authorization);
  if (authed) {
    const affResult = await requestJson(`https://${host}${AFF_PATH}`, headers);
    if (affResult.ok && affResult.json) {
      record.aff = { url: `https://${host}${AFF_PATH}`, http: affResult.status, body: affResult.json };
    } else {
      record.notes.push(`/api/user/aff 不可用（http ${affResult.status}）`);
    }

    // 两套后台都试一遍，对不上的那条 404，直接忽略。
    const autoPayments = [];
    const infoResult = await requestJson(`https://${host}${NEW_API_INFO_PATH}`, headers);
    const newApiTopup = infoResult.ok ? readNewApiTopupInfo(infoResult.json) : null;
    if (newApiTopup) record.topup = { ...newApiTopup, url: `https://${host}${NEW_API_INFO_PATH}` };

    const ordersResult = await requestJson(`https://${host}${NEW_API_ORDERS_PATH}`, headers);
    if (ordersResult.ok && ordersResult.json) autoPayments.push(...readNewApiTopupOrders(ordersResult.json));

    const checkoutResult = await requestJson(`https://${host}${SUB2_CHECKOUT_PATH}`, headers);
    const sub2Topup = checkoutResult.ok ? readSub2Checkout(checkoutResult.json) : null;
    if (sub2Topup) record.topup = { ...sub2Topup, url: `https://${host}${SUB2_CHECKOUT_PATH}` };

    const sub2OrdersResult = await requestJson(`https://${host}${SUB2_ORDERS_PATH}`, headers);
    if (sub2OrdersResult.ok && sub2OrdersResult.json) autoPayments.push(...readSub2Orders(sub2OrdersResult.json));

    if (autoPayments.length > 0) {
      record.payments = mergePayments(record.payments, autoPayments);
      record.notes.push(`订单接口给出 ${autoPayments.length} 条收银台金额`);
    }
    if (!record.topup) record.notes.push("充值接口没读到档位或渠道");
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

// 上一轮的条目全带上：这一轮没登录也要把它们原样写回去，不能被冲掉。
// 手抄的和「订单 …」的差别由 mergePayments 决定谁让位。
async function loadPreviousPayments(host) {
  try {
    const previous = JSON.parse(await readFile(path.join(OUT_DIR, fileNameFor(host)), "utf8"));
    if (!Array.isArray(previous?.payments)) return [];
    return previous.payments.filter(usablePayment);
  } catch {
    return [];
  }
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
  if (!args.developer) {
    console.error("开发者维护操作：请显式添加 --developer；普通用户无需运行充值探测。");
    process.exitCode = 2;
    return;
  }
  if (!args.all && args.ids.length === 0 && args.hosts.length === 0) {
    console.error("请用 --id 或 --host 定向采集；确认需要全量维护时使用 --from-plugins。");
    process.exitCode = 2;
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
    console.error("没有匹配到站点。用 --id / --host 指定，或 --from-plugins 显式全量维护。");
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
  const withTopup = records.filter(record => record.topup).length;
  const withPayments = records.filter(record => (record.payments?.length || 0) > 0).length;
  console.log(`  status 可读 ${withStatus} · 带档位 ${withTiers} · 带渠道 ${withChannels} · 账号档位 ${withAff}`);
  console.log(`  充值接口可读 ${withTopup} · 有渠道实付 ${withPayments}`);
  const gaps = records.filter(record =>
    !record.status && !record.aff && !record.topup && (record.payments?.length || 0) === 0
  );
  if (gaps.length) console.log(`  无证据 ${gaps.length}：${gaps.map(record => record.host).join("、")}`);
  console.log("收银台金额需要人工补进各 JSON 的 payments，再跑 npm run recharge:apply");
}

// 被测试 import 时不要顺带跑网络采集。
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
