/**
 * A policy's last day of cover from its start date and term.
 *
 * Cover runs for the whole term and ends the day BEFORE the anniversary: a
 * 30-year policy starting on 17 Nov 2026 covers up to 16 Nov 2056, not 17 Nov
 * 2056 (the form used to land on the anniversary itself, a day late).
 * A plain module so the form and its test share one rule.
 */

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** `startISO` + `years` − 1 day, as yyyy-mm-dd; "" when either is missing or not a positive term. */
export function expiryFromTerm(startISO: string, years: number | string): string {
  const term = Number(years);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startISO ?? "");
  if (!m || !Number.isFinite(term) || term <= 0) return "";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (Number.isInteger(term)) {
    // 29 Feb + n years rolls to 1 Mar, so the day before is 28 Feb — the end of that policy year.
    return iso(Date.UTC(y + term, mo - 1, d) - 864e5);
  }
  // A part-year term (1.5 years): count whole months, clamped to the month's end.
  const months = Math.round(term * 12);
  const total = mo - 1 + months;
  const ty = y + Math.floor(total / 12);
  const tm = total % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return iso(Date.UTC(ty, tm, Math.min(d, last)) - 864e5);
}
