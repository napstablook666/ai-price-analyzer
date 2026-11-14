// 抓站点图标，写进 plugins/<id>/icon.svg 或 icon.png。
//
// 图标是插件的一部分：插件仓库带一份源，扩展构建时复制到 icons/sites/ 并生成
// src/shared/site-logos.js。这里只负责「从站点抓一次」，不做 UI 侧的任何事。
//
// 用法：
//   node scripts/site-icons.mjs                  抓全部插件
//   node scripts/site-icons.mjs --only=tokenflux 只处理一个插件
//   node scripts/site-icons.mjs --dry            只看选中了哪个图标，不落盘
//
// 栅格图统一压到 64px PNG；本机没有 Python + Pillow 时保留原图（≤ 24KB），
// 超限的跳过，界面上退回首字母色块。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN_DIR = path.resolve(process.env.PLUGIN_DIR || path.join(ROOT, "..", "plugins"));
const DRY = process.argv.includes("--dry");
const ONLY = (process.argv.find(arg => arg.startsWith("--only=")) || "").slice(7) || "";
const ICON_TARGET = 64;
const MAX_BYTES = 24 * 1024;
const TIMEOUT = 15000;

const RASTER_EXT = { png: "png", jpeg: "jpg", jpg: "jpg", webp: "webp", ico: "ico" };

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function listPlugins() {
  return fs.readdirSync(PLUGIN_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
    .map(entry => entry.name)
    .sort();
}

async function fetchBytes(url, { accept = "" } = {}) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT),
    headers: accept ? { accept } : undefined
  });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { bytes, type: String(response.headers.get("content-type") || "").toLowerCase(), url };
}

// 只信文件头，不信 content-type：好几个站把 /favicon.ico 回成 HTML 404 页。
function sniff(bytes) {
  if (bytes.length < 8) return "";
  if (bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return "png";
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "jpeg";
  if (bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (bytes.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00]))) return "ico";
  const head = bytes.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || head.startsWith("<?xml")) {
    const text = bytes.toString("utf8");
    if (/<svg\b/i.test(text)) return "svg";
  }
  return "";
}

function parseIconCandidates(html, baseUrl) {
  const tags = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => match[0].replace(/\s+/g, " "));
  const candidates = [];
  for (const tag of tags) {
    const rel = (tag.match(/\brel=["']([^"']+)["']/i)?.[1] || "").toLowerCase();
    if (!/icon/.test(rel)) continue;
    const href = tag.match(/\bhref=["']([^"']+)["']/i)?.[1];
    if (!href) continue;
    const type = (tag.match(/\btype=["']([^"']+)["']/i)?.[1] || "").toLowerCase();
    const sizes = (tag.match(/\bsizes=["']([^"']+)["']/i)?.[1] || "").toLowerCase();
    const px = Math.max(0, ...[...sizes.matchAll(/(\d+)x(\d+)/g)].map(match => Number(match[1])));
    const isApple = /apple-touch/.test(rel);
    const isSvg = /svg/.test(type) || /\.svg(\?|$)/i.test(href);
    let score = 40;
    if (isSvg) score = 0;
    else if (isApple) score = 10;
    else if (/png|webp|avif/.test(type) || /\.(png|webp|avif)(\?|$)/i.test(href)) score = 20 - Math.min(px, 256) / 16;
    else if (/ico/.test(type) || /\.ico(\?|$)/i.test(href)) score = 60;
    candidates.push({ url: absoluteUrl(href, baseUrl), score, kind: isSvg ? "svg" : "raster" });
  }
  candidates.sort((left, right) => left.score - right.score);
  return dedupe(candidates.map(item => item.url)).map(url => ({
    url,
    kind: /\.svg(\?|$)/i.test(url) ? "svg" : "guess"
  }));
}

function absoluteUrl(href, baseUrl) {
  try { return new URL(href, baseUrl).href; } catch { return ""; }
}

function dedupe(list) {
  return [...new Set(list.filter(Boolean))];
}

function decodedDataUri(href) {
  const match = href.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const isBase64 = Boolean(match[2]);
  const raw = isBase64 ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]));
  return { bytes: raw, type: String(match[1] || "").toLowerCase(), url: "data:" };
}

