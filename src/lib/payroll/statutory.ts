/**
 * Statutory rates for payroll, dated — a change in the law is a new entry with
 * its effective date, so a past month is always worked out on the rule that
 * applied then. Pure data and lookups; safe on the client (live previews).
 *
 * Every figure here must be confirmed with the firm's CA before go-live
 * (docs/PAYROLL_MODULE_DESIGN.md §3.4). Sources: EPF Scheme 1952, ESI Act,
 * the state Professional Tax Acts, Income-tax Act 2025 (tax year 2026-27:
 * rates unchanged from 2025-26), Code on Wages 2019 (in force 21 Nov 2025).
 */

type Dated<T> = Array<{ from: string; value: T }>;

/** The entry in force on `day` (yyyy-mm-dd): the latest whose `from` is not after it. */
export function inForce<T>(table: Dated<T>, day: string): T {
  let pick = table[0].value;
  for (const e of table) if (e.from <= day) pick = e.value;
  return pick;
}

export type PfRates = {
  employee: number; // of PF wages
  employer: number; // total employer share, of which EPS below
  eps: number; // of wages up to the ceiling
  edli: number; // of wages up to the ceiling
  admin: number; // of PF wages
  ceiling: number; // monthly wage ceiling
};
export const PF: Dated<PfRates> = [
  { from: "2014-09-01", value: { employee: 0.12, employer: 0.12, eps: 0.0833, edli: 0.005, admin: 0.005, ceiling: 15000 } },
];

export type EsiRates = { employee: number; employer: number; ceiling: number };
export const ESI: Dated<EsiRates> = [
  { from: "2019-07-01", value: { employee: 0.0075, employer: 0.0325, ceiling: 21000 } },
];

/** Code on Wages: wages (Basic + DA) must be at least this share of total pay. */
export const WAGES_MIN_SHARE: Dated<number> = [{ from: "2025-11-21", value: 0.5 }];

// ── Income tax on salary (new regime) ───────────────────────────────────────
export type TaxRegime = {
  standardDeduction: number;
  slabs: Array<{ upTo: number | null; rate: number }>; // annual taxable income
  rebateLimit: number; // income up to this pays no tax (rebate), with marginal relief above
  cess: number;
  surcharge: Array<{ above: number; rate: number }>;
};
export const NEW_REGIME: Dated<TaxRegime> = [
  {
    from: "2025-04-01",
    value: {
      standardDeduction: 75000,
      slabs: [
        { upTo: 400000, rate: 0 },
        { upTo: 800000, rate: 0.05 },
        { upTo: 1200000, rate: 0.1 },
        { upTo: 1600000, rate: 0.15 },
        { upTo: 2000000, rate: 0.2 },
        { upTo: 2400000, rate: 0.25 },
        { upTo: null, rate: 0.3 },
      ],
      rebateLimit: 1200000,
      cess: 0.04,
      surcharge: [
        { above: 20000000, rate: 0.25 },
        { above: 10000000, rate: 0.15 },
        { above: 5000000, rate: 0.1 },
      ],
    },
  },
];

/** Annual income tax (incl. cess) on `taxable` under the regime. */
export function annualTax(taxable: number, r: TaxRegime): number {
  if (taxable <= 0) return 0;
  let tax = 0;
  let lower = 0;
  for (const s of r.slabs) {
    const top = s.upTo ?? Infinity;
    if (taxable > lower) tax += (Math.min(taxable, top) - lower) * s.rate;
    lower = top;
  }
  // Rebate: nothing up to the limit; just above it, never more than the excess (marginal relief).
  if (taxable <= r.rebateLimit) tax = 0;
  else tax = Math.min(tax, taxable - r.rebateLimit);
  const sur = r.surcharge.find((x) => taxable > x.above);
  if (sur) tax += tax * sur.rate;
  return Math.round(tax * (1 + r.cess));
}

// ── Professional Tax, by state ──────────────────────────────────────────────
export type PtRule =
  | { kind: "none" }
  | { kind: "unsupported"; note: string }
  | {
      kind: "slabs";
      /** Monthly gross upper bounds → amount; the first band that fits. */
      slabs: Array<{ upTo: number | null; amount: number }>;
      /** A different amount in February (the year's balancing month). */
      february?: number;
      /** Separate slabs for women, where the state has them. */
      female?: Array<{ upTo: number | null; amount: number }>;
    };

