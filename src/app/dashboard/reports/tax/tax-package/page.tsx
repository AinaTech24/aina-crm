/**
 * Tax Package — one PDF per client for the FY: realised capital gains (FIFO
 * working), IDCW received, and the unrealised position as of today, on the
 * firm's letterhead. The list shows every client with a taxable event in the
 * year so the MFD can work down it in January.
 */

import Link from "next/link";
import { Users, FileText, Receipt, IndianRupee } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireAny, can } from "@/lib/auth/rbac";
import { formatINR } from "@/lib/utils";
import { loadFirmTxGroups, realisedByClient, loadDividendsByClient, fyChoices, parseFy, fyLabel } from "@/lib/tax/firm-gains";
import { TaxReportShell, Stat, signedINR } from "@/components/reports/TaxReportShell";
import { DownloadButton, OpenDocButton } from "@/components/common/SecureLinkButtons";

export const dynamic = "force-dynamic";

export default async function TaxPackagePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
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
    const rmId = seesAll ? undefined : session.userId;
    const [groups, dividends] = await Promise.all([
      loadFirmTxGroups(tx, { tenantId: session.tenantId, rmId }),
      loadDividendsByClient(tx, { tenantId: session.tenantId, fy, rmId }),
    ]);
    const realised = realisedByClient(groups, fy);
    // Union of clients with a taxable event: a redemption OR any IDCW in the FY.
    const byId = new Map<string, { investorId: string; name: string; pan: string | null; stcg: number; ltcg: number; ltcgTaxable: number; idcw: number }>();
    for (const r of realised) byId.set(r.investorId, { investorId: r.investorId, name: r.name, pan: r.pan, stcg: r.stcg, ltcg: r.ltcg, ltcgTaxable: r.ltcgTaxable, idcw: 0 });
    for (const d of dividends) {
      const e = byId.get(d.investorId) ?? { investorId: d.investorId, name: d.name, pan: d.pan, stcg: 0, ltcg: 0, ltcgTaxable: 0, idcw: 0 };
      e.idcw = d.total;
      byId.set(d.investorId, e);
    }
    return [...byId.values()].sort((a, b) => (b.ltcgTaxable + Math.max(0, b.stcg) + b.idcw) - (a.ltcgTaxable + Math.max(0, a.stcg) + a.idcw));
  });

  const t = rows.reduce((a, r) => ({ taxable: a.taxable + r.ltcgTaxable + Math.max(0, r.stcg), idcw: a.idcw + r.idcw }), { taxable: 0, idcw: 0 });

  return (
    <TaxReportShell
      active="package"
      fy={fy}
      fys={fys}
      title={`Tax package — ${fyLabel(fy)}`}
      subtitle="One PDF per client on your letterhead: realised gains (FIFO working), IDCW received, and today's unrealised position."
    >
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat icon={Users} label="Clients with a taxable event" value={String(rows.length)} />
        <Stat icon={Receipt} label="Taxable gains (STCG + LTCG over ₹1.25 L)" value={formatINR(t.taxable)} tone={t.taxable > 0 ? "bad" : "good"} />
        <Stat icon={IndianRupee} label="IDCW income" value={formatINR(t.idcw)} />
      </div>

      <div className="card-surface overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No client has a redemption or IDCW in {fyLabel(fy)}{seesAll ? "" : " in your book"} — nothing to package.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b bg-secondary/30">
                <tr>
                  <th className="text-left py-2.5 px-4 font-medium">Client</th>
                  <th className="text-left py-2.5 px-3 font-medium">PAN</th>
                  <th className="text-right py-2.5 px-3 font-medium">STCG</th>
                  <th className="text-right py-2.5 px-3 font-medium">LTCG</th>
                  <th className="text-right py-2.5 px-3 font-medium">LTCG taxable</th>
                  <th className="text-right py-2.5 px-3 font-medium">IDCW</th>
                  <th className="text-right py-2.5 px-4 font-medium">Tax package</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.investorId} className="border-b last:border-0 hover:bg-secondary/30">
                    <td className="py-2.5 px-4 font-medium"><Link href={`/dashboard/investors/${r.investorId}`} className="hover:underline">{r.name}</Link></td>
                    <td className="py-2.5 px-3 font-mono text-xs text-muted-foreground">{r.pan ?? "—"}</td>
                    <td className={`py-2.5 px-3 text-right tabular-nums ${r.stcg < 0 ? "text-rose-700" : ""}`}>{r.stcg ? signedINR(r.stcg, formatINR) : "—"}</td>
                    <td className={`py-2.5 px-3 text-right tabular-nums ${r.ltcg < 0 ? "text-rose-700" : ""}`}>{r.ltcg ? signedINR(r.ltcg, formatINR) : "—"}</td>
                    <td className={`py-2.5 px-3 text-right tabular-nums font-semibold ${r.ltcgTaxable > 0 ? "text-rose-700" : "text-emerald-700"}`}>{r.ltcgTaxable > 0 ? formatINR(r.ltcgTaxable) : "Nil"}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{r.idcw ? formatINR(r.idcw) : "—"}</td>
                    <td className="py-2.5 px-4 text-right whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        <OpenDocButton url={`/api/investors/${r.investorId}/tax-package/pdf?fy=${fy}`} className="text-xs text-muted-foreground hover:text-foreground px-1.5 py-1" title="Preview PDF">
                          Preview
                        </OpenDocButton>
                        <DownloadButton
                          url={`/api/investors/${r.investorId}/tax-package/pdf?fy=${fy}&download=1`}
                          className="btn-secondary text-xs inline-flex items-center gap-1"
                          title="Download the tax package PDF"
                        >
                          <FileText className="size-3.5" /> Download PDF
                        </DownloadButton>
                      </span>
                    </td>
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
