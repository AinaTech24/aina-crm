/**
 * The web calculators' number formatting (src/components/calculators/ui.tsx
 * `inr` / `fmtPct`, CalculatorsApp `inrCompact`), so a figure prints exactly as
 * it does in the CRM: every rupee, Indian grouping — ₹47,59,314.
 *
 * `inr` reproduces Intl.NumberFormat("en-IN", { style: "currency", currency:
 * "INR", maximumFractionDigits: 0 }) by hand: Hermes' Intl differs by platform,
 * and a figure must not change between an Android and an iPhone.
 */

/** 1234567 → "12,34,567" (Indian grouping: last three, then pairs). */
export function groupIndian(intDigits: string): string {
  if (intDigits.length <= 3) return intDigits;
  const last3 = intDigits.slice(-3);
  let rest = intDigits.slice(0, -3);
  const parts: string[] = [];
  while (rest.length > 2) {
    parts.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) parts.unshift(rest);
  return `${parts.join(",")},${last3}`;
}

/** Whole rupees, Indian grouping: ₹47,59,314 · -₹1,234 · "—" when not finite. */
export function inr(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const r = Math.round(n);
  const neg = r < 0 || Object.is(r, -0);
  return `${neg ? "-" : ""}₹${groupIndian(String(Math.abs(r)))}`;
}

/** A count with Indian grouping and no ₹: 1,24,500. */
export function count(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const r = Math.round(n);
  return `${r < 0 ? "-" : ""}${groupIndian(String(Math.abs(r)))}`;
}

/** 12 → "12%", 12.5 → "12.5%", 12.345 → "12.3%" (web fmtPct). */
export function fmtPct(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(1)}%`;
}

/** n.toFixed(d) + "%", "—" when not finite. */
export function pctN(n: number, d = 2): string {
  return Number.isFinite(n) ? `${n.toFixed(d)}%` : "—";
}

/** Compact INR for dense tables (web CalculatorsApp inrCompact): ₹1.23 Cr · ₹4.5 L · ₹12k. */
export function inrCompact(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  if (a >= 1e3) return `₹${(n / 1e3).toFixed(0)}k`;
  return `₹${Math.round(n)}`;
}

/** "12 yrs" / "1 yr" / "7.5 yrs". */
export function yrs(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const v = Number.isInteger(n) ? String(n) : n.toFixed(1);
  return `${v} ${n === 1 ? "yr" : "yrs"}`;
}

/** Months as "Xy Ym" (e.g. 150 → "12y 6m"). */
export function yearsMonths(months: number): string {
  if (!Number.isFinite(months)) return "—";
  const m = Math.max(0, Math.round(months));
  return `${Math.floor(m / 12)}y ${m % 12}m`;
}
