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
import { sitePlugin as maolaoapiPlugin } from "./providers/maolaoapi.js";
import { sitePlugin as stellaislePlugin } from "./providers/stellaisle.js";
import { sitePlugin as relayrouterPlugin } from "./providers/relayrouter.js";
import { sitePlugin as stellaisleCarpoolPlugin } from "./providers/stellaisle-carpool.js";
import { sitePlugin as newcodexPlugin } from "./providers/newcodex.js";
import { sitePlugin as allrouterPlugin } from "./providers/allrouter.js";
import { sitePlugin as xingyaPlugin } from "./providers/xingya.js";
import { sitePlugin as openluxPlugin } from "./providers/openlux.js";
import { sitePlugin as _91tokenPlugin } from "./providers/91token.js";

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
  entry("soleapi", "SoleAPI", "soleapi.com", "direct", () => ({ sitePlugin: soleapiPlugin }), { description: "公开模型价格接口直接采，按 Credits 计价（1 Credit = ¥1）" }),
  entry("dddai", "dddai.dev", "dddai.dev", "direct", () => ({ sitePlugin: dddaiPlugin }), { paths: ["/","/pricing"], description: "公开模型价格 API" }),
  entry("liuguang", "liuguang.ai", "liuguang.ai", "direct", () => ({ sitePlugin: liuguangPlugin }), { paths: ["/","/pricing"], description: "公开模型价格 API" }),
  entry("public-pricing", "公开价格 API", "nomissapi.com", "direct", () => ({ sitePlugin: publicPricingPlugin }), { hosts: ["nomissapi.com","yorhamc.com","token123.cfd"], addable: false, description: "通用公开价格适配，按站点地址添加" }),
  entry("hepingan", "hepingan.top", "api.hepingan.top", "page", () => ({ sitePlugin: hepinganPlugin }), { paths: ["/available-channels"], description: "复用浏览器登录态，过期自动续期" }),
  entry("all-in-one", "all-in-one.icu", "all-in-one.icu", "page", () => ({ sitePlugin: allInOnePlugin }), { paths: ["/tenant/models"], description: "租户模型价格，页面会话采集" }),
  entry("aiapi", "AIAPI", "cn.aiapi.bot", "page", () => ({ sitePlugin: aiapiPlugin }), { paths: ["/dashboard/model-prices"], description: "模型目录与价格，页面会话采集" }),
  entry("fastaitoken", "fastaitoken.com", "fastaitoken.com", "page", () => ({ sitePlugin: fastaitokenPlugin }), { description: "读取当前账号的可用渠道" }),
  entry("nexavlinks", "NexaVlinks", "nexavlinks.com", "page", () => ({ sitePlugin: nexavlinksPlugin }), { description: "读取当前账号的模型渠道" }),
  entry("cheaprouter", "CheapRouter", "cheaprouter.cc", "direct", () => ({ sitePlugin: cheaprouterPlugin }), { paths: ["/models"], description: "公开模型价格 API" }),
  entry("jiji", "吉吉模型市场", "jiji.cc", "page", () => ({ sitePlugin: jijiPlugin }), { description: "模型市场接口要登录态，插件用你浏览器里的吉吉登录 token 直连采集" }),
  entry("maolaoapi", "maolaoapi.com", "maolaoapi.com", "direct", () => ({ sitePlugin: maolaoapiPlugin }), { paths: ["/pricing","/","/console/topup"], description: "公开定价 API，直连采集；充值 1.03 元/额度，200/500/1000 档另有折扣" }),
  entry("stellaisle", "飓星API", "token.stellaisle.com", "direct", () => ({ sitePlugin: stellaislePlugin }), { paths: ["/","/pricing","/group-plaza"], description: "公开接口直连采集：/api/pricing 给 94 个模型的基准价，/api/group-plaza 给分组与倍率，按分组展开报价" }),
  entry("relayrouter", "RelayRouter", "relayrouter.app", "direct", () => ({ sitePlugin: relayrouterPlugin }), { hosts: ["www.relayrouter.app","relayrouter.app"], paths: ["/pricing","/console/topup","/"], description: "公开定价 API，直连采集；充值 1 元 = 1 美元额度，面值越大折扣越多（最高 7.5%）" }),
  entry("stellaisle-carpool", "飓星API 拼车", "token.stellaisle.com", "page", () => ({ sitePlugin: stellaisleCarpoolPlugin }), { paths: ["/carpool-market"], description: "登录后读 /api/carpool-market 的座位清单，用座位价除以期间额度当折扣，折算站内模型价" }),
  entry("newcodex", "NewCodex", "newcodex.cn", "direct", () => ({ sitePlugin: newcodexPlugin }), { hosts: ["newcodex.cn","www.newcodex.cn"], paths: ["/","/pricing","/console/topup"], description: "公开 /api/pricing 直连采集，69 个模型 11 个分组；充值 1 元 = 1 美元额度，单笔 ¥100/200/500/1000 另赠 10%/20%/40%/50%" }),
  entry("allrouter", "AllRouter", "allrouter.cc", "direct", () => ({ sitePlugin: allrouterPlugin }), { hosts: ["allrouter.cc","www.allrouter.cc"], paths: ["/","/console","/console/topup"], description: "公开 /api/pricing 直连采集，52 个在售模型、102 条模型分组；分组倍率公开（default 0.75、deepseek 0.4、gpt 0.053 等），倍率 1 = $2/百万 token，37 个模型走分段或分时表达式；充值 1 元 = 1 美元额度" }),
  entry("xingya", "星芽API", "xingya.site", "direct", () => ({ sitePlugin: xingyaPlugin }), { hosts: ["xingya.site","xingya.space"], paths: ["/","/pricing"], description: "公开 /api/pricing 直连采集，83 个模型 13 个分组；充值 1 元 = 100 芽点 = 1 美元额度，无阶梯赠送" }),
  entry("openlux", "OpenLux", "openlux.ai", "direct", () => ({ sitePlugin: openluxPlugin }), { hosts: ["www.openlux.ai","openlux.ai"], paths: ["/pricing","/console/topup","/console/models","/"], description: "公开定价接口直连采集，322 个模型覆盖按 token 与按次；1 美元 = 1 美元额度，面值越大越便宜（最高 7.5%）" }),
  entry("91token", "91Token", "91token.com", "direct", () => ({ sitePlugin: _91tokenPlugin }), { hosts: ["91token.com","www.91token.com"], paths: ["/pricing","/console","/console/topup","/"], description: "公开定价接口匿名采集文本与图片报价，保留分组和长度档；复杂视频暂不折算，充值方案及实付需要登录核实" })
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
