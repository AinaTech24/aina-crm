/**
 * Work widgets: Needs attention (the six most urgent counts, one list) and
 * Tasks due. Each count is the row count of the list its arrow opens.
 */

import Link from "next/link";
import { sql } from "drizzle-orm";
import { ArrowRight } from "lucide-react";
import type { Tx } from "@/db/client";
import { can } from "@/lib/auth/rbac";
import {
  getOverdueTasks, getOpenServiceRequests, getOpenComplaints, getClaimsOpenOver, getReviewsOverdue,
  getRenewalsDue, getRiskProfileCounts, getClientsMissingData, overdueTaskSql, staffWhere, inOrder,
} from "@/lib/metrics";
import { formatCount, formatDate } from "@/lib/format";
import { indiaToday } from "@/lib/dashboards/system/period";
import type { WidgetCtx, WidgetImpl } from "../types";
import { clientsHref, qs, riskProfilesHref, serviceRequestsHref, tasksHref } from "../links";

type Row = { key: string; count: number; label: string; href: string; severity: number; alarm: boolean };

const plural = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
}

async function attentionRows(tx: Tx, ctx: WidgetCtx): Promise<Row[]> {
  const s = { tenantId: ctx.scope.tenantId, rmIds: ctx.scope.rmIds, branchIds: ctx.scope.branchIds };
  const roles = ctx.session.roles;
  const perms = ctx.session.permissions;
  const seesInsurance = roles.includes("owner") || can(roles, "insurance.view", perms);
  const seesComplaints = roles.includes("owner") || can(roles, "service_request.view.all", perms) || roles.includes("compliance");
  const today = indiaToday();
  const [tasks, sr, complaints, claims, reviews, renewals, risk, missing] = await inOrder(
    () => getOverdueTasks(tx, s),
    () => getOpenServiceRequests(tx, s),
    () => seesComplaints ? getOpenComplaints(tx, s) : Promise.resolve(0),
    () => seesInsurance ? getClaimsOpenOver(tx, s, 30) : Promise.resolve(0),
    () => getReviewsOverdue(tx, s),
    () => seesInsurance ? getRenewalsDue(tx, s, 30) : Promise.resolve({ due: 0, overdue: 0 }),
    () => getRiskProfileCounts(tx, s),
    () => getClientsMissingData(tx, s),
  );
  const rows: Row[] = [
    { key: "sr", count: sr.pastSla, label: plural(sr.pastSla, "service request past SLA", "service requests past SLA"), href: serviceRequestsHref(ctx, { breached: "1" }), severity: 1, alarm: true },
    { key: "complaints", count: complaints, label: plural(complaints, "complaint open", "complaints open"), href: `/dashboard/complaints${qs({ status: "open,in_progress,escalated", rm: ctx.scope.rmIds, branch: ctx.scope.branchIds })}`, severity: 1, alarm: false },
    { key: "tasks", count: tasks, label: plural(tasks, "task overdue", "tasks overdue"), href: tasksHref(ctx, { tab: "overdue" }), severity: 2, alarm: true },
    { key: "claims", count: claims, label: plural(claims, "insurance claim open over 30 days", "insurance claims open over 30 days"), href: `/dashboard/insurance-claims${qs({ open_over: "30", rm: ctx.scope.rmIds, branch: ctx.scope.branchIds })}`, severity: 3, alarm: true },
    { key: "reviews", count: reviews, label: plural(reviews, "client review overdue", "client reviews overdue"), href: clientsHref(ctx, { review: "overdue" }), severity: 3, alarm: true },
    { key: "renewals", count: renewals.due, label: plural(renewals.due, "renewal due in 30 days", "renewals due in 30 days"), href: `/dashboard/insurance${qs({ due_from: today, due_to: addDays(today, 30), owner: ctx.scope.rmIds, branch: ctx.scope.branchIds })}`, severity: 4, alarm: false },
    { key: "risk", count: risk.needsAction, label: plural(risk.needsAction, "risk profile due", "risk profiles due"), href: riskProfilesHref(ctx, "due,expired"), severity: 4, alarm: false },
    { key: "missing", count: missing, label: plural(missing, "client missing data", "clients missing data"), href: clientsHref(ctx, { needs_data: "1" }), severity: 5, alarm: false },
  ];
  return rows.filter((r) => r.count > 0).sort((a, b) => a.severity - b.severity || b.count - a.count);
}

