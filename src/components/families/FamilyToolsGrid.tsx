import Link from "next/link";
import { sql } from "drizzle-orm";
import {
  ArrowRight,
  GitMerge,
  HeartHandshake,
  UserPlus,
  Users2,
  ShieldAlert,
  Settings2,
} from "lucide-react";
import { withTenant } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";

/**
 * Family Master tools — one place that answers "what can I do with households?"
 *
 * The module had capable parts (create, merge, AI pairing, next-gen pulse) that
 * were scattered across the page header and a dialog, so the only obvious action
 * was "New family". These tiles surface the whole set, and carry the live counts
 * that say which one is worth clicking — the unmapped queue is the one that
 * actually moves coverage, so it leads.
 */
export async function FamilyToolsGrid({ session }: { session: SessionUser }) {
  const counts = await withTenant(
    session.tenantId,
    async (tx) => {
      const r = await tx.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE i.family_id IS NULL)::int   AS unmapped,
          COUNT(*) FILTER (WHERE i.family_id IS NOT NULL)::int AS mapped
        FROM investors i
        WHERE i.tenant_id = ${session.tenantId}::uuid
          AND i.deleted_at IS NULL
          AND i.status = 'active'
      `);
      const f = await tx.execute(sql`
        SELECT COUNT(*)::int AS c FROM families WHERE tenant_id = ${session.tenantId}::uuid
      `);
      const counts = r.rows[0] as { unmapped?: number; mapped?: number } | undefined;
      const fam = f.rows[0] as { c?: number } | undefined;
      return {
        unmapped: Number(counts?.unmapped ?? 0),
        mapped: Number(counts?.mapped ?? 0),
        families: Number(fam?.c ?? 0),
      };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const total = counts.mapped + counts.unmapped;
  const coverage = total > 0 ? Math.round((counts.mapped / total) * 100) : 0;

  const tiles = [
    {
      href: "/dashboard/families/unmapped",
      icon: Users2,
      title: "Unmapped clients",
      desc: "Clients not in any household yet — start here",
      badge: counts.unmapped > 0 ? counts.unmapped.toLocaleString("en-IN") : null,
      tone: "amber" as const,
    },
    {
      href: "/dashboard/families/new",
      icon: UserPlus,
      title: "Create household",
      desc: "Group clients under one head",
      badge: null,
      tone: "plain" as const,
    },
    {
      href: "/dashboard/families?sort=aum",
      icon: HeartHandshake,
      title: "Household list",
      desc: "Combined AUM, SIP and health per family",
      badge: counts.families.toLocaleString("en-IN"),
      tone: "plain" as const,
    },
    {
      href: "/dashboard/families/at-risk",
      icon: ShieldAlert,
      title: "Next-gen pulse",
      desc: "Households at risk of losing the next generation",
      badge: null,
      tone: "plain" as const,
    },
    {
      href: "/dashboard/duplicates",
      icon: GitMerge,
      title: "Merge duplicates",
      desc: "Combine households created twice",
      badge: null,
      tone: "plain" as const,
    },
    {
      href: "/dashboard/families/settings",
      icon: Settings2,
      title: "Family settings",
      desc: "Relationship types and defaults for new households",
      badge: null,
      tone: "plain" as const,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Family master
        </h2>
        <span className="text-xs text-muted-foreground">
          <span className={coverage >= 60 ? "text-emerald-600 font-semibold" : "text-amber-600 font-semibold"}>
            {coverage}%
          </span>{" "}
          of active clients mapped
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {tiles.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className={`group border rounded-lg bg-card p-4 flex items-start gap-3 transition-colors hover:bg-accent/40 ${
              t.tone === "amber" ? "border-amber-300 bg-amber-50/40" : ""
            }`}
          >
            <span
              className={`size-9 rounded-lg grid place-items-center shrink-0 ${
                t.tone === "amber" ? "bg-amber-100 text-amber-700" : "bg-secondary text-foreground/70"
              }`}
            >
              <t.icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="font-semibold text-sm">{t.title}</span>
                {t.badge && (
                  <span
                    className={`text-[10px] font-bold tabular-nums rounded-full px-1.5 py-0.5 ${
                      t.tone === "amber" ? "bg-amber-600 text-white" : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {t.badge}
                  </span>
                )}
              </span>
              <span className="block text-[11px] text-muted-foreground mt-0.5">{t.desc}</span>
            </span>
            <ArrowRight className="size-4 text-muted-foreground/50 shrink-0 transition-transform group-hover:translate-x-0.5" />
          </Link>
        ))}
      </div>
    </div>
  );
}