async function siteCandidates(hosts) {
  // 有的站只在 www 上带 TLS 证书，裸域名握手就失败，两个变体都试。
  const variants = [...new Set(hosts.filter(Boolean))];
  let html = "";
  let base = `https://${variants[0]}/`;
  for (const variant of variants) {
    try {
      html = (await fetchBytes(`https://${variant}/`)).bytes.toString("utf8");
      base = `https://${variant}/`;
      break;
    } catch { /* 换下一个变体；都打不开就只试根目录图标 */ }
  }
  const inline = [...html.matchAll(/<link[^>]*rel=["'][^"']*icon[^"']*["'][^>]*href=["'](data:[^"']+)["']/gi)]
    .map(match => ({ url: match[1], kind: "inline" }));
  const roots = variants.flatMap(variant => [`/favicon.ico`, `/favicon.png`, `/favicon.svg`, `/logo.svg`, `/logo.png`]
    .map(pathname => ({ url: `https://${variant}${pathname}`, kind: "guess" })));
  // 首页链接 > 常见根路径：很多站点 /favicon.ico 是 SPA 兜底 HTML。
  return [...inline, ...parseIconCandidates(html, base), ...roots];
}

function pillowConvert(bytes, type) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "site-icon-"));
  const input = path.join(dir, `in.${RASTER_EXT[type] || "bin"}`);
  const output = path.join(dir, "out.png");
  fs.writeFileSync(input, bytes);
  try {
    execFileSync("python", ["-c", `
import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src)
if im.format == "ICO" and getattr(im, "ico", None) is not None:
    sizes = im.ico.sizes()
    if sizes:
        biggest = max(sizes, key=lambda item: item[0] * item[1])
        im.size = biggest
        im.load()
if getattr(im, "is_animated", False):
    im.seek(0)
im = im.convert("RGBA")
im.thumbnail((${ICON_TARGET}, ${ICON_TARGET}), Image.LANCZOS)
im.save(dst, "PNG", optimize=True)
`, input, output], { stdio: ["ignore", "ignore", "pipe"], timeout: 30000 });
    return fs.readFileSync(output);
  } catch {
    return null;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function stripExistingIcons(dir) {
  for (const entry of fs.readdirSync(dir)) {
    if (/^icon\.(svg|png|ico|jpg|webp)$/i.test(entry)) fs.rmSync(path.join(dir, entry));
  }
}

async function pickIcon(hosts) {
  for (const candidate of await siteCandidates(hosts)) {
    let bytes;
    let type;
    try {
      if (candidate.url.startsWith("data:")) {
        const decoded = decodedDataUri(candidate.url);
        if (!decoded) continue;
        bytes = decoded.bytes;
        type = sniff(bytes);
      } else {
        const result = await fetchBytes(candidate.url, { accept: "image/*" });
        bytes = result.bytes;
        type = sniff(bytes);
      }
    } catch { continue; }
    if (!type) continue;
    if (type === "svg") {
      const text = bytes.toString("utf8");
      if (bytes.length > MAX_BYTES) continue;
      if (/<script\b/i.test(text)) continue;
      if (!/viewBox=|width=/i.test(text)) continue;
      return { file: "icon.svg", bytes, type, url: candidate.url };
    }
    const converted = pillowConvert(bytes, type);
    if (converted && converted.length <= MAX_BYTES) return { file: "icon.png", bytes: converted, type, url: candidate.url };
    if (bytes.length <= MAX_BYTES) return { file: `icon.${RASTER_EXT[type]}`, bytes, type, url: candidate.url };
  }
  return null;
}

const plugins = listPlugins().filter(id => !ONLY || id === ONLY);
const missing = [];
for (const id of plugins) {
  const dir = path.join(PLUGIN_DIR, id);
  let manifest;
  try { manifest = readJson(path.join(dir, "manifest.json")); } catch { continue; }
  const host = String(manifest.host || "").trim();
  if (!host) { missing.push(`${id}（manifest 没有 host）`); continue; }
  const icon = await pickIcon([host, `www.${host}`]);
  if (!icon) { missing.push(`${id}（${host}）`); continue; }
  const sizeKb = (icon.bytes.length / 1024).toFixed(1);
  const label = icon.url.startsWith("data:") ? "首页内联 data URI" : icon.url.replace(/^https:\/\/[^/]+/, "");
  console.log(`${id.padEnd(22)} ${icon.file.padEnd(10)} ${sizeKb.padStart(6)}KB  ${label}`);
  if (DRY) continue;
  stripExistingIcons(dir);
  fs.writeFileSync(path.join(dir, icon.file), icon.bytes);
}
if (missing.length) console.log(`\n没有图标：${missing.join("、")}`);