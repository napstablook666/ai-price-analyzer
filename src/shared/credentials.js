const KEY = "ai-price-analyzer:tokens";

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

const MODEL_ASSISTANT_KEY = "ai-price-analyzer:model-assistant-key";

export async function setModelAssistantKey(apiKey, chromeApi = globalThis.chrome) {
  const area = writeArea(chromeApi);
  if (!area) return;
  const value = String(apiKey || "").trim();
  if (value) await area.set({ [MODEL_ASSISTANT_KEY]: value });
  else await area.remove(MODEL_ASSISTANT_KEY);
  await clearSessionValue(chromeApi, MODEL_ASSISTANT_KEY, area);
}

export async function getModelAssistantKey(chromeApi = globalThis.chrome) {
  for (const area of storageAreas(chromeApi)) {
    const values = await area.get(MODEL_ASSISTANT_KEY);
    const value = values?.[MODEL_ASSISTANT_KEY];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

