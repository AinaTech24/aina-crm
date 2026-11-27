/** Tell people a task has been shared with them. */

import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { users } from "@/db/schema";
import { createNotification } from "@/lib/notifications/create";

export async function notifyCollaboratorsAdded(
  tx: Tx,
  opts: { tenantId: string; taskId: string; title: string; actorId: string; userIds: string[] },
): Promise<void> {
  const actor = (await tx.select({ name: users.name }).from(users).where(eq(users.id, opts.actorId)).limit(1))[0]?.name;
  for (const userId of opts.userIds) {
    await createNotification(tx, {
      tenantId: opts.tenantId,
      userId,
      kind: "task.assigned",
      title: `Task shared with you: ${opts.title}`,
      body: `${actor ?? "A teammate"} added you as a collaborator`,
      linkUrl: `/dashboard/tasks/${opts.taskId}`,
      severity: "info",
      meta: { task_id: opts.taskId, assigned_by: opts.actorId, collaborator: true },
    });
  }
}
