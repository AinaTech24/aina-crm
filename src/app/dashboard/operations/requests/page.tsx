/**
 * /dashboard/operations/requests?view=… — the requests behind an Operations
 * Dashboard figure. Every tile on that dashboard opens here with the filters
 * it was showing; the rows are the same `opsBase` + `opsFilter` the count ran
 * over, narrowed by the view (lib/dashboard/ops/request-list.ts), so the list
 * holds exactly the number on the tile. Each row opens its task.
 *
 * Access is the dashboard's own: `opsAccess` (or the dashboard shared with the
 * viewer), and its scope — firm, branch or own work.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { loadDashboardThresholds } from "@/lib/dashboard/thresholds";
import { opsAccess } from "@/lib/dashboard/ops/access";
import { mayUseRoleDashboard } from "@/lib/dashboards/open-system";
import { istToday, parseOpsFilter, parseOpsPeriod, parseRupees } from "@/lib/dashboard/ops/params";
import { KIND_LABEL, STATUS_LABEL, type OpsWindow } from "@/lib/dashboard/ops/window";
import { SLA_LABEL, SLA_TONE, STATUS_TONE, fmtHours, fmtIstDateTime, fmtIstDay } from "@/lib/dashboard/ops/fmt";
import { OPS_LIST_VIEWS, isOpsListView, loadOpsRequestList } from "@/lib/dashboard/ops/request-list";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { Badge } from "@/components/ui/Badge";
import { InlineEmpty } from "@/components/common/EmptyState";
import { buttonClass } from "@/components/ui/button-class";
import { formatCount, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

const LIMIT = 500;

export default async function OpsRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession();
  const access = opsAccess(session);
  if (!(await mayUseRoleDashboard(session, "operations", access.allowed))) redirect("/dashboard");

  const sp = await searchParams;
  const one = (k: string) => {
    const v = sp[k];
    return ((Array.isArray(v) ? v[0] : v) ?? "").trim();
  };
  const view = isOpsListView(one("view")) ? (one("view") as keyof typeof OPS_LIST_VIEWS) : "open";
  // Back to the dashboard the tile was on — only ever a path inside the app.
  const back = /^\/dashboard\/[\w-]+$/.test(one("back")) ? one("back") : "/dashboard/operations";

  const filter = parseOpsFilter(sp, session.userId);
  const p = parseOpsPeriod(sp);
  const { rows, total } = await withTenant(session.tenantId, async (tx) => {
    const t = await loadDashboardThresholds(tx);
    const w: OpsWindow = {
      tenantId: session.tenantId, userId: session.userId, scope: access.scope, filter,
      from: p.from, to: p.to, today: istToday(), periodLabel: p.label, t,
    };
    const highValue = parseRupees(one("hv"), t.opsHighValue);
    return loadOpsRequestList(tx, w, view, highValue, LIMIT);
  });

  const isPeriod = view === "received" || view === "completed";
  const done = view === "completed" || view === "completed_today";
  const narrowed = [
    filter.sla?.length ? `SLA: ${filter.sla.map((s) => SLA_LABEL[s] ?? s).join(", ")}` : null,
    filter.kinds?.length ? `Type: ${filter.kinds.map((k) => KIND_LABEL[k] ?? k).join(", ")}` : null,
    filter.execIds?.includes("none") ? "Not assigned" : null,
    isPeriod ? p.label : null,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <PageHeaderCard
        title={<>{OPS_LIST_VIEWS[view].label}{narrowed.length ? ` · ${narrowed.join(" · ")}` : ""}</>}
        actions={
          <Link href={back} className={buttonClass("secondary", "sm", "gap-1.5")}>
            <ArrowLeft className="size-3.5" /> Operations Dashboard
          </Link>
        }
      />

      <div className="card-surface overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-sm">
          <span className="font-medium">{formatCount(total)} request{total === 1 ? "" : "s"}</span>
          {total > rows.length && <span className="text-xs text-muted-foreground">Showing the first {formatCount(rows.length)}</span>}
        </div>
        {rows.length === 0 ? (
          <div className="p-6"><InlineEmpty message="No requests match this figure right now." /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Request</th>
                  <th className="text-left">Client</th>
                  <th className="text-left">Type</th>
                  <th className="text-left">Assigned to</th>
                  <th className="text-left">Status</th>
                  <th className="text-left">{done ? "Completed" : "SLA"}</th>
                  <th className="text-right">Amount</th>
                  <th className="text-left">Received</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="max-w-xs">
                      <Link href={`/dashboard/tasks/${r.id}`} className="font-medium hover:underline">{r.title || "Request"}</Link>
                    </td>
                    <td>
                      {r.investorId ? (
                        <Link href={`/dashboard/investors/${r.investorId}`} className="hover:underline">{r.client}</Link>
                      ) : r.leadId ? (
                        <Link href={`/dashboard/leads/${r.leadId}`} className="hover:underline">{r.client}</Link>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap">{KIND_LABEL[r.kind] ?? "Other"}</td>
                    <td className="whitespace-nowrap">{r.assignee ?? <span className="text-muted-foreground">Not assigned</span>}</td>
                    <td><Badge tone={STATUS_TONE[r.status] ?? "neutral"}>{STATUS_LABEL[r.status] ?? r.status}</Badge></td>
                    <td className="whitespace-nowrap">
                      {done ? (
                        <>
                          {fmtIstDay(r.completedAt)}
                          {r.tatHours != null && <span className="ml-1 text-xs text-muted-foreground">({fmtHours(r.tatHours)})</span>}
                        </>
                      ) : (
                        <>
                          <Badge tone={SLA_TONE[r.slaState] ?? "neutral"}>{SLA_LABEL[r.slaState] ?? r.slaState}</Badge>
                          {(r.slaDueAt ?? r.dueAt) && (
                            <span className="ml-1.5 text-xs text-muted-foreground">{fmtIstDateTime(r.slaDueAt ?? r.dueAt)}</span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-right tabular-nums">{r.value ? formatMoney(r.value) : <span className="text-muted-foreground">—</span>}</td>
                    <td className="whitespace-nowrap text-muted-foreground">{fmtIstDay(r.receivedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
