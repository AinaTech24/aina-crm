/**
 * Debt Fund (Hold vs Sell) Benefit Calculator — math engine.
 *
 * Debt funds (under the indexation regime) attract a lower long-term capital
 * gains tax with indexation if held past the LTCG qualification period (3 years).
 * Sell before that and the gain is taxed at the slab rate. This compares:
 *   • SELL TODAY — short-term gain taxed at the slab rate, and
 *   • HOLD to LTCG — value grows for the remaining period, gain is reduced by
 *     indexation and taxed at the (lower) LTCG rate.
 *
 * The headline is the EFFECTIVE post-tax return earned over just the remaining
 * holding period — usually far above the market return, because most of the gain
 * is the tax saved by waiting.
 *
 * CONVENTIONS — actual-days/365 compounding; indexation applied over the whole
 * years held to qualification. Calibrated to the reference case study to the
 * rupee:
 *   ₹10,00,000 on 20/07/2020 · value ₹12,00,000 on 14/11/2022 · index 5% ·
 *   remaining return 6% · ST 30% · LT 20% →
 *     sell today: tax ₹60,000 · net ₹11,40,000 · yield 5.81%
 *     hold to 21/07/2023: redeem ₹12,48,661 · LTCG ₹91,036 · tax ₹18,207 ·
 *     net ₹12,30,454 · yield 7.15% · effective remaining yield 11.84%.
 *
 * CURRENT RULES, applied from the dates (the inputs' LT rate / indexation /
 * qualification years apply only to a sale BEFORE 23 Jul 2024):
 *   • units bought on/after 1 Apr 2023 — every gain at slab, however long held
 *     (s.50AA), so holding saves no tax (`regime: "slab"`);
 *   • older units sold on/after 23 Jul 2024 — long-term after 24 months, at
 *     12.5% WITHOUT indexation (`regime: "flat"`);
 *   • a sale already past the qualify date is long-term today.
 */

const SLAB_FROM = new Date("2023-04-01T00:00:00");
const FLAT_FROM = new Date("2024-07-23T00:00:00");
const FLAT_LTCG_PCT = 12.5;
const FLAT_LTCG_YEARS = 2;

export type DebtFundBenefitInput = {
  purchaseDate: string; // ISO yyyy-mm-dd
  investmentAmount: number;
  redemptionDate: string; // "sell today" date (ISO)
  currentMarketValue: number;
  indexationRatePct: number;
  expectedReturnPct: number; // return for the remaining period
  shortTermTaxPct: number;
  longTermTaxPct: number;
  ltcgYears: number; // qualification period (default 3)
};

export type DebtFundBenefitResult = {
  valid: boolean;
  error: string; // why `valid` is false ("" when valid)
  regime: "slab" | "indexation" | "flat"; // rules for the hold-to-LTCG sale
  sellIsLongTerm: boolean; // already past the qualify date today
  sellTaxPct: number;
  holdTaxPct: number;
  qualifyDate: string; // ISO ("" for slab units)
  sellHoldingDays: number;
  remainingDays: number;
  totalHoldingDays: number;
  indexYears: number;

  // Sell today
  sellGain: number;
  sellTax: number;
  netIfSold: number;
  postTaxYieldSold: number; // % p.a.

  // Hold to LTCG
  expectedRedemptionAmount: number;
  indexedCost: number;
  longTermGain: number;
  longTermTax: number;
  netIfHeld: number;
  postTaxYieldHeld: number; // % p.a.

  // Headline: return on the EXTRA holding period
  effectiveRemainingYield: number; // % p.a.
  taxSaved: number;
  extraInHand: number;
};

