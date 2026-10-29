/**
 * What completing a meeting, or marking it a no-show, does to the rest of the
 * CRM. Shared by PATCH /api/review-meetings/[id] and the bulk route, so a
 * meeting closed from the list gets exactly what one closed from its page gets:
 *
 *   completed — the client's lastReviewAt / nextReviewAt, the same review on
 *               the rest of the family, the lead's Meeting-Done advance, any
 *               action item still without a task, and the next review.
 *   no_show   — a re-engage task for the RM, due tomorrow.
 *
 * The caller has already written the meeting's new status.
 */

import { v4 as uuid } from "uuid";
import { eq, and, sql } from "drizzle-orm";
import { propagateReviewToFamily, stampFamilyReview, type FamilyPropagationResult } from "@/lib/reviews/family-propagation";
import { recomputeFamilyHealth } from "@/lib/families/health-persist";
import { autoAdvance, resolveLeadIdForInvestor } from "@/lib/blueprints/auto-advance";
import { computeNextReview } from "@/lib/investors/review-cadence";
import { formatDate } from "@/lib/format";
import { onOpportunityMeetingCompleted } from "@/lib/opportunities/steps";
import { reviewMeetings, investors, tasks } from "@/db/schema";
import type { ActionItemIn } from "./sync";

type Tx = any;
type MeetingRow = typeof reviewMeetings.$inferSelect;

