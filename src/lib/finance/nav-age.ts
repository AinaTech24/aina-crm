/**
 * How old a NAV may be and still be treated as current (Phase 3I). A plain
 * module — no database imports — so valuation code can read it anywhere.
 * RTA_NAV_MAX_AGE_DAYS, default 7 calendar days (weekends and market holidays
 * leave AMFI's latest NAV a few days old; a week is the outer bound).
 */
export const NAV_MAX_AGE_DAYS = Number(process.env.RTA_NAV_MAX_AGE_DAYS ?? 7);

/** The oldest NAV date (YYYY-MM-DD) still current on `now`. */
export function navCutoffIso(now: Date = new Date()): string {
  return new Date(now.getTime() - NAV_MAX_AGE_DAYS * 864e5).toISOString().slice(0, 10);
}
