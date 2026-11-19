// 插件仓库 → 扩展插件的构建器。
//
// 源：plugins/<id>/manifest.json + plugins/<id>/plugin.js + plugins/<id>/models.json
// 产物：src/site-plugins/providers/<id>.js 与 src/site-plugins/catalog.js
// 站点图标：plugins/<id>/icon.svg|png → icons/sites/<id>.<ext> + src/shared/site-logos.js
//
// 插件源码只写 `@app/...` 这类扩展核心导入，构建时改写成扩展内的相对路径，
// 所以插件目录本身不依赖目录层级，单独抽成仓库后也能直接打包。
//
// 用法：
//   node scripts/plugin-build.mjs           生成产物
//   node scripts/plugin-build.mjs --check   只校验产物是否与源同步（CI/测试用）

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// 插件源目录：独立仓库默认并排签出在 ../plugins，签出到别处时用 PLUGIN_DIR 环境变量指向。
const PLUGIN_DIR = path.resolve(process.env.PLUGIN_DIR || path.join(ROOT, "..", "plugins"));
const PROVIDER_DIR = path.join(ROOT, "src", "site-plugins", "providers");
const CATALOG_FILE = path.join(ROOT, "src", "site-plugins", "catalog.js");
const ORDER_FILE = path.join(ROOT, "src", "shared", "plugin-order.js");
const GENERATED = "由 scripts/plugin-build.mjs 从 plugins/ 生成，不要手改。重新生成：node scripts/plugin-build.mjs";
// 插件仓库索引：一份随扩展内置（离线也能看到商店），一份写进插件仓库用于线上分发。
const REGISTRY_SNAPSHOT_FILE = path.join(ROOT, "src", "site-plugins", "registry-snapshot.js");
const REGISTRY_JSON_FILE = path.join(PLUGIN_DIR, "plugins.json");
// 站点图标随插件分发：插件目录放一份源，构建时复制进扩展并生成 id → 路径映射。
const SITE_ICON_DIR = path.join(ROOT, "icons", "sites");
const SITE_LOGOS_FILE = path.join(ROOT, "src", "shared", "site-logos.js");
const SITE_ICON_PATTERN = /^icon\.(svg|png|webp|jpe?g|ico)$/i;
const BUNDLED_VERSION = String(readJson(path.join(ROOT, "manifest.json")).version || "0.0.0");

