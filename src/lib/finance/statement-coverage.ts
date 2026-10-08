/**
 * What a client's portfolio rests on (Phase 3F): which registrar statements
 * the open holdings were last checked against, how old the oldest is, and
 * how many holdings no statement covers. Pure — shared by the client page's
 * holdings table (a client component) and tests.
 *
 * Statements are never merged into one date: a portfolio standing on a May
 * CAMS statement and an October KFintech one says so, rather than reading as
 * one current figure.
 */
export type StatementBacked = {
  netUnits: number;
  currentValue: number | null;
  registrar?: { asOf: string | null; report: string | null } | null;
};

export const STATEMENT_STALE_DAYS = 35;

const isOpen = (h: StatementBacked) => h.netUnits > 0.0005 || (h.currentValue ?? 0) > 0;
const days = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86_400_000);

export function statementCoverage(
  holdings: StatementBacked[],
  asOf: string | null,
  fmt: (iso: string) => string = (d) => d,
  staleDays = STATEMENT_STALE_DAYS,
): { text: string; warn: boolean } | null {
  const open = holdings.filter(isOpen);
  const dates = open.map((h) => h.registrar?.asOf?.slice(0, 10)).filter((d): d is string => !!d).sort();
  if (!dates.length) return null;
  const oldest = dates[0], newest = dates[dates.length - 1];
  const uncovered = open.length - dates.length;
  const ref = asOf?.slice(0, 10) ?? newest;
  const age = days(oldest, ref);
  const parts = [oldest === newest ? `Registrar statement dated ${fmt(oldest)}` : `Registrar statements dated ${fmt(oldest)} – ${fmt(newest)} (different dates)`];
  if (age > staleDays) parts.push(`the oldest is ${age} days old`);
  if (uncovered) parts.push(`${uncovered} holding${uncovered === 1 ? "" : "s"} not on any statement`);
  return { text: parts.join(" · "), warn: oldest !== newest || age > staleDays || uncovered > 0 };
}
