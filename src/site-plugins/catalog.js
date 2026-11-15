// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

import { stationContext } from "../core/provider-registry.js";
import { sitePlugin as sevenaiPlugin } from "./providers/sevenai.js";
import { sitePlugin as tokenfluxPlugin } from "./providers/tokenflux.js";
import { sitePlugin as windhubPlugin } from "./providers/windhub.js";
import { sitePlugin as centosPlugin } from "./providers/centos.js";
import { sitePlugin as trueSotaPlugin } from "./providers/true-sota.js";
import { sitePlugin as sidrunePlugin } from "./providers/sidrune.js";
import { sitePlugin as nodeaiPlugin } from "./providers/nodeai.js";
import { sitePlugin as killaiPlugin } from "./providers/killai.js";
import { sitePlugin as fuckEveryonePlugin } from "./providers/fuck-everyone.js";
import { sitePlugin as cunPlugin } from "./providers/cun.js";
import { sitePlugin as soleapiPlugin } from "./providers/soleapi.js";
import { sitePlugin as dddaiPlugin } from "./providers/dddai.js";
import { sitePlugin as liuguangPlugin } from "./providers/liuguang.js";
import { sitePlugin as publicPricingPlugin } from "./providers/public-pricing.js";
import { sitePlugin as hepinganPlugin } from "./providers/hepingan.js";
import { sitePlugin as allInOnePlugin } from "./providers/all-in-one.js";
import { sitePlugin as aiapiPlugin } from "./providers/aiapi.js";
import { sitePlugin as fastaitokenPlugin } from "./providers/fastaitoken.js";
import { sitePlugin as nexavlinksPlugin } from "./providers/nexavlinks.js";
import { sitePlugin as cheaprouterPlugin } from "./providers/cheaprouter.js";
import { sitePlugin as jijiPlugin } from "./providers/jiji.js";

const entry = (id, name, host, mode, load, options = {}) => ({
  id,
  name,
  host,
  hosts: options.hosts || [host],
  paths: options.paths || null,
  mode,
  category: options.category || "paid",
  addable: options.addable !== false,
  authLabel: mode === "page" ? "使用当前浏览器登录态" : "公开接口，无需登录",
  kind: "bundled",
  source: "bundled",
  description: options.description || "内置站点适配器",
  load
});

