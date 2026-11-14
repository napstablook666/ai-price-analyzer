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
// 价格分布图：按规范模型分组，每站一根横柱，官方混合单价画参考线。
// 只收付费站且有可算混合单价的 offer；同站同模型多档位取最低那档，避免同一模型出现重复柱。
export function buildChartGroups(rows = [], { maxGroups = 12 } = {}) {
  const limit = Math.max(1, Math.trunc(Number(maxGroups)) || 1);
  const byModel = new Map();
  for (const row of rows) {
    if (row.stationCategory === "public" || row.pricingUnavailable) continue;
    const price = Number(row.blendedUnitPrice);
    if (!Number.isFinite(price) || price <= 0) continue;
    const key = row.canonicalModel || row.modelName || "";
    if (!key) continue;
    let group = byModel.get(key);
    if (!group) {
      group = {
        canonicalModel: key,
        displayName: row.officialName || row.displayName || row.modelName || key,
        provider: row.provider || "",
        officialBlendedUnitPrice: null,
        bars: new Map()
      };
      byModel.set(key, group);
    } else if (!group.displayName && row.officialName) {
      group.displayName = row.officialName;
    }
    const official = Number(row.officialBlendedUnitPrice);
    if (group.officialBlendedUnitPrice === null && Number.isFinite(official) && official > 0) {
      group.officialBlendedUnitPrice = official;
    }
    const existing = group.bars.get(row.stationId);
    if (existing && existing.blendedUnitPrice <= price) continue;
    group.bars.set(row.stationId, {
      stationId: row.stationId,
      stationName: row.stationName,
      blendedUnitPrice: price,
      diffPercent: Number.isFinite(Number(row.diffPercent)) ? Number(row.diffPercent) : null,
      category: row.category || ""
    });
  }

  const groups = [];
  for (const group of byModel.values()) {
    const bars = [...group.bars.values()].sort((left, right) => left.blendedUnitPrice - right.blendedUnitPrice);
    if (!bars.length) continue;
    const official = group.officialBlendedUnitPrice;
    const baseline = Math.max(...bars.map(bar => bar.blendedUnitPrice));
    for (const bar of bars) bar.widthPercent = baseline > 0 ? bar.blendedUnitPrice / baseline * 100 : 0;
    const lowest = bars[0].blendedUnitPrice;
    groups.push({
      canonicalModel: group.canonicalModel,
      displayName: group.displayName,
      provider: group.provider,
      officialBlendedUnitPrice: official,
      // 官方价只在没有超过轨道满格时才有位置可画；超出说明全站都比官方便宜
      officialLeftPercent: official > 0 && official <= baseline ? official / baseline * 100 : null,
      savingRatio: official > 0 ? 1 - lowest / official : Number.NEGATIVE_INFINITY,
      bars
    });
  }
  groups.sort((left, right) => (right.savingRatio - left.savingRatio) || String(left.displayName).localeCompare(String(right.displayName)));
  return { groups: groups.slice(0, limit), totalGroups: groups.length };
}