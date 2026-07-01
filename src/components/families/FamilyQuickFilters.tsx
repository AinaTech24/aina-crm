import Link from "next/link";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Quick-filter chip strip for the Families list page.
 *
 * Filter keys:
 *   - mine=1            → family rm_id = session.userId
 *   - no_primary=1      → primary_investor_id IS NULL
 *   - no_rm=1           → rm_id IS NULL
 *   - review_due=1      → next_review_at IS NULL OR <= now()
 *   - nominee_gap=1     → at least one member with nominee_name IS NULL/''
 *   - has_minor=1       → at least one member with is_minor=true
 *   - hni=1             → at least one HNI member
 *   - single=1          → only one active member
 *   - large=1           → 5+ active members
 */
export async function FamilyQuickFilters({
  session,
  active,
}: {
  session: SessionUser;
  active: Record<string, string | undefined>;
}) {
  const userId = session.userId;
  const counts = await withTenant(
    session.tenantId,
    async (tx) => {
      const r = await tx.execute(sql`
        WITH fam AS (
          SELECT
            f.id, f.primary_investor_id, f.rm_id, f.next_review_at, f.health_band,
            COUNT(i.id) FILTER (WHERE i.status = 'active') AS active_members,
            BOOL_OR(i.nominee_name IS NULL OR i.nominee_name = '')
              FILTER (WHERE i.status = 'active') AS any_no_nominee,
            BOOL_OR(i.is_minor = true) AS has_minor,
            BOOL_OR(i.segment_tag = 'HNI') AS any_hni
          FROM families f
          LEFT JOIN investors i ON i.family_id = f.id AND i.deleted_at IS NULL
          GROUP BY f.id
        )
        SELECT
          COUNT(*) FILTER (WHERE rm_id = ${userId})::int AS mine,
          COUNT(*) FILTER (WHERE primary_investor_id IS NULL)::int AS no_primary,
          COUNT(*) FILTER (WHERE rm_id IS NULL)::int AS no_rm,
          COUNT(*) FILTER (
            WHERE next_review_at IS NULL OR next_review_at <= now()
          )::int AS review_due,
          COUNT(*) FILTER (WHERE any_no_nominee = true)::int AS nominee_gap,
          COUNT(*) FILTER (WHERE has_minor = true)::int AS has_minor,
          COUNT(*) FILTER (WHERE any_hni = true)::int AS hni,
          COUNT(*) FILTER (WHERE active_members = 1)::int AS single,
          COUNT(*) FILTER (WHERE active_members >= 5)::int AS large,
          COUNT(*) FILTER (WHERE health_band = 'red')::int AS red_health
        FROM fam
      `);
      return r.rows[0] as any;
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const chips: Array<{ key: string; label: string; count: number; tone: string }> = [
    { key: "mine", label: "My families", count: Number(counts.mine), tone: "violet" },
    { key: "no_primary", label: "No primary", count: Number(counts.no_primary), tone: "rose" },
    { key: "no_rm", label: "No RM", count: Number(counts.no_rm), tone: "rose" },
    { key: "review_due", label: "Review due", count: Number(counts.review_due), tone: "amber" },
    { key: "nominee_gap", label: "Nominee gap", count: Number(counts.nominee_gap), tone: "rose" },
    { key: "has_minor", label: "Has minor", count: Number(counts.has_minor), tone: "violet" },
    { key: "hni", label: "HNI", count: Number(counts.hni), tone: "violet" },
    { key: "single", label: "Single-member", count: Number(counts.single), tone: "amber" },
    { key: "large", label: "5+ members", count: Number(counts.large), tone: "emerald" },
    { key: "red_health", label: "At-risk health", count: Number(counts.red_health), tone: "rose" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mr-1">
        Quick filters:
      </span>
      {chips.map((c) => {
        const isActive = active[c.key] === "1";
        const next = new URLSearchParams();
        for (const [k, v] of Object.entries(active)) {
          // Toggling a quick filter resets paging (drop any carried `page`).
          if (v && k !== c.key && k !== "page") next.set(k, v);
        }
        if (!isActive) next.set(c.key, "1");
        const href = `/dashboard/families${next.toString() ? `?${next.toString()}` : ""}`;
        const cls = toneClass(c.tone, isActive);
        return (
          <Link
            key={c.key}
            href={href}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-all ${cls}`}
          >
            <span className="font-medium">{c.label}</span>
            <span className="tabular-nums font-bold opacity-90">{c.count}</span>
          </Link>
        );
      })}
    </div>
  );
}

function toneClass(tone: string, active: boolean): string {
  const base: Record<string, string> = {
    violet: active
      ? "bg-violet-600 text-white border-violet-600 shadow-sm"
      : "bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100",
    amber: active
      ? "bg-amber-600 text-white border-amber-600 shadow-sm"
      : "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100",
    rose: active
      ? "bg-rose-600 text-white border-rose-600 shadow-sm"
      : "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100",
    emerald: active
      ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
      : "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100",
  };
  return base[tone] ?? base.violet;
}
