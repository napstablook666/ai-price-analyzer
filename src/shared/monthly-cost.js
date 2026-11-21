// Select the single monthly amount used for display, sorting, and ranking.
// Image quotes carry separate image totals; other billing modes use the token/request total.
export function effectiveMonthlyCost(row) {
  if (row?.billingMode === "image") {
    return Number.isFinite(row?.imageMonthlyCostPaid) ? row.imageMonthlyCostPaid : row?.imageMonthlyCost;
  }
  return Number.isFinite(row?.monthlyCostPaid) ? row.monthlyCostPaid : row?.monthlyCost;
}
