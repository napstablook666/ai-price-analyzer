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


// 页码输入框解析：空值或非数字返回 null（留在原页），数字夹到 1..pageCount，返回零基页码。
export function parsePageInput(raw, pageCount) {
  const text = String(raw ?? "").trim();
  const target = Math.trunc(Number(text));
  if (!text || !Number.isFinite(target)) return null;
  const total = Math.max(1, Math.trunc(Number(pageCount)) || 0);
  return Math.min(Math.max(1, target), total) - 1;
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
    return bandStart ? "model-band-start" : "";
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
  rows.forEach((row, position) => {
    if (row?.stationCategory === "public" || row?.pricingUnavailable) return;
    // 有充值阶梯的站按落档后的实付金额排名，否则名次会和表里显示的金额对不上。
    // 生图行的人民币成本单独算过一版，和按月 token 摊出来的不是同一个数，优先用它。
    const rawMonthlyCost = row?.billingMode === "image"
      ? (Number.isFinite(row?.imageMonthlyCostPaid) ? row.imageMonthlyCostPaid : row?.imageMonthlyCost)
      : (Number.isFinite(row?.monthlyCostPaid) ? row.monthlyCostPaid : row?.monthlyCost);
    if (rawMonthlyCost === null || rawMonthlyCost === undefined || rawMonthlyCost === "") return;
    const monthlyCost = Number(rawMonthlyCost);
    const key = monthlyCostModelKey(row);
    if (!Number.isFinite(monthlyCost) || monthlyCost < 0 || !key) return;
    if (!byModel.has(key)) byModel.set(key, []);
    // position 是这条报价在当前筛选结果里的下标，浮层点一下就能跳回那一页。
    byModel.get(key).push({ row, monthlyCost, position });
  });
  for (const [key, entries] of byModel) {
    entries.sort((left, right) => left.monthlyCost - right.monthlyCost);
    // 名次就是列表里的第几条，同价也按先后顺序编号，不再并排成两个 #1。
    byModel.set(key, entries.map((entry, index) => ({ ...entry, rank: index + 1 })));
  }
  return byModel;
}

// 浮层里给出同模型的完整排名，不截断；浮现时由调用方把当前那条滚到可见区。
export function monthlyCostRankingFor(row, rankings) {
  const entries = rankings?.get(monthlyCostModelKey(row)) || [];
  const current = entries.find(entry => entry.row === row);
  return {
    rank: current?.rank ?? null,
    total: entries.length,
    baseline: entries.at(-1)?.monthlyCost || 0,
    entries
  };
}
// 付费与公益是两套数据集：站点、供应商、分组、模型筛选在另一种模式里不存在，
// 沿用过去会被 sanitizeFiltersForRows 裁成空集合，报价被静默筛光。切模式时一起重置。
// providerFilter 传 null 表示全选；具体值由 dashboard 从 localStorage 的记忆里取，代码里不写死名单。
export function modeSwitchFilters(filters = {}, providerFilter = null) {
  return { ...filters, search: "", stationId: "", provider: Array.isArray(providerFilter) ? [...providerFilter] : null, group: null, models: [] };
}

export function mediaModeSwitchFilters(filters = {}, mediaMode = "text", providerFilter = null) {
  const next = modeSwitchFilters(filters, providerFilter);
  const mode = ["text", "image", "video"].includes(mediaMode) ? mediaMode : "text";
  return {
    ...next,
    provider: mode === "text" ? next.provider : null,
    sortBy: mode === "text" ? "blendedUnitPrice" : "mediaUnitPrice",
    sortSecondary: "diffPercent",
    sortDirection: "asc"
  };
}