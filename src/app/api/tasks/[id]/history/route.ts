import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET /api/tasks/[id]/history — the task's Timeline: its creation and every edit,
 * field by field (from → to), with who did it and when. Newest first.
 *
 * Seen by whoever can open the task itself (the same rule as GET /api/tasks/[id]
 * and its comments): everyone with task.view.all within their client / lead
 * scope; otherwise the task's assignee, creator, a delegate of one of its action
 * points, the person an open "Need information" question waits on, or a manager
 * the escalation ladder brought it to.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { tasks, taskChecklist } from "@/db/schema";
import { openInfoRequest } from "@/lib/tasks/info-request";
import { escalatedTo } from "@/lib/tasks/escalation-ladder";
import { taskInScope } from "@/lib/tasks/scope";
import { loadTaskTimeline } from "@/lib/tasks/history";
import { worksOnTask } from "@/lib/tasks/collaborators";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["task.view.all", "task.view.assigned"], session.permissions);
    const canViewAll = can(session.roles, "task.view.all", session.permissions);

    const timeline = await withTenant(session.tenantId, async (tx) => {
      const [task] = await tx
        .select({ assigneeId: tasks.assigneeId, createdById: tasks.createdById, collaboratorIds: tasks.collaboratorIds, meta: tasks.meta })
        .from(tasks)
        .where(and(eq(tasks.id, id), eq(tasks.tenantId, session.tenantId)))
        .limit(1);
      if (!task) return null;
      const mine =
        worksOnTask(task, session.userId) ||
        task.createdById === session.userId ||
        taskChecklist(task.meta).some((c) => c.assigneeId === session.userId) ||
        openInfoRequest(task.meta)?.askedToId === session.userId ||
        escalatedTo(task.meta, session.userId);
      if (!canViewAll && !mine) return null;
      if (!(await taskInScope(tx, session, id))) return null;
      return loadTaskTimeline(tx, session.tenantId, id);
    });
    if (!timeline) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(timeline);
  } catch (err: any) {
    return handleApiError(err);
  }
}
