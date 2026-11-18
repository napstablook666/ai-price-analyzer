// 站点体检：把每个能匿名拉的站点真拉一遍，走完整解析和归一，报出模型数、出图/出视频
// 行数、以及有没有模型没能解析出价格。
//
// 存在的意义是「站点偷改了接口」这件事由脚本发现，而不是等用户看到榜单空了才发现。
// 用法：npm run audit:stations   （有 FAIL 时退出码非 0）

import { SITE_PLUGIN_CATALOG } from "../src/site-plugins/catalog.js";
import { normalizePricingPayload } from "../src/core/normalizers.js";

// liuguang 这类站点会挡没有浏览器 UA 的请求，统一带上。
const UA = "Mozilla" + "/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TIMEOUT_MS = 20_000;

// 网络抖动（DNS 抽风、TLS 握手被 reset、Cloudflare 限速）不算站点坏了。
// 这机器上连续拉十几个站时经常中途被 reset 一发，所以退避重试三次再定性。
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 600;

async function fetchPricing(host, endpoint) {
  const url = `https://${host}${endpoint}`;
  let failure;
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (attempt) await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": UA },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
      const text = await response.text();
      if (!response.ok) return { url, status: response.status, error: text.slice(0, 120).replace(/\s+/g, " ") };
      try {
        return { url, status: response.status, raw: JSON.parse(text) };
      } catch {
        return { url, status: response.status, error: "响应不是 JSON" };
      }
    } catch (error) {
      failure = error;
    }
  }
  return { url, error: `请求失败: ${failure?.message}` };
}

function countRows(rows) {
  const stats = { image: 0, video: 0, tiered: 0 };
  for (const row of rows) {
    if (row.media_type === "image") stats.image += 1;
    else if (row.media_type === "video") stats.video += 1;
    if (row.tier_name && row.tier_name !== "标准") stats.tiered += 1;
  }
  return stats;
}

const results = [];
for (const entry of SITE_PLUGIN_CATALOG) {
  const skip = reason => results.push({ id: entry.id, state: "SKIP", reason });

  if (entry.mode !== "direct") {
    skip("需要登录态");
    continue;
  }

  let endpoint;
  let responseFormat;
  let priceMap = null;
  try {
    const { sitePlugin } = entry.load();
    // 有的插件把 preset 写成函数（要拿汇率之类的外部参数），这里按无参调一次。
    const preset = typeof sitePlugin?.preset === "function" ? sitePlugin.preset({}) : sitePlugin?.preset;
    endpoint = preset?.adapter?.endpoint;
    responseFormat = preset?.adapter?.responseFormat || "auto";
    priceMap = preset?.adapter?.priceMap || null;
  } catch (error) {
    results.push({ id: entry.id, state: "FAIL", reason: `插件加载失败: ${error.message}` });
    continue;
  }

  if (!endpoint) {
    skip("没有固定价格接口");
    continue;
  }

  const fetched = await fetchPricing(entry.host, endpoint);

  if (fetched.error) {
    results.push({ id: entry.id, state: "FAIL", reason: `HTTP ${fetched.status}: ${fetched.error}` });
    continue;
  }

  let normalized;
  try {
    normalized = normalizePricingPayload(fetched.raw, responseFormat, { priceMap });
  } catch (error) {
    results.push({ id: entry.id, state: "FAIL", reason: `解析失败: ${error.message}` });
    continue;
  }

  const rows = normalized.data || [];
  if (!rows.length) {
    results.push({ id: entry.id, state: "FAIL", reason: "解析出 0 行" });
    continue;
  }

  const unpriced = (normalized.unpricedModels || []).length;
  results.push({
    id: entry.id,
    state: unpriced ? "WARN" : "OK",
    rows: rows.length,
    format: normalized.sourceFormat || "?",
    unpriced,
    ...countRows(rows)
  });
}

const pad = (value, width) => String(value).padEnd(width);
for (const item of results) {
  if (item.state === "SKIP") {
    console.log(`${pad(item.id, 14)} SKIP  ${item.reason}`);
    continue;
  }
  if (item.state === "FAIL") {
    console.log(`${pad(item.id, 14)} FAIL  ${item.reason}`);
    continue;
  }
  console.log(
    `${pad(item.id, 14)} ${item.state}  rows=${pad(item.rows, 5)} 图=${pad(item.image, 3)} 视频=${pad(item.video, 3)} 分档=${pad(item.tiered, 3)} 缺价=${pad(item.unpriced, 3)} ${item.format}`
  );
}

const failed = results.filter(item => item.state === "FAIL");
const warned = results.filter(item => item.state === "WARN");
console.log(`\n${results.length} 个站点：${results.length - failed.length - warned.length} 正常，${warned.length} 有缺价，${failed.length} 失败`);
if (failed.length) process.exitCode = 1;
