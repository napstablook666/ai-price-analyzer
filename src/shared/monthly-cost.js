// Select the single monthly amount used for display, sorting, and ranking.
export function effectiveMonthlyCost(row) {
  return Number.isFinite(row?.monthlyCostPaid) ? row.monthlyCostPaid : row?.monthlyCost;
}
