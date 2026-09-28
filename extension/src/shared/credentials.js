const KEY = "ai-price-analyzer:tokens";
const LLM_API_KEY = "ai-price-analyzer:llm-api-key";
const JEV_API_KEY = "ai-price-analyzer:jev-api-key";
const PROVIDER_API_KEYS = "ai-price-analyzer:provider-api-keys";

function storageAreas(chromeApi) {
  const local = chromeApi?.storage?.local;
  const session = chromeApi?.storage?.session;
  return [session, local].filter(Boolean);
}

function writeArea(chromeApi) {
  return chromeApi?.storage?.local || chromeApi?.storage?.session;
}

async function clearSessionValue(chromeApi, key, area) {
  const session = chromeApi?.storage?.session;
  if (session && session !== area) await session.remove(key);
}

async function readStationCredentials(chromeApi) {
  const areas = storageAreas(chromeApi);
  if (!areas.length) return { area: null, credentials: {} };
  let raw = {};
  for (const area of areas) {
    const values = await area.get(KEY);
    const next = values?.[KEY];
    if (next && typeof next === "object") raw = { ...raw, ...next };
  }
  const credentials = Object.fromEntries(Object.entries(raw).map(([stationId, value]) => [
    stationId,
    typeof value === "string"
      ? { token: value, username: "", password: "" }
      : { token: String(value?.token || ""), username: String(value?.username || ""), password: String(value?.password || "") }
  ]));
  return { area: writeArea(chromeApi), credentials };
}

export async function setStationCredential(stationId, credential = {}, chromeApi = globalThis.chrome) {
  const { area, credentials } = await readStationCredentials(chromeApi);
  if (!area) return;
  const value = {
    token: String(credential.token || ""),
    username: String(credential.username || ""),
    password: String(credential.password || "")
  };
  if (Object.values(value).some(Boolean)) credentials[stationId] = value;
  else delete credentials[stationId];
  await area.set({ [KEY]: credentials });
  await clearSessionValue(chromeApi, KEY, area);
}

export async function getStationCredential(stationId, chromeApi = globalThis.chrome) {
  const { credentials } = await readStationCredentials(chromeApi);
  return credentials[stationId] || { token: "", username: "", password: "" };
}

export async function removeStationCredential(stationId, chromeApi = globalThis.chrome) {
  return setStationCredential(stationId, {}, chromeApi);
}

export async function setStationToken(stationId, token, chromeApi = globalThis.chrome) {
  const current = await getStationCredential(stationId, chromeApi);
  return setStationCredential(stationId, { ...current, token }, chromeApi);
}

export async function getStationToken(stationId, chromeApi = globalThis.chrome) {
  return (await getStationCredential(stationId, chromeApi)).token;
}

export async function removeStationToken(stationId, chromeApi = globalThis.chrome) {
  const current = await getStationCredential(stationId, chromeApi);
  return setStationCredential(stationId, { ...current, token: "" }, chromeApi);
}

async function setApiKey(storageKey, value, chromeApi = globalThis.chrome) {
  const area = writeArea(chromeApi);
  if (!area) return;
  const key = String(value || "").trim();
  if (key) await area.set({ [storageKey]: key });
  else await area.remove(storageKey);
  await clearSessionValue(chromeApi, storageKey, area);
}

async function getApiKey(storageKey, chromeApi = globalThis.chrome) {
  for (const area of storageAreas(chromeApi)) {
    const values = await area.get(storageKey);
    const key = String(values?.[storageKey] || "").trim();
    if (key) return key;
  }
  return "";
}

export function setLlmApiKey(value, chromeApi = globalThis.chrome) {
  return setApiKey(LLM_API_KEY, value, chromeApi);
}

export function getLlmApiKey(chromeApi = globalThis.chrome) {
  return getApiKey(LLM_API_KEY, chromeApi);
}

export async function hasLlmApiKey(chromeApi = globalThis.chrome) {
  return Boolean(await getLlmApiKey(chromeApi));
}

export function setJevApiKey(value, chromeApi = globalThis.chrome) {
  return setApiKey(JEV_API_KEY, value, chromeApi);
}

export function getJevApiKey(chromeApi = globalThis.chrome) {
  return getApiKey(JEV_API_KEY, chromeApi);
}

export async function hasJevApiKey(chromeApi = globalThis.chrome) {
  return Boolean(await getJevApiKey(chromeApi));
}


async function readProviderApiKeys(chromeApi) {
  const areas = storageAreas(chromeApi);
  if (!areas.length) return { area: null, keys: {} };
  const keys = {};
  for (const area of areas) {
    const values = await area.get(PROVIDER_API_KEYS);
    const raw = values?.[PROVIDER_API_KEYS];
    if (!raw || typeof raw !== "object") continue;
    for (const [kind, entries] of Object.entries(raw)) {
      if (entries && typeof entries === "object") keys[kind] = { ...(keys[kind] || {}), ...entries };
    }
  }
  return { area: writeArea(chromeApi), keys };
}
export async function setProviderApiKey(kind, profileId, value, chromeApi = globalThis.chrome) {
  const normalizedKind = kind === "jev" ? "jev" : "llm";
  const id = String(profileId || "").trim();
  if (!id) return;
  const { area, keys } = await readProviderApiKeys(chromeApi);
  if (!area) return;
  const next = { ...keys, [normalizedKind]: { ...(keys[normalizedKind] || {}) } };
  const key = String(value || "").trim();
  if (key) next[normalizedKind][id] = key;
  else delete next[normalizedKind][id];
  if (!Object.keys(next[normalizedKind]).length) delete next[normalizedKind];
  if (Object.keys(next).length) await area.set({ [PROVIDER_API_KEYS]: next });
  else await area.remove(PROVIDER_API_KEYS);
  await clearSessionValue(chromeApi, PROVIDER_API_KEYS, area);
}
export async function getProviderApiKey(kind, profileId, chromeApi = globalThis.chrome) {
  const id = String(profileId || "").trim();
  if (!id) return "";
  const { keys } = await readProviderApiKeys(chromeApi);
  const normalizedKind = kind === "jev" ? "jev" : "llm";
  return String(keys[normalizedKind]?.[id] || "");
}
export async function hasProviderApiKey(kind, profileId, chromeApi = globalThis.chrome) {
  return Boolean(await getProviderApiKey(kind, profileId, chromeApi));
}
export async function removeProviderApiKey(kind, profileId, chromeApi = globalThis.chrome) {
  return setProviderApiKey(kind, profileId, "", chromeApi);
}
export { KEY as CREDENTIAL_STORAGE_KEY, LLM_API_KEY, JEV_API_KEY };
