// 由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs

// 站点图标映射：模型列旁边的站点标记、中转站筛选、供应商列表都用它。
export const SITE_LOGOS = {
  "0ait": "icons/sites/0ait.svg",
  "4zapi": "icons/sites/4zapi.png",
  "91token": "icons/sites/91token.ico",
  "aiapi": "icons/sites/aiapi.svg",
  "all-in-one": "icons/sites/all-in-one.svg",
  "allrouter": "icons/sites/allrouter.svg",
  "centos": "icons/sites/centos.png",
  "cheaprouter": "icons/sites/cheaprouter.svg",
  "coderelay": "icons/sites/coderelay.png",
  "corecode": "icons/sites/corecode.svg",
  "cun": "icons/sites/cun.png",
  "dddai": "icons/sites/dddai.png",
  "eapi": "icons/sites/eapi.png",
  "fastaitoken": "icons/sites/fastaitoken.svg",
  "fuck-everyone": "icons/sites/fuck-everyone.png",
  "hepingan": "icons/sites/hepingan.png",
  "jiji": "icons/sites/jiji.png",
  "juziai": "icons/sites/juziai.svg",
  "kelaode": "icons/sites/kelaode.png",
  "killai": "icons/sites/killai.png",
  "kuaipao": "icons/sites/kuaipao.png",
  "leaflow": "icons/sites/leaflow.svg",
  "liuguang": "icons/sites/liuguang.svg",
  "maolaoapi": "icons/sites/maolaoapi.svg",
  "moonup": "icons/sites/moonup.svg",
  "newcodex": "icons/sites/newcodex.svg",
  "nexavlinks": "icons/sites/nexavlinks.png",
  "nodeai": "icons/sites/nodeai.png",
  "ooioo": "icons/sites/ooioo.png",
  "openlux": "icons/sites/openlux.svg",
  "packycode": "icons/sites/packycode.svg",
  "poloai": "icons/sites/poloai.svg",
  "pqh": "icons/sites/pqh.png",
  "public-pricing": "icons/sites/public-pricing.png",
  "relayrouter": "icons/sites/relayrouter.svg",
  "sevenai": "icons/sites/sevenai.png",
  "sidrune": "icons/sites/sidrune.svg",
  "soleapi": "icons/sites/soleapi.svg",
  "spiderai": "icons/sites/spiderai.svg",
  "stellaisle": "icons/sites/stellaisle.png",
  "stellaisle-carpool": "icons/sites/stellaisle-carpool.png",
  "tokenflux": "icons/sites/tokenflux.png",
  "true-sota": "icons/sites/true-sota.svg",
  "undying": "icons/sites/undying.png",
  "velamost": "icons/sites/velamost.png",
  "windhub": "icons/sites/windhub.png",
  "xingya": "icons/sites/xingya.png",
  "xkrelay": "icons/sites/xkrelay.png",
  "zerocat": "icons/sites/zerocat.png"
};

export function siteLogoFor(id) {
  return SITE_LOGOS[String(id || "")] || "";
}

export function siteInitial(name) {
  const chars = String(name || "").trim();
  return chars ? chars[0].toUpperCase() : "?";
}