export async function applyMeetingCompleted(tx: Tx, args: {
  tenantId: string;
  actorId: string;
  /** The meeting as it was before this save. */
  before: MeetingRow;
  /** The meeting's date as saved (a reschedule in the same save wins). */
  reviewedAt: Date | string;
  /** A next-review date the user chose; otherwise the client's cadence decides. */
  explicitNextReview?: string;
  /** Action items as saved in this request, if it carried any. */
  items?: ActionItemIn[] | null;
  /** The request carried a non-empty action-item list. */
  itemsSent?: boolean;
}): Promise<FamilyPropagationResult | null> {
  const { tenantId, actorId, before, reviewedAt } = args;
  const id = before.id;
  // Link spawned tasks to whichever party this meeting is about — a lead
  // meeting must NOT create investor-typed tasks with a null subjectId.
  const taskSubjectType: "investor" | "lead" = before.leadId ? "lead" : "investor";
  const taskSubjectId = before.leadId ?? before.investorId;
  // Next review date: an explicit one from the form wins; otherwise derive
  // it from THIS client's configured review cadence (preset or custom days)
  // so the reminder reflects what the RM actually set. Falls back to 180
  // days only when the client has no cadence configured.
  let nextReviewDate = args.explicitNextReview;
  if (!nextReviewDate) {
    let next: Date | null = null;
    if (before.investorId) {
      const [iv] = await tx
        .select({ rf: investors.reviewFrequency, rfd: investors.reviewFrequencyDays })
        .from(investors)
        .where(and(eq(investors.id, before.investorId), eq(investors.tenantId, tenantId)))
        .limit(1);
      next = computeNextReview(new Date(reviewedAt), iv?.rf as any, iv?.rfd as any);
    }
    nextReviewDate = (next ?? new Date(Date.now() + 180 * 24 * 60 * 60 * 1000)).toISOString().slice(0, 10);
  }

  // Only update the investor's review cadence if this meeting was
  // actually with an investor. Lead-side meetings don't have a
  // review cycle (leads have a different lifecycle).
  let familyPropagation: FamilyPropagationResult | null = null;
  if (before.investorId) {
    await tx
      .update(investors)
      .set({
        lastReviewAt: new Date(reviewedAt),
        nextReviewAt: new Date(nextReviewDate),
        lastContactAt: new Date(),
        updatedAt: new Date(),
      } as any)
      .where(and(eq(investors.id, before.investorId), eq(investors.tenantId, tenantId)));

    // One sitting reviews the household. Without this, every other member
    // of the family stayed "review overdue" and the RM's due list was
    // full of people they had just sat with — clearable only by logging a
    // fake meeting each. Contact dates are NOT propagated and each member
    // keeps their own cadence; see lib/reviews/family-propagation.ts.
    familyPropagation = await propagateReviewToFamily(tx, {
      tenantId,
      investorId: before.investorId,
      reviewedAt: new Date(reviewedAt),
      explicitNextReview: args.explicitNextReview ?? null,
    });
  }

  // …and the family's own review dates, so the family stops reading
  // "review due" the moment its review is done.
  const reviewedFamilyId = (before as any).familyId ?? familyPropagation?.familyId ?? null;
  if (reviewedFamilyId) {
    await stampFamilyReview(tx, {
      tenantId,
      familyId: reviewedFamilyId,
      reviewedAt: new Date(reviewedAt),
      explicitNextReview: args.explicitNextReview ?? null,
    });
    await recomputeFamilyHealth(tx, reviewedFamilyId);
  }

  // ─── Smart blueprint advance — meeting completed ──────────────
  // For lead-side meetings, push the blueprint to `meeting_done` so
  // the user sees their journey progress without a manual click.
  if (before.leadId) {
    await autoAdvance(tx, tenantId, before.leadId, "meeting.completed", {
      remarks: `Auto: meeting marked completed on ${formatDate(new Date())}.`,
    });
  } else if (before.investorId) {
    // Client-side meeting completion → if the client was converted
    // from a lead, advance the source lead's blueprint too (covers
    // post-conversion review meetings).
    const leadId = await resolveLeadIdForInvestor(tx, before.investorId);
    if (leadId) {
      await autoAdvance(tx, tenantId, leadId, "meeting.completed", {
        remarks: "Auto: client review meeting completed.",
      });
    }
  }

  // An opportunity whose meeting this is moves past "Discussion / meeting"
  // (lib/opportunities/steps.ts) — the same as its "Meeting done" button.
  await onOpportunityMeetingCompleted(tx, { tenantId, userId: actorId }, id);

  // ─── Automation: fan out action items into tasks ──────────────
  // Saved items already carry their task (synced on save); this only reaches
  // rows stored before action items became tasks on save.
  const items = (args.items ?? (before.actionItems as any[] | null) ?? []) as Array<{
    title: string;
    assigneeId?: string;
    dueAt?: string;
    taskId?: string;
  }>;
  // Build the new task rows, then insert them in ONE awaited batch. The
  // previous code called tx.insert(...) WITHOUT await inside a .map(), so
  // the inserts were fire-and-forget — the meeting got stamped
  // "followUpTaskCreated" while the tasks themselves were never reliably
  // committed. Collect → await → stamp.
  const newTaskRows: any[] = [];
  const stamped = items.map((it) => {
    if (it.taskId) return it; // already created
    const taskId = uuid();
    newTaskRows.push({
      id: taskId,
      tenantId,
      assigneeId: it.assigneeId ?? before.rmId ?? actorId,
      subjectType: taskSubjectType,
      subjectId: taskSubjectId,
      relatedInvestorId: before.investorId ?? null,
      relatedLeadId: before.leadId ?? null,
      relatedMeetingId: id,
      type: "review_action_item",
      title: it.title,
      priority: "normal",
      status: "open",
      dueAt: it.dueAt ? new Date(it.dueAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      workflowRunId: null,
    });
    return { ...it, taskId };
  });
  const createdAny = newTaskRows.length > 0;
  if (createdAny) {
    await tx.insert(tasks).values(newTaskRows);
  }
  if (createdAny || args.itemsSent) {
    await tx
      .update(reviewMeetings)
      .set({
        actionItems: stamped as any,
        followUpTaskCreated: "true",
        updatedAt: new Date(),
      } as any)
      .where(and(eq(reviewMeetings.id, id), eq(reviewMeetings.tenantId, tenantId)));
  }

  // (The "write up your notes" task is gone with the notes box: the
  // meeting page no longer has one, so the task could never be done.)

  // ─── Auto-schedule the NEXT review (recurring cadence) ─────────
  // Reviews recur. On completing a review-category INVESTOR meeting,
  // create the next scheduled review at nextReviewDate so it shows in
  // Upcoming + fires its own T-1 reminder — unless a future review is
  // already on this client's calendar. Best-effort (savepoint) so it can
  // never fail the completion itself.
  if (before.category === "review" && before.investorId) {
    try {
      await tx.transaction(async (sp: Tx) => {
        const existing = await sp.execute(sql`
          SELECT 1 FROM review_meetings
          WHERE tenant_id = ${tenantId}::uuid
            AND investor_id = ${before.investorId}::uuid
            AND category = 'review'
            AND status IN ('scheduled', 'confirmed')
            AND meeting_date >= now()
          LIMIT 1
        `);
        if (existing.rows.length === 0) {
          const nextId = uuid();
          const nextReminderId = uuid();
          const nextMeetingDate = new Date(`${nextReviewDate}T11:00:00`);
          await sp.insert(tasks).values({
            id: nextReminderId,
            tenantId,
            assigneeId: before.rmId ?? actorId,
            subjectType: "investor",
            subjectId: before.investorId,
            relatedInvestorId: before.investorId,
            relatedMeetingId: nextId,
            type: "review_meeting_reminder",
            title: "Reminder: next portfolio review coming up",
            priority: "normal",
            status: "open",
            dueAt: new Date(nextMeetingDate.getTime() - 24 * 60 * 60 * 1000),
          } as any);
          await sp.insert(reviewMeetings).values({
            id: nextId,
            tenantId,
            investorId: before.investorId,
            familyId: before.familyId ?? null,
            rmId: before.rmId,
            category: "review",
            parentMeetingId: before.id,
            meetingType: before.meetingType,
            subject: "Next review (auto-scheduled)",
            meetingDate: nextMeetingDate,
            durationMinutes: before.durationMinutes ?? "30",
            meetingMode: before.meetingMode,
            status: "scheduled",
            reminderTaskId: nextReminderId,
          } as any);
        }
      });
    } catch (e) {
      console.warn("[review_meeting] auto-next-review skipped:", (e as Error)?.message);
    }
  }

  return familyPropagation;
}

/**
 * Marking a meeting no_show should leave a trail of action: task the RM to
 * re-engage the client within a day instead of letting it drop silently.
 */
export async function applyMeetingNoShow(tx: Tx, args: { tenantId: string; actorId: string; before: MeetingRow }) {
  const { tenantId, actorId, before } = args;
  const reSubjectType: "investor" | "lead" = before.leadId ? "lead" : "investor";
  const reSubjectId = before.leadId ?? before.investorId;
  await tx.insert(tasks).values({
    id: uuid(),
    tenantId,
    assigneeId: before.rmId ?? actorId,
    subjectType: reSubjectType,
    subjectId: reSubjectId,
    relatedInvestorId: before.investorId ?? null,
    relatedLeadId: before.leadId ?? null,
    relatedMeetingId: before.id,
    type: "follow_up",
    title: "Re-engage — client missed the scheduled meeting",
    description: "The client didn't attend. Reach out to understand why and reschedule.",
    priority: "high",
    status: "open",
    dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  } as any);
}

/** A cancelled meeting's T-1 "meeting tomorrow" reminder is cancelled with it. */
export async function cancelMeetingReminders(tx: Tx, tenantId: string, meetingIds: string[]) {
  if (meetingIds.length === 0) return;
  await tx.execute(sql`
    UPDATE tasks SET status = 'cancelled', updated_at = now()
     WHERE tenant_id = ${tenantId}::uuid
       AND status NOT IN ('completed', 'cancelled')
       AND id IN (
         SELECT reminder_task_id FROM review_meetings
          WHERE tenant_id = ${tenantId}::uuid
            AND reminder_task_id IS NOT NULL
            AND id IN (${sql.join(meetingIds.map((i) => sql`${i}::uuid`), sql`, `)})
       )
  `);
}
