// 按当前插件目录估算开页预算，不访问网站，不是浏览器实测。
// 假设：所有页面站点启用、没有既有页面、预检无有效凭据、每站只采集一次。
// 跑法：node scripts/measure-tabs.mjs
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

const before = preflight.length + collect;
const after = collect;

console.log("静态预算，非浏览器实测；假设全启用、无已打开页面、无有效凭据。");
console.log(`页面站点：${collect}；旧路径可能额外预检开页的站点：${preflight.length}`);
console.log("");
console.log("| 站点 | pageAuth | credentials:include | 无头续期 | 旧路径开页上限 | 修复后开页上限 |");
console.log("| --- | --- | --- | --- | --- | --- |");
for (const row of rows) {
  const oldTabs = (row.needsPreflight ? 1 : 0) + 1;
  console.log(`| ${row.id} | ${row.pageAuth ? "是" : "否"} | ${row.include ? "是" : "否"} | ${row.renewal || "无（走页面）"} | ${oldTabs} | 1 |`);
}
console.log("");
console.log(`一次刷新开页预算：旧路径最多 ${before} 个，修复后最多 ${after} 个，预检额外开页为 0。`);
console.log("修复后页面采集共用 1 个槽位；直接 API 采集保留 3 个并行槽位。");
console.log("实际行为由 test/refresh-preflight.test.js 和 test/core.test.js 的回归测试验证。");