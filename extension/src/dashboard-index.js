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