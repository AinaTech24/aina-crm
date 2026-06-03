/**
 * Tax-harvesting report — which clients have unrealised long-term equity gains
 * that can be booked tax-free within this year's ₹1.25L LTCG exemption. A
 * year-end (Jan-Mar) worklist that adds real, measurable value: harvesting the
 * exemption every year saves each eligible client up to ₹15,625 of tax.
 */

import Link from "next/link";
import { Sprout, IndianRupee, Users, PiggyBank } from "lucide-react";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { users } from "@/db/schema";
import { formatINR } from "@/lib/utils";
import { scanTaxHarvest, LTCG_EXEMPTION } from "@/lib/tax/harvesting";

export const dynamic = "force-dynamic";

export default async function TaxHarvestingPage() {
  const session = await requireSession();
  requireAny(session.roles, ["reports.business", "reports.team", "investor.view.all", "investor.view.assigned"], session.permissions);

  const data = await withTenant(session.tenantId, async (tx) => {
    const rows = await scanTaxHarvest(tx, { limit: 200 });
    const rmRows = await tx.select({ id: users.id, name: users.name }).from(users);
    return { rows, rmMap: new Map(rmRows.map((r) => [r.id, r.name])) };
  });

  const totalHarvestable = data.rows.reduce((s, r) => s + r.harvestable, 0);
  const totalTaxSaved = data.rows.reduce((s, r) => s + r.taxSaved, 0);

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h1 className="page-title">
          <Sprout className="size-6 text-emerald-600" /> Tax-harvesting opportunities
        </h1>
        <p className="page-subtitle">
          Clients sitting on unrealised long-term equity gains they can book tax-free under this
          year&apos;s {formatINR(LTCG_EXEMPTION)} LTCG exemption. Harvest before 31 March to use the
          allowance — it doesn&apos;t carry forward.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat icon={Users} label="Clients with an opportunity" value={String(data.rows.length)} />
        <Stat icon={IndianRupee} label="Total harvestable gain" value={totalHarvestable > 0 ? formatINR(totalHarvestable) : "—"} tone="emerald" />
        <Stat icon={PiggyBank} label="Est. tax saved" value={totalTaxSaved > 0 ? formatINR(Math.round(totalTaxSaved)) : "—"} tone="emerald" />
      </div>

      <div className="card-surface overflow-hidden">
        {data.rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Sprout className="size-8 mx-auto text-muted-foreground/50" />
            <div className="mt-2 font-medium">No harvestable long-term gains right now.</div>
            <p className="mt-2 text-xs max-w-md mx-auto">
              Opportunities appear once clients hold equity funds for over a year with an unrealised
              gain. Make sure transactions are imported with AMFI scheme codes so gains can be priced.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Client</th>
                <th className="text-left py-2 font-medium">Top long-term holdings</th>
                <th className="text-left py-2 font-medium">RM</th>
                <th className="text-right py-2 font-medium">LT gain</th>
                <th className="text-right py-2 font-medium">Harvest now</th>
                <th className="text-right px-4 py-2 font-medium">Tax saved</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.investorId} className="border-b last:border-0 hover:bg-secondary/40 align-top">
                  <td className="px-4 py-3">
                    <Link href={`/dashboard/investors/${r.investorId}`} className="font-medium hover:underline">
                      {r.investorName}
                    </Link>
                  </td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-1 max-w-md">
                      {r.holdings.slice(0, 3).map((h, i) => (
                        <span key={i} className="chip bg-secondary text-[10px]">
                          {h.schemeName} · {formatINR(Math.round(h.longTermGain))}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 text-xs text-muted-foreground">{r.rmId ? data.rmMap.get(r.rmId) ?? "—" : "—"}</td>
                  <td className="py-3 text-right tabular-nums">{formatINR(Math.round(r.longTermGain))}</td>
                  <td className="py-3 text-right tabular-nums font-semibold text-emerald-700">{formatINR(Math.round(r.harvestable))}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700">{formatINR(Math.round(r.taxSaved))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground italic">
        Estimate for planning only — cost basis approximates the remaining lots and excludes exit
        load / STT. Confirm exact figures from the client&apos;s CAS before transacting, and account
        for any LTCG the client has already realised this year.
      </p>
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "emerald" }) {
  return (
    <div className="kpi-card">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{label}</span>
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${tone === "emerald" ? "text-emerald-600" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}
