/**
 * Fixed deposits — the vocabulary and the maturity maths. Pure: no database,
 * so the form, the API and the tests all compute the same figure.
 *
 * Maturity follows the convention Indian banks print on a receipt:
 *   - cumulative, tenure of 181 days or more: compound interest at the
 *     deposit's compounding frequency (quarterly for banks),
 *     A = P × (1 + r / (100·n)) ^ (n · days / 365)
 *   - cumulative, shorter: simple interest, A = P × (1 + r · days / 36500)
 *   - interest paid out (monthly / quarterly / …): the principal comes back
 *     at maturity, and each payout is P × r / (100 · payouts a year).
 * Banks discount the monthly payout slightly and round in their own way, so
 * the computed amount is an estimate — the receipt's figure, when typed in,
 * wins (maturity_amount_entered).
 */

import type { FdCompounding, FdPayout, FdStatus } from "@/db/schema";

export const ISSUER_TYPE_LABELS: Record<string, string> = {
  bank: "Bank",
  small_finance_bank: "Small finance bank",
  corporate: "Corporate FD",
  nbfc: "NBFC",
  post_office: "Post office",
  other: "Other",
};

export const PAYOUT_LABELS: Record<string, string> = {
  cumulative: "Cumulative (paid at maturity)",
  monthly: "Monthly payout",
  quarterly: "Quarterly payout",
  half_yearly: "Half-yearly payout",
  yearly: "Yearly payout",
};

export const PAYOUT_SHORT: Record<string, string> = {
  cumulative: "Cumulative",
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Half-yearly",
  yearly: "Yearly",
};

export const COMPOUNDING_LABELS: Record<string, string> = {
  monthly: "Monthly",
  quarterly: "Quarterly",
  half_yearly: "Half-yearly",
  yearly: "Yearly",
};

export const HOLDING_LABELS: Record<string, string> = {
  single: "Single",
  joint: "Joint",
  either_or_survivor: "Either or survivor",
};

export const TAX_FORM_LABELS: Record<string, string> = {
  none: "Not submitted",
  "15g": "Form 15G",
  "15h": "Form 15H",
};

export const STATUS_LABELS: Record<FdStatus, string> = {
  applied: "Applied",
  active: "Active",
  matured: "Matured",
  renewed: "Renewed",
  closed_early: "Closed early",
  cancelled: "Cancelled",
};

/** Statuses where the money is still with the issuer. */
export const LIVE_STATUSES: FdStatus[] = ["applied", "active"];

export const isLive = (s: string) => (LIVE_STATUSES as string[]).includes(s);

const PER_YEAR: Record<string, number> = { monthly: 12, quarterly: 4, half_yearly: 2, yearly: 1 };

/** yyyy-mm-dd → UTC midnight ms (dates have no time zone here). */
function utc(d: string): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to) - utc(from)) / 864e5);
}

/** Deposit date + tenure → maturity date. Month arithmetic clamps to month end (31 Jan + 1m = 28/29 Feb). */
export function maturityDateFor(depositDate: string, months: number, days: number): string {
  const [y, m, d] = depositDate.split("-").map(Number);
  const totalMonths = m - 1 + Math.max(0, months || 0);
  const ty = y + Math.floor(totalMonths / 12);
  const tm = totalMonths % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const base = Date.UTC(ty, tm, Math.min(d, lastDay));
  return iso(base + Math.max(0, days || 0) * 864e5);
}

/** The tenure between two dates, as whole months plus the remaining days. */
export function tenureBetween(depositDate: string, maturityDate: string): { months: number; days: number } {
  if (utc(maturityDate) <= utc(depositDate)) return { months: 0, days: 0 };
  let months = 0;
  while (utc(maturityDateFor(depositDate, months + 1, 0)) <= utc(maturityDate)) months++;
  return { months, days: daysBetween(maturityDateFor(depositDate, months, 0), maturityDate) };
}

export function tenureLabel(months: number | null | undefined, days: number | null | undefined): string {
  const m = months ?? 0;
  const d = days ?? 0;
  const parts: string[] = [];
  const y = Math.floor(m / 12);
  const rm = m % 12;
  if (y) parts.push(`${y} yr${y > 1 ? "s" : ""}`);
  if (rm) parts.push(`${rm} mo`);
  if (d) parts.push(`${d} day${d > 1 ? "s" : ""}`);
  return parts.join(" ") || "—";
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export type MaturityInput = {
  principal: number;
  rate: number;
  depositDate: string;
  maturityDate: string;
  payout: FdPayout | string;
  compounding: FdCompounding | string;
};

export type MaturityFigures = {
  /** What the client receives on the maturity date. */
  maturityAmount: number;
  /** All interest over the tenure (paid out, or accrued into the maturity amount). */
  interest: number;
  /** Each payout, for a non-cumulative deposit; null when cumulative. */
  periodicInterest: number | null;
  days: number;
};

export function computeMaturity(i: MaturityInput): MaturityFigures | null {
  const P = Number(i.principal);
  const r = Number(i.rate);
  if (!Number.isFinite(P) || P <= 0 || !Number.isFinite(r) || r < 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.depositDate) || !/^\d{4}-\d{2}-\d{2}$/.test(i.maturityDate)) return null;
  const days = daysBetween(i.depositDate, i.maturityDate);
  if (days <= 0) return null;

  if (i.payout === "cumulative") {
    const n = PER_YEAR[i.compounding] ?? 4;
    const A = days < 181 ? P * (1 + (r * days) / 36500) : P * Math.pow(1 + r / (100 * n), (n * days) / 365);
    return { maturityAmount: round2(A), interest: round2(A - P), periodicInterest: null, days };
  }
  const per = PER_YEAR[i.payout] ?? 4;
  return {
    maturityAmount: round2(P),
    interest: round2((P * r * days) / 36500),
    periodicInterest: round2((P * r) / (100 * per)),
    days,
  };
}

/** Days until maturity from `today` (India date); negative once past. */
export function daysToMaturity(maturityDate: string, today: string): number {
  return daysBetween(today, maturityDate);
}

/** Today as an India (IST) yyyy-mm-dd. */
export function indiaToday(now = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}
