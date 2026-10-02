import { normalizeSettings } from "./schema.js";
const DB_NAME = "ai-relay-price-comparison";
const DB_VERSION = 1;

const MAX_IMPORTED_SNAPSHOTS = 500;
const MAX_IMPORTED_RECORD_BYTES = 2 * 1024 * 1024;
let comparisonRevision = 0;

export function getComparisonRevision() {
  return comparisonRevision;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isValidSnapshot(snapshot) {
  if (!isPlainObject(snapshot) || typeof snapshot.id !== "string" || typeof snapshot.stationId !== "string") return false;
  if (!Number.isFinite(Number(snapshot.collectedAt)) || !isPlainObject(snapshot.normalized) || !Array.isArray(snapshot.normalized.data) || !snapshot.normalized.data.every(isPlainObject)) return false;
  try { return JSON.stringify(snapshot).length <= MAX_IMPORTED_RECORD_BYTES; } catch { return false; }
}
function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
}

function compareSnapshotIds(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortSnapshots(rows) {
  return rows.sort((left, right) => Number(right.collectedAt) - Number(left.collectedAt) || compareSnapshotIds(left.id, right.id));
}

function latestSnapshotsFromRows(rows, stationIds, isUsable) {
  const latest = new Map();
  for (const snapshot of rows) {
    if (!stationIds.has(snapshot.stationId) || !isValidSnapshot(snapshot) || !isUsable(snapshot)) continue;
    const previous = latest.get(snapshot.stationId);
    const collectedAt = Number(snapshot.collectedAt);
    if (!previous || collectedAt > Number(previous.collectedAt) || (collectedAt === Number(previous.collectedAt) && compareSnapshotIds(snapshot.id, previous.id) < 0)) latest.set(snapshot.stationId, snapshot);
  }
  return sortSnapshots([...latest.values()]);
}

function pruneSnapshots(index, query, shouldDelete) {
  return new Promise((resolve, reject) => {
    const request = index.openCursor(query);
    request.onerror = () => reject(request.error || new Error("Unable to prune snapshots"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      if (shouldDelete(cursor.value)) cursor.delete();
      cursor.continue();
    };
  });
}

export function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("stations")) db.createObjectStore("stations", { keyPath: "id" });
      if (!db.objectStoreNames.contains("snapshots")) {
        const store = db.createObjectStore("snapshots", { keyPath: "id" });
        store.createIndex("stationId", "stationId");
        store.createIndex("collectedAt", "collectedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open IndexedDB"));
  });
}

export async function withStore(storeName, mode, callback) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    let result;
    let transaction;
    try {
      transaction = db.transaction(storeName, mode);
      result = callback(transaction.objectStore(storeName));
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = () => { db.close(); reject(transaction.error || new Error("IndexedDB transaction failed")); };
    transaction.onabort = () => { db.close(); reject(transaction.error || new Error("IndexedDB transaction aborted")); };
  });
}

export async function getValue(key, fallback = null) {
  const value = await withStore("kv", "readonly", store => requestToPromise(store.get(key)));
  return value === undefined ? fallback : value;
}

export async function setValue(key, value) {
  const result = await withStore("kv", "readwrite", store => requestToPromise(store.put(value, key)));
  if (key === "settings" || key === "references") comparisonRevision++;
  return result;
}

export async function getStations() {
  const stations = await withStore("stations", "readonly", store => requestToPromise(store.getAll()));
  return stations.map(redactStation);
}

export async function putStations(stations) {
  comparisonRevision++;
  try {
    const current = await getStations();
    const wanted = new Set(stations.map(station => station.id));
    for (const station of current) if (!wanted.has(station.id)) await withStore("stations", "readwrite", store => requestToPromise(store.delete(station.id)));
    for (const station of stations) await withStore("stations", "readwrite", store => requestToPromise(store.put(redactStation(station))));
  } finally {
    comparisonRevision++;
  }
}

export function addStationIfNeeded(createStation) {
  return withStore("stations", "readwrite", store => new Promise((resolve, reject) => {
    const lookup = store.getAll();
    lookup.onerror = () => reject(lookup.error || new Error("Unable to read stations"));
    lookup.onsuccess = () => {
      let station;
      try { station = createStation(lookup.result); } catch (error) { reject(error); return; }
      if (!station) return resolve(false);
      const request = store.add(redactStation(station));
      request.onsuccess = () => { comparisonRevision++; resolve(true); };
      request.onerror = () => reject(request.error || new Error("Unable to add station"));
    };
  }));
}

