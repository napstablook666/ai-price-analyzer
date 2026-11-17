// 配置迁移：换扩展 ID（比如加了 manifest.key）之后，老数据读不到，靠这个文件救回来。
// 只搬「用户自己填的」：站点和设置。密钥不进去，导入后重填一次。
export const SETTINGS_EXPORT_FORMAT = "apa-settings";
export const SETTINGS_EXPORT_VERSION = 1;

function stripSecrets(settings) {
  const copy = { ...settings };
  if (copy.modelAssistant && typeof copy.modelAssistant === "object") {
    copy.modelAssistant = { ...copy.modelAssistant };
    delete copy.modelAssistant.apiKey;
  }
  return copy;
}

function stripStationAuth(station) {
  const auth = station.auth && typeof station.auth === "object" ? station.auth : {};
  return { ...station, auth: { type: auth.type || "none", token: "", username: "", password: "" } };
}

export function buildSettingsExport({ settings, stations, now = Date.now }) {
  return {
    format: SETTINGS_EXPORT_FORMAT,
    version: SETTINGS_EXPORT_VERSION,
    exportedAt: new Date(now()).toISOString(),
    settings: stripSecrets(settings && typeof settings === "object" ? settings : {}),
    stations: (Array.isArray(stations) ? stations : []).filter(station => station && typeof station === "object").map(stripStationAuth)
  };
}

export function parseSettingsExport(raw) {
  const data = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!data || typeof data !== "object" || data.format !== SETTINGS_EXPORT_FORMAT) {
    throw new Error("不是本扩展导出的配置文件");
  }
  if (Number(data.version) > SETTINGS_EXPORT_VERSION) {
    throw new Error("配置文件来自更新的扩展版本，先升级再导入");
  }
  const settings = data.settings && typeof data.settings === "object" ? data.settings : {};
  const stations = Array.isArray(data.stations) ? data.stations : [];
  return {
    settings: stripSecrets(settings),
    stations: stations.filter(station => station && typeof station === "object").map(stripStationAuth)
  };
}
