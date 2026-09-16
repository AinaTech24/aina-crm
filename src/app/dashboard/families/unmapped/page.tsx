/**
 * Unmapped clients — the Family Mapping work queue.
 *
 * Family mapping is only as useful as its coverage, and coverage was invisible:
 * there was no way to ask "who is NOT in a household yet?", so the answer went
 * unnoticed — 9,434 of 10,341 clients at the largest firm on this platform, and
 * 2,058 of 3,023 at VSN. This page is that list, with the two ways to clear a
 * row (start a household, or join an existing one) on the row itself.
 *
 * Reuses the shared investor filter builder, so search, RM scope and the
 * per-tenant data-visibility switch behave exactly as they do on Clients.
 */

import Link from "next/link";
import { and, desc, sql } from "drizzle-orm";
import { HeartHandshake, Users2 } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { investors, users } from "@/db/schema";
import { formatINR } from "@/lib/utils";
import { buildInvestorWhere } from "@/lib/investors/list-filters";
import { investorScopeCondition } from "@/lib/investors/access";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";
import { Pager } from "@/components/common/Pager";
import { MapClientActions } from "@/components/families/MapClientActions";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function UnmappedClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const session = await requireSession();
  requireAny(
    session.roles,
    ["family.view", "investor.view.all", "investor.view.assigned"],
    session.permissions
  );

  const page = Math.max(1, parseInt(sp.page ?? "1", 10) || 1);

  const { rows, total, mappedCount } = await withTenant(
    session.tenantId,
    async (tx) => {
      const scope = await investorScopeCondition(tx, session);
      // `unmapped` is a quick-filter on the shared builder, so this page can't
      // drift from how Clients filters and searches.
      const filters = buildInvestorWhere({ ...sp, unmapped: "1" }, session.userId);
      const where = scope ? and(filters, scope) : filters;

      const r = await tx
        .select({
          id: investors.id,
          name: investors.name,
          pan: investors.pan,
          phone: investors.phone,
          aum: investors.aum,
          segmentTag: investors.segmentTag,
          rmName: users.name,
        })
        .from(investors)
        .leftJoin(users, sql`${users.id} = ${investors.rmId}`)
        .where(where)
        .orderBy(desc(investors.aum))
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE);

      const c = await tx
        .select({ c: sql<number>`count(*)::int` })
        .from(investors)
        .where(where);

      // How many ARE mapped — the coverage number that makes the queue mean
      // something rather than being a bare list.
      const m = await tx.execute(sql`
        SELECT COUNT(*)::int AS c FROM investors
         WHERE tenant_id = ${session.tenantId}::uuid
           AND deleted_at IS NULL AND family_id IS NOT NULL
      `);

      return {
        rows: r,
        total: Number(c[0]?.c ?? 0),
        mappedCount: Number((m.rows[0] as { c?: number } | undefined)?.c ?? 0),
      };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const coverage = total + mappedCount > 0
    ? Math.round((mappedCount / (total + mappedCount)) * 100)
    : 0;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Unmapped clients</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Clients not linked to any household yet. Map them to see combined AUM, run
            household reviews and spot next-generation prospects.
          </p>
        </div>
        <Link href="/dashboard/families" className="btn-secondary text-sm shrink-0">
          <HeartHandshake className="size-4" /> Family mapping
        </Link>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Kpi label="Unmapped" value={total.toLocaleString("en-IN")} tone="amber" />
        <Kpi label="Mapped into households" value={mappedCount.toLocaleString("en-IN")} tone="emerald" />
        <Kpi label="Coverage" value={`${coverage}%`} tone={coverage >= 60 ? "emerald" : "amber"} />
      </div>

      <CompactFilterBar
        searchKey="q"
        searchPlaceholder="Search name, PAN or phone…"
        totalCount={total}
        filters={[
          {
            type: "flags",
            label: "Quick filters",
            options: [
              { key: "mine", label: "My clients" },
              { key: "hni", label: "HNI only" },
              { key: "tier_a", label: "Service tier A" },
            ],
          },
        ]}
      />

      <div className="border rounded-lg bg-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Users2 className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium text-foreground">
              {sp.q ? "No unmapped client matches that search." : "Every client is mapped to a household."}
            </div>
            {!sp.q && (
              <p className="mt-1 text-xs">Nothing to do here — that is the goal.</p>
            )}
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b bg-card">
                <tr>
                  <th className="text-left font-medium px-4 py-2">Client</th>
                  <th className="text-left font-medium py-2">PAN</th>
                  <th className="text-right font-medium py-2">AUM</th>
                  <th className="text-left font-medium pl-4 py-2">RM</th>
                  <th className="text-right font-medium px-4 py-2">Map into a household</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((i) => (
                  <tr key={i.id} className="hover:bg-secondary/30">
                    <td className="px-4 py-3">
                      <Link href={`/dashboard/investors/${i.id}`} className="font-medium hover:underline">
                        {i.name}
                      </Link>
                      <div className="text-2xs text-muted-foreground">
                        {[i.phone, i.segmentTag].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </td>
                    <td className="py-3 font-mono text-xs text-muted-foreground">{i.pan ?? "—"}</td>
                    <td className="py-3 text-right tabular-nums">{formatINR(Number(i.aum ?? 0))}</td>
                    <td className="pl-4 py-3 text-xs text-muted-foreground">{i.rmName ?? "—"}</td>
                    <td className="px-4 py-3">
                      <MapClientActions investorId={i.id} investorName={i.name} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 0 && (
          <Pager page={page} totalPages={totalPages} total={total} pageSize={PAGE_SIZE} />
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: "amber" | "emerald" }) {
  return (
    <div className="border rounded-lg bg-card p-4">
      <div className="text-2xs uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div
        className={`mt-1 text-2xl font-bold tabular-nums ${
          tone === "emerald" ? "text-emerald-600" : "text-amber-600"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
