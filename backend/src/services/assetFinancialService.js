function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function wholeMonthsBetween(startDate, endDate) {
  if (!startDate || Number.isNaN(startDate.getTime())) return 0;
  let months = (endDate.getFullYear() - startDate.getFullYear()) * 12
    + endDate.getMonth() - startDate.getMonth();
  if (endDate.getDate() < startDate.getDate()) months -= 1;
  return Math.max(0, months);
}

function calculateStraightLine(asset, asOf = new Date()) {
  const purchaseCost = number(asset.purchase_price);
  const salvageValue = Math.min(number(asset.salvage_value), purchaseCost);
  const legacyMonths = number(asset.useful_life_years) > 0
    ? Math.round(number(asset.useful_life_years) * 12)
    : 0;
  const usefulLifeMonths = Math.max(1, Math.round(number(asset.useful_life_months, legacyMonths || 36)));
  const startValue = asset.depreciation_start_date || asset.purchase_date;
  const purchaseDate = startValue ? new Date(startValue) : null;
  const lifecycleDate = asset.purchase_date ? new Date(asset.purchase_date) : purchaseDate;
  const monthsElapsed = wholeMonthsBetween(purchaseDate, asOf);
  const lifecycleMonthsElapsed = wholeMonthsBetween(lifecycleDate, asOf);
  const isDepreciable = purchaseCost >= 5000;
  const monthlyDepreciation = isDepreciable
    ? Math.max(0, (purchaseCost - salvageValue) / usefulLifeMonths)
    : 0;
  const annualDepreciation = monthlyDepreciation * 12;
  const accumulatedDepreciation = Math.min(
    Math.max(0, purchaseCost - salvageValue),
    monthlyDepreciation * monthsElapsed
  );
  const currentBookValue = isDepreciable
    ? Math.max(salvageValue, purchaseCost - accumulatedDepreciation)
    : purchaseCost;
  const remainingUsefulLifeMonths = Math.max(0, usefulLifeMonths - monthsElapsed);
  const remainingLifeMonths = Math.max(0, usefulLifeMonths - lifecycleMonthsElapsed);
  const fullyDepreciated = isDepreciable
    && (currentBookValue <= salvageValue || remainingUsefulLifeMonths === 0);
  const lifespanStatus = remainingLifeMonths <= 0
    ? "End of Life"
    : remainingLifeMonths <= 6
      ? "Critical"
      : remainingLifeMonths <= 12
        ? "Near End of Life"
        : "Healthy";
  const depreciationStatus = !isDepreciable
    ? "Expense Item"
    : fullyDepreciated ? "Fully Depreciated" : "Active";
  const endOfLifeDate = lifecycleDate && !Number.isNaN(lifecycleDate.getTime())
    ? new Date(lifecycleDate.getFullYear(), lifecycleDate.getMonth() + usefulLifeMonths, lifecycleDate.getDate())
    : null;

  return {
    purchase_cost: purchaseCost,
    useful_life_months: usefulLifeMonths,
    is_depreciable: isDepreciable,
    asset_financial_classification: isDepreciable ? "Depreciable Asset" : "Expense Item",
    annual_depreciation: annualDepreciation,
    monthly_depreciation: monthlyDepreciation,
    accumulated_depreciation: accumulatedDepreciation,
    current_book_value: currentBookValue,
    months_elapsed: monthsElapsed,
    remaining_useful_life_months: remainingUsefulLifeMonths,
    remaining_life_months: remainingLifeMonths,
    fully_depreciated: fullyDepreciated,
    depreciation_status: depreciationStatus,
    lifespan_status: lifespanStatus,
    end_of_life_date: endOfLifeDate?.toISOString() || null,
    expected_end_of_life: endOfLifeDate?.toISOString() || null,
  };
}

module.exports = { calculateStraightLine };
