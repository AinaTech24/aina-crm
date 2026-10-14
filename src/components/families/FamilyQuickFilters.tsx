import { sql, type SQL } from "drizzle-orm";
import { LIVE_MEMBER_JOIN } from "@/lib/families/live";
import { needsNomineeSql } from "@/lib/investors/type-rules";

/**
 * Quick-filter OPTIONS (with live row counts) for the Families list, fed to
 * the shared CompactFilterBar's Filters dropdown.
 *
 * The counts run over the SAME families the list shows — the caller passes
 * its visibility condition. They used to be firm-wide, so an RM saw "No RM
 * (412)", clicked it, and got an empty list.
 *
 * Members are LIVE members (not deleted, merged or closed) — the same rule as
 * every other figure on the page.
 *
 * Filter keys:
 *   - mine=1            → family rm_id = session.userId
 *   - no_primary=1      → no head of family
 *   - no_rm=1           → rm_id IS NULL
 *   - review_due=1      → next_review_at IS NULL OR <= now()
 *   - nominee_gap=1     → at least one member without a nominee
 *   - has_minor=1       → at least one minor
 *   - hni=1             → at least one HNI member
 *   - single=1          → one member
 *   - large=1           → 5+ members
 */
export type FamilyFilterOption = { key: string; label: string; count: number };

export async function familyQuickFilterOptions(
  tx: any,
  opts: { userId: string; scope: SQL }
): Promise<FamilyFilterOption[]> {
  const r = await tx.execute(sql`
    WITH fam AS (
      SELECT
        f.id, f.primary_investor_id, f.rm_id, f.next_review_at, f.health_band,
        COUNT(i.id) AS members,
        BOOL_OR(i.id IS NOT NULL AND ${needsNomineeSql("i")}) AS any_no_nominee,
        BOOL_OR(i.is_minor = true) AS has_minor,
        BOOL_OR(i.segment_tag = 'HNI') AS any_hni
      FROM families f
      LEFT JOIN investors i ON ${LIVE_MEMBER_JOIN}
      WHERE ${opts.scope}
      GROUP BY f.id
    )
    SELECT
      COUNT(*) FILTER (WHERE rm_id = ${opts.userId}::uuid)::int AS mine,
      COUNT(*) FILTER (WHERE primary_investor_id IS NULL)::int AS no_primary,
      COUNT(*) FILTER (WHERE rm_id IS NULL)::int AS no_rm,
      COUNT(*) FILTER (WHERE next_review_at IS NULL OR next_review_at <= now())::int AS review_due,
      COUNT(*) FILTER (WHERE any_no_nominee = true)::int AS nominee_gap,
      COUNT(*) FILTER (WHERE has_minor = true)::int AS has_minor,
      COUNT(*) FILTER (WHERE any_hni = true)::int AS hni,
      COUNT(*) FILTER (WHERE members = 1)::int AS single,
      COUNT(*) FILTER (WHERE members >= 5)::int AS large,
      COUNT(*) FILTER (WHERE health_band = 'red')::int AS red_health
    FROM fam
  `);
  const counts = (r.rows[0] ?? {}) as Record<string, number>;

  return [
    { key: "mine", label: "My families", count: Number(counts.mine ?? 0) },
    { key: "no_primary", label: "No head of family", count: Number(counts.no_primary ?? 0) },
    { key: "no_rm", label: "No RM", count: Number(counts.no_rm ?? 0) },
    { key: "review_due", label: "Review due", count: Number(counts.review_due ?? 0) },
    { key: "nominee_gap", label: "Nominee gap", count: Number(counts.nominee_gap ?? 0) },
    { key: "has_minor", label: "Has a minor", count: Number(counts.has_minor ?? 0) },
    { key: "hni", label: "Has an HNI member", count: Number(counts.hni ?? 0) },
    { key: "single", label: "One member", count: Number(counts.single ?? 0) },
    { key: "large", label: "5+ members", count: Number(counts.large ?? 0) },
    { key: "red_health", label: "At-risk health", count: Number(counts.red_health ?? 0) },
  ];
}
