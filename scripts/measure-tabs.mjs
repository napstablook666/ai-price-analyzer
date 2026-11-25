// D3 取证：一次全量刷新里，page 模式站点会开多少个临时标签页。
//
// 只读真实产物（src/site-plugins/catalog.js 与 src/core/refresh-preflight.js），
// 不造假数据：站点集来自 105 个插件生成出来的 catalog，
// 判定函数就是扩展运行时用的那个 requiresPageSessionPreflight。
//
// 跑法：node out/measure-tabs.mjs
import { SITE_PLUGIN_CATALOG } from "../src/site-plugins/catalog.js";
import { requiresPageSessionPreflight } from "../src/core/refresh-preflight.js";

const pageEntries = SITE_PLUGIN_CATALOG.filter(entry => entry.mode === "page");

const rows = pageEntries.map(entry => {
  const provider = entry.load().sitePlugin;
  // 站点形状按 catalog 组装成运行时的样子，enabled 取真：全量刷新只跑已启用的站。
  const station = { id: entry.id, name: entry.name, mode: entry.mode, enabled: true, pluginId: entry.id, baseUrl: `https://${entry.host}/` };
  const request = provider.request || {};
  const needsPreflight = requiresPageSessionPreflight(station, provider);
  return {
    id: entry.id,
    pageAuth: Boolean(request.pageAuth),
    include: request.credentials === "include",
    renewal: request.renewal?.kind || (request.cookieAuth?.refreshPath ? "cookie" : ""),
    needsPreflight
  };
});

const preflight = rows.filter(row => row.needsPreflight);
const collect = rows.length;

// 旧路径：刷新前对每个要预检的 page 站开一个标签页探活，采集时再为每个 page 站开一个。
// 新路径：预检改读凭据仓，不开标签页；采集仍是一站一个。
const before = preflight.length + collect;
const after = collect;

console.log(`page 模式站点：${collect}`);
console.log(`其中刷新前需要页面预检：${preflight.length}`);
console.log("");
console.log("| 站点 | pageAuth | credentials:include | 无头续期 | 旧路径开标签页 | 新路径开标签页 |");
console.log("| --- | --- | --- | --- | --- | --- |");
for (const row of rows) {
  const oldTabs = (row.needsPreflight ? 1 : 0) + 1;
  console.log(`| ${row.id} | ${row.pageAuth ? "是" : "否"} | ${row.include ? "是" : "否"} | ${row.renewal || "无（走页面）"} | ${oldTabs} | 1 |`);
}
console.log("");
console.log(`一次全量刷新合计：旧 ${before} 个临时标签页 → 新 ${after} 个（减少 ${before - after}）`);
console.log(`平均每站：旧 ${(before / collect).toFixed(2)} 个 → 新 ${(after / collect).toFixed(2)} 个`);