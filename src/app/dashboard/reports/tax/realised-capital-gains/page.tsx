/**
 * Realised Capital Gain — firm-wide, per client, for one FY.
 *
 * The number an MFD is asked for from January to July: who booked gains, how
 * much was short-term vs long-term, and how much long-term gain is actually
 * taxable after the ₹1.25 L exemption. Each row opens the client's full FIFO
 * statement (the per-redemption working) for the same FY.
 */

import Link from "next/link";
import { Users, TrendingUp, Landmark, Receipt } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { formatINR } from "@/lib/utils";
import { loadFirmTxGroups, realisedByClient, fyChoices, parseFy, fyLabel } from "@/lib/tax/firm-gains";
import { TaxReportShell, Stat, signedINR } from "@/components/reports/TaxReportShell";
import { ReportExportButtons } from "@/components/reports/ReportExportButtons";

export const dynamic = "force-dynamic";

export default async function RealisedCapitalGainsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  requireAny(session.roles, ["reports.business", "reports.team", "investor.view.all", "investor.view.assigned"], session.permissions);
  const seesAll =
    can(session.roles, "investor.view.all", session.permissions) ||
    can(session.roles, "reports.business", session.permissions) ||
    can(session.roles, "reports.team", session.permissions);
  const sp = await searchParams;
  const fy = parseFy(sp.fy);
  const fys = fyChoices();

  const rows = await withTenant(session.tenantId, async (tx) => {
    const groups = await loadFirmTxGroups(tx, { tenantId: session.tenantId, rmId: seesAll ? undefined : session.userId });
    return realisedByClient(groups, fy);
  });

  const t = rows.reduce(
    (a, r) => ({ stcg: a.stcg + r.stcg, ltcg: a.ltcg + r.ltcg, taxable: a.taxable + r.ltcgTaxable, proceeds: a.proceeds + r.proceeds }),
    { stcg: 0, ltcg: 0, taxable: 0, proceeds: 0 }
  );

  const exportRows = rows.map((r) => ({
    client: r.name, pan: r.pan ?? "", sells: r.sells, proceeds: r.proceeds, cost: r.cost,
    stcg: r.stcg, ltcg: r.ltcg, ltcg_taxable: r.ltcgTaxable, total_gain: r.total,
  }));
  const exportCols = [
    { key: "client", label: "Client" }, { key: "pan", label: "PAN" }, { key: "sells", label: "Redemptions" },
    { key: "proceeds", label: "Sale proceeds" }, { key: "cost", label: "Cost" }, { key: "stcg", label: "STCG" },
    { key: "ltcg", label: "LTCG" }, { key: "ltcg_taxable", label: "LTCG taxable" }, { key: "total_gain", label: "Total gain" },
  ];

  return (
    <TaxReportShell
      active="realised"
      fy={fy}
      fys={fys}
      title={`Realised capital gains — ${fyLabel(fy)}`}
      subtitle="Gains and losses booked on redemptions, switches and SWPs settled in this financial year."
      right={<ReportExportButtons rows={exportRows} columns={exportCols} filename={`realised-capital-gains-${fy}`} />}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Users} label="Clients with redemptions" value={String(rows.length)} />
        <Stat icon={TrendingUp} label="Short-term gain" value={signedINR(t.stcg, formatINR)} tone={t.stcg >= 0 ? undefined : "bad"} />
        <Stat icon={Landmark} label="Long-term gain" value={signedINR(t.ltcg, formatINR)} tone={t.ltcg >= 0 ? undefined : "bad"} />
        <Stat icon={Receipt} label="LTCG taxable (after ₹1.25 L each)" value={formatINR(t.taxable)} tone={t.taxable > 0 ? "bad" : "good"} />
      </div>

      <div className="card-surface overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No redemptions settled in {fyLabel(fy)}{seesAll ? "" : " in your book"}. Try another financial year.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b bg-secondary/30">
                <tr>
                  <th className="text-left py-2.5 px-4 font-medium">Client</th>
                  <th className="text-left py-2.5 px-3 font-medium">PAN</th>
                  <th className="text-right py-2.5 px-3 font-medium">Redemptions</th>
                  <th className="text-right py-2.5 px-3 font-medium">Proceeds</th>
                  <th className="text-right py-2.5 px-3 font-medium">Cost</th>
                  <th className="text-right py-2.5 px-3 font-medium">STCG</th>
                  <th className="text-right py-2.5 px-3 font-medium">LTCG</th>
                  <th className="text-right py-2.5 px-3 font-medium">LTCG taxable</th>
                  <th className="text-right py-2.5 px-4 font-medium">Statement</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.investorId} className="border-b last:border-0 hover:bg-secondary/30">
                    <td className="py-2.5 px-4 font-medium">
                      <Link href={`/dashboard/investors/${r.investorId}`} className="hover:underline">{r.name}</Link>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">{r.pan ?? "—"}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{r.sells}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{formatINR(r.proceeds)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">{formatINR(r.cost)}</td>
                    <td className={`py-2.5 px-3 text-right tabular-nums ${r.stcg < 0 ? "text-rose-700" : ""}`}>{signedINR(r.stcg, formatINR)}</td>
                    <td className={`py-2.5 px-3 text-right tabular-nums ${r.ltcg < 0 ? "text-rose-700" : ""}`}>{signedINR(r.ltcg, formatINR)}</td>
                    <td className={`py-2.5 px-3 text-right tabular-nums font-semibold ${r.ltcgTaxable > 0 ? "text-rose-700" : "text-emerald-700"}`}>
                      {r.ltcgTaxable > 0 ? formatINR(r.ltcgTaxable) : "Nil"}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <Link href={`/dashboard/investors/${r.investorId}/capital-gains?fy=${fy}`} className="text-xs text-primary hover:underline">
                        View FIFO working
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-xs border-t bg-secondary/20">
                <tr>
                  <td className="py-2.5 px-4 font-semibold" colSpan={3}>Total · {rows.length} client{rows.length === 1 ? "" : "s"}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-semibold">{formatINR(t.proceeds)}</td>
                  <td className="py-2.5 px-3" />
                  <td className="py-2.5 px-3 text-right tabular-nums font-semibold">{signedINR(t.stcg, formatINR)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-semibold">{signedINR(t.ltcg, formatINR)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-semibold">{formatINR(t.taxable)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </TaxReportShell>
  );
}