// MV3 service workers require static module imports; provider registration stays on demand.
export const SITE_PLUGIN_CATALOG = [
  entry("sevenai", "SevenAI", "sevenai.moe", "direct", () => ({ sitePlugin: sevenaiPlugin }), { paths: ["/model-plaza"], description: "公开模型广场，直连采集" }),
  entry("tokenflux", "TokenFlux", "tokenflux.cloud", "direct", () => ({ sitePlugin: tokenfluxPlugin }), { paths: ["/","/pricing"], description: "公开定价 API，直连采集" }),
  entry("windhub", "WindHub", "windhub.cc", "direct", () => ({ sitePlugin: windhubPlugin }), { paths: ["/pricing"], category: "public", description: "公益站公开价格接口" }),
  entry("centos", "ai.centos.hk", "ai.centos.hk", "direct", () => ({ sitePlugin: centosPlugin }), { paths: ["/pricing"], description: "公开定价 API，直连采集" }),
  entry("true-sota", "TrueSOTA", "true-sota.com", "direct", () => ({ sitePlugin: trueSotaPlugin }), { paths: ["/model-pricing"], description: "公开模型价格 API" }),
  entry("sidrune", "Sidrune", "sidrune.ai", "direct", () => ({ sitePlugin: sidrunePlugin }), { paths: ["/model-plaza"], description: "公开模型广场，支持汇率配置" }),
  entry("nodeai", "NodeAI", "nodeai.cc", "direct", () => ({ sitePlugin: nodeaiPlugin }), { paths: ["/model-plaza"], description: "公开模型广场，直连采集" }),
  entry("killai", "KillAI", "api.killai.cc", "page", () => ({ sitePlugin: killaiPlugin }), { paths: ["/pricing","/model-plaza"], description: "New API 价格，支持会话刷新" }),
  entry("fuck-everyone", "fuck-everyone.com", "fuck-everyone.com", "direct", () => ({ sitePlugin: fuckEveryonePlugin }), { paths: ["/model-plaza"], description: "公开模型广场，直连采集" }),
  entry("cun", "CUN.AI", "cun.ai", "page", () => ({ sitePlugin: cunPlugin }), { paths: ["/","/pricing"], description: "复用登录态读取价格 API" }),
  entry("soleapi", "SoleAPI", "soleapi.com", "direct", () => ({ sitePlugin: soleapiPlugin }), { addable: false, description: "按具体模型页地址添加" }),
  entry("dddai", "dddai.dev", "dddai.dev", "direct", () => ({ sitePlugin: dddaiPlugin }), { paths: ["/","/pricing"], description: "公开模型价格 API" }),
  entry("liuguang", "liuguang.ai", "liuguang.ai", "direct", () => ({ sitePlugin: liuguangPlugin }), { paths: ["/","/pricing"], description: "公开模型价格 API" }),
  entry("public-pricing", "公开价格 API", "nomissapi.com", "direct", () => ({ sitePlugin: publicPricingPlugin }), { hosts: ["nomissapi.com","yorhamc.com","token123.cfd"], addable: false, description: "通用公开价格适配，按站点地址添加" }),
  entry("hepingan", "hepingan.top", "api.hepingan.top", "page", () => ({ sitePlugin: hepinganPlugin }), { paths: ["/available-channels"], description: "复用当前浏览器持久登录态" }),
  entry("all-in-one", "all-in-one.icu", "all-in-one.icu", "page", () => ({ sitePlugin: allInOnePlugin }), { paths: ["/tenant/models"], description: "租户模型价格，页面会话采集" }),
  entry("aiapi", "AIAPI", "cn.aiapi.bot", "page", () => ({ sitePlugin: aiapiPlugin }), { paths: ["/dashboard/model-prices"], description: "模型目录与价格，页面会话采集" }),
  entry("fastaitoken", "fastaitoken.com", "fastaitoken.com", "page", () => ({ sitePlugin: fastaitokenPlugin }), { description: "读取当前账号的可用渠道" }),
  entry("nexavlinks", "NexaVlinks", "nexavlinks.com", "page", () => ({ sitePlugin: nexavlinksPlugin }), { description: "读取当前账号的模型渠道" }),
  entry("cheaprouter", "CheapRouter", "cheaprouter.cc", "direct", () => ({ sitePlugin: cheaprouterPlugin }), { paths: ["/models"], description: "公开模型价格 API" }),
  entry("jiji", "吉吉模型市场", "jiji.cc", "page", () => ({ sitePlugin: jijiPlugin }), { addable: false, description: "带 token 的模型市场，按站点地址添加" })
];

export function sitePluginById(id) {
  return SITE_PLUGIN_CATALOG.find(plugin => plugin.id === id) || null;
}

export function sitePluginForStation(station = {}) {
  if (station.pluginId) {
    const explicit = sitePluginById(station.pluginId);
    if (explicit) return explicit;
  }
  const context = stationContext(station);
  if (!context.url) return null;
  const hostMatches = SITE_PLUGIN_CATALOG.filter(plugin => plugin.hosts.includes(context.hostname));
  return hostMatches.find(plugin => !plugin.paths || plugin.paths.includes(context.path) || plugin.paths.includes(context.hashPath))
    || (hostMatches.length === 1 ? hostMatches[0] : null);
}

export function sitePluginCatalogForStations(stations = [], options = {}) {
  const addedIds = new Set(stations.map(sitePluginForStation).filter(Boolean).map(plugin => plugin.id));
  // 出货时不带任何插件，只有装过的才会出现在列表里；installedIds 缺省表示不过滤。
  const installedIds = options.installedIds instanceof Set ? options.installedIds : null;
  return (installedIds ? SITE_PLUGIN_CATALOG.filter(plugin => installedIds.has(plugin.id)) : SITE_PLUGIN_CATALOG).map(({ load, paths, hosts, ...plugin }) => ({
    ...plugin,
    version: options.bundledVersion || "",
    added: addedIds.has(plugin.id),
    stationCount: stations.filter(station => sitePluginForStation(station)?.id === plugin.id).length
  }));
}
