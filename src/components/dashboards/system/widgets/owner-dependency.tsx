/**
 * Owner dependency — "Could the firm run a month without you?" (The E-Myth
 * Revisited). Every figure is lib/metrics/owner-dependency.ts. Firm-wide
 * only: the positions and processes are the firm's, and an RM's or a
 * branch's slice of the owner's load is not the question. Hidden when the
 * firm has no active owner or nothing to measure.
 *
 * Severity budget: amber when the dependency is high, neutral otherwise —
 * a low dependency is the absence of a problem, not an achievement.
 */

import Link from "next/link";
import type { Tx } from "@/db/client";
import { dependencyLevel, getOwnerDependency, type OwnerDependency } from "@/lib/metrics";
import { formatCount, formatPercent } from "@/lib/format";
import type { WidgetCtx, WidgetImpl } from "../types";

type Row = { label: string; part: number; total: number; href?: string; empty: string };

function rowsOf(d: OwnerDependency): Row[] {
  return [
    { label: "Clients whose RM is the owner", part: d.clientsOwnedByOwner, total: d.totalLiveClients, href: "/dashboard/investors", empty: "No live clients" },
    { label: "Open tasks assigned to the owner", part: d.openTasksAssignedToOwner, total: d.totalOpenTasks, href: "/dashboard/tasks", empty: "No open tasks" },
    { label: "Positions only the owner fills", part: d.positionsFilledOnlyByOwner, total: d.totalPositions, href: "/dashboard/practice/positions", empty: "No positions set up" },
    { label: "Processes owned only by the owner", part: d.processesOwnedByOwnerOnly, total: d.totalProcesses, href: "/dashboard/practice", empty: "No process has an owner" },
  ];
}

async function ownerDependency(tx: Tx, ctx: WidgetCtx) {
  if (ctx.access.kind !== "firm") return { body: null };
  const d = await getOwnerDependency(tx, { tenantId: ctx.tenantId });
  const rows = rowsOf(d);
  if (!d.ownerCount || rows.every((r) => r.total === 0)) return { body: null };
  const level = dependencyLevel(d);
  const high = level === "high";
  const verdict = high
    ? "Not yet — too much of the firm rests on the owner."
    : level === "medium"
      ? "Partly — some of the firm still rests on the owner."
      : "Mostly — the work rests on positions, not on the owner.";
  return {
    body: (
      <div className="space-y-4">
        <div>
          <p className="text-sm font-semibold text-foreground">Could the firm run a month without you?</p>
          <p className={`mt-0.5 text-sm ${high ? "font-medium text-warning-foreground" : "text-muted-foreground"}`}>{verdict}</p>
        </div>
        <ul className="space-y-1">
          {rows.map((r) => {
            const pct = r.total ? (r.part / r.total) * 100 : 0;
            const inner = (
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="truncate">{r.label}</span>
                  <span className="whitespace-nowrap tabular-nums text-muted-foreground">
                    {r.total ? `${formatCount(r.part)} of ${formatCount(r.total)} · ${formatPercent(pct, 0)}` : "—"}
                  </span>
                </div>
                {r.total > 0 ? (
                  <div className="dash-bar" aria-hidden>
                    <span style={{
                      width: `${Math.max(r.part ? 2 : 0, Math.min(100, pct))}%`,
                      ...(high ? { background: "hsl(var(--warning))" } : {}),
                    }} />
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">{r.empty}</div>
                )}
              </div>
            );
            return (
              <li key={r.label}>
                {r.href ? <Link href={r.href} className="dash-row">{inner}</Link> : <div className="dash-row">{inner}</div>}
              </li>
            );
          })}
        </ul>
      </div>
    ),
    subtitle: high ? "High dependency" : level === "medium" ? "Some dependency" : "Low dependency",
    href: "/dashboard/practice/positions",
    hrefLabel: "Positions",
    info: "Owner = every active user with the owner role. Clients are live clients whose RM is an owner; tasks are open tasks assigned to an owner. A position counts when its only active holders are owners (the Owner / Director position itself is left out; a vacant one is not counted). A process counts when the position that owns it is held only by owners. High: the shares average half or more, or any one is 75%+.",
  };
}

export const ownerDependencyWidgets: WidgetImpl[] = [
  {
    key: "owner_dependency",
    render: ownerDependency,
    csv: async (tx, ctx) => {
      if (ctx.access.kind !== "firm") return { columns: ["Measure", "Owner", "Total", "Share %"], rows: [] };
      const d = await getOwnerDependency(tx, { tenantId: ctx.tenantId });
      return {
        columns: ["Measure", "Owner", "Total", "Share %"],
        rows: rowsOf(d).map((r) => [r.label, r.part, r.total, r.total ? Number(((r.part / r.total) * 100).toFixed(1)) : null]),
      };
    },
  },
];
