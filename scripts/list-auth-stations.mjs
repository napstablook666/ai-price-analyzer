import { SITE_PLUGIN_CATALOG } from "../src/site-plugins/catalog.js";
import { renewalFromProvider } from "../src/core/renewal.js";

const rows = [];
for (const entry of SITE_PLUGIN_CATALOG) {
  const provider = entry.load().sitePlugin;
  const request = provider.request || {};
  const hasPageAuth = Boolean(request.pageAuth);
  const cfg = renewalFromProvider(provider);
  if (!hasPageAuth && !cfg) continue;
  rows.push({ id: entry.id, mode: entry.mode, pageAuth: hasPageAuth, kind: cfg?.kind || "无声明" });
}
rows.sort((a, b) => a.mode.localeCompare(b.mode) || a.id.localeCompare(b.id));
console.log(`合计 ${rows.length} 个`);
for (const r of rows) console.log(`| \`${r.id}\` | \`${r.mode}\` | ${r.pageAuth ? "是" : "否"} | \`${r.kind}\` |`);
