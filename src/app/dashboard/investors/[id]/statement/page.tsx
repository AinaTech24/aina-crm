import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
/**
 * Client account statement — opening balance, transactions, closing balance,
 * grouped by folio × scheme, for a date range.
 *
 * Print-friendly: the controls hide on print so the page IS the deliverable,
 * rather than needing a separate PDF pipeline to produce the same table.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, FileText, Printer } from "lucide-react";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { loadAccountStatement } from "@/lib/finance/account-statement";
import { formatDate } from "@/lib/format";
import { toLocalISODate } from "@/lib/dashboard/period";
import { DateField } from "@/components/ui/DateField";

export const dynamic = "force-dynamic";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const units = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 4 });
const fmtDate = (v: string) => {
  const d = new Date(v);
  return isNaN(d.getTime()) ? v : formatDate(d);
};

/** Default range: this financial year to date (Apr 1 → today), the period an
 *  Indian client actually asks for. */
function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const fyStart = new Date(now.getFullYear() - (now.getMonth() < 3 ? 1 : 0), 3, 1);
  // Local, not UTC: `toISOString()` on local midnight 1 April in IST yields
  // 2026-03-31, so the statement would silently open on 31 March and pull the
  // previous financial year's last day into this year's statement.
  return { from: toLocalISODate(fyStart), to: toLocalISODate(now) };
}