async function needsAttention(tx: Tx, ctx: WidgetCtx) {
  const rows = (await attentionRows(tx, ctx)).slice(0, 6);
  if (!rows.length) return { body: null };
  return {
    body: (
      <div className="flex flex-col h-full">
        <ul className="space-y-0.5">
          {rows.map((r) => {
            const [n, ...rest] = r.label.split(" ");
            return (
              <li key={r.key}>
                <Link href={r.href} className="dash-row group">
                  <span className={`dash-count ${r.alarm ? "dash-count-alarm" : ""}`}>{n}</span>
                  <span className="flex-1 text-sm font-medium text-foreground first-letter:uppercase">{rest.join(" ")}</span>
                  <ArrowRight className="size-4 text-muted-foreground/60 transition-colors group-hover:text-primary" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    ),
  };
}

async function tasksDueRows(tx: Tx, ctx: WidgetCtx, limit: number) {
  const who = ctx.access.kind === "self"
    ? sql`t.assignee_id = ${ctx.session.userId}::uuid`
    : staffWhere({ tenantId: ctx.tenantId, rmIds: ctx.scope.rmIds, branchIds: ctx.scope.branchIds }, sql`t.assignee_id`);
  return (await tx.execute(sql`
    SELECT t.id, t.title, t.priority, t.due_at, u.name AS assignee,
           (${overdueTaskSql("t")}) AS overdue
      FROM tasks t LEFT JOIN users u ON u.id = t.assignee_id
     WHERE t.tenant_id = ${ctx.tenantId}::uuid AND ${who}
       AND t.deleted_at IS NULL AND t.status IN ('open', 'in_progress', 'blocked')
       AND (t.due_at AT TIME ZONE 'Asia/Kolkata')::date <= (now() AT TIME ZONE 'Asia/Kolkata')::date
     ORDER BY t.due_at ASC
     LIMIT ${limit}
  `)).rows as Array<{ id: string; title: string; priority: string | null; due_at: string; assignee: string | null; overdue: boolean }>;
}

async function tasksDue(tx: Tx, ctx: WidgetCtx) {
  const rows = await tasksDueRows(tx, ctx, 8);
  if (!rows.length) return { body: null };
  const overdue = rows.filter((r) => r.overdue).length;
  return {
    body: (
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id} className="py-2 flex items-center gap-3 min-w-0">
            <Link href={`/dashboard/tasks?task=${r.id}`} className="flex-1 min-w-0 text-sm font-medium hover:underline truncate">{r.title}</Link>
            {ctx.access.kind !== "self" && r.assignee && (
              <span className="hidden sm:inline text-xs text-muted-foreground truncate max-w-32">{r.assignee.replace(/\s*\([^)]*\)$/, "")}</span>
            )}
            <span className={`text-xs whitespace-nowrap ${r.overdue ? "text-rose-700 font-medium" : "text-muted-foreground"}`}>
              {r.overdue ? `Due ${formatDate(r.due_at, "dayMonth")}` : "Today"}
            </span>
          </li>
        ))}
      </ul>
    ),
    subtitle: overdue ? `${formatCount(overdue)} overdue` : "Due today",
    href: tasksHref(ctx, { tab: "overdue" }),
    hrefLabel: "All tasks",
  };
}

export const workWidgets: WidgetImpl[] = [
  {
    key: "needs_attention",
    render: needsAttention,
    csv: async (tx, ctx) => {
      const rows = await attentionRows(tx, ctx);
      return { columns: ["Item", "Count"], rows: rows.map((r) => [r.label.replace(/^[\d,]+ /, ""), r.count]) };
    },
  },
  {
    key: "tasks_due",
    render: tasksDue,
    csv: async (tx, ctx) => {
      const rows = await tasksDueRows(tx, ctx, 500);
      return {
        columns: ["Task", "Assignee", "Due", "Overdue"],
        rows: rows.map((r) => [r.title, r.assignee, formatDate(r.due_at), r.overdue ? "Yes" : "No"]),
      };
    },
  },
];
