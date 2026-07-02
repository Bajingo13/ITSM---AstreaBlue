function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function calculateStraightLine(asset, asOf = new Date()) {
  const purchaseCost = number(asset.purchase_price);
  const salvageValue = Math.min(number(asset.salvage_value), purchaseCost);
  const usefulLifeYears = Math.max(number(asset.useful_life_years, 5), 0.01);
  const startValue = asset.depreciation_start_date || asset.purchase_date;
  const purchaseDate = startValue ? new Date(startValue) : null;
  const monthsElapsed = purchaseDate && !Number.isNaN(purchaseDate.getTime())
    ? Math.max(0, (asOf.getFullYear() - purchaseDate.getFullYear()) * 12 + asOf.getMonth() - purchaseDate.getMonth())
    : 0;
  const usefulLifeMonths = Math.max(1, Math.round(usefulLifeYears * 12));
  const annualDepreciation = Math.max(0, (purchaseCost - salvageValue) / usefulLifeYears);
  const monthlyDepreciation = annualDepreciation / 12;
  const accumulatedDepreciation = Math.min(
    Math.max(0, purchaseCost - salvageValue),
    monthlyDepreciation * monthsElapsed
  );
  const currentBookValue = Math.max(salvageValue, purchaseCost - accumulatedDepreciation);
  const endOfLifeDate = purchaseDate
    ? new Date(purchaseDate.getFullYear(), purchaseDate.getMonth() + usefulLifeMonths, purchaseDate.getDate())
    : null;

  return {
    purchase_cost: purchaseCost,
    annual_depreciation: annualDepreciation,
    monthly_depreciation: monthlyDepreciation,
    accumulated_depreciation: accumulatedDepreciation,
    current_book_value: currentBookValue,
    months_elapsed: monthsElapsed,
    remaining_useful_life_months: Math.max(0, usefulLifeMonths - monthsElapsed),
    fully_depreciated: monthsElapsed >= usefulLifeMonths,
    end_of_life_date: endOfLifeDate?.toISOString() || null,
  };
}

module.exports = { calculateStraightLine };
