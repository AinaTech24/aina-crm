/**
 * Fixed-deposit vocabulary and maturity maths — the app's copy of the CRM's
 * src/lib/fixed-deposits/terms.ts (pure and tested there; keep them equal).
 * Cumulative ≥ 181 days compounds at the deposit's frequency, shorter is
 * simple interest; a payout FD returns the principal. The receipt's amount,
 * when typed, wins over the computed one.
 */

export const ISSUER_TYPE_LABELS: Record<string, string> = {
  bank: "Bank", small_finance_bank: "Small finance bank", corporate: "Corporate FD", nbfc: "NBFC", post_office: "Post office", other: "Other",
};
export const PAYOUT_LABELS: Record<string, string> = {
  cumulative: "Cumulative (paid at maturity)", monthly: "Monthly payout", quarterly: "Quarterly payout", half_yearly: "Half-yearly payout", yearly: "Yearly payout",
};
export const PAYOUT_SHORT: Record<string, string> = { cumulative: "Cumulative", monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Half-yearly", yearly: "Yearly" };
export const COMPOUNDING_LABELS: Record<string, string> = { monthly: "Monthly", quarterly: "Quarterly", half_yearly: "Half-yearly", yearly: "Yearly" };
export const HOLDING_LABELS: Record<string, string> = { single: "Single", joint: "Joint", either_or_survivor: "Either or survivor" };
export const TAX_FORM_LABELS: Record<string, string> = { none: "Not submitted", "15g": "Form 15G", "15h": "Form 15H" };
export const STATUS_LABELS: Record<string, string> = {
  applied: "Applied", active: "Active", matured: "Matured", renewed: "Renewed", closed_early: "Closed early", cancelled: "Cancelled",
};
export const isLive = (s: string) => s === "applied" || s === "active";

export const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

const PER_YEAR: Record<string, number> = { monthly: 12, quarterly: 4, half_yearly: 2, yearly: 1 };
const DAY = /^\d{4}-\d{2}-\d{2}$/;
function utc(d: string): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;

export const daysBetween = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 864e5);

/** Deposit date + tenure → maturity date. Month arithmetic clamps to month end. */
export function maturityDateFor(depositDate: string, months: number, days: number): string {
  const [y, m, d] = depositDate.split("-").map(Number);
  const totalMonths = m - 1 + Math.max(0, months || 0);
  const ty = y + Math.floor(totalMonths / 12);
  const tm = totalMonths % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return iso(Date.UTC(ty, tm, Math.min(d, lastDay)) + Math.max(0, days || 0) * 864e5);
}

/**
 * The first interest date of a payout FD: one period after the deposit (monthly
 * +1 month … yearly +12), never later than maturity. A cumulative FD pays with
 * the principal, so its payout date is the maturity date.
 */
export function firstPayoutDate(depositDate: string, maturityDate: string, payout: string): string {
  if (!depositDate) return "";
  const months = ({ monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 } as Record<string, number>)[payout];
  if (!months) return maturityDate || "";
  const first = maturityDateFor(depositDate, months, 0);
  return maturityDate && first > maturityDate ? maturityDate : first;
}

/** The tenure between two dates, as whole months plus the remaining days. */
export function tenureBetween(depositDate: string, maturityDate: string): { months: number; days: number } {
  if (utc(maturityDate) <= utc(depositDate)) return { months: 0, days: 0 };
  let months = 0;
  while (utc(maturityDateFor(depositDate, months + 1, 0)) <= utc(maturityDate)) months++;
  return { months, days: daysBetween(maturityDateFor(depositDate, months, 0), maturityDate) };
}

export function tenureLabel(months?: number | null, days?: number | null): string {
  const m = months ?? 0, d = days ?? 0, y = Math.floor(m / 12), rm = m % 12;
  const parts: string[] = [];
  if (y) parts.push(`${y} yr${y > 1 ? "s" : ""}`);
  if (rm) parts.push(`${rm} mo`);
  if (d) parts.push(`${d} day${d > 1 ? "s" : ""}`);
  return parts.join(" ") || "—";
}

export function computeMaturity(i: { principal: number; rate: number; depositDate: string; maturityDate: string; payout: string; compounding: string }) {
  const P = Number(i.principal), r = Number(i.rate);
  if (!Number.isFinite(P) || P <= 0 || !Number.isFinite(r) || r < 0) return null;
  if (!DAY.test(i.depositDate) || !DAY.test(i.maturityDate)) return null;
  const days = daysBetween(i.depositDate, i.maturityDate);
  if (days <= 0) return null;
  if (i.payout === "cumulative") {
    const n = PER_YEAR[i.compounding] ?? 4;
    const A = days < 181 ? P * (1 + (r * days) / 36500) : P * Math.pow(1 + r / (100 * n), (n * days) / 365);
    return { maturityAmount: round2(A), interest: round2(A - P), periodicInterest: null as number | null, days };
  }
  const per = PER_YEAR[i.payout] ?? 4;
  return { maturityAmount: round2(P), interest: round2((P * r * days) / 36500), periodicInterest: round2((P * r) / (100 * per)), days };
}

/** Days until maturity from `today` (India date); negative once past. */
export const daysToMaturity = (maturityDate: string, today: string) => daysBetween(today, maturityDate);

/** Today as an India (IST) yyyy-mm-dd. */
export const indiaToday = (now = new Date()) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