export default async function StatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const sp = await searchParams;
  const def = defaultRange();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? "") ? sp.from! : def.from;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? "") ? sp.to! : def.to;

  const data = await withTenant(
    session.tenantId,
    async (tx) => {
      const inv = (await tx.execute(sql`
        SELECT id, name, pan, email, phone FROM investors
         WHERE id = ${id}::uuid AND deleted_at IS NULL
      `)).rows[0] as any;
      if (!inv) return null;
      const tenant = (await tx.execute(sql`SELECT display_name AS name, arn FROM tenants WHERE id = ${session.tenantId}::uuid`)).rows[0] as any;
      return { inv, tenant, statement: await loadAccountStatement(tx, id, from, to) };
    },
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  if (!data) notFound();
  const { inv, tenant, statement } = data;

  return (
    <div className="space-y-5 max-w-5xl">
      <div className="print:hidden">
        <Link href={`/dashboard/investors/${id}`} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
          <ChevronLeft className="size-3.5" /> Back to client
        </Link>
        <div className="flex items-start justify-between gap-3 flex-wrap">
<PageHeaderCard title={<><FileText className="size-6 text-muted-foreground" /> Account Statement</>} />
<form className="flex items-end gap-2" action={`/dashboard/investors/${id}/statement`}>
            <label className="text-xs">
              <span className="block text-muted-foreground mb-1">From</span>
              <DateField name="from" defaultValue={from} className="input-base h-8 text-xs" />
            </label>
            <label className="text-xs">
              <span className="block text-muted-foreground mb-1">To</span>
              <DateField name="to" defaultValue={to} className="input-base h-8 text-xs" />
            </label>
            <button className="btn-secondary text-xs h-8">Apply</button>
          </form>
</div>
      </div>

      {/* Statement header — the firm, the client, the period. Printed too. */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="font-bold text-lg">{tenant?.name ?? "—"}</div>
            {tenant?.arn && <div className="text-xs text-muted-foreground">ARN {tenant.arn}</div>}
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Statement period</div>
            <div className="text-sm font-medium tabular-nums">
              {fmtDate(statement.from)} — {fmtDate(statement.to)}
            </div>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-border grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <div>
            <span className="text-muted-foreground text-xs">Client</span>
            <div className="font-semibold">{inv.name}</div>
          </div>
          <div className="sm:text-right">
            <span className="text-muted-foreground text-xs">PAN</span>
            <div className="font-medium tabular-nums">{inv.pan ?? "—"}</div>
          </div>
        </div>
      </div>

      {statement.groups.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-sm text-muted-foreground">
          <FileText className="size-8 mx-auto text-muted-foreground/40" />
          <div className="mt-2 font-medium">No holdings or transactions in this period.</div>
        </div>
      ) : (
        <>
          {statement.groups.map((g) => (
            <div key={`${g.folioNumber}-${g.schemeCode}-${g.schemeName}`} className="rounded-xl border border-border bg-card overflow-hidden break-inside-avoid">
              <div className="px-4 py-3 border-b border-border bg-secondary/30 flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-semibold text-sm">{g.schemeName}</div>
                  <div className="text-2xs text-muted-foreground tabular-nums">
                    {[g.amcName, g.folioNumber ? `Folio ${g.folioNumber}` : null].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xs text-muted-foreground">Closing units at latest NAV</div>
                  <div className="text-sm font-bold tabular-nums">
                    {g.closingValue != null ? inr(g.closingValue) : "not priced"}
                  </div>
                  <div className="text-2xs text-muted-foreground">NAV dated {g.navDate ? fmtDate(g.navDate) : "unknown"}</div>
                </div>
              </div>

              <table className="w-full text-xs">
                <thead className="text-2xs uppercase tracking-wider text-muted-foreground border-b">
                  <tr>
                    <th className="text-left py-2 px-4 font-medium">Date</th>
                    <th className="text-left py-2 px-4 font-medium">Transaction</th>
                    <th className="text-right py-2 px-4 font-medium">Amount</th>
                    <th className="text-right py-2 px-4 font-medium">NAV</th>
                    <th className="text-right py-2 px-4 font-medium">Units</th>
                    <th className="text-right py-2 px-4 font-medium">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-secondary/20 font-medium">
                    <td className="py-2 px-4" colSpan={4}>Opening balance</td>
                    <td className="py-2 px-4 text-right">—</td>
                    <td className="py-2 px-4 text-right tabular-nums">{units(g.openingUnits)}</td>
                  </tr>
                  {g.lines.map((l, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 px-4 tabular-nums whitespace-nowrap">{fmtDate(l.date)}</td>
                      <td className="py-2 px-4">{l.description}</td>
                      <td className="py-2 px-4 text-right tabular-nums">{l.amount != null ? inr(l.amount) : "—"}</td>
                      <td className="py-2 px-4 text-right tabular-nums">{l.nav != null ? l.nav.toFixed(4) : "—"}</td>
                      <td className={`py-2 px-4 text-right tabular-nums ${l.units < 0 ? "text-rose-600" : ""}`}>
                        {units(l.units)}
                      </td>
                      <td className="py-2 px-4 text-right tabular-nums">{units(l.balance)}</td>
                    </tr>
                  ))}
                  <tr className="bg-secondary/20 font-semibold">
                    <td className="py-2 px-4" colSpan={3}>Closing balance</td>
                    <td className="py-2 px-4 text-right tabular-nums">{g.nav != null ? g.nav.toFixed(4) : "—"}</td>
                    <td className="py-2 px-4 text-right">—</td>
                    <td className="py-2 px-4 text-right tabular-nums">{units(g.closingUnits)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ))}

          <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between">
            <span className="text-sm font-semibold">Units at {fmtDate(statement.to)}, valued at the NAV dates shown above</span>
            <span className="text-lg font-bold tabular-nums">{inr(statement.totalClosingValue)}</span>
          </div>

          <p className="text-xs text-muted-foreground">The transaction period ends on {fmtDate(statement.to)}. Historical NAVs are not stored; values use the latest available NAV for each scheme and are not a historical period-end valuation.</p>

          {statement.unpricedSchemes > 0 && (
            <p className="text-xs text-muted-foreground">
              {statement.unpricedSchemes} scheme{statement.unpricedSchemes === 1 ? "" : "s"} could not be priced against
              the NAV feed, so {statement.unpricedSchemes === 1 ? "its" : "their"} value is excluded from the total above
              — the units are still shown per scheme.
            </p>
          )}
        </>
      )}

      <div className="print:hidden text-xs text-muted-foreground flex items-center gap-2">
        <Printer className="size-3.5" /> Use your browser's print dialog to save this as a PDF.
      </div>
    </div>
  );
}
