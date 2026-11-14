import { runWithConcurrency } from "./concurrency.js";
import { getPartialDiagnostics } from "./partial-diagnostics.js";

function errorMessage(error) {
  return error?.message || String(error);
}

function fallbackErrorSnapshot(station, error) {
  const collectedAt = Date.now();
  return {
    id: `${station.id}:${collectedAt}`,
    stationId: station.id,
    stationName: station.name,
    collectedAt,
    status: "error",
    source: station.adapter?.kind || "unknown",
    normalized: { sourceFormat: "error", data: [], group_ratio: {} },
    error: errorMessage(error)
  };
}

async function persistErrorSnapshot({ station, error, getSnapshots, errorSnapshot, putSnapshot }) {
  let message = errorMessage(error);
  let previous;
  try {
    previous = (await getSnapshots({ stationId: station.id, limit: 1 }))[0];
  } catch (previousError) {
    message += `；读取上一条快照失败：${errorMessage(previousError)}`;
  }
  let snapshot;
  try {
    snapshot = errorSnapshot(station, new Error(message), previous);
  } catch (snapshotError) {
    snapshot = fallbackErrorSnapshot(station, new Error(`${message}；错误快照构造失败：${errorMessage(snapshotError)}`));
  }
  try {
    await putSnapshot(snapshot);
  } catch (saveError) {
    snapshot.error = `${snapshot.error}；错误快照保存失败：${errorMessage(saveError)}`;
  }
  return snapshot;
}

export async function runRefreshAll({
  forceReferences = false,
  stationId,
  stationIds,
  sourceTabId,
  concurrency = 3,
  getStations,
  getValue,
  refreshOfficialReferences,
  collect,
  putSnapshot,
  getSnapshots,
  errorSnapshot,
  notifyProgress
}) {
  const selectedStationIds = Array.isArray(stationIds) ? new Set(stationIds) : stationId ? new Set([stationId]) : null;
  const allStations = (await getStations()).filter(station => station.enabled === true && (!selectedStationIds || selectedStationIds.has(station.id)));
  const startedAt = Date.now();
  const total = allStations.length;
  const results = new Array(total);
  notifyProgress({ phase: "start", total, completed: 0 });

  if (!total) {
    const references = await getValue("references", {});
    const summary = { total: 0, successCount: 0, errorCount: 0, totalModels: 0, durationMs: Date.now() - startedAt };
    notifyProgress({ phase: "complete", total, completed: 0, summary });
    return { results, references, summary };
  }
  notifyProgress({ phase: "references", status: "running", total, completed: 0, message: "正在确认官方参考价" });
  let references;
  try {
    references = await refreshOfficialReferences(forceReferences);
  } catch (error) {
    notifyProgress({ phase: "error", total, completed: 0, message: `官方参考价查询失败：${errorMessage(error)}` });
    throw error;
  }
  notifyProgress({ phase: "references", status: "success", total, completed: 0, message: "官方参考价已就绪" });

  let completed = 0;
  const reportStation = (station, snapshot, index, slot, stationStartedAt) => {
    results[index] = snapshot;
    completed += 1;
    const partialMessage = getPartialDiagnostics(snapshot.normalized).message;
    notifyProgress({
      phase: "station",
      status: snapshot.status === "success" ? "success" : snapshot.status === "partial" ? "partial" : "error",
      total,
      completed,
      current: slot,
      stationId: station.id,
      stationName: station.name,
      modelCount: snapshot.normalized?.data?.length || 0,
      unsupportedBillingModes: snapshot.normalized?.unsupportedBillingModes || [],
      invalidPricingValues: snapshot.normalized?.invalidPricingValues || [],
      unpricedModels: snapshot.normalized?.unpricedModels || [],
      durationMs: Date.now() - stationStartedAt,
      error: snapshot.error || (snapshot.status === "partial" ? partialMessage : "")
    });
    return snapshot;
  };

  const settledResults = await runWithConcurrency(allStations, concurrency, async (station, index, slot) => {
    const stationStartedAt = Date.now();
    notifyProgress({ phase: "station", status: "running", total, completed, current: slot, stationId: station.id, stationName: station.name });
    let snapshot;
    try {
      snapshot = await collect(station, sourceTabId);
      await putSnapshot(snapshot);
    } catch (error) {
      snapshot = await persistErrorSnapshot({ station, error, getSnapshots, errorSnapshot, putSnapshot });
    }
    return reportStation(station, snapshot, index, slot, stationStartedAt);
  });

  for (const [index, result] of settledResults.entries()) {
    if (result?.status === "fulfilled") continue;
    const station = allStations[index];
    const snapshot = await persistErrorSnapshot({
      station,
      error: result?.reason || new Error("站点刷新任务未完成"),
      getSnapshots,
      errorSnapshot,
      putSnapshot
    });
    reportStation(station, snapshot, index, result?.slot || 0, result?.startedAt || Date.now());
  }

  const summary = {
    total,
    successCount: results.filter(snapshot => snapshot.status === "success").length,
    partialCount: results.filter(snapshot => snapshot.status === "partial").length,
    errorCount: results.filter(snapshot => !["success", "partial"].includes(snapshot.status)).length,
    totalModels: results.reduce((count, snapshot) => count + (snapshot.normalized?.data?.length || 0), 0),
    durationMs: Date.now() - startedAt
  };
  notifyProgress({ phase: "complete", total, completed, summary });
  return { results, references, summary };
}
