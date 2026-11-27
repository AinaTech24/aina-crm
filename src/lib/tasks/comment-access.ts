/** Who is "on" a task's comment thread without task.view.all. */

import { openInfoRequest } from "@/lib/tasks/info-request";
import { escalatedTo } from "@/lib/tasks/escalation-ladder";

export function ownsTaskThread(
  task: { assigneeId: string | null; createdById: string | null; meta?: unknown },
  userId: string
): boolean {
  // The person an open "Need information" question is waiting on joins the thread.
  // So does a manager the escalation ladder brought it to.
  return task.assigneeId === userId || task.createdById === userId || openInfoRequest(task.meta)?.askedToId === userId
    || escalatedTo(task.meta, userId);
}
