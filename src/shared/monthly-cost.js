import * as rust from "./rust-shim.js";

// Select the single monthly amount used for display, sorting, and ranking.
export function effectiveMonthlyCost(row) {
  return rust.effectiveMonthlyCost(row);
}