export async function getSnapshots({ stationId, limit = 50 } = {}) {
  const rows = await withStore("snapshots", "readonly", store => requestToPromise(stationId ? store.index("stationId").getAll(stationId) : store.getAll()));
  return sortSnapshots(rows.filter(row => isValidSnapshot(row) && (!stationId || row.stationId === stationId))).slice(0, limit);
}

export async function getLatestSnapshots(stationIds, isUsable = () => true) {
  const targets = new Set(stationIds);
  if (!targets.size) return [];
  return withStore("snapshots", "readonly", store => new Promise((resolve, reject) => {
    const request = store.index("collectedAt").openCursor(null, "prev");
    const latest = new Map();
    request.onerror = () => reject(request.error || new Error("Unable to read latest snapshots"));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve(sortSnapshots([...latest.values()]));
      const snapshot = cursor.value;
      if (typeof snapshot?.collectedAt !== "number") {
        const fallback = store.getAll();
        fallback.onerror = () => reject(fallback.error || new Error("Unable to read snapshots"));
        fallback.onsuccess = () => {
          try { resolve(latestSnapshotsFromRows(fallback.result, targets, isUsable)); }
          catch (error) { reject(error); }
        };
        return;
      }
      if (latest.size === targets.size) {
        let oldestLatest = Infinity;
        for (const item of latest.values()) oldestLatest = Math.min(oldestLatest, Number(item.collectedAt));
        if (snapshot.collectedAt < oldestLatest) return resolve(sortSnapshots([...latest.values()]));
      }
      if (targets.has(snapshot.stationId)) {
        const previous = latest.get(snapshot.stationId);
        const collectedAt = Number(snapshot.collectedAt);
        if ((!previous || collectedAt >= Number(previous.collectedAt)) && isValidSnapshot(snapshot) && isUsable(snapshot) && (!previous || collectedAt > Number(previous.collectedAt) || compareSnapshotIds(snapshot.id, previous.id) < 0)) latest.set(snapshot.stationId, snapshot);
      }
      cursor.continue();
    };
  }));
}

export function putSnapshot(snapshot) {
  if (!isValidSnapshot(snapshot)) throw new Error("快照格式不正确");
  return withStore("snapshots", "readwrite", store => new Promise((resolve, reject) => {
    const request = store.put(snapshot);
    request.onerror = () => reject(request.error || new Error("Unable to save snapshot"));
    request.onsuccess = () => {
      comparisonRevision++;
      const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      Promise.all([
        pruneSnapshots(store.index("collectedAt"), IDBKeyRange.upperBound(cutoff), value => Number(value.collectedAt) < cutoff),
        pruneSnapshots(store.index("collectedAt"), IDBKeyRange.lowerBound(""), value => Number.isFinite(Number(value.collectedAt)) && Number(value.collectedAt) < cutoff)
      ]).then(resolve, reject);
    };
  }));
}

export async function clearSnapshots() {
  const result = await withStore("snapshots", "readwrite", store => requestToPromise(store.clear()));
  comparisonRevision++;
  return result;
}

export function redactStation(station = {}) {
  const { auth = {}, ...rest } = station;
  return { ...rest, auth: { type: auth.type || "none" } };
}

export async function exportState() {
  return {
    version: 1,
    exportedAt: Date.now(),
    settings: normalizeSettings(await getValue("settings", {})),
    references: await getValue("references"),
    stations: (await getStations()).map(redactStation),
    snapshots: await getSnapshots({ limit: 500 })
  };
}

export async function importState(state) {
  if (!state || !Array.isArray(state.stations) || state.stations.length > 100) throw new Error("导入文件格式不正确");
  const snapshots = state.snapshots === undefined ? [] : state.snapshots;
  if (!Array.isArray(snapshots) || snapshots.length > MAX_IMPORTED_SNAPSHOTS || snapshots.some(snapshot => !isValidSnapshot(snapshot))) throw new Error("导入快照格式不正确");
  if (state.references !== undefined && state.references !== null && (!isPlainObject(state.references) || JSON.stringify(state.references).length > MAX_IMPORTED_RECORD_BYTES)) throw new Error("导入参考数据过大或格式不正确");
  await clearSnapshots();
  await putStations(state.stations.map(redactStation));
  if (state.settings) await setValue("settings", normalizeSettings(state.settings));
  if (state.references) await setValue("references", state.references);
  for (const snapshot of snapshots) await putSnapshot(snapshot);
}
