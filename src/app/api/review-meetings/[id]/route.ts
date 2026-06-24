import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single review meeting endpoints.
 *
 *   PATCH  /api/review-meetings/[id]   — update status / notes / action items / next-review
 *   DELETE /api/review-meetings/[id]   — cancel (status='cancelled')
 *
 * Automations on status flip to `completed`:
 *   - Update investor.lastReviewAt = meeting_date and nextReviewAt = nextReviewDate
 *   - Fan out actionItems[] → tasks for the RM (only items without a taskId yet)
 *   - Stamp followUpTaskCreated = true
 *   - Create a "Write up your notes" task if meetingNotes still empty
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { autoAdvance, resolveLeadIdForInvestor } from "@/lib/blueprints/auto-advance";
import {
  reviewMeetings,
  investors,
  leads,
  tasks,
  REVIEW_MEETING_STATUSES,
  REVIEW_MEETING_OUTCOMES,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const ActionItem = z.object({
  title: z.string().min(2).max(300),
  assigneeId: z.string().uuid().optional(),
  dueAt: z.string().optional(),
  taskId: z.string().uuid().optional(),
});

const Attendee = z.object({
  name: z.string().min(1).max(120),
  role: z.enum([
    "rm",
    "investor",
    "spouse",
    "family",
    "ca",
    "amc_rm",
    "sub_distributor",
    "back_office",
    "compliance",
    "other",
  ]),
  isExternal: z.boolean(),
  notes: z.string().max(500).optional(),
});

const Patch = z.object({
  status: z.enum(REVIEW_MEETING_STATUSES).optional(),
  subject: z.string().max(300).optional(),
  meetingDate: z.string().optional(),
  meetingMode: z.string().optional(),
  locationOrLink: z.string().optional(),
  discussionPoints: z.string().optional(),
  meetingNotes: z.string().optional(),
  actionItems: z.array(ActionItem).optional(),
  attendees: z.array(Attendee).max(30).optional(),
  attachments: z
    .array(z.object({ name: z.string(), url: z.string(), size: z.number().optional() }))
    .optional(),
  nextReviewDate: z.string().optional(),
  /** Post-meeting outcome — drives the lead-to-client funnel. */
  outcome: z.enum(REVIEW_MEETING_OUTCOMES).optional(),
  outcomeNotes: z.string().max(2000).optional(),
  /** Reason captured when the meeting date is moved. */
  rescheduleReason: z.string().max(500).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);
    const canAll = can(session.roles, "review_meeting.manage.all", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(reviewMeetings).where(and(eq(reviewMeetings.id, id), eq(reviewMeetings.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return null;
      // RMs (manage.assigned) may only touch meetings they own.
      if (!canAll && before.rmId !== session.userId) return { forbidden: true as const };

      const patch: any = { ...body, updatedAt: new Date() };
      if (body.meetingDate) patch.meetingDate = new Date(body.meetingDate);
      // Stamp actualEndAt when transitioning to completed
      // Reference the auto-advance helper (imported below at module scope).
      const becomingCompleted = body.status === "completed" && before.status !== "completed";
      if (becomingCompleted) {
        patch.actualEndAt = new Date();
      }

      // ─── Reschedule hygiene ────────────────────────────────────────────
      // Moving the meeting date (without completing it) is a reschedule:
      // bump the counter and move the existing T-1 reminder task to the new
      // date instead of leaving a stale "meeting tomorrow" nag.
      const newDate = body.meetingDate ? new Date(body.meetingDate) : null;
      const dateChanged =
        !becomingCompleted &&
        newDate != null &&
        newDate.getTime() !== new Date(before.meetingDate).getTime();
      if (dateChanged) {
        patch.rescheduleCount = (before.rescheduleCount ?? 0) + 1;
        if (before.reminderTaskId) {
          await tx
            .update(tasks)
            .set({
              dueAt: new Date(newDate!.getTime() - 24 * 60 * 60 * 1000),
              status: "open",
              updatedAt: new Date(),
            } as any)
            .where(eq(tasks.id, before.reminderTaskId));
        }
      }

      await tx.update(reviewMeetings).set(patch).where(and(eq(reviewMeetings.id, id), eq(reviewMeetings.tenantId, session.tenantId)));

      // ─── Outcome → funnel ──────────────────────────────────────────────
      // The post-meeting outcome drives the lead's journey: ready → won,
      // not_interested → not_qualified, more_info/not_ready → re-nurture
      // (resurface in 7 days). Investor-side meetings just store the outcome.
      if (body.outcome && body.outcome !== before.outcome && before.leadId) {
        if (body.outcome === "ready") {
          await autoAdvance(tx, session.tenantId, before.leadId, "lead.won", {
            remarks: "Auto: meeting outcome = ready to proceed.",
          });
        } else if (body.outcome === "not_interested") {
          await autoAdvance(tx, session.tenantId, before.leadId, "lead.not_qualified", {
            remarks: "Auto: meeting outcome = not interested.",
          });
        } else if (body.outcome === "more_info" || body.outcome === "not_ready") {
          await tx
            .update(leads)
            .set({
              nextFollowUpAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
              updatedAt: new Date(),
            } as any)
            .where(and(eq(leads.id, before.leadId), eq(leads.tenantId, session.tenantId)));
        }
      }

      // ─── Automation: propagate review dates to investor on completion ──
      if (becomingCompleted) {
        const reviewedAt = patch.meetingDate ?? before.meetingDate;
        // Link spawned tasks to whichever party this meeting is about — a lead
        // meeting must NOT create investor-typed tasks with a null subjectId.
        const taskSubjectType: "investor" | "lead" = before.leadId ? "lead" : "investor";
        const taskSubjectId = before.leadId ?? before.investorId;
        const nextReviewDate =
          body.nextReviewDate ??
          // Default cadence: 90 days for HNI, 180 days for retail (we just default 180 here;
          // the existing tier-recomputer worker can refine this nightly).
          new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

        // Only update the investor's review cadence if this meeting was
        // actually with an investor. Lead-side meetings don't have a
        // review cycle (leads have a different lifecycle).
        if (before.investorId) {
          await tx
            .update(investors)
            .set({
              lastReviewAt: new Date(reviewedAt),
              nextReviewAt: new Date(nextReviewDate),
              lastContactAt: new Date(),
              updatedAt: new Date(),
            } as any)
            .where(and(eq(investors.id, before.investorId), eq(investors.tenantId, session.tenantId)));
        }

        // ─── Smart blueprint advance — meeting completed ──────────────
        // For lead-side meetings, push the blueprint to `meeting_done` so
        // the user sees their journey progress without a manual click.
        if (before.leadId) {
          await autoAdvance(tx, session.tenantId, before.leadId, "meeting.completed", {
            remarks: `Auto: meeting marked completed on ${new Date().toLocaleDateString("en-IN")}.`,
          });
        } else if (before.investorId) {
          // Client-side meeting completion → if the client was converted
          // from a lead, advance the source lead's blueprint too (covers
          // post-conversion review meetings).
          const leadId = await resolveLeadIdForInvestor(tx, before.investorId);
          if (leadId) {
            await autoAdvance(tx, session.tenantId, leadId, "meeting.completed", {
              remarks: "Auto: client review meeting completed.",
            });
          }
        }

        // ─── Automation: fan out action items into tasks ──────────────
        const items = (body.actionItems ?? (before.actionItems as any[] | null) ?? []) as Array<{
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
            tenantId: session.tenantId,
            assigneeId: it.assigneeId ?? before.rmId ?? session.userId,
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
        if (createdAny || (body.actionItems && body.actionItems.length > 0)) {
          await tx
            .update(reviewMeetings)
            .set({
              actionItems: stamped as any,
              followUpTaskCreated: "true",
              updatedAt: new Date(),
            } as any)
            .where(and(eq(reviewMeetings.id, id), eq(reviewMeetings.tenantId, session.tenantId)));
        }

        // ─── Automation: nudge the RM if notes are still empty ─────────
        const haveNotes = (body.meetingNotes ?? before.meetingNotes ?? "").trim().length > 0;
        if (!haveNotes && !before.notesReminderTaskId) {
          const notesTaskId = uuid();
          await tx.insert(tasks).values({
            id: notesTaskId,
            tenantId: session.tenantId,
            assigneeId: before.rmId ?? session.userId,
            subjectType: taskSubjectType,
            subjectId: taskSubjectId,
            relatedInvestorId: before.investorId ?? null,
            relatedLeadId: before.leadId ?? null,
            relatedMeetingId: id,
            type: "review_notes_pending",
            title: `Write up notes for the review meeting`,
            priority: "high",
            status: "open",
            dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            slaDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          } as any);
          await tx
            .update(reviewMeetings)
            .set({ notesReminderTaskId: notesTaskId } as any)
            .where(and(eq(reviewMeetings.id, id), eq(reviewMeetings.tenantId, session.tenantId)));
        }

        // ─── Auto-schedule the NEXT review (recurring cadence) ─────────
        // Reviews recur. On completing a review-category INVESTOR meeting,
        // create the next scheduled review at nextReviewDate so it shows in
        // Upcoming + fires its own T-1 reminder — unless a future review is
        // already on this client's calendar. Best-effort (savepoint) so it can
        // never fail the completion itself.
        if (before.category === "review" && before.investorId) {
          try {
            await tx.transaction(async (sp) => {
              const existing = await sp.execute(sql`
                SELECT 1 FROM review_meetings
                WHERE tenant_id = ${session.tenantId}::uuid
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
                  tenantId: session.tenantId,
                  assigneeId: before.rmId ?? session.userId,
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
                  tenantId: session.tenantId,
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
      }

      // ─── No-show → re-engage task ──────────────────────────────────────
      // Marking a meeting no_show should leave a trail of action: task the RM to
      // re-engage the client within a day instead of letting it drop silently.
      if (body.status === "no_show" && before.status !== "no_show") {
        const reSubjectType: "investor" | "lead" = before.leadId ? "lead" : "investor";
        const reSubjectId = before.leadId ?? before.investorId;
        await tx.insert(tasks).values({
          id: uuid(),
          tenantId: session.tenantId,
          assigneeId: before.rmId ?? session.userId,
          subjectType: reSubjectType,
          subjectId: reSubjectId,
          relatedInvestorId: before.investorId ?? null,
          relatedLeadId: before.leadId ?? null,
          relatedMeetingId: id,
          type: "follow_up",
          title: "Re-engage — client missed the scheduled meeting",
          description: "The client didn't attend. Reach out to understand why and reschedule.",
          priority: "high",
          status: "open",
          dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        } as any);
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: becomingCompleted ? "review_meeting.complete" : "review_meeting.update",
        entityType: "review_meeting",
        entityId: id,
        before: { status: before.status } as any,
        after: body as any,
        ...clientMeta,
      });

      return { ok: true, completed: becomingCompleted };
    });
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    if ("forbidden" in result) return NextResponse.json({ error: "you can only manage your own meetings" }, { status: 403 });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);
    const canAll = can(session.roles, "review_meeting.manage.all", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    const outcome = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(reviewMeetings).where(and(eq(reviewMeetings.id, id), eq(reviewMeetings.tenantId, session.tenantId))).limit(1))[0];
      if (!before) return "not_found" as const;
      if (!canAll && before.rmId !== session.userId) return "forbidden" as const;
      await tx
        .update(reviewMeetings)
        .set({ status: "cancelled", updatedAt: new Date() } as any)
        .where(and(eq(reviewMeetings.id, id), eq(reviewMeetings.tenantId, session.tenantId)));

      // Cancel the dangling T-1 reminder task so the RM isn't nagged about a
      // meeting that's no longer happening.
      if (before?.reminderTaskId) {
        await tx
          .update(tasks)
          .set({ status: "cancelled", updatedAt: new Date() } as any)
          .where(eq(tasks.id, before.reminderTaskId));
      }
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "review_meeting.cancel",
        entityType: "review_meeting",
        entityId: id,
        ...clientMeta,
      });
      return "ok" as const;
    });
    if (outcome === "not_found") return NextResponse.json({ error: "not found" }, { status: 404 });
    if (outcome === "forbidden") return NextResponse.json({ error: "you can only manage your own meetings" }, { status: 403 });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return handleApiError(err);
  }
}
