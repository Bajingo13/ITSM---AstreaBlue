function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function calculateStraightLine(asset, asOf = new Date()) {
  const purchaseCost = number(asset.purchase_price);
  const salvageValue = Math.min(number(asset.salvage_value), purchaseCost);
  const usefulLifeYears = Math.max(number(asset.useful_life_years, 5), 0.01);
  const purchaseDate = asset.purchase_date ? new Date(asset.purchase_date) : null;
  const elapsedMs = purchaseDate && !Number.isNaN(purchaseDate.getTime())
    ? Math.max(0, asOf.getTime() - purchaseDate.getTime())
    : 0;
  const assetAgeYears = elapsedMs / (365.25 * 24 * 60 * 60 * 1000);
  const annualDepreciation = Math.max(0, (purchaseCost - salvageValue) / usefulLifeYears);
  const accumulatedDepreciation = Math.min(
    Math.max(0, purchaseCost - salvageValue),
    annualDepreciation * assetAgeYears
  );
  const currentBookValue = Math.max(salvageValue, purchaseCost - accumulatedDepreciation);
  const endOfLifeDate = purchaseDate
    ? new Date(purchaseDate.getTime() + usefulLifeYears * 365.25 * 24 * 60 * 60 * 1000)
    : null;

  return {
    purchase_cost: purchaseCost,
    annual_depreciation: annualDepreciation,
    monthly_depreciation: annualDepreciation / 12,
    accumulated_depreciation: accumulatedDepreciation,
    current_book_value: currentBookValue,
    asset_age_years: assetAgeYears,
    remaining_useful_life_years: Math.max(0, usefulLifeYears - assetAgeYears),
    end_of_life_date: endOfLifeDate?.toISOString() || null,
  };
}

module.exports = { calculateStraightLine };
