/**
 * A policy's premium, as typed and as stored.
 *
 * `insurance_policies.annual_premium` is ANNUALISED — every dashboard, the
 * register and the renewals read it as the year's premium. But the figure on a
 * policy document is the amount for ONE payment at the chosen mode ("₹10,000,
 * quarterly"), and that is what the form asks for (2026-10-30). Typed into a
 * field called "Annual premium", a quarterly 10,000 was read back as 2,500 an
 * installment — "the amount is lower than I entered".
 *
 * Single-pay is the whole premium, paid once: one payment a year for the sums.
 */

export const PAYMENTS_PER_YEAR: Record<string, number> = {
  single: 1,
  annual: 1,
  semi_annual: 2,
  quarterly: 4,
  monthly: 12,
};

export function paymentsPerYear(freq: string | null | undefined): number {
  return PAYMENTS_PER_YEAR[String(freq ?? "annual")] ?? 1;
}

/** The annual premium for `amount` paid each time at `freq`. */
export function annualFrom(amount: number, freq: string | null | undefined): number {
  return Math.round(amount * paymentsPerYear(freq) * 100) / 100;
}

/** What is paid each time, from the stored annual premium. */
export function installmentOf(annual: number, freq: string | null | undefined): number {
  return Math.round((annual / paymentsPerYear(freq)) * 100) / 100;
}

const PER: Record<string, string> = { semi_annual: "half-year", quarterly: "quarter", monthly: "month" };

/** "every quarter" — or null when the premium is paid once a year or once. */
export function eachPeriod(freq: string | null | undefined): string | null {
  const k = PER[String(freq ?? "")];
  return k ? `every ${k}` : null;
}

/** The form's label for the premium field, by frequency. */
export function premiumFieldLabel(freq: string | null | undefined): string {
  switch (freq) {
    case "single": return "Single premium (₹)";
    case "semi_annual": return "Premium each half-year (₹)";
    case "quarterly": return "Premium each quarter (₹)";
    case "monthly": return "Premium each month (₹)";
    default: return "Annual premium (₹)";
  }
}
