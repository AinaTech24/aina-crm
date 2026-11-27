/**
 * Collaborators (2026-11-27): teammates who work on a task together with the
 * person it is assigned to. Stored in `tasks.collaborator_ids` (migration 0301).
 *
 * A collaborator sees and works on the task as the assignee does: it is in their
 * Tasks list and "Assigned to me", and they may update, comment, attach and log
 * time. Deleting it, and changing who is on it, stay with the assignee, the
 * creator and `task.edit.all`. Team and branch figures (dashboards, reports,
 * scorecards, escalation, QA) still follow the assignee alone, so a shared task
 * is counted once.
 *
 * Pure and client-safe; the SQL twin is `collaborators-sql.ts`.
 */

export const MAX_COLLABORATORS = 10;

export function collaboratorsOf(task: { collaboratorIds?: unknown }): string[] {
  const v = task.collaboratorIds;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

/** Assigned to this person, or shared with them. */
export function worksOnTask(task: { assigneeId?: string | null; collaboratorIds?: unknown }, userId: string): boolean {
  return task.assigneeId === userId || collaboratorsOf(task).includes(userId);
}

/** Each person once, and never the assignee: they are already on the task. */
export function cleanCollaborators(ids: readonly string[] | undefined, assigneeId: string | null | undefined): string[] {
  return [...new Set(ids ?? [])].filter((id) => id !== assigneeId);
}

export function sameMembers(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}
