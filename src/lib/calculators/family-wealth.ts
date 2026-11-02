/**
 * Young Couple / Family Wealth Plan (EFP "Freedom Wealth Solutions" workbook).
 *
 * Projects a lumpsum + monthly SIP split across asset classes (Equity / Hybrid /
 * Debt / Others), each compounding at its own return, year by year to a total
 * fund value. Faithful to the workbook:
 *   closingₖ = (openingₖ + annual SIPₖ) × (1 + RoRₖ);  openingₖ = prior closing;
 *   year-1 opening = the class's lumpsum allocation. Verified to the rupee
 *   (year-1 total ₹18,85,300 on the reference inputs).
 */

export type AssetClassInput = { name: string; allocationPct: number; returnPct: number };

export type FamilyWealthYear = {
  year: number;
  age: number;
  total: number;
  byClass: number[];
};

export type FamilyWealthResult = {
  years: number;
  totalInvested: number;
  finalTotal: number;
  finalByClass: number[];
  series: FamilyWealthYear[];
  blendedReturnPct: number;
  allocationSumPct: number; // raw sum of allocations entered (to flag ≠ 100)
};

export function familyWealthPlan(input: {
  lumpsum: number;
  monthlySip: number;
  currentAge: number;
  targetAge: number;
  classes: AssetClassInput[];
}): FamilyWealthResult {
  const years = Math.max(0, Math.round(input.targetAge - input.currentAge));
  const alloc = (c: AssetClassInput) => Math.max(0, c.allocationPct || 0); // no negative weights
  const allocationSumPct = input.classes.reduce((s, c) => s + alloc(c), 0);
  const n = input.classes.length || 1;
  const cls = input.classes.map((c) => ({
    // normalised weight; all-zero allocations split equally (was ÷1 → every weight 0 → ₹0 corpus)
    w: allocationSumPct > 0 ? alloc(c) / allocationSumPct : 1 / n,
    r: c.returnPct / 100,
  }));

  let bal = cls.map((c) => Math.max(0, input.lumpsum) * c.w);
  const series: FamilyWealthYear[] = [
    { year: 0, age: input.currentAge, total: bal.reduce((a, b) => a + b, 0), byClass: [...bal] },
  ];
  for (let y = 1; y <= years; y++) {
    bal = bal.map((b, i) => (b + Math.max(0, input.monthlySip) * cls[i].w * 12) * (1 + cls[i].r));
    series.push({ year: y, age: input.currentAge + y, total: bal.reduce((a, b) => a + b, 0), byClass: [...bal] });
  }

  const finalByClass = [...bal];
  const finalTotal = bal.reduce((a, b) => a + b, 0);
  const totalInvested = Math.max(0, input.lumpsum) + Math.max(0, input.monthlySip) * 12 * years;
  const blendedReturnPct = cls.reduce((s, c, i) => s + c.w * input.classes[i].returnPct, 0);

  return { years, totalInvested, finalTotal, finalByClass, series, blendedReturnPct, allocationSumPct };
}
