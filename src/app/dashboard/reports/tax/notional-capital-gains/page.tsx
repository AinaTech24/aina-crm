/**
 * Notional (unrealised) Capital Gain — what each client would book if they
 * redeemed today, priced at the latest AMFI NAV, split long/short-term by lot
 * age. The LTCG headroom column is the actionable bit: long-term equity gain
 * that still fits inside this year's ₹1.25 L exemption (see Tax-harvesting).
 */

import Link from "next/link";
import { Users, Wallet, TrendingUp, Sprout } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { formatINR } from "@/lib/utils";
import { loadFirmTxGroups, loadLatestNav, notionalByClient, fyChoices, parseFy, fyLabel } from "@/lib/tax/firm-gains";
import { TaxReportShell, Stat, signedINR } from "@/components/reports/TaxReportShell";
import { ReportExportButtons } from "@/components/reports/ReportExportButtons";

export const dynamic = "force-dynamic";

export default async function NotionalCapitalGainsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await requireSession();
  requireAny(session.roles, ["reports.business", "reports.team", "investor.view.all", "investor.view.assigned"], session.permissions);
  const seesAll =
    can(session.roles, "investor.view.all", session.permissions) ||
    can(session.roles, "reports.business", session.permissions) ||
    can(session.roles, "reports.team", session.permissions);
  const sp = await searchParams;
  const fy = parseFy(sp.fy);
  const fys = fyChoices();

  const { rows, navCount } = await withTenant(session.tenantId, async (tx) => {
    const [groups, nav] = await Promise.all([
      loadFirmTxGroups(tx, { tenantId: session.tenantId, rmId: seesAll ? undefined : session.userId }),
      loadLatestNav(tx),
    ]);
    return { rows: notionalByClient(groups, nav, fy), navCount: nav.size };
  });

  const t = rows.reduce(
    (a, r) => ({ invested: a.invested + r.invested, current: a.current + r.current, lt: a.lt + r.unrealisedLt, st: a.st + r.unrealisedSt, head: a.head + r.ltcgHeadroom, unpriced: a.unpriced + r.unpriced }),
    { invested: 0, current: 0, lt: 0, st: 0, head: 0, unpriced: 0 }
  );

  const exportRows = rows.map((r) => ({
    client: r.name, pan: r.pan ?? "", lots: r.lots, unpriced_lots: r.unpriced, invested: r.invested, current_value: r.current,
    unrealised_lt: r.unrealisedLt, unrealised_st: r.unrealisedSt, unrealised_total: r.unrealised, ltcg_headroom: r.ltcgHeadroom,
  }));
  const exportCols = [
    { key: "client", label: "Client" }, { key: "pan", label: "PAN" }, { key: "lots", label: "Open lots" }, { key: "unpriced_lots", label: "Unpriced lots" },
    { key: "invested", label: "Cost of open lots" }, { key: "current_value", label: "Current value" }, { key: "unrealised_lt", label: "Unrealised LT" },
    { key: "unrealised_st", label: "Unrealised ST" }, { key: "unrealised_total", label: "Unrealised total" }, { key: "ltcg_headroom", label: "LTCG headroom" },
  ];

  return (
    <TaxReportShell
      active="notional"
      fy={fy}
      fys={fys}
      title="Notional capital gains — as of today"
      subtitle={`Open FIFO lots priced at the latest NAV. Headroom uses LTCG already realised in ${fyLabel(fy)}.`}
      right={<ReportExportButtons rows={exportRows} columns={exportCols} filename={`notional-capital-gains-${fy}`} />}
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Users} label="Clients with open lots" value={String(rows.length)} />
        <Stat icon={Wallet} label="Current value (priced)" value={formatINR(t.current)} />
        <Stat icon={TrendingUp} label="Unrealised gain (LT + ST)" value={signedINR(t.lt + t.st, formatINR)} tone={t.lt + t.st >= 0 ? "good" : "bad"} />
        <Stat icon={Sprout} label="LTCG headroom this FY" value={formatINR(t.head)} tone="good" />
      </div>

      {(t.unpriced > 0 || navCount === 0) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800">
          {navCount === 0
            ? "No NAVs are loaded yet — values show cost only until the AMFI NAV feed runs."
            : `${t.unpriced} lot${t.unpriced === 1 ? "" : "s"} could not be priced (no NAV for the scheme code) and are excluded from current value and gain.`}
        </div>
      )}

      <div className="card-surface overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">No open holdings found{seesAll ? "" : " in your book"}.</div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b bg-secondary/30">
                <tr>
                  <th className="text-left py-2.5 px-4 font-medium">Client</th>
                  <th className="text-left py-2.5 px-3 font-medium">PAN</th>
                  <th className="text-right py-2.5 px-3 font-medium">Lots</th>
                  <th className="text-right py-2.5 px-3 font-medium">Cost</th>
                  <th className="text-right py-2.5 px-3 font-medium">Current value</th>
                  <th className="text-right py-2.5 px-3 font-medium">Unrealised LT</th>
                  <th className="text-right py-2.5 px-3 font-medium">Unrealised ST</th>
                  <th className="text-right py-2.5 px-3 font-medium">Total</th>
                  <th className="text-right py-2.5 px-4 font-medium">LTCG headroom</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.investorId} className="border-b last:border-0 hover:bg-secondary/30">
                    <td className="py-2.5 px-4 font-medium">
                      <Link href={`/dashboard/investors/${r.investorId}`} className="hover:underline">{r.name}</Link>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">{r.pan ?? "—"}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {r.lots}{r.unpriced > 0 && <span className="text-2xs text-amber-700 ml-1" title="lots without a NAV">({r.unpriced} unpriced)</span>}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-muted-foreground">{formatINR(r.invested)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{formatINR(r.current)}</td>
                    <td className={`py-2.5 px-3 text-right tabular-nums ${r.unrealisedLt < 0 ? "text-rose-700" : ""}`}>{signedINR(r.unrealisedLt, formatINR)}</td>
                    <td className={`py-2.5 px-3 text-right tabular-nums ${r.unrealisedSt < 0 ? "text-rose-700" : ""}`}>{signedINR(r.unrealisedSt, formatINR)}</td>
                    <td className={`py-2.5 px-3 text-right tabular-nums font-semibold ${r.unrealised < 0 ? "text-rose-700" : "text-emerald-700"}`}>{signedINR(r.unrealised, formatINR)}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums">{r.ltcgHeadroom > 0 ? formatINR(r.ltcgHeadroom) : <span className="text-muted-foreground">—</span>}</td>
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
