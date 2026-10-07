import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
/**
 * Financial Discovery — list of fact-finds across leads & clients, with the
 * health score + status, plus "New discovery". The shareable client form is
 * titled "Financial Health Check".
 */

import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { desc, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { financialDiscoveries } from "@/db/schema";
import { formatRelative } from "@/lib/utils";
import { NewDiscoveryDialog } from "@/components/discovery/NewDiscoveryDialog";
import { HelpTip } from "@/components/common/HelpTip";
import { CompactFilterBar } from "@/components/common/CompactFilterBar";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-secondary text-muted-foreground",
  shared: "bg-blue-50 text-blue-700",
  submitted: "bg-amber-50 text-amber-700",
  reviewed: "bg-emerald-50 text-emerald-700",
};

export default async function DiscoveryListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  requireAny(session.roles, ["investor.view.all", "investor.view.assigned", "lead.view.all", "lead.view.assigned"], session.permissions);

  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100);

  // Search: every word must match the client or lead's name, the discovery's
  // title or its review type — "adesh manocha" finds "ADESH KUMAR MANOCHA".
  // The client / lead are read by the discovery's own subject, so a name typed
  // here can only find discoveries this firm already has.
  const words = q.split(/\s+/).filter(Boolean).slice(0, 6);
  const where = words.length
    ? sql.join(
        words.map((w) => {
          const p = `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
          return sql`(${financialDiscoveries.title} ILIKE ${p} OR ${financialDiscoveries.reviewType} ILIKE ${p}
            OR (${financialDiscoveries.subjectType} = 'investor' AND EXISTS (
                  SELECT 1 FROM investors i WHERE i.id = ${financialDiscoveries.subjectId} AND i.name ILIKE ${p}))
            OR (${financialDiscoveries.subjectType} = 'lead' AND EXISTS (
                  SELECT 1 FROM leads l WHERE l.id = ${financialDiscoveries.subjectId} AND l.name ILIKE ${p})))`;
        }),
        sql` AND `
      )
    : undefined;

  const rows = await withTenant(session.tenantId, (tx) =>
    tx.select().from(financialDiscoveries).where(where).orderBy(desc(financialDiscoveries.updatedAt)).limit(300)
  );

  const submitted = rows.filter((r) => r.status === "submitted").length;

  return (
    <div className="space-y-6 max-w-6xl">
      <PageHeaderCard title={<><ClipboardList className="size-6 text-muted-foreground" /> Discovery (Fact-find)
            <HelpTip title="Discovery (Fact-find)">
              A guided fact-find you fill with (or send to) a client before advising — goals,
              income, risk appetite. It produces a suitability view so your recommendations are
              documented and defensible.
            </HelpTip></>} actions={<><NewDiscoveryDialog /></>} />

      {submitted > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-2 text-sm text-amber-800">
          {submitted} discovery{submitted === 1 ? "" : "s"} submitted by clients and awaiting your review.
        </div>
      )}

      <CompactFilterBar totalCount={rows.length} searchPlaceholder="Search by client, lead or title…" filters={[]} />

      <div className="card-surface overflow-hidden">
        {rows.length === 0 && q ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No discoveries match <span className="font-medium text-foreground">&ldquo;{q}&rdquo;</span>.
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <ClipboardList className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No discoveries yet.</div>
            <p className="mt-1 text-xs">Click &ldquo;New discovery&rdquo; to start one for a client or lead.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Client / Lead</th>
                <th className="text-left py-2 font-medium">Type</th>
                <th className="text-left py-2 font-medium">Status</th>
                <th className="text-right py-2 font-medium">Health score</th>
                <th className="text-right px-4 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-secondary/40">
                  <td className="px-4 py-2.5">
                    <Link href={`/dashboard/discovery/${r.id}`} className="font-medium text-brand-cyan-deep hover:underline">
                      {r.title || "Untitled discovery"}
                    </Link>
                    {r.reviewType && <div className="text-2xs text-muted-foreground">{r.reviewType}</div>}
                  </td>
                  <td className="py-2.5 text-xs capitalize text-muted-foreground">{r.subjectType}</td>
                  <td className="py-2.5">
                    <span className={`text-2xs px-2 py-0.5 rounded-full capitalize ${STATUS_STYLE[r.status] ?? "bg-secondary"}`}>{r.status}</span>
                  </td>
                  <td className="py-2.5 text-right tabular-nums">
                    {r.healthScore != null ? (
                      <span className={`font-semibold ${r.healthScore >= 80 ? "text-emerald-600" : r.healthScore >= 60 ? "text-brand-cyan-deep" : r.healthScore >= 40 ? "text-amber-600" : "text-rose-600"}`}>{r.healthScore}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs text-muted-foreground tabular-nums">{formatRelative(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
