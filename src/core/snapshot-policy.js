import { NORMALIZATION_VERSION } from "./normalizers.js";

export function snapshotNeedsRefresh(_station, snapshot = {}) {
  return Number(snapshot.normalizationVersion || 0) < NORMALIZATION_VERSION;
}
