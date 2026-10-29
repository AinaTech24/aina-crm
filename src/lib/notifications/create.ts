/**
 * createNotification — direct in-app notification insert for non-workflow code
 * paths (API routes). Workflows use the create_notification action handler; this
 * is the lightweight, synchronous equivalent for things like "task assigned to
 * you" / "task status changed" emitted straight from a route handler.
 *
 * Call inside an existing withTenant() transaction so it's atomic with the
 * action that triggered it. The NotificationBell surfaces it (90s poll, plus a refetch whenever the panel is opened).
 */

import { v4 as uuid } from "uuid";
import { notifications } from "@/db/schema";

// The 8 am briefing goes to the phone too: a cue that only reaches an inbox
// nobody opens before work is no cue. (The 6:30 pm "close your day" nudge was
// removed 2026-10-29 with the Daily Job Tracker.)
const MOBILE_ALERTS = new Set(["task.assigned", "task.subtask_assigned", "task.reminder", "task.overdue", "task.overdue.branch", "task.escalated", "meeting.reminder", "task.info_requested", "task.info_answered", "daily_briefing"]);

export type NotifySeverity = "info" | "success" | "warning" | "critical";

export async function createNotification(
  tx: any,
  n: {
    tenantId: string;
    userId: string; // recipient
    kind: string; // e.g. "task.assigned" | "task.status_changed"
    title: string;
    body?: string | null;
    linkUrl?: string | null;
    severity?: NotifySeverity;
    meta?: Record<string, unknown> | null;
  }
): Promise<void> {
  await tx.insert(notifications).values({
    id: uuid(),
    tenantId: n.tenantId,
    userId: n.userId,
    kind: n.kind,
    title: n.title,
    body: n.body ?? null,
    linkUrl: n.linkUrl ?? null,
    severity: n.severity ?? "info",
    // Persist the push intent with the notification, never send before commit.
    meta: MOBILE_ALERTS.has(n.kind) ? { ...n.meta, mobilePush: { status: "pending" } } : n.meta ?? null,
  } as any);
}
