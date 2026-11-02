/**
 * Equity LTCG Tax-Harvesting — math engine.
 *
 * Long-term capital gains on equity/equity MF are exempt up to ₹1.25 lakh per
 * year; gains above that are taxed at 12.5%. "Harvesting" means redeeming and
 * immediately re-buying enough units each year to realise gains within the
 * exemption tax-free, stepping up the cost base — so less gain is taxed at the
 * end.
 *
 * Model: same portfolio growth either way; harvesting only resets the cost
 * base. Compares total tax with vs without harvesting and the cumulative
 * tax-free gains banked.
 */

export const LTCG_EXEMPTION = 125000;
export const LTCG_RATE = 0.125;

export type HarvestInput = {
  investment: number;
  expectedReturnPct: number;
  years: number;
  exemptionPerYear: number; // default 1.25L
  ltcgRatePct: number; // default 12.5
};

export type HarvestYearRow = {
  year: number;
  value: number;
  unrealizedGain: number;
  harvested: number; // realised tax-free this year
  costBase: number;
};

export type HarvestResult = {
  finalValue: number;
  taxWithoutHarvesting: number;
  taxWithHarvesting: number;
  taxSaved: number;
  totalHarvestedTaxFree: number;
  rows: HarvestYearRow[];
};

export function computeTaxHarvesting(input: HarvestInput): HarvestResult {
  const r = input.expectedReturnPct / 100;
  const n = Math.max(0, Math.round(input.years));
  // A typed 0 means no exemption; only a missing/invalid value falls back.
  const exemption = Number.isFinite(input.exemptionPerYear) ? Math.max(0, input.exemptionPerYear) : LTCG_EXEMPTION;
  const rate = input.ltcgRatePct / 100;

  let value = input.investment;
  let costBase = input.investment;
  let totalHarvested = 0;
  const rows: HarvestYearRow[] = [];

  for (let y = 1; y <= n; y++) {
    value *= 1 + r;
    const unrealized = value - costBase;
    const harvested = Math.max(0, Math.min(unrealized, exemption));
    costBase += harvested; // re-buy at the higher cost
    totalHarvested += harvested;
    rows.push({ year: y, value, unrealizedGain: unrealized, harvested, costBase });
  }

  // The final redemption falls in year n, whose exemption the loop already
  // used (that row's "harvested" is the exempt part of the sale) — so the rest
  // is fully taxable; claiming the exemption again would count it twice.
  const finalUnrealized = value - costBase;
  const taxWithHarvesting = Math.max(0, finalUnrealized) * rate;

  // Without harvesting: hold throughout, redeem at the end.
  const finalValueNoHarvest = input.investment * Math.pow(1 + r, n);
  const gainNoHarvest = finalValueNoHarvest - input.investment;
  const taxWithoutHarvesting = Math.max(0, gainNoHarvest - exemption) * rate;

  return {
    finalValue: value,
    taxWithoutHarvesting,
    taxWithHarvesting,
    taxSaved: Math.max(0, taxWithoutHarvesting - taxWithHarvesting),
    totalHarvestedTaxFree: totalHarvested,
    rows,
  };
}
