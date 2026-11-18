// 站点落库的合并规则：只认「显式删除」，传入数组里缺席不代表删除。
// 页面拿的是打开时的快照，插件安装/卸载、导入、另一个标签页都会在它背后改库，
// 用快照覆盖全库会把别人刚写进去的站点抹掉，所以这里按 id 合并。
export function mergeStationSave(current = [], upserts = [], removedIds = []) {
  const removed = new Set((Array.isArray(removedIds) ? removedIds : []).map(id => String(id ?? "").trim()).filter(Boolean));
  const pending = new Map((Array.isArray(upserts) ? upserts : []).map(station => [station.id, station]));
  const merged = [];
  // 顺序沿用库里原有顺序，被覆盖的原地替换，新增的追加到末尾，列表不会因为一次开关跳动。
  for (const station of Array.isArray(current) ? current : []) {
    if (removed.has(station.id)) {
      pending.delete(station.id);
      continue;
    }
    merged.push(pending.get(station.id) || station);
    pending.delete(station.id);
  }
  for (const [id, station] of pending) {
    if (removed.has(id)) continue;
    merged.push(station);
  }
  return merged;
}
