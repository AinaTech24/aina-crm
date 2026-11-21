/**
 * What "Undo" sends after a task change — pure, so it is tested without the
 * network. Undo restores the previous state through the same PATCH: the status
 * back (and the next occurrence a recurring task spawned goes to Trash), or the
 * due date back. Null when there is nothing honest to undo:
 *  - the change only queued on the phone (no signal) — it has not happened yet;
 *  - the server did something else (a task that needs approval was SENT for
 *    approval, not completed);
 *  - a snoozed task had no due date (the API cannot clear one).
 */

export interface TaskUndoPlan {
  body: { status?: string; dueAt?: string };
  /** The next occurrence completing a recurring task created. */
  trashId: string | null;
}

type Result = { status?: string | null; spawnedNextId?: string | null } | null | undefined;

export function statusUndo(prevStatus: string | null | undefined, target: string, result: Result): TaskUndoPlan | null {
  if (!result || result.status !== target) return null;
  const prev = prevStatus || "open";
  if (prev === target) return null;
  return { body: { status: prev }, trashId: target === "completed" ? result.spawnedNextId ?? null : null };
}

export function dueUndo(prevDueAt: string | null | undefined, result: Result): TaskUndoPlan | null {
  if (!result || !prevDueAt) return null;
  return { body: { dueAt: prevDueAt }, trashId: null };
}

/** The toast after a status change. */
export function statusMessage(target: string, result: { status?: string | null; approvalStatus?: string | null } | null | undefined, label: string): string {
  if (target === "completed" && result && result.status !== "completed" && result.approvalStatus === "pending") return "Sent for approval";
  return target === "completed" ? "Task completed" : `Moved to ${label}`;
}
