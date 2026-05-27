import Link from "next/link";
import { desc, eq, sql } from "drizzle-orm";
import { Plus, HeartHandshake } from "lucide-react";
import { withTenant } from "@/db/client";
import { families, investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { formatINR, formatRelative } from "@/lib/utils";
import { RowActions } from "@/components/common/RowActions";

export const dynamic = "force-dynamic";

export default async function FamiliesPage() {
  const session = await requireSession();
  const rows = await withTenant(session.tenantId, async (tx) => {
    return tx.execute(sql`
      SELECT f.id, f.head_name, f.notes, f.created_at, f.updated_at,
             COUNT(i.id)::int AS member_count,
             COALESCE(SUM(i.aum::numeric), 0)::numeric AS family_aum,
             COALESCE(SUM(i.active_sip_amount::numeric), 0)::numeric AS family_sip
      FROM families f
      LEFT JOIN investors i ON i.family_id = f.id AND i.status = 'active'
      GROUP BY f.id
      ORDER BY family_aum DESC NULLS LAST
      LIMIT 100
    `);
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Family mapping</h1>
          <p className="text-muted-foreground text-sm">
            Track family-level wealth — combined AUM, multi-gen onboarding, family goals.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard/families/at-risk"
            className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 px-3 py-1.5 text-sm font-medium flex items-center gap-1.5 hover:bg-amber-100"
          >
            ⚠ Next-gen pulse
          </Link>
          <Link
            href="/dashboard/families/new"
            className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium flex items-center gap-1.5"
          >
            <Plus className="size-4" /> New family
          </Link>
        </div>
      </div>

      <div className="border rounded-lg bg-card">
        {rows.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <HeartHandshake className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2">No families mapped yet.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              Group existing investors into families to see combined AUM and run next-gen
              onboarding plays.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Family</th>
                <th className="text-right py-2 font-medium">Members</th>
                <th className="text-right py-2 font-medium">Combined AUM</th>
                <th className="text-right py-2 font-medium">Combined SIP</th>
                <th className="text-left py-2 font-medium pl-4">Updated</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(rows.rows as any[]).map((f) => (
                <tr key={f.id} className="border-b last:border-0 hover:bg-accent/40">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/families/${f.id}`} className="font-medium hover:underline">
                      {f.head_name}
                    </Link>
                    {f.notes && (
                      <div className="text-xs text-muted-foreground truncate max-w-md mt-0.5">
                        {f.notes}
                      </div>
                    )}
                  </td>
                  <td className="py-3 text-right tabular-nums">{f.member_count}</td>
                  <td className="py-3 text-right tabular-nums">{formatINR(Number(f.family_aum ?? 0))}</td>
                  <td className="py-3 text-right tabular-nums text-muted-foreground">
                    {formatINR(Number(f.family_sip ?? 0))}
                  </td>
                  <td className="py-3 pl-4 text-xs text-muted-foreground">{formatRelative(f.updated_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <RowActions
                      editHref={`/dashboard/families/${f.id}`}
                      deleteUrl={`/api/families/${f.id}`}
                      itemLabel="family"
                      itemName={f.head_name}
                      verb="Delete"
                      permanent
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
