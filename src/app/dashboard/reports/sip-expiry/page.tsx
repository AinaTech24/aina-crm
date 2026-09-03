/**
 * SIP Expiry — the renewal worklist.
 *
 * The daily scanner already fires `sip.expiring` at 30/15/7 days, but a
 * notification is a nudge, not a list you can work. This is the list: every
 * active SIP reaching the end of its term, ordered by how soon, with lifetime
 * progress (35 of 36 done) and the bounce history that decides whether "renew"
 * is even the right conversation.
 */

import Link from "next/link";
import { ChevronLeft, CalendarClock, AlertTriangle } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { loadSipExpiry, loadSipExpirySummary } from "@/lib/finance/sip-lifecycle";

export const dynamic = "force-dynamic";

const inr = (n: number) =>
  n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(2)} L` : `₹${Math.round(n).toLocaleString("en-IN")}`;

const fmtDate = (v: string | null) => {
  if (!v) return "—";
  const d = new Date(v);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

const WINDOWS = [30, 60, 90, 180] as const;

export default async function SipExpiryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const sp = await searchParams;
  const raw = Number(sp.days);
  const days = (WINDOWS as readonly number[]).includes(raw) ? raw : 90;

  const { rows, summary } = await withTenant(
    session.tenantId,
    async (tx) => ({
      rows: await loadSipExpiry(tx, days),
      summary: await loadSipExpirySummary(tx),
    }),
    { userId: session.userId, branchId: session.branchId, roles: session.roles }
  );

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <Link href="/dashboard/reports" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-2">
          <ChevronLeft className="size-3.5" /> Reports &amp; MIS
        </Link>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <CalendarClock className="size-6 text-brand-cyan" /> SIP Expiry
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Active SIPs reaching the end of their term. Renew before the last instalment, not after.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Expiring in 30 days" value={String(summary.expiring30)} sub={inr(summary.amount30) + "/mo at risk"} tone="rose" />
        <Kpi label="Expiring in 90 days" value={String(summary.expiring90)} sub={inr(summary.amount90) + "/mo at risk"} tone="amber" />
        <Kpi label="Past end date" value={String(summary.overdue)} sub="still marked active" tone={summary.overdue > 0 ? "rose" : undefined} />
        <Kpi label="In this view" value={String(rows.length)} sub={`next ${days} days`} />
      </div>

      {summary.overdue > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 flex gap-2">
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <span>
            <strong>{summary.overdue}</strong> SIP{summary.overdue === 1 ? " is" : "s are"} past their end date but still
            marked active, so they are still counted in the SIP book. The nightly pass closes these after a 7-day grace
            window — anything older than that ended before the pass existed.
          </span>
        </div>
      )}

      <div className="inline-flex rounded-lg border border-border bg-secondary/40 p-0.5 gap-0.5 text-xs">
        {WINDOWS.map((d) => (
          <Link
            key={d}
            href={`/dashboard/reports/sip-expiry?days=${d}`}
            className={`px-3 py-1.5 rounded-md font-medium transition ${
              d === days ? "bg-card shadow-sm" : "text-muted-foreground hover:bg-secondary"
            }`}
          >
            {d} days
          </Link>
        ))}
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <CalendarClock className="size-8 mx-auto text-muted-foreground/40" />
            <div className="mt-2 font-medium">No SIPs expiring in the next {days} days.</div>
            <p className="mt-1 text-xs">
              Only SIPs with an end date appear here — open-ended SIPs never expire.
            </p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b bg-secondary/30">
                <tr>
                  <th className="text-left py-2.5 px-4 font-medium">Client</th>
                  <th className="text-left py-2.5 px-4 font-medium">Scheme</th>
                  <th className="text-right py-2.5 px-4 font-medium">Amount</th>
                  <th className="text-left py-2.5 px-4 font-medium">Progress</th>
                  <th className="text-right py-2.5 px-4 font-medium">Ends</th>
                  <th className="text-left py-2.5 px-4 font-medium">RM</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const overdue = r.daysToExpiry != null && r.daysToExpiry < 0;
                  const urgent = r.daysToExpiry != null && r.daysToExpiry >= 0 && r.daysToExpiry <= 30;
                  const pct =
                    r.totalInstallments && r.totalInstallments > 0
                      ? Math.min(100, Math.round((r.completedInstallments / r.totalInstallments) * 100))
                      : null;
                  return (
                    <tr key={r.sipId} className="border-b last:border-0 hover:bg-secondary/30">
                      <td className="py-2.5 px-4">
                        <Link href={`/dashboard/investors/${r.investorId}`} className="font-medium hover:underline">
                          {r.investorName}
                        </Link>
                        <div className="text-[11px] text-muted-foreground tabular-nums">
                          {[r.pan, r.folioNumber].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </td>
                      <td className="py-2.5 px-4">
                        <div className="text-xs">{r.schemeName ?? "—"}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {r.amcName ?? "—"} · {r.frequency}
                          {r.bouncedCount > 0 && (
                            <span className="ml-1.5 text-rose-600">· {r.bouncedCount} bounced</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums font-medium">{inr(r.amount)}</td>
                      <td className="py-2.5 px-4">
                        {r.totalInstallments == null ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          <div className="w-32">
                            <div className="text-[11px] tabular-nums mb-1">
                              {r.completedInstallments} of {r.totalInstallments}
                              {r.pendingInstallments != null && r.pendingInstallments > 0 && (
                                <span className="text-muted-foreground"> · {r.pendingInstallments} left</span>
                              )}
                            </div>
                            <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                              <div
                                className={`h-full rounded-full ${pct != null && pct >= 95 ? "bg-emerald-500" : "bg-brand-cyan"}`}
                                style={{ width: `${pct ?? 0}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <div className="tabular-nums text-xs">{fmtDate(r.endDate)}</div>
                        <span
                          className={`chip text-[10px] ${
                            overdue ? "bg-rose-50 text-rose-700" : urgent ? "bg-amber-50 text-amber-700" : "bg-secondary text-muted-foreground"
                          }`}
                        >
                          {overdue
                            ? `${Math.abs(r.daysToExpiry!)}d overdue`
                            : r.daysToExpiry != null
                              ? `in ${r.daysToExpiry}d`
                              : "—"}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-xs text-muted-foreground">{r.rmName ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "rose" | "amber" }) {
  const color = tone === "rose" ? "text-rose-600" : tone === "amber" ? "text-amber-600" : "";
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}
