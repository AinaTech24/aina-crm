/** Who may be added as a collaborator — the same people the task could be assigned to. */

import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { users } from "@/db/schema";
import type { SessionUser } from "@/lib/auth/session";
import { assertAssigneeInBranch } from "@/lib/mobile/record-access";

export async function assertCollaborators(tx: Tx, session: SessionUser, ids: string[], canEditAll: boolean): Promise<void> {
  if (!ids.length) return;
  // Without task.edit.all (and always in the mobile app): yourself or an active
  // teammate in your branch, as for the assignee.
  for (const id of ids) {
    if (session.mobile || (!canEditAll && id !== session.userId)) await assertAssigneeInBranch(tx, session, id);
  }
  const found = await tx
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, session.tenantId), eq(users.status, "active"), inArray(users.id, ids)));
  if (found.length !== ids.length) {
    throw Object.assign(new Error("A collaborator is not an active member of this firm"), { status: 400 });
  }
}
