/**
 * Financial Year Wise Report — per client, the last four FYs side by side:
 * fresh money in, money out, net, and the realised gain the FIFO engine
 * attributes to that year. The FY chip picks which year leads the columns;
 * the three before it follow.
 */

import Link from "next/link";
import { Users, ArrowDownToLine, ArrowUpFromLine, TrendingUp } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { formatINR } from "@/lib/utils";
import { loadFirmTxGroups, fyWiseByClient, fyChoices, parseFy, fyLabel } from "@/lib/tax/firm-gains";
import { TaxReportShell, Stat, signedINR } from "@/components/reports/TaxReportShell";
import { ReportExportButtons } from "@/components/reports/ReportExportButtons";

export const dynamic = "force-dynamic";

export default async function FyWisePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  requireAny(session.roles, ["reports.business", "reports.team", "investor.view.all", "investor.view.assigned"], session.permissions);
  const seesAll =
    can(session.roles, "investor.view.all", session.permissions) ||
    can(session.roles, "reports.business", session.permissions) ||
    can(session.roles, "reports.team", session.permissions);
  const sp = await searchParams;
  const fy = parseFy(sp.fy);
  const fys = fyChoices();
  const cols = [fy, fy - 1, fy - 2, fy - 3];

  const rows = await withTenant(session.tenantId, async (tx) => {
    const groups = await loadFirmTxGroups(tx, { tenantId: session.tenantId, rmId: seesAll ? undefined : session.userId });
    return fyWiseByClient(groups, cols);
  });

  const lead = rows.reduce(
    (a, r) => { const c = r.byFy[fy]; return { inflow: a.inflow + (c?.inflow ?? 0), outflow: a.outflow + (c?.outflow ?? 0), gain: a.gain + (c?.gain ?? 0) }; },
    { inflow: 0, outflow: 0, gain: 0 }
  );

  const exportRows = rows.map((r) => {
    const o: Record<string, string | number> = { client: r.name, pan: r.pan ?? "" };
    for (const y of cols) {
      const c = r.byFy[y];
      o[`${fyLabel(y)} in`] = c?.inflow ?? 0; o[`${fyLabel(y)} out`] = c?.outflow ?? 0; o[`${fyLabel(y)} net`] = c?.net ?? 0; o[`${fyLabel(y)} gain`] = c?.gain ?? 0;
    }
    return o;
  });
  const exportCols = [{ key: "client", label: "Client" }, { key: "pan", label: "PAN" }, ...cols.flatMap((y) => ["in", "out", "net", "gain"].map((k) => ({ key: `${fyLabel(y)} ${k}`, label: `${fyLabel(y)} ${k}` })))];

  return (
    <TaxReportShell
      active="fywise"
      fy={fy}
      fys={fys}
      title={`Financial year wise — ${fyLabel(cols[3])} to ${fyLabel(cols[0])}`}
      subtitle="Net = fresh money in minus money out (reinvested IDCW excluded). Gain = realised STCG + LTCG in that year."
      right={<ReportExportButtons rows={exportRows} columns={exportCols} filename={`fy-wise-${fy}`} />}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Users} label="Active clients (4 FYs)" value={String(rows.length)} />
        <Stat icon={ArrowDownToLine} label={`Inflows · ${fyLabel(fy)}`} value={formatINR(lead.inflow)} />
        <Stat icon={ArrowUpFromLine} label={`Redemptions · ${fyLabel(fy)}`} value={formatINR(lead.outflow)} />
        <Stat icon={TrendingUp} label={`Realised gain · ${fyLabel(fy)}`} value={signedINR(lead.gain, formatINR)} tone={lead.gain >= 0 ? "good" : "bad"} />
      </div>

      <div className="card-surface overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">No transactions in these four financial years{seesAll ? "" : " in your book"}.</div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b bg-secondary/30">
                <tr>
                  <th className="text-left py-2 px-4 font-medium" rowSpan={2}>Client</th>
                  {cols.map((y) => (
                    <th key={y} className="text-center py-2 px-2 font-semibold border-l border-border" colSpan={2}>{fyLabel(y)}</th>
                  ))}
                </tr>
                <tr>
                  {cols.map((y) => (
                    <>
                      <th key={`${y}-n`} className="text-right py-1.5 px-2 font-medium border-l border-border">Net</th>
                      <th key={`${y}-g`} className="text-right py-1.5 px-2 font-medium">Gain</th>
                    </>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.investorId} className="border-b last:border-0 hover:bg-secondary/30">
                    <td className="py-2.5 px-4">
                      <Link href={`/dashboard/investors/${r.investorId}`} className="font-medium hover:underline">{r.name}</Link>
                      {r.pan && <div className="text-[11px] font-mono text-muted-foreground">{r.pan}</div>}
                    </td>
                    {cols.map((y) => {
                      const c = r.byFy[y];
                      return (
                        <>
                          <td key={`${y}-n`} className={`py-2.5 px-2 text-right tabular-nums border-l border-border ${(c?.net ?? 0) < 0 ? "text-rose-700" : ""}`} title={c ? `In ${formatINR(c.inflow)} · Out ${formatINR(c.outflow)}` : ""}>
                            {c && (c.inflow || c.outflow) ? signedINR(c.net, formatINR) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td key={`${y}-g`} className={`py-2.5 px-2 text-right tabular-nums ${(c?.gain ?? 0) < 0 ? "text-rose-700" : (c?.gain ?? 0) > 0 ? "text-emerald-700" : "text-muted-foreground"}`}>
                            {c && c.gain ? signedINR(c.gain, formatINR) : "—"}
                          </td>
                        </>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </TaxReportShell>
  );
}