function parseDate(s: string): Date | null {
  const d = new Date(s + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}
function toIso(d: Date): string {
  // Format from LOCAL components — toISOString() would shift by the timezone
  // offset and show the previous day for timezones ahead of UTC (e.g. IST).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
/** Annualised return from `from` → `to` over `days` (actual/365). */
function annualise(from: number, to: number, days: number): number {
  if (from <= 0 || days <= 0 || to <= 0) return 0;
  return (Math.pow(to / from, 365 / days) - 1) * 100;
}

export function computeDebtFundBenefit(input: DebtFundBenefitInput): DebtFundBenefitResult {
  const purchase = parseDate(input.purchaseDate);
  const redemption = parseDate(input.redemptionDate);
  const ltcgYears = Math.max(1, Math.round(input.ltcgYears || 3));
  const inv = input.investmentAmount;

  const empty: DebtFundBenefitResult = {
    valid: false, error: "Enter valid purchase and redemption dates.", regime: "indexation", sellIsLongTerm: false,
    sellTaxPct: 0, holdTaxPct: 0, qualifyDate: "", sellHoldingDays: 0, remainingDays: 0, totalHoldingDays: 0, indexYears: 0,
    sellGain: 0, sellTax: 0, netIfSold: 0, postTaxYieldSold: 0,
    expectedRedemptionAmount: 0, indexedCost: 0, longTermGain: 0, longTermTax: 0, netIfHeld: 0, postTaxYieldHeld: 0,
    effectiveRemainingYield: 0, taxSaved: 0, extraInHand: 0,
  };
  if (!purchase || !redemption) return empty;
  if (redemption < purchase) return { ...empty, error: "Redemption date is before the purchase date." };

  const plusYearsAndDay = (d: Date, years: number) => {
    const q = new Date(d);
    q.setFullYear(q.getFullYear() + years);
    q.setDate(q.getDate() + 1); // strictly past the period
    return q;
  };
  const slab = purchase >= SLAB_FROM;
  // First date a sale is long-term: the old rule if it is reached before 23 Jul
  // 2024, else the 24-month rule (which only exists from 23 Jul 2024).
  const oldQualify = plusYearsAndDay(purchase, ltcgYears);
  const newQualify = plusYearsAndDay(purchase, FLAT_LTCG_YEARS);
  const qualify = slab
    ? null
    : oldQualify < FLAT_FROM
      ? oldQualify
      : newQualify > FLAT_FROM ? newQualify : FLAT_FROM;

  /** Long-term tax on a sale of `value` on `sale`, under the rules of that date. */
  const ltTax = (sale: Date, value: number) => {
    const flat = sale >= FLAT_FROM;
    const years = flat ? 0 : Math.floor(Math.max(1, daysBetween(purchase, sale)) / 365);
    const cost = inv * Math.pow(1 + input.indexationRatePct / 100, years);
    const gain = Math.max(0, value - cost);
    const pct = flat ? FLAT_LTCG_PCT : input.longTermTaxPct;
    return { cost, gain, tax: (gain * pct) / 100, pct, years };
  };

  const sellHoldingDays = Math.max(1, daysBetween(purchase, redemption));
  const sellIsLongTerm = qualify != null && redemption >= qualify;

  // ── Sell today ── (slab unless already long-term)
  const sellLt = sellIsLongTerm ? ltTax(redemption, input.currentMarketValue) : null;
  const sellGain = sellLt ? sellLt.gain : Math.max(0, input.currentMarketValue - inv);
  const sellTaxPct = sellLt ? sellLt.pct : input.shortTermTaxPct;
  const sellTax = (sellGain * sellTaxPct) / 100;
  const netIfSold = input.currentMarketValue - sellTax;
  const postTaxYieldSold = annualise(inv, netIfSold, sellHoldingDays);

  // ── Hold to LTCG ── nothing to wait for on slab units or once long-term.
  const holdDate = qualify != null && !sellIsLongTerm ? qualify : null;
  const remainingDays = holdDate ? Math.max(0, daysBetween(redemption, holdDate)) : 0;
  const totalHoldingDays = holdDate ? Math.max(1, daysBetween(purchase, holdDate)) : sellHoldingDays;
  const expectedRedemptionAmount = holdDate
    ? input.currentMarketValue * Math.pow(1 + input.expectedReturnPct / 100, remainingDays / 365)
    : input.currentMarketValue;
  const holdLt = holdDate ? ltTax(holdDate, expectedRedemptionAmount) : sellLt;
  const indexedCost = holdLt ? holdLt.cost : inv;
  const longTermGain = holdLt ? holdLt.gain : sellGain;
  const longTermTax = holdLt ? holdLt.tax : sellTax;
  const netIfHeld = expectedRedemptionAmount - longTermTax;
  const postTaxYieldHeld = annualise(inv, netIfHeld, totalHoldingDays);

  // ── Headline: the return on the EXTRA holding period ──
  const effectiveRemainingYield = remainingDays > 0 ? annualise(netIfSold, netIfHeld, remainingDays) : 0;

  return {
    valid: true,
    error: "",
    regime: slab ? "slab" : (holdDate ?? redemption) >= FLAT_FROM ? "flat" : "indexation",
    sellIsLongTerm,
    sellTaxPct,
    holdTaxPct: holdLt ? holdLt.pct : sellTaxPct,
    qualifyDate: qualify ? toIso(qualify) : "",
    sellHoldingDays,
    remainingDays,
    totalHoldingDays,
    indexYears: holdLt ? holdLt.years : 0,
    sellGain,
    sellTax,
    netIfSold,
    postTaxYieldSold,
    expectedRedemptionAmount,
    indexedCost,
    longTermGain,
    longTermTax,
    netIfHeld,
    postTaxYieldHeld,
    effectiveRemainingYield,
    taxSaved: sellTax - longTermTax,
    extraInHand: netIfHeld - netIfSold,
  };
}