export const STATES: Array<{ code: string; name: string; pt: Dated<PtRule> }> = [
  { code: "GJ", name: "Gujarat", pt: [{ from: "2023-04-01", value: { kind: "slabs", slabs: [{ upTo: 11999, amount: 0 }, { upTo: null, amount: 200 }] } }] },
  {
    code: "MH", name: "Maharashtra",
    pt: [{ from: "2023-07-01", value: {
      kind: "slabs",
      slabs: [{ upTo: 7500, amount: 0 }, { upTo: 10000, amount: 175 }, { upTo: null, amount: 200 }],
      female: [{ upTo: 25000, amount: 0 }, { upTo: null, amount: 200 }],
      february: 300,
    } }],
  },
  { code: "KA", name: "Karnataka", pt: [{ from: "2025-04-01", value: { kind: "slabs", slabs: [{ upTo: 24999, amount: 0 }, { upTo: null, amount: 200 }], february: 300 } }] },
  {
    code: "WB", name: "West Bengal",
    pt: [{ from: "2014-04-01", value: { kind: "slabs", slabs: [{ upTo: 10000, amount: 0 }, { upTo: 15000, amount: 110 }, { upTo: 25000, amount: 130 }, { upTo: 40000, amount: 150 }, { upTo: null, amount: 200 }] } }],
  },
  { code: "TG", name: "Telangana", pt: [{ from: "2014-06-02", value: { kind: "slabs", slabs: [{ upTo: 15000, amount: 0 }, { upTo: 20000, amount: 150 }, { upTo: null, amount: 200 }] } }] },
  { code: "AP", name: "Andhra Pradesh", pt: [{ from: "2013-04-01", value: { kind: "slabs", slabs: [{ upTo: 15000, amount: 0 }, { upTo: 20000, amount: 150 }, { upTo: null, amount: 200 }] } }] },
  { code: "MP", name: "Madhya Pradesh", pt: [{ from: "2000-01-01", value: { kind: "unsupported", note: "Madhya Pradesh works PT on annual salary — enter it as a deduction for now." } }] },
  { code: "TN", name: "Tamil Nadu", pt: [{ from: "2000-01-01", value: { kind: "unsupported", note: "Tamil Nadu collects PT half-yearly — enter it as a deduction for now." } }] },
  { code: "KL", name: "Kerala", pt: [{ from: "2000-01-01", value: { kind: "unsupported", note: "Kerala collects PT half-yearly — enter it as a deduction for now." } }] },
  { code: "DL", name: "Delhi", pt: [{ from: "2000-01-01", value: { kind: "none" } }] },
  { code: "RJ", name: "Rajasthan", pt: [{ from: "2000-01-01", value: { kind: "none" } }] },
  { code: "UP", name: "Uttar Pradesh", pt: [{ from: "2000-01-01", value: { kind: "none" } }] },
  { code: "HR", name: "Haryana", pt: [{ from: "2000-01-01", value: { kind: "none" } }] },
  { code: "PB", name: "Punjab", pt: [{ from: "2000-01-01", value: { kind: "unsupported", note: "Punjab levies a flat ₹200 a month above a threshold — enter it as a deduction for now." } }] },
];

export const stateName = (code: string | null | undefined) => STATES.find((s) => s.code === code)?.name ?? code ?? "—";

/** Professional Tax for a month's gross, or a note why it is not worked out. */
export function professionalTax(
  stateCode: string | null | undefined,
  monthlyGross: number,
  day: string,
  gender: string | null | undefined
): { amount: number; why: string } {
  const st = STATES.find((s) => s.code === stateCode);
  if (!st) return { amount: 0, why: "No work state on the payroll profile — Professional Tax not worked out." };
  const rule = inForce(st.pt, day);
  if (rule.kind === "none") return { amount: 0, why: `${st.name} has no Professional Tax.` };
  if (rule.kind === "unsupported") return { amount: 0, why: rule.note };
  const slabs = gender === "female" && rule.female ? rule.female : rule.slabs;
  const band = slabs.find((b) => b.upTo == null || monthlyGross <= b.upTo)!;
  const isFeb = day.slice(5, 7) === "02";
  const amount = band.amount > 0 && isFeb && rule.february ? rule.february : band.amount;
  return {
    amount,
    why: amount ? `${st.name} slab for a monthly gross of ₹${Math.round(monthlyGross).toLocaleString("en-IN")}${isFeb && rule.february ? " (February)" : ""}.` : `Below ${st.name}'s Professional Tax threshold.`,
  };
}
