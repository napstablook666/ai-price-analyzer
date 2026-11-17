// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

// 站点图标映射：模型列旁边的站点标记、中转站筛选、供应商列表都用它。
export const SITE_LOGOS = {
  "aiapi": "icons/sites/aiapi.svg",
  "all-in-one": "icons/sites/all-in-one.svg",
  "centos": "icons/sites/centos.png",
  "cheaprouter": "icons/sites/cheaprouter.svg",
  "cun": "icons/sites/cun.png",
  "dddai": "icons/sites/dddai.png",
  "fastaitoken": "icons/sites/fastaitoken.svg",
  "fuck-everyone": "icons/sites/fuck-everyone.png",
  "hepingan": "icons/sites/hepingan.png",
  "jiji": "icons/sites/jiji.png",
  "killai": "icons/sites/killai.png",
  "liuguang": "icons/sites/liuguang.svg",
  "maolaoapi": "icons/sites/maolaoapi.svg",
  "nexavlinks": "icons/sites/nexavlinks.png",
  "nodeai": "icons/sites/nodeai.png",
  "public-pricing": "icons/sites/public-pricing.png",
  "relayrouter": "icons/sites/relayrouter.svg",
  "sevenai": "icons/sites/sevenai.png",
  "sidrune": "icons/sites/sidrune.svg",
  "site-checkin": "icons/sites/site-checkin.svg",
  "soleapi": "icons/sites/soleapi.svg",
  "stellaisle": "icons/sites/stellaisle.png",
  "tokenflux": "icons/sites/tokenflux.png",
  "true-sota": "icons/sites/true-sota.svg",
  "windhub": "icons/sites/windhub.png"
};

export function siteLogoFor(id) {
  return SITE_LOGOS[String(id || "")] || "";
}

export function siteInitial(name) {
  const chars = String(name || "").trim();
  return chars ? chars[0].toUpperCase() : "?";
}
