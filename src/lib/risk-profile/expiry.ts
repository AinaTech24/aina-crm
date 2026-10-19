/**
 * When a client's risk profile lapses — the ONE place that decides.
 *
 * A profile lapses one year after it was signed, unless it states its own
 * expiry: a profile uploaded from elsewhere says "Expire On". That stated date
 * is kept beside the signed date it belongs to (investors.risk_profile_expires_on
 * + risk_profile_expiry_for, migration 0236) and counts ONLY while the two
 * agree — so the questionnaire, the client link, the RM form or an import,
 * each recording a new signed date, quietly put the one-year rule back without
 * any of them knowing the expiry exists.
 *
 * Plain module (no "use client"): the server pages, the SQL behind the Risk
 * Profiles tabs and the dashboards' counts all use it.
 */

import { sql, type SQL } from "drizzle-orm";

/** The default life of a profile when it states no expiry of its own. */
export const RISK_PROFILE_DEFAULT_YEARS = 1;

/**
 * SQL: the DATE the client's profile lapses; NULL when they have no signed
 * profile. `alias` is the investors table (default `i`).
 *
 *   WHERE ${riskExpiresOnSql()} < CURRENT_DATE        -- lapsed
 *   WHERE ${riskExpiresOnSql()} <= CURRENT_DATE + 30  -- lapses within 30 days
 */
export function riskExpiresOnSql(alias = "i"): SQL {
  const a = sql.raw(alias);
  return sql`(CASE
    WHEN ${a}.risk_profile_signed_at IS NULL THEN NULL
    WHEN ${a}.risk_profile_expires_on IS NOT NULL
         AND ${a}.risk_profile_expiry_for = ${a}.risk_profile_signed_at THEN ${a}.risk_profile_expires_on
    ELSE (${a}.risk_profile_signed_at + interval '1 year')::date
  END)`;
}

const DAY = 86_400_000;

type RiskDates = {
  riskProfileSignedAt?: Date | string | null;
  riskProfileExpiresOn?: Date | string | null;
  riskProfileExpiryFor?: Date | string | null;
};

/** TS twin of riskExpiresOnSql: the date the profile lapses, or null with no signed profile. */
export function riskExpiresOn(r: RiskDates): Date | null {
  if (!r.riskProfileSignedAt) return null;
  const signed = new Date(r.riskProfileSignedAt);
  if (r.riskProfileExpiresOn && r.riskProfileExpiryFor && new Date(r.riskProfileExpiryFor).getTime() === signed.getTime()) {
    return new Date(r.riskProfileExpiresOn);
  }
  const d = new Date(signed);
  d.setUTCFullYear(d.getUTCFullYear() + RISK_PROFILE_DEFAULT_YEARS);
  return d;
}

/**
 * True once the profile has lapsed: it stays valid THROUGH its expiry date, so
 * it lapses on the next day (the same as `riskExpiresOnSql() < CURRENT_DATE`).
 * A client with no signed profile is not "lapsed", they are missing one.
 */
export function riskProfileLapsed(r: RiskDates, now = new Date()): boolean {
  const e = riskExpiresOn(r);
  if (!e) return false;
  return now.getTime() >= Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate()) + DAY;
}
