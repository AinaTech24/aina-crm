// Copied verbatim from src/lib/calculators/capital-gains-bond.ts by sync-from-web.mjs — do not edit here; change the web module and re-run.
/**
 * Capital Gains Bond (Sec 54EC) vs Other Investment — math engine.
 *
 * A long-term capital gain can be parked in a 54EC bond (no LTCG tax on the
 * gain, the bond's interest taxed at the slab) or the tax can be paid and the
 * rest invested elsewhere (FD, debt fund, equity fund, any product). This
 * compares the post-tax maturity and the post-tax IRR of each choice.
 *
 * CONVENTIONS (verified to the reference case: ₹50,00,000 gain, 12.5% LTCG,
 * 5 yrs, bond 5.25% @ 30% slab; FD 6% @ 30%; debt 7% @ 30%; equity 12% @ 12.5%
 * → post-tax maturity ₹60,20,418 / ₹54,10,816 / ₹56,07,815 / ₹72,93,339 and
 * post-tax IRR 3.78% / 1.59% / 2.32% / 7.84%):
 *   • Annual compounding; interest is assumed reinvested at the same rate and
 *     taxed ONCE at maturity: maturity = net · (1 + r)^n.
 *   • Bond: no LTCG tax up front; every other option pays gain × LTCG rate first.
 *   • Tax = (maturity − cost) × tax rate, on the unrounded taxable figure.
 *     The reference applies NO cess and NO equity exemption; both exist here
 *     only as opt-in deviations (`cessPct`, `exemption`), default off.
 *   • Post-tax IRR = (post-tax maturity / GROSS gain)^(1/n) − 1. The base is the
 *     full gain for every column, so the tax paid up front lowers the IRR.
 *   • The bond's period applies to every column.
 *
 * Indexation "Yes" is NOT proven by the reference case (it only shows "No").
 * It is implemented as a CII-based estimate: the cost is indexed by an assumed
 * yearly rise in the Cost Inflation Index, compounded — cost · (1 + idx)^n.
 * The UI labels it as an estimate.
 */

export type CgBondOptionInput = {
  name: string;
  ratePct: number;
  taxRatePct: number;
  indexation: boolean;
  /** Opt-in deviation: an amount of the gain exempt from tax (e.g. the equity
   *  LTCG exemption). The reference report applies none. */
  exemption?: number;
};

export type CgBondInput = {
  gain: number;
  ltcgRatePct: number;
  years: number;
  bondRatePct: number;
  slabPct: number;
  indexationPct: number;
  options: CgBondOptionInput[];
  /** Opt-in deviation: health & education cess on the tax (reference: none). */
  cessPct?: number;
};

export type CgBondColumn = {
  name: string;
  isBond: boolean;
  gain: number;
  ltcgTax: number;
  netInvestment: number;
  ratePct: number;
  years: number;
  indexation: boolean;
  maturity: number;
  indexationPct: number;
  indexedCost: number;
  taxableIncome: number;
  taxRatePct: number;
  tax: number;
  postTaxMaturity: number;
  /** null when it cannot be computed (no gain or no period). */
  postTaxIrrPct: number | null;
};

function column(
  input: CgBondInput,
  o: CgBondOptionInput,
  isBond: boolean,
  n: number
): CgBondColumn {
  const gain = Math.max(0, input.gain);
  const ltcgTax = isBond ? 0 : gain * (input.ltcgRatePct / 100);
  const net = gain - ltcgTax;
  const maturity = net * Math.pow(1 + o.ratePct / 100, n);
  const idxPct = o.indexation ? input.indexationPct : 0;
  const indexedCost = o.indexation ? net * Math.pow(1 + idxPct / 100, n) : net;
  const taxableIncome = maturity - indexedCost;
  const taxableAfterExemption = Math.max(0, taxableIncome - Math.max(0, o.exemption ?? 0));
  const baseTax = taxableAfterExemption * (o.taxRatePct / 100);
  const tax = baseTax * (1 + Math.max(0, input.cessPct ?? 0) / 100);
  const postTaxMaturity = maturity - tax;
  const postTaxIrrPct =
    gain > 0 && n > 0 && postTaxMaturity > 0 ? (Math.pow(postTaxMaturity / gain, 1 / n) - 1) * 100 : null;
  return {
    name: o.name,
    isBond,
    gain,
    ltcgTax,
    netInvestment: net,
    ratePct: o.ratePct,
    years: n,
    indexation: o.indexation,
    maturity,
    indexationPct: idxPct,
    indexedCost,
    taxableIncome,
    taxRatePct: o.taxRatePct,
    tax,
    postTaxMaturity,
    postTaxIrrPct,
  };
}

/** One column per choice: the 54EC bond first, then each other option. */
export function capitalGainsBondVsOthers(input: CgBondInput): CgBondColumn[] {
  const n = Math.max(0, Math.round(input.years));
  const bond = column(
    input,
    { name: "54EC Bond", ratePct: input.bondRatePct, taxRatePct: input.slabPct, indexation: false },
    true,
    n
  );
  return [bond, ...input.options.map((o) => column(input, o, false, n))];
}
