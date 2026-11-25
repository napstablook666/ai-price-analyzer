const KEY = "ai-price-analyzer:tokens";

// 续期状态与凭据同键同区存，避免两处状态不同步。
// expiresAt / lastRenewedAt 都是毫秒时间戳，与 service-worker.js:135 的 Date.now() 比较口径一致。
const RENEWAL_DEFAULTS = Object.freeze({
  expiresAt: null,
  refreshToken: "",
  lastRenewedAt: null,
  renewFailures: 0,
  status: "unknown"
});

const CREDENTIAL_STATUSES = new Set(["unknown", "ok", "needsLogin"]);

function positiveOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

// 旧格式（裸字符串、只有三段）读出来补齐默认值，但不回写，除非调用方明确要写。
function normalizeCredential(value) {
  if (typeof value === "string") return { token: value, identity: "", username: "", password: "", ...RENEWAL_DEFAULTS };
  const failures = Number(value?.renewFailures);
  return {
    token: String(value?.token || ""),
    identity: String(value?.identity || ""),
    username: String(value?.username || ""),
    password: String(value?.password || ""),
    expiresAt: positiveOrNull(value?.expiresAt),
    refreshToken: String(value?.refreshToken || ""),
    lastRenewedAt: positiveOrNull(value?.lastRenewedAt),
    renewFailures: Number.isFinite(failures) && failures > 0 ? Math.floor(failures) : 0,
    status: CREDENTIAL_STATUSES.has(value?.status) ? value.status : RENEWAL_DEFAULTS.status
  };
}

function pickRenewal(value) {
  return Object.fromEntries(Object.keys(RENEWAL_DEFAULTS).map(key => [key, value?.[key] ?? RENEWAL_DEFAULTS[key]]));
}

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
  const credentials = Object.fromEntries(
    Object.entries(raw).map(([stationId, value]) => [stationId, normalizeCredential(value)])
  );
  return { area: writeArea(chromeApi), credentials };
}

export async function setStationCredential(stationId, credential = {}, chromeApi = globalThis.chrome) {
  const { area, credentials } = await readStationCredentials(chromeApi);
  if (!area) return;
  // 只替换四段认证字段，续期状态沿用仓里已有的，避免采集把 expiresAt 冲掉。
  // identity 是 New-API 那类站的用户 ID（New-Api-User 头），不参与过期，但要能无头取到才探得了活。
  const value = {
    ...normalizeCredential(credentials[stationId]),
    token: String(credential.token || ""),
    ...(credential.identity === undefined ? {} : { identity: String(credential.identity || "") }),
    username: String(credential.username || ""),
    password: String(credential.password || "")
  };
  if (value.token || value.identity || value.username || value.password) credentials[stationId] = value;
  else delete credentials[stationId];
  await area.set({ [KEY]: credentials });
  await clearSessionValue(chromeApi, KEY, area);
}

// 一次给出三段凭据加续期状态：续期执行器要 token、refreshToken、expiresAt 与计数一起看，
// 分两次读会拿到不一致的快照。旧调用方只读 token / username / password，超集不影响。
export async function getStationCredential(stationId, chromeApi = globalThis.chrome) {
  const { credentials } = await readStationCredentials(chromeApi);
  return credentials[stationId] || normalizeCredential(undefined);
}

export async function removeStationCredential(stationId, chromeApi = globalThis.chrome) {
  return setStationCredential(stationId, {}, chromeApi);
}

// 续期状态可以独立落盘：只靠 cookie 认人的站（没有存过 token）也要能记 ok / needsLogin。
export async function setStationRenewal(stationId, patch = {}, chromeApi = globalThis.chrome) {
  const { area, credentials } = await readStationCredentials(chromeApi);
  if (!area) return null;
  const existing = credentials[stationId];
  const value = normalizeCredential({ ...existing, ...pickRenewal({ ...existing, ...patch }) });
  credentials[stationId] = value;
  await area.set({ [KEY]: credentials });
  await clearSessionValue(chromeApi, KEY, area);
  return pickRenewal(value);
}

export async function getStationRenewal(stationId, chromeApi = globalThis.chrome) {
  const { credentials } = await readStationCredentials(chromeApi);
  return pickRenewal(credentials[String(stationId || "")]);
}

// 只清续期状态，不动 token / identity / username / password：重新登录前先把它置回未知，
// 免得面板继续显示「已登录」。那四段是另外的事。
export async function clearStationRenewal(stationId, chromeApi = globalThis.chrome) {
  const { area, credentials } = await readStationCredentials(chromeApi);
  if (!area) return null;
  const id = String(stationId || "");
  const existing = credentials[id];
  if (!existing) return pickRenewal(undefined);
  const value = normalizeCredential({ ...existing, ...RENEWAL_DEFAULTS });
  credentials[id] = value;
  await area.set({ [KEY]: credentials });
  await clearSessionValue(chromeApi, KEY, area);
  return pickRenewal(value);
}

// 保活排期要一次看到全站的续期状态，逐站读会把仓读 N 遍。
export async function listStationRenewals(chromeApi = globalThis.chrome) {
  const { credentials } = await readStationCredentials(chromeApi);
  return Object.entries(credentials)
    .map(([stationId, value]) => ({ stationId, ...pickRenewal(value) }))
    .sort((left, right) => left.stationId.localeCompare(right.stationId));
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

