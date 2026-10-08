/**
 * Fixed Deposits — every FD the firm's clients have placed through it: what
 * is live, what it is worth, and what matures next. Each deposit's maturity is
 * already on the Expected Inflows pipeline with a reminder for its RM.
 */

import Link from "next/link";
import { AlertTriangle, CalendarClock, Landmark, Plus, Wallet } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { requireInvestorView } from "@/lib/investors/access";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { ExportButton } from "@/components/export/ExportButton";
import { Kpi } from "@/components/dashboards/DashboardShared";
import { buttonClass } from "@/components/ui/button-class";
import { EmptyState } from "@/components/common/EmptyState";
import { FdTable } from "@/components/fixed-deposits/FdTable";
import { canEditFds, listFds } from "@/lib/fixed-deposits/service";
import { ISSUER_TYPE_LABELS, STATUS_LABELS } from "@/lib/fixed-deposits/terms";
import { formatCount, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const VIEWS: Array<[string, string]> = [["live", "Live"], ["30", "Maturing in 30 days"], ["90", "In 90 days"], ["all", "All"]];

export default async function FixedDepositsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const session = await requireSession();
  requireInvestorView(session);
  const sp = await searchParams;
  const view = one(sp.view) || "live";
  const status = one(sp.status);
  const issuerType = one(sp.type);
  const q = one(sp.q);

  const { rows, totals } = await withTenant(session.tenantId, (tx) => listFds(tx, session, {
    status: status || (view === "all" ? "all" : "live"),
    within: view === "30" ? 30 : view === "90" ? 90 : null,
    issuerType: issuerType || null,
    q: q || null,
  }), { userId: session.userId, branchId: session.branchId ?? undefined, roles: session.roles });

  const canEdit = canEditFds(session);
  const href = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    const merged = { view, status, type: issuerType, q, ...over };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "view" && v === "live")) p.set(k, v);
    const s = p.toString();
    return `/dashboard/fixed-deposits${s ? `?${s}` : ""}`;
  };
  const filtered = !!(status || issuerType || q || view !== "live");
  const empty = totals.liveCount === 0 && rows.length === 0 && !filtered;

  return (
    <div className="space-y-6">
      <PageHeaderCard
        title="Fixed Deposits"
        actions={<>
          <ExportButton module="fixed-deposits" />
          {canEdit && (
            <Link href="/dashboard/fixed-deposits/new" className={buttonClass("primary")}>
              <Plus className="size-4" aria-hidden /> Add FD
            </Link>
          )}
        </>}
      />

      {empty ? (
        <EmptyState
          icon={Landmark}
          title="No fixed deposits yet"
          description="Record a client's FD once and the CRM reminds the RM 15 days before it matures, adds the money to Expected Inflows, and marks FD as held on the client's Cross-sell card."
          primary={canEdit ? { label: "Add the first FD", href: "/dashboard/fixed-deposits/new" } : undefined}
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi icon={Landmark} label="Live FDs" value={formatCount(totals.liveCount)}
              sub={`${formatCount(totals.clients)} client${totals.clients === 1 ? "" : "s"}`} href={href({ view: "live", status: "" })} />
            <Kpi icon={Wallet} accent="emerald" label="Amount deposited" value={formatMoney(totals.livePrincipal)}
              sub={`${formatMoney(totals.liveMaturity)} at maturity`} />
            <Kpi icon={CalendarClock} accent="amber" label="Maturing in 30 days" value={formatCount(totals.maturing30)}
              sub={totals.maturing30 ? formatMoney(totals.maturing30Amount) : undefined} href={href({ view: "30", status: "" })} />
            <Kpi icon={CalendarClock} accent="violet" label="Maturing in 90 days" value={formatCount(totals.maturing90)}
              sub={totals.maturing90 ? formatMoney(totals.maturing90Amount) : undefined} href={href({ view: "90", status: "" })} />
          </div>

          {totals.overdue > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
              <p>
                <span className="font-semibold">{totals.overdue} FD{totals.overdue === 1 ? " has" : "s have"} passed maturity</span> and still
                {totals.overdue === 1 ? " shows" : " show"} as live. Open each one and mark it matured or renewed.
              </p>
            </div>
          )}

          <section className="card-surface space-y-4 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <nav className="dash-seg" aria-label="View">
                {VIEWS.map(([k, l]) => (
                  <Link key={k} href={href({ view: k, status: "" })} aria-current={view === k && !status ? "page" : undefined}>{l}</Link>
                ))}
              </nav>
              <form className="flex flex-wrap items-center gap-2" action="/dashboard/fixed-deposits">
                {view !== "live" && <input type="hidden" name="view" value={view} />}
                <input name="q" defaultValue={q} placeholder="Client, bank or FD no." aria-label="Search" className="input-base h-9 w-56" />
                <select name="type" defaultValue={issuerType} aria-label="Issuer type" className="input-base h-9 w-auto">
                  <option value="">All issuers</option>
                  {Object.entries(ISSUER_TYPE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <select name="status" defaultValue={status} aria-label="Status" className="input-base h-9 w-auto">
                  <option value="">{view === "all" ? "Any status" : "Live"}</option>
                  {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <button type="submit" className={buttonClass("secondary", "sm")}>Apply</button>
                {filtered && <Link href="/dashboard/fixed-deposits" className={buttonClass("ghost", "sm")}>Clear</Link>}
              </form>
            </div>
            <FdTable rows={rows} empty={<p className="dash-empty">No fixed deposit matches these filters.</p>} />
          </section>
        </>
      )}
    </div>
  );
}
