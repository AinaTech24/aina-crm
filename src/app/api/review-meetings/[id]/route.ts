import { handleApiError } from "@/lib/api/error-handler";
/**
 * Single review meeting endpoints.
 *
 *   PATCH  /api/review-meetings/[id]   — update status / notes / action items / next-review
 *   DELETE /api/review-meetings/[id]   — cancel (status='cancelled')
 *
 * Automations on status flip to `completed` (lib/review-meetings/complete.ts,
 * shared with the bulk route):
 *   - Update investor.lastReviewAt = meeting_date and nextReviewAt = nextReviewDate
 *   - Stamp the same review on every other live member of that client's FAMILY
 *     (each keeps their own cadence; contact dates are not propagated) —
 *     see lib/reviews/family-propagation.ts
 *   - Fan out any action item still without a task (rows saved before action
 *     items became tasks on save)
 *   - Stamp followUpTaskCreated = true
 *
 * On EVERY save (lib/review-meetings/sync.ts):
 *   - action items are tasks: created on first save, edited / cancelled with the row
 *   - attendees are checked against the firm's clients, leads and team; a team
 *     member newly added is notified, and the meeting is theirs to open and edit
 */

import { NextRequest, NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { can, requireAny } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import type { FamilyPropagationResult } from "@/lib/reviews/family-propagation";
import { autoAdvance } from "@/lib/blueprints/auto-advance";
import { ATTENDEE_KINDS, hasUserAttendee } from "@/lib/review-meetings/attendees";
import { cleanAttendees, notifyAddedTeam, syncActionItemTasks, type ActionItemIn } from "@/lib/review-meetings/sync";
import { canSeeMeeting } from "@/lib/review-meetings/scope";
import { applyMeetingCompleted, applyMeetingNoShow, cancelMeetingReminders } from "@/lib/review-meetings/complete";
import {
  reviewMeetings,
  leads,
  tasks,
  REVIEW_MEETING_STATUSES,
  REVIEW_MEETING_OUTCOMES,
} from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * GET /api/review-meetings/[id] — single meeting bundle.
 *
 * Returns the meeting row (snake_case, mirroring the list) with the subject
 * (investor / lead) + RM names joined, plus an optional "prep brief" for
 * upcoming investor meetings (same shape the web detail page computes). This
 * one endpoint serves BOTH the mobile detail screen and the edit-form hydration.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireAny(session.roles, ["review_meeting.manage.all", "review_meeting.manage.assigned"], session.permissions);
    const canAll = can(session.roles, "review_meeting.manage.all", session.permissions);
    const data = await withTenant(
      session.tenantId,
      async (tx) => {
        const r = await tx.execute(sql`
          SELECT m.*, COALESCE(i.name, l.name) AS investor_name, l.name AS lead_name,
                 i.segment_tag, i.pan AS investor_pan, u.name AS rm_name
          FROM review_meetings m
          LEFT JOIN investors i ON i.id = m.investor_id
          LEFT JOIN leads l ON l.id = m.lead_id
          LEFT JOIN users u ON u.id = m.rm_id
          WHERE m.id = ${id}::uuid AND m.tenant_id = ${session.tenantId}::uuid
          LIMIT 1
        `);
        const m = r.rows[0] as any;
        if (!m) return null;
        // RMs (manage.assigned) may only view their own meetings — or one they attend.
        if (!canAll && m.rm_id !== session.userId && !hasUserAttendee(m.attendees, session.userId)) return { forbidden: true as const };
        // manage.all reaches only meetings whose client / lead is in scope.
        if (!(await canSeeMeeting(tx, session, id))) return null;

        // Prep brief — only for upcoming/in-progress INVESTOR meetings.
        let prep: any = null;
        if (m.investor_id && ["scheduled", "confirmed", "in_progress"].includes(m.status)) {
          const p = await tx.execute(sql`
            SELECT
              i.aum, i.last_review_at, i.active_sip_amount, i.health_score, i.health_band,
              (SELECT count(*) FROM service_requests sr WHERE sr.investor_id = i.id
                 AND sr.status IN ('open','in_progress','waiting_customer','escalated'))::int AS open_srs,
              (SELECT count(*) FROM sips s WHERE s.investor_id = i.id
                 AND s.status NOT IN ('stopped','cancelled','completed'))::int AS active_sips,
              (SELECT count(*) FROM transactions t WHERE t.investor_id = i.id AND t.type = 'sip'
                 AND t.status IN ('rejected','failed')
                 AND t.order_date >= current_date - interval '180 days')::int AS bounces_6mo,
              (SELECT count(*) FROM goals g WHERE g.investor_id = i.id)::int AS goals_count
            FROM investors i WHERE i.id = ${m.investor_id}::uuid
          `);
          prep = (p.rows[0] as any) ?? null;
        }
        return { meeting: m, prep };
      },
      { userId: session.userId, branchId: session.branchId, roles: session.roles }
    );
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    if ("forbidden" in data) return NextResponse.json({ error: "you can only view your own meetings" }, { status: 403 });
    const m = data.meeting;
    return NextResponse.json({
      ...m,
      prep: data.prep,
      subject_name: m.investor_name ?? m.lead_name ?? "Subject",
      subject_kind: m.lead_id ? "lead" : "client",
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}

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
  /** Looked up from the CRM, or a typed guest. */
  kind: z.enum(ATTENDEE_KINDS).optional(),
  refId: z.string().uuid().optional(),
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
    // fileId: an uploaded file (lib/review-meetings/files.ts) — kept on save.
    .array(z.object({ name: z.string(), url: z.string(), size: z.number().optional(),
      fileId: z.string().uuid().optional(), uploadedAt: z.string().optional() }))
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
      // RMs (manage.assigned) may only touch meetings they own — or attend.
      if (!canAll && before.rmId !== session.userId && !hasUserAttendee(before.attendees, session.userId)) {
        return { forbidden: true as const };
      }
      // manage.all reaches only meetings whose client / lead is in scope.
      if (!(await canSeeMeeting(tx, session, id))) return null;

      const patch: any = { ...body, updatedAt: new Date() };
      const meetingLabel = (body.subject ?? before.subject) || "a meeting";

      // Attendees: only real clients / leads / team members keep their link.
      const cleanedAttendees = body.attendees ? await cleanAttendees(tx, session.tenantId, body.attendees as any) : null;
      if (cleanedAttendees) patch.attendees = cleanedAttendees;

      // Action items are tasks from the first save, not only on completion.
      let syncedItems: ActionItemIn[] | null = null;
      if (body.actionItems) {
        syncedItems = await syncActionItemTasks(tx, {
          tenantId: session.tenantId,
          actorId: session.userId,
          meeting: before,
          items: body.actionItems,
          meetingLabel,
        });
        patch.actionItems = syncedItems;
        if (syncedItems.length > 0) patch.followUpTaskCreated = "true";
      }
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
      // "Rescheduled" with a new date (the Activity tab) is a reschedule like
      // the editor's: the meeting is on again at the new time, so it stays
      // scheduled — every upcoming view counts only scheduled / confirmed.
      if (dateChanged && body.status === "rescheduled") patch.status = "scheduled";
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
      // Called off here rather than by DELETE: its T-1 reminder goes with it.
      if (body.status === "cancelled" && before.status !== "cancelled") {
        await cancelMeetingReminders(tx, session.tenantId, [id]);
      }

      if (cleanedAttendees) {
        await notifyAddedTeam(tx, {
          tenantId: session.tenantId,
          meetingId: id,
          actorId: session.userId,
          title: meetingLabel,
          when: patch.meetingDate ?? before.meetingDate,
          before: before.attendees,
          after: cleanedAttendees,
        });
      }

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

      // ─── Completion / no-show automations (lib/review-meetings/complete.ts,
      // shared with the bulk route) ─────────────────────────────────────────
      let familyPropagation: FamilyPropagationResult | null = null;
      if (becomingCompleted) {
        familyPropagation = await applyMeetingCompleted(tx, {
          tenantId: session.tenantId,
          actorId: session.userId,
          before,
          reviewedAt: patch.meetingDate ?? before.meetingDate,
          explicitNextReview: body.nextReviewDate,
          items: syncedItems,
          itemsSent: !!(body.actionItems && body.actionItems.length > 0),
        });
      }
      if (body.status === "no_show" && before.status !== "no_show") {
        await applyMeetingNoShow(tx, { tenantId: session.tenantId, actorId: session.userId, before });
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: becomingCompleted ? "review_meeting.complete" : "review_meeting.update",
        entityType: "review_meeting",
        entityId: id,
        before: { status: before.status } as any,
        after: {
          ...body,
          // A client whose next review moved without a meeting of their own
          // has to be able to show why.
          ...(familyPropagation?.updated
            ? {
                familyReview: {
                  familyId: familyPropagation.familyId,
                  alsoReviewed: familyPropagation.members,
                },
              }
            : {}),
        } as any,
        ...clientMeta,
      });

      return {
        ok: true,
        completed: becomingCompleted,
        // The editor keeps these, so a second save edits the same tasks.
        actionItems: syncedItems ?? undefined,
        attendees: cleanedAttendees ?? undefined,
        familyAlsoReviewed: familyPropagation?.updated ?? 0,
        familyMembers: familyPropagation?.members.map((m) => m.name) ?? [],
      };
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
      if (!(await canSeeMeeting(tx, session, id))) return "not_found" as const;
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
