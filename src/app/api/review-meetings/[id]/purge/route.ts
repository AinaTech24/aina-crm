import { handleApiError } from "@/lib/api/error-handler";
/**
 * DELETE /api/review-meetings/[id]/purge — remove a meeting that was entered
 * by mistake.
 *
 * DELETE /api/review-meetings/[id] only CANCELS (the meeting stays, marked
 * cancelled), which is right for a meeting that was really planned and then
 * called off. A meeting keyed by mistake should not stay in anyone's list, so
 * this removes the row.
 *
 * Only a meeting with no record of what happened may go: not completed, and
 * no outcome, notes or action items. Those are the firm's minutes of a client
 * conversation (a compliance record), so such a meeting can only be
 * cancelled. Before the row goes:
 *   - its reminder tasks are cancelled (they would remind about nothing);
 *   - tasks that point at it and follow-up meetings that name it as their
 *     parent are unlinked, not deleted;
 *   - the audit log keeps the whole row, so the entry can be traced and
 *     re-keyed if it was deleted in error.
 * Who may: the same people who may cancel it — meeting managers, or the RM
 * who owns it.
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { reviewMeetings } from "@/db/schema";

export const dynamic = "force-dynamic";

const hasText = (v: unknown) => typeof v === "string" && v.trim().length > 0;

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);
    const canAll = can(session.roles, "review_meeting.manage.all", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [m] = await tx
        .select()
        .from(reviewMeetings)
        .where(and(eq(reviewMeetings.id, id), eq(reviewMeetings.tenantId, session.tenantId)))
        .limit(1);
      if (!m) return { status: 404, error: "Meeting not found" } as const;
      if (!canAll && m.rmId !== session.userId) return { status: 403, error: "You can only delete your own meetings" } as const;

      const actionItems = Array.isArray(m.actionItems) ? m.actionItems : [];
      if (m.status === "completed" || m.outcome || hasText(m.meetingNotes) || hasText(m.outcomeNotes) || actionItems.length > 0) {
        return {
          status: 409,
          error: "This meeting has a record of what happened (notes, outcome or action items), so it can be cancelled but not deleted.",
        } as const;
      }

      // Reminders about a meeting that will not exist.
      const reminderIds = [m.reminderTaskId, (m as any).notesReminderTaskId].filter(Boolean) as string[];
      if (reminderIds.length) {
        await tx.execute(sql`
          UPDATE tasks SET status = 'cancelled', updated_at = now()
           WHERE tenant_id = ${session.tenantId}::uuid
             AND id IN (${sql.join(reminderIds.map((t) => sql`${t}::uuid`), sql`, `)})
             AND status IN ('open', 'in_progress', 'blocked')
        `);
      }
      // Keep the work, drop the pointer.
      await tx.execute(sql`
        UPDATE tasks SET related_meeting_id = NULL, updated_at = now()
         WHERE tenant_id = ${session.tenantId}::uuid AND related_meeting_id = ${id}::uuid
      `);
      await tx.execute(sql`
        UPDATE review_meetings SET parent_meeting_id = NULL, updated_at = now()
         WHERE tenant_id = ${session.tenantId}::uuid AND parent_meeting_id = ${id}::uuid
      `);
      await tx.delete(reviewMeetings).where(and(eq(reviewMeetings.id, id), eq(reviewMeetings.tenantId, session.tenantId)));

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "review_meeting.delete",
        entityType: "review_meeting",
        entityId: id,
        before: JSON.parse(JSON.stringify(m)),
        ...clientMeta,
      });
      return { status: 200 } as const;
    });

    if (outcome.status !== 200) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return handleApiError(err);
  }
}
