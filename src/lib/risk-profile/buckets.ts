/**
 * The five Risk Profiles tabs, defined once for the page and the bulk send.
 *
 * Every active client sits in EXACTLY ONE bucket, so the tab counts add up to
 * the book and no client is counted twice. (The old "Needs review" tab was the
 * union of three others and showed the same 785 clients as "Not profiled".)
 *
 *   awaiting      a category was suggested from age; the client has not confirmed
 *   not_profiled  no signed profile at all
 *   current       signed within the last 11 months
 *   due           signed 11–12 months ago: re-profile before it lapses
 *   expired       signed more than 12 months ago
 *
 * A suggestion outranks everything else: it is not a profile, and the client's
 * next step is to confirm it, whatever an older signature says.
 *
 * Fragments reference the investors table as `i`.
 */
import { sql, type SQL } from "drizzle-orm";

export type RiskBucket = "not_profiled" | "due" | "current" | "expired" | "awaiting";

export const RISK_BUCKETS: Array<{ key: RiskBucket; label: string }> = [
  { key: "not_profiled", label: "Not profiled" },
  { key: "due", label: "Due for review" },
  { key: "current", label: "Current" },
  { key: "expired", label: "Expired" },
  { key: "awaiting", label: "Awaiting client confirmation" },
];

/** Old ?filter= values still arriving from bookmarks. */
const LEGACY: Record<string, RiskBucket> = {
  needs_review: "not_profiled",
  suggested: "awaiting",
  all: "not_profiled",
};

export function parseRiskBucket(v: string | undefined): RiskBucket {
  if (v && RISK_BUCKETS.some((b) => b.key === v)) return v as RiskBucket;
  return (v && LEGACY[v]) || "not_profiled";
}

export function riskBucketSql(key: RiskBucket): SQL {
  const confirmed = sql`i.risk_profile_provisional IS NOT TRUE`;
  switch (key) {
    case "awaiting":
      return sql`i.risk_profile_provisional = true`;
    case "not_profiled":
      return sql`(${confirmed} AND i.risk_profile_signed_at IS NULL)`;
    case "current":
      return sql`(${confirmed} AND i.risk_profile_signed_at >= now() - interval '11 months')`;
    case "due":
      return sql`(${confirmed} AND i.risk_profile_signed_at < now() - interval '11 months'
                  AND i.risk_profile_signed_at >= now() - interval '12 months')`;
    case "expired":
      return sql`(${confirmed} AND i.risk_profile_signed_at < now() - interval '12 months')`;
  }
}

/** The bucket as a column, so a row's status chip can never disagree with its tab. */
export function riskBucketCaseSql(): SQL {
  return sql`CASE
    WHEN ${riskBucketSql("awaiting")} THEN 'awaiting'
    WHEN ${riskBucketSql("not_profiled")} THEN 'not_profiled'
    WHEN ${riskBucketSql("current")} THEN 'current'
    WHEN ${riskBucketSql("due")} THEN 'due'
    ELSE 'expired' END`;
}
