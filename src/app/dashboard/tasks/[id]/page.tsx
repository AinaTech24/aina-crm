import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { investors, leads, taskChecklist, tasks, users } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
import { TaskDetailPage } from "./TaskDetailPage";
import { taskInScope } from "@/lib/tasks/scope";
import { dataWallApplies, investorScopeCondition } from "@/lib/investors/access";
import { loadViewableLead } from "@/lib/leads/access";

/**
 * One task as a full page — the same editor as the task list's dialog
 * (TaskDetailDrawer, variant "page"), with room for the description, the
 * checklist, comments, attachments and time log.
 *
 * Who may open it is the task API's own rule (GET /api/tasks/[id]): anyone
 * with task.view.all, or an assigned-only viewer who is the assignee, the
 * creator, or holds a delegated sub-task. Anything else is a 404, never a
 * hint that the task exists.
 */
export const dynamic = "force-dynamic";

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const session = await requireSession();
  requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
  const canViewAll = can(session.roles, "task.view.all", session.permissions);

  const data = await withTenant(session.tenantId, async (tx) => {
    const task = (await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId), isNull(tasks.deletedAt)))
      .limit(1))[0];
    if (!task) return null;
    const mine =
      task.assigneeId === session.userId ||
      task.createdById === session.userId ||
      taskChecklist(task.meta).some((c) => c.assigneeId === session.userId);
    if (!canViewAll && !mine) return null;
    // view.all reaches only tasks whose client / lead is in scope.
    if (!(await taskInScope(tx, session, id))) return null;

    // The names the list shows beside a task — a task reaches its client or
    // lead through the explicit link OR the legacy subject columns.
    const investorId = task.relatedInvestorId ?? (task.subjectType === "investor" ? task.subjectId : null);
    const leadId = task.relatedLeadId ?? (task.subjectType === "lead" ? task.subjectId : null);
    // A client / lead outside the viewer's scope is not named — only under
    // the data wall; without it every task names its client / lead, as before.
    const wallOn = await dataWallApplies(tx, session);
    const cap = (c: Parameters<typeof can>[1]) => can(session.roles, c, session.permissions);
    const invAllowed = !wallOn || cap("investor.view.all") || cap("investor.view.assigned");
    const invScope = wallOn && investorId && invAllowed
      ? await investorScopeCondition(tx, session) : undefined;
    const leadVisible = !wallOn ? true : leadId && (cap("lead.view.all") || cap("lead.view.assigned"))
      ? !!(await loadViewableLead(tx, session, leadId)) : !leadId;
    const [assignee, investor, lead] = await Promise.all([
      task.assigneeId
        ? tx.select({ name: users.name }).from(users).where(eq(users.id, task.assigneeId)).limit(1)
        : Promise.resolve([]),
      investorId && invAllowed
        ? tx.select({ name: investors.name }).from(investors).where(and(eq(investors.id, investorId), invScope)).limit(1)
        : Promise.resolve([]),
      leadId && leadVisible ? tx.select({ name: leads.name }).from(leads).where(eq(leads.id, leadId)).limit(1) : Promise.resolve([]),
    ]);
    return {
      task,
      assigneeName: (assignee as Array<{ name: string | null }>)[0]?.name ?? null,
      investorName: (investor as Array<{ name: string | null }>)[0]?.name ?? null,
      leadName: (lead as Array<{ name: string | null }>)[0]?.name ?? null,
    };
  });
  if (!data) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeaderCard
        breadcrumb={[{ label: "Tasks", href: "/dashboard/tasks" }, { label: data.task.title }]}
        title={<>{data.task.title}</>}
        subtitle={<>Task {data.task.id.slice(0, 8)}</>}
      />
      <TaskDetailPage
        task={JSON.parse(JSON.stringify({
          ...data.task,
          assigneeName: data.assigneeName,
          investorName: data.investorName,
          leadName: data.leadName,
        }))}
        currentUserId={session.userId}
        canManageAll={canViewAll}
      />
    </div>
  );
}
