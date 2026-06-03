import Link from "next/link";
import { sql } from "drizzle-orm";
import { IndianRupee, TrendingUp, FileText, Repeat, Shield } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { formatINR } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Indicative renewal-commission rate on annual premium (estimate; varies by line/insurer). */
const RENEWAL_RATE = 0.05;

export default async function InsuranceCommissionPage() {
  const session = await requireSession();

  const data = await withTenant(session.tenantId, async (tx) => {
    const totals = (await tx.execute(sql`
      SELECT
        COALESCE(SUM(commission_paisa::numeric), 0)::numeric AS recorded,
        COUNT(*) FILTER (WHERE commission_paisa IS NOT NULL AND commission_paisa::numeric > 0)::int AS with_comm,
        COALESCE(SUM(annual_premium::numeric) FILTER (WHERE status='active'), 0)::numeric AS premium_book,
        COUNT(*) FILTER (WHERE status='active')::int AS active
      FROM insurance_policies WHERE tenant_id = ${session.tenantId}::uuid
    `)).rows[0] as any;

    const byInsurer = (await tx.execute(sql`
      SELECT insurer,
        COUNT(*)::int AS policies,
        COUNT(*) FILTER (WHERE status='active')::int AS active,
        COALESCE(SUM(annual_premium::numeric) FILTER (WHERE status='active'), 0)::numeric AS premium_book,
        COALESCE(SUM(commission_paisa::numeric), 0)::numeric AS recorded
      FROM insurance_policies WHERE tenant_id = ${session.tenantId}::uuid
      GROUP BY insurer ORDER BY premium_book DESC LIMIT 30
    `)).rows as any[];
    return { totals, byInsurer };
  });

  const t = data.totals ?? {};
  const premiumBook = Number(t.premium_book ?? 0);
  const estRenewal = premiumBook * RENEWAL_RATE;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2"><IndianRupee className="size-6 text-brand-cyan" /> Insurance Commission</h1>
          <p className="text-muted-foreground text-sm">Your insurance earnings — recorded commission + the recurring renewal income your active book throws off each year.</p>
        </div>
        <Link href="/dashboard/insurance/renewals" className="btn-secondary text-sm"><Repeat className="size-4" /> Renewals due</Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={IndianRupee} label="Recorded commission" value={formatINR(Number(t.recorded ?? 0))} tone="emerald" />
        <Kpi icon={Shield} label="Active premium book" value={formatINR(premiumBook)} />
        <Kpi icon={Repeat} label="Est. renewal income / yr" value={formatINR(estRenewal)} tone="emerald" />
        <Kpi icon={FileText} label="Active policies" value={String(t.active ?? 0)} />
      </div>

      <div className="card-surface overflow-x-auto">
        <div className="px-4 py-3 border-b font-semibold text-sm flex items-center gap-2"><TrendingUp className="size-4 text-brand-cyan" /> By insurer</div>
        {data.byInsurer.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">No policies in the register yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr><th className="text-left px-4 py-2 font-medium">Insurer</th><th className="text-right py-2 font-medium">Policies</th><th className="text-right py-2 font-medium">Active</th><th className="text-right py-2 font-medium">Premium book</th><th className="text-right py-2 font-medium">Recorded comm.</th><th className="text-right py-2 font-medium pr-4">Est. renewal/yr</th></tr>
            </thead>
            <tbody>
              {data.byInsurer.map((r) => (
                <tr key={r.insurer} className="border-b last:border-0 hover:bg-secondary/40">
                  <td className="px-4 py-2.5 font-medium">{r.insurer ?? "—"}</td>
                  <td className="py-2.5 text-right tabular-nums">{r.policies}</td>
                  <td className="py-2.5 text-right tabular-nums text-muted-foreground">{r.active}</td>
                  <td className="py-2.5 text-right tabular-nums">{formatINR(Number(r.premium_book))}</td>
                  <td className="py-2.5 text-right tabular-nums text-emerald-700">{Number(r.recorded) > 0 ? formatINR(Number(r.recorded)) : "—"}</td>
                  <td className="py-2.5 text-right tabular-nums pr-4 text-emerald-700">{formatINR(Number(r.premium_book) * RENEWAL_RATE)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground italic">Renewal income is an estimate at {Math.round(RENEWAL_RATE * 100)}% of active annual premium — actual rates vary by line and insurer. Record per-policy commission on the policy to track real figures.</p>
    </div>
  );
}

function Kpi({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "emerald" }) {
  return (
    <div className="card-surface p-4">
      <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><Icon className="size-3.5 text-muted-foreground" /></div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${tone === "emerald" ? "text-emerald-600" : "text-foreground"}`}>{value}</div>
    </div>
  );
}
