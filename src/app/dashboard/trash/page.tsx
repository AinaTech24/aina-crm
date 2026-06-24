/**
 * Trash bin — soft-deleted items, grouped into a collapsible section per module
 * (Clients, Tasks, …), recoverable until permanently removed. Clients keep their
 * retention window (auto-purged by the daily worker); tasks are kept until
 * manually purged. Each module section is shown only to roles allowed to see it.
 */

import { redirect } from "next/navigation";
import { and, desc, eq, isNotNull, or } from "drizzle-orm";
import { Trash2, Info, Users, ListChecks } from "lucide-react";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { investors, tasks } from "@/db/schema";
import { DEFAULT_SOFT_DELETE_RETENTION_DAYS } from "@/lib/platform/retention";
import { formatINR, formatDate } from "@/lib/utils";
import { TrashActions } from "@/components/investors/TrashActions";
import { TrashSection } from "@/components/trash/TrashSection";
import { TaskTrashActions } from "@/components/trash/TaskTrashActions";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function TrashPage() {
  const session = await requireSession();
  const canInvestors = can(session.roles, "investor.delete", session.permissions);
  const canTasksAll = can(session.roles, "task.edit.all", session.permissions);
  const canTasksOwn = can(session.roles, "task.edit.assigned", session.permissions);
  const canTasks = canTasksAll || canTasksOwn;
  if (!canInvestors && !canTasks) redirect("/dashboard");

  const retention = DEFAULT_SOFT_DELETE_RETENTION_DAYS;

  const { invRows, taskRows } = await withTenant(session.tenantId, async (tx) => {
    const invRows = canInvestors
      ? await tx
          .select({
            id: investors.id,
            name: investors.name,
            pan: investors.pan,
            email: investors.email,
            phone: investors.phone,
            aum: investors.aum,
            deletedAt: investors.deletedAt,
          })
          .from(investors)
          .where(and(eq(investors.tenantId, session.tenantId), isNotNull(investors.deletedAt)))
          .orderBy(desc(investors.deletedAt))
          .limit(500)
      : [];

    // task.edit.assigned users see only their own trashed tasks; task.edit.all sees all.
    const taskScope = canTasksAll
      ? undefined
      : or(eq(tasks.assigneeId, session.userId), eq(tasks.createdById, session.userId));
    const taskRows = canTasks
      ? await tx
          .select({
            id: tasks.id,
            title: tasks.title,
            type: tasks.type,
            status: tasks.status,
            priority: tasks.priority,
            deletedAt: tasks.deletedAt,
          })
          .from(tasks)
          .where(and(eq(tasks.tenantId, session.tenantId), isNotNull(tasks.deletedAt), taskScope))
          .orderBy(desc(tasks.deletedAt))
          .limit(500)
      : [];

    return { invRows, taskRows };
  });

  const isEmpty = invRows.length === 0 && taskRows.length === 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title flex items-center gap-2">
          <Trash2 className="size-5 text-muted-foreground" /> Trash
        </h1>
        <p className="page-subtitle">
          Deleted items are kept here, grouped by module. Restore one to bring it back exactly as it was,
          or delete it permanently. Clients are auto-removed {retention} days after deletion.
        </p>
      </div>

      {isEmpty ? (
        <div className="card-surface flex flex-col items-center justify-center gap-2 py-16 text-center">
          <Trash2 className="size-10 text-muted-foreground/30" />
          <div className="text-sm font-medium">Trash is empty</div>
          <div className="text-xs text-muted-foreground">Deleted clients and tasks will appear here.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* ── Clients ─────────────────────────────────────────────────── */}
          {canInvestors && invRows.length > 0 && (
            <TrashSection title="Clients" count={invRows.length} icon={<Users className="size-4 text-muted-foreground" />}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Client</th>
                    <th className="px-4 py-3 font-medium">PAN</th>
                    <th className="px-4 py-3 font-medium text-right">AUM</th>
                    <th className="px-4 py-3 font-medium">Deleted</th>
                    <th className="px-4 py-3 font-medium">Auto-deletes</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invRows.map((r) => {
                    const deletedAt = r.deletedAt ? new Date(r.deletedAt as any) : null;
                    const daysLeft = deletedAt
                      ? Math.max(0, retention - Math.floor((Date.now() - deletedAt.getTime()) / DAY_MS))
                      : retention;
                    return (
                      <tr key={r.id} className="border-b last:border-0 hover:bg-secondary/30">
                        <td className="px-4 py-3">
                          <div className="font-medium">{r.name}</div>
                          <div className="text-xs text-muted-foreground">{r.email || r.phone || "—"}</div>
                        </td>
                        <td className="px-4 py-3 font-mono text-xs">{r.pan || "—"}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {r.aum ? formatINR(Math.round(Number(r.aum))) : "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{deletedAt ? formatDate(deletedAt) : "—"}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`chip text-[11px] font-medium ${
                              daysLeft <= 3
                                ? "bg-rose-50 text-rose-700 border border-rose-200"
                                : "bg-amber-50 text-amber-700 border border-amber-200"
                            }`}
                          >
                            in {daysLeft} day{daysLeft === 1 ? "" : "s"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <TrashActions id={r.id} name={r.name} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TrashSection>
          )}

          {/* ── Tasks ───────────────────────────────────────────────────── */}
          {canTasks && taskRows.length > 0 && (
            <TrashSection title="Tasks" count={taskRows.length} icon={<ListChecks className="size-4 text-muted-foreground" />}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Task</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Deleted</th>
                    <th className="px-4 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {taskRows.map((r) => (
                    <tr key={r.id} className="border-b last:border-0 hover:bg-secondary/30">
                      <td className="px-4 py-3 font-medium max-w-[28rem] truncate" title={r.title}>{r.title}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground capitalize">{String(r.type).replace(/_/g, " ")}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground capitalize">{String(r.status).replace(/_/g, " ")}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{r.deletedAt ? formatDate(new Date(r.deletedAt as any)) : "—"}</td>
                      <td className="px-4 py-3">
                        <TaskTrashActions id={r.id} title={r.title} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TrashSection>
          )}
        </div>
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="size-3.5 mt-0.5 shrink-0" />
        Permanent deletion is irreversible. Until then, nothing is lost — restoring brings the item back
        exactly as it was.
      </p>
    </div>
  );
}
