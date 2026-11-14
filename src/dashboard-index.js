export function createDashboardIndex(rows, stations) {
  const searchTextByRow = new WeakMap(rows.map(row => [
    row,
    [row.displayName, row.modelName, row.stationName, row.groupName, row.officialName, row.provider].join(" ").toLowerCase()
  ]));
  const modelTextByRow = new WeakMap(rows.map(row => [
    row,
    [row.modelName, row.displayName, row.displayNameOverride, row.officialName, row.canonicalModel].filter(Boolean).join(" ").toLowerCase()
  ]));
  const stationById = new Map(stations.map(station => [station.id, station]));
  return { searchTextByRow, modelTextByRow, stationById };
}

export function matchesModelQueries(modelText, queries) {
  const active = queries.map(query => query.trim().toLowerCase()).filter(Boolean);
  return !active.length || active.some(query => modelText.includes(query));
}


export function paginateRows(rows, page, pageSize) {
  const size = Math.max(1, Math.trunc(Number(pageSize)) || 1);
  const pageCount = Math.ceil(rows.length / size);
  const currentPage = pageCount ? Math.min(Math.max(0, Math.trunc(Number(page) || 0)), pageCount - 1) : 0;
  return { page: currentPage, pageCount, rows: rows.slice(currentPage * size, (currentPage + 1) * size) };
}

export function rowBandClasses(rows) {
  return rows.map((row, index) => {
    const bandStart = index === 0 || rows[index - 1].canonicalModel !== row.canonicalModel;
    return `row-${index % 2 === 0 ? "even" : "odd"}${bandStart ? " model-band-start" : ""}`;
  });
}
export function deltaTone(diffPercent) {
  const value = Number(diffPercent);
  if (!Number.isFinite(value) || Math.abs(value) < 0.005) return "neutral";
  if (value < -40) return "excellent";
  if (value < -2) return "good";
  if (value > 50) return "bad";
  return "fair";
}



// 月成本条长按同模型最高月成本归一，分页和排序不改变相对长度。
export function monthlyCostBarWidth(value, baseline) {
  if (value === null || value === undefined || value === "") return null;
  const cost = Number(value);
  const max = Number(baseline);
  if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(max) || max <= 0) return null;
  return Math.min(100, cost / max * 100);
}

// 月成本只在同一规范模型内排名，完整筛选结果排序后再截断，分页不影响名次。
export function monthlyCostModelKey(row) {
  return row?.canonicalModel || row?.modelName || row?.displayName || "";
}

export function buildMonthlyCostRankings(rows = []) {
  const byModel = new Map();
  for (const row of rows) {
    if (row?.stationCategory === "public" || row?.pricingUnavailable) continue;
    const rawMonthlyCost = row?.monthlyCost;
    if (rawMonthlyCost === null || rawMonthlyCost === undefined || rawMonthlyCost === "") continue;
    const monthlyCost = Number(rawMonthlyCost);
    const key = monthlyCostModelKey(row);
    if (!Number.isFinite(monthlyCost) || monthlyCost < 0 || !key) continue;
    if (!byModel.has(key)) byModel.set(key, []);
    byModel.get(key).push({ row, monthlyCost });
  }
  for (const [key, entries] of byModel) {
    entries.sort((left, right) => left.monthlyCost - right.monthlyCost);
    let rank = 0;
    byModel.set(key, entries.map((entry, index) => {
      if (index === 0 || entry.monthlyCost !== entries[index - 1].monthlyCost) rank = index + 1;
      return { ...entry, rank };
    }));
  }
  return byModel;
}

export function monthlyCostRankingFor(row, rankings, { limit = 10 } = {}) {
  const entries = rankings?.get(monthlyCostModelKey(row)) || [];
  const topLimit = Math.max(1, Math.trunc(Number(limit)) || 10);
  const current = entries.find(entry => entry.row === row);
  return {
    rank: current?.rank ?? null,
    total: entries.length,
    baseline: entries.at(-1)?.monthlyCost || 0,
    top: entries.slice(0, topLimit)
  };
}