const MANIFEST_KEYS = ["id", "name", "version", "host", "hosts", "paths", "mode", "category", "kind", "addable", "description", "order"];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function listPlugins() {
  return fs.readdirSync(PLUGIN_DIR, { withFileTypes: true })
    // 只认带 manifest.json 的目录：plugins/assets 这类放 README 图标的目录不算插件。
    .filter(entry => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules" && fs.existsSync(path.join(PLUGIN_DIR, entry.name, "manifest.json")))
    .map(entry => entry.name)
    .sort();
}

function loadPlugin(id) {
  const dir = path.join(PLUGIN_DIR, id);
  const manifestFile = path.join(dir, "manifest.json");
  const pluginFile = path.join(dir, "plugin.js");
  if (!fs.existsSync(manifestFile)) throw new Error(`plugins/${id} 缺 manifest.json`);
  const manifest = readJson(manifestFile);
  if (manifest.id !== id) throw new Error(`plugins/${id}/manifest.json 的 id 是 ${manifest.id}，必须与目录名一致`);
  if (!fs.existsSync(pluginFile)) throw new Error(`plugins/${id} 缺 plugin.js`);
  const modelsFile = path.join(dir, "models.json");
  const models = fs.existsSync(modelsFile) ? readJson(modelsFile) : { aliases: {} };
  const aliases = models?.aliases && typeof models.aliases === "object" ? models.aliases : {};
  return { id, dir, manifest, kind: "price", source: fs.readFileSync(pluginFile, "utf8"), aliases, icon: findSiteIcon(dir) };
}

// 插件目录里的图标源文件名固定，不额外加 manifest 字段。
function findSiteIcon(dir) {
  for (const name of fs.readdirSync(dir)) {
    const match = name.match(SITE_ICON_PATTERN);
    if (match) return { name, ext: match[1].toLowerCase().replace(/^jpeg$/, "jpg") };
  }
  return null;
}

function renderSiteLogos(plugins) {
  const entries = plugins
    .filter(plugin => plugin.icon)
    .map(plugin => `  ${JSON.stringify(plugin.id)}: "icons/sites/${plugin.id}.${plugin.icon.ext}"`);
  const body = entries.length ? `{\n${entries.join(",\n")}\n}` : "{}";
  return `// ${GENERATED}\n\n// 站点图标映射：模型列旁边的站点标记、中转站筛选、供应商列表都用它。\nexport const SITE_LOGOS = ${body};\n\nexport function siteLogoFor(id) {\n  return SITE_LOGOS[String(id || "")] || "";\n}\n\nexport function siteInitial(name) {\n  const chars = String(name || "").trim();\n  return chars ? chars[0].toUpperCase() : "?";\n}\n`;
}

function rewriteImports(source) {
  return source.replace(/(["'])@app\//g, "$1../../");
}

function renderProvider(plugin) {
  const body = rewriteImports(plugin.source).replace(/\s+$/u, "");
  if (!/^export const sitePlugin\b/m.test(body)) {
    throw new Error(`plugins/${plugin.id}/plugin.js 必须 export const sitePlugin`);
  }
  const renamed = body.replace(/^export const sitePlugin\b/m, "const pluginSource");
  const aliasList = Object.entries(plugin.aliases)
    .map(([alias, canonicalId]) => ({ alias: String(alias), canonicalId: String(canonicalId) }))
    .filter(item => item.alias && item.canonicalId);
  const aliasBlock = aliasList.length
    ? `const MODEL_ALIASES = ${JSON.stringify(aliasList, null, 2)};`
    : "const MODEL_ALIASES = [];";
  return `// ${GENERATED}\n\n${renamed}\n\n${aliasBlock}\n\nexport const sitePlugin = { ...pluginSource, modelAliases: MODEL_ALIASES };\n`;
}

function orderedPlugins(plugins) {
  return [...plugins].sort((left, right) => {
    const leftOrder = Number.isFinite(left.manifest.order) ? left.manifest.order : Number.MAX_SAFE_INTEGER;
    const rightOrder = Number.isFinite(right.manifest.order) ? right.manifest.order : Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.id.localeCompare(right.id);
  });
}

function renderOrder(plugins) {
  const ids = orderedPlugins(plugins).map(plugin => plugin.id);
  return `// ${GENERATED}
export const SITE_PLUGIN_ORDER = ${JSON.stringify(ids, null, 2)};
`;
}

function registryEntries(plugins) {
  return orderedPlugins(plugins).map(plugin => {
    const manifest = plugin.manifest;
    const hosts = Array.isArray(manifest.hosts) && manifest.hosts.length ? manifest.hosts : [manifest.host];
    return {
      id: manifest.id,
      name: manifest.name || manifest.id,
      version: String(manifest.version || BUNDLED_VERSION),
      description: manifest.description || "",
      hosts,
      needsCode: true
    };
  });
}

// 内置快照与线上索引内容一致，区别只是扩展里带一份、插件仓库发布一份。
function renderRegistrySnapshot(plugins) {
  const payload = { schemaVersion: 1, plugins: registryEntries(plugins) };
  return `// ${GENERATED}\n// 内置的插件仓库快照：首次打开插件商店时先用它，刷新仓库后以线上索引为准。\nexport const PLUGIN_REGISTRY_SNAPSHOT = ${JSON.stringify(payload, null, 2)};\n`;
}

function renderRegistryJson(plugins) {
  return `${JSON.stringify({ schemaVersion: 1, plugins: registryEntries(plugins) }, null, 2)}\n`;
}
function renderCatalog(plugins) {
  const imports = orderedPlugins(plugins).map(plugin => ({
    plugin,
    local: `${plugin.id.replace(/[^a-zA-Z0-9]+(.)?/g, (_, chr) => (chr ? chr.toUpperCase() : "")).replace(/^[0-9]/, "_$&")}Plugin`
  }));
  const importLines = imports
    .map(({ plugin, local }) => `import { sitePlugin as ${local} } from "./providers/${plugin.id}.js";`)
    .join("\n");
  const entries = imports.map(({ plugin, local }) => {
    const manifest = plugin.manifest;
    const options = [];
    if (Array.isArray(manifest.hosts) && manifest.hosts.length && manifest.hosts.join("|") !== String(manifest.host)) {
      options.push(`hosts: ${JSON.stringify(manifest.hosts)}`);
    }
    if (Array.isArray(manifest.paths) && manifest.paths.length) options.push(`paths: ${JSON.stringify(manifest.paths)}`);
    if (manifest.category && manifest.category !== "paid") options.push(`category: ${JSON.stringify(manifest.category)}`);
    if (manifest.addable === false) options.push("addable: false");
    if (manifest.description) options.push(`description: ${JSON.stringify(manifest.description)}`);
    const tail = options.length ? `, { ${options.join(", ")} }` : "";
    return `  entry(${JSON.stringify(manifest.id)}, ${JSON.stringify(manifest.name || manifest.id)}, ${JSON.stringify(manifest.host)}, ${JSON.stringify(manifest.mode || "direct")}, () => ({ sitePlugin: ${local} })${tail})`;
  });
  return `// ${GENERATED}\n\nimport { stationContext } from "../core/provider-registry.js";\n${importLines}\n\nconst entry = (id, name, host, mode, load, options = {}) => ({
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
${entries.join(",\n")}
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
`;
}

function build() {
  const plugins = listPlugins().map(loadPlugin);
  if (!plugins.length) throw new Error("plugins/ 下没有任何插件目录");
  const seen = new Set();
  for (const plugin of plugins) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(plugin.id)) throw new Error(`插件 id 只能用 a-z 0-9 与连字符：${plugin.id}`);
    if (plugin.manifest.version !== undefined && !/^\d+\.\d+\.\d+$/.test(String(plugin.manifest.version))) {
      throw new Error(`plugins/${plugin.id}/manifest.json 的 version 必须是 x.y.z：${plugin.manifest.version}`);
    }
    for (const key of Object.keys(plugin.manifest)) {
      if (!MANIFEST_KEYS.includes(key)) throw new Error(`plugins/${plugin.id}/manifest.json 有未知字段：${key}`);
    }
    if (seen.has(plugin.manifest.host)) {
      // 同域多插件只能靠 paths 区分，允许，但要求都声明 paths
      const others = plugins.filter(item => item.manifest.host === plugin.manifest.host && item !== plugin);
      for (const other of [plugin, ...others]) {
        if (!Array.isArray(other.manifest.paths) || !other.manifest.paths.length) {
          throw new Error(`同域插件 ${other.id} 与 ${plugin.id} 共用 ${plugin.manifest.host}，必须各自声明 paths`);
        }
      }
    }
    seen.add(plugin.manifest.host);
  }
  const files = new Map();
  for (const plugin of plugins) {
    files.set(path.join(PROVIDER_DIR, `${plugin.id}.js`), renderProvider(plugin));
  }
  files.set(CATALOG_FILE, renderCatalog(plugins));
  files.set(ORDER_FILE, renderOrder(plugins));
  files.set(REGISTRY_SNAPSHOT_FILE, renderRegistrySnapshot(plugins));
  files.set(REGISTRY_JSON_FILE, renderRegistryJson(plugins));
  for (const plugin of plugins) {
    if (!plugin.icon) continue;
    files.set(path.join(SITE_ICON_DIR, `${plugin.id}.${plugin.icon.ext}`), fs.readFileSync(path.join(plugin.dir, plugin.icon.name)));
  }
  files.set(SITE_LOGOS_FILE, renderSiteLogos(plugins));
  return { plugins, files };
}

function writeOutputs(files) {
  fs.mkdirSync(PROVIDER_DIR, { recursive: true });
  fs.mkdirSync(SITE_ICON_DIR, { recursive: true });
  const keep = new Set([...files.keys()]);
  for (const dir of [PROVIDER_DIR, SITE_ICON_DIR]) {
    for (const entry of fs.readdirSync(dir)) {
      const file = path.join(dir, entry);
      if (entry.endsWith(".js") && dir === PROVIDER_DIR && !keep.has(file)) fs.rmSync(file);
      if (dir === SITE_ICON_DIR && !keep.has(file)) fs.rmSync(file);
    }
  }
  for (const [file, content] of files) fs.writeFileSync(file, content);
}

// 图标是二进制，文本比较会把它们全判成漂移；svg 是文本，行尾差异（CRLF 克隆）不算漂移。
function normalizeEol(text) {
  return text.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
}

function sameContent(file, content) {
  const actual = fs.readFileSync(file);
  if (Buffer.isBuffer(content) && !file.toLowerCase().endsWith(".svg")) return actual.equals(content);
  return normalizeEol(actual.toString("utf8")) === normalizeEol(content.toString("utf8"));
}

function checkOutputs(files) {
  const drift = [];
  for (const [file, content] of files) {
    if (!fs.existsSync(file)) drift.push(`${path.relative(ROOT, file)} 缺失`);
    else if (!sameContent(file, content)) drift.push(`${path.relative(ROOT, file)} 与 plugins/ 不同步`);
  }
  const known = new Set([...files.keys()]);
  if (fs.existsSync(PROVIDER_DIR)) {
    for (const entry of fs.readdirSync(PROVIDER_DIR)) {
      const file = path.join(PROVIDER_DIR, entry);
      if (entry.endsWith(".js") && !known.has(file)) drift.push(`${path.relative(ROOT, file)} 没有对应的 plugins/ 目录`);
    }
  }
  if (fs.existsSync(SITE_ICON_DIR)) {
    for (const entry of fs.readdirSync(SITE_ICON_DIR)) {
      const file = path.join(SITE_ICON_DIR, entry);
      if (!known.has(file)) drift.push(`${path.relative(ROOT, file)} 没有对应的 plugins/ 图标`);
    }
  }
  return drift;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { plugins, files } = build();
  if (process.argv.includes("--check")) {
    const drift = checkOutputs(files);
    if (drift.length) {
      console.error(drift.join("\n"));
      console.error("运行 node scripts/plugin-build.mjs 同步。");
      process.exit(1);
    }
    console.log(`插件产物与源同步：${plugins.length} 个插件`);
  } else {
    writeOutputs(files);
    console.log(`已生成 ${plugins.length} 个插件产物：providers/*.js + catalog.js + registry-snapshot.js + site-logos.js + icons/sites/* + plugins.json`);
  }
}

export { build, checkOutputs, renderCatalog, renderProvider, renderRegistryJson, renderRegistrySnapshot, renderSiteLogos, rewriteImports };