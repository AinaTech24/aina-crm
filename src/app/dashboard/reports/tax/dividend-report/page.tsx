/**
 * Dividend / IDCW Report — payouts and reinvestments received per client in a
 * FY. IDCW is taxed as income at the client's slab (and TDS applies above
 * ₹5,000 a year per AMC), so this is the line they need for "Income from other
 * sources" — reinvested IDCW counts too even though no cash arrived.
 */

import Link from "next/link";
import { Users, IndianRupee, Repeat, Banknote } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { formatINR } from "@/lib/utils";
import { loadDividendsByClient, fyChoices, parseFy, fyLabel } from "@/lib/tax/firm-gains";
import { TaxReportShell, Stat } from "@/components/reports/TaxReportShell";
import { ReportExportButtons } from "@/components/reports/ReportExportButtons";

export const dynamic = "force-dynamic";

export default async function DividendReportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  requireAny(session.roles, ["reports.business", "reports.team", "investor.view.all", "investor.view.assigned"], session.permissions);
  const seesAll =
    can(session.roles, "investor.view.all", session.permissions) ||
    can(session.roles, "reports.business", session.permissions) ||
    can(session.roles, "reports.team", session.permissions);
  const sp = await searchParams;
  const fy = parseFy(sp.fy);
  const fys = fyChoices();

  const rows = await withTenant(session.tenantId, (tx) =>
    loadDividendsByClient(tx, { tenantId: session.tenantId, fy, rmId: seesAll ? undefined : session.userId })
  );
  const t = rows.reduce((a, r) => ({ payout: a.payout + r.payout, reinvest: a.reinvest + r.reinvest }), { payout: 0, reinvest: 0 });

  const exportRows = rows.map((r) => ({ client: r.name, pan: r.pan ?? "", payout: r.payout, reinvest: r.reinvest, total: r.total, entries: r.entries }));
  const exportCols = [
    { key: "client", label: "Client" }, { key: "pan", label: "PAN" }, { key: "payout", label: "IDCW payout" },
    { key: "reinvest", label: "IDCW reinvested" }, { key: "total", label: "Total IDCW" }, { key: "entries", label: "Entries" },
  ];

  return (
    <TaxReportShell
      active="dividend"
      fy={fy}
      fys={fys}
      title={`Dividend / IDCW received — ${fyLabel(fy)}`}
      subtitle="Taxed as income at the client's slab. Reinvested IDCW is income too — the units bought with it start a new lot."
      right={<ReportExportButtons rows={exportRows} columns={exportCols} filename={`dividend-idcw-${fy}`} />}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Users} label="Clients receiving IDCW" value={String(rows.length)} />
        <Stat icon={Banknote} label="Paid out" value={formatINR(t.payout)} />
        <Stat icon={Repeat} label="Reinvested" value={formatINR(t.reinvest)} />
        <Stat icon={IndianRupee} label="Total IDCW income" value={formatINR(t.payout + t.reinvest)} tone="good" />
      </div>

      <div className="card-surface overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No IDCW recorded in {fyLabel(fy)}{seesAll ? "" : " in your book"}. Growth-plan books will show nothing here — that is the expected result.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b bg-secondary/30">
                <tr>
                  <th className="text-left py-2.5 px-4 font-medium">Client</th>
                  <th className="text-left py-2.5 px-3 font-medium">PAN</th>
                  <th className="text-right py-2.5 px-3 font-medium">Paid out</th>
                  <th className="text-right py-2.5 px-3 font-medium">Reinvested</th>
                  <th className="text-right py-2.5 px-3 font-medium">Total IDCW</th>
                  <th className="text-right py-2.5 px-4 font-medium">Entries</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.investorId} className="border-b last:border-0 hover:bg-secondary/30">
                    <td className="py-2.5 px-4 font-medium"><Link href={`/dashboard/investors/${r.investorId}`} className="hover:underline">{r.name}</Link></td>
                    <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">{r.pan ?? "—"}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{formatINR(r.payout)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{formatINR(r.reinvest)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-semibold">{formatINR(r.total)}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-muted-foreground">{r.entries}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="text-xs border-t bg-secondary/20">
                <tr>
                  <td className="py-2.5 px-4 font-semibold" colSpan={2}>Total</td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-semibold">{formatINR(t.payout)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-semibold">{formatINR(t.reinvest)}</td>
                  <td className="py-2.5 px-3 text-right tabular-nums font-semibold">{formatINR(t.payout + t.reinvest)}</td>
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
