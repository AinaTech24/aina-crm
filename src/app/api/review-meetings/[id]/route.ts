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
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { autoAdvance, resolveLeadIdForInvestor } from "@/lib/blueprints/auto-advance";
import { reviewMeetings, investors, tasks, REVIEW_MEETING_STATUSES } from "@/db/schema";

export const dynamic = "force-dynamic";

const ActionItem = z.object({
  title: z.string().min(2).max(300),
  assigneeId: z.string().uuid().optional(),
  dueAt: z.string().optional(),
  taskId: z.string().uuid().optional(),
});

const Patch = z.object({
  status: z.enum(REVIEW_MEETING_STATUSES).optional(),
  meetingDate: z.string().optional(),
  meetingMode: z.string().optional(),
  locationOrLink: z.string().optional(),
  discussionPoints: z.string().optional(),
  meetingNotes: z.string().optional(),
  actionItems: z.array(ActionItem).optional(),
  attachments: z
    .array(z.object({ name: z.string(), url: z.string(), size: z.number().optional() }))
    .optional(),
  nextReviewDate: z.string().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "review_meeting.manage.all");
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Patch.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      const before = (await tx.select().from(reviewMeetings).where(eq(reviewMeetings.id, id)).limit(1))[0];
      if (!before) return null;

      const patch: any = { ...body, updatedAt: new Date() };
      if (body.meetingDate) patch.meetingDate = new Date(body.meetingDate);
      // Stamp actualEndAt when transitioning to completed
      // Reference the auto-advance helper (imported below at module scope).
      const becomingCompleted = body.status === "completed" && before.status !== "completed";
      if (becomingCompleted) {
        patch.actualEndAt = new Date();
      }

      await tx.update(reviewMeetings).set(patch).where(eq(reviewMeetings.id, id));

      // ─── Automation: propagate review dates to investor on completion ──
      if (becomingCompleted) {
        const reviewedAt = patch.meetingDate ?? before.meetingDate;
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
            .where(eq(investors.id, before.investorId));
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
        let createdAny = false;
        const stamped = items.map((it) => {
          if (it.taskId) return it; // already created
          const taskId = uuid();
          createdAny = true;
          // Schedule the task now (inside the same tx)
          tx.insert(tasks).values({
            id: taskId,
            tenantId: session.tenantId,
            assigneeId: it.assigneeId ?? before.rmId ?? session.userId,
            subjectType: "investor",
            subjectId: before.investorId,
            type: "review_action_item",
            title: it.title,
            priority: "normal",
            status: "open",
            dueAt: it.dueAt ? new Date(it.dueAt) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            workflowRunId: null,
          } as any);
          return { ...it, taskId };
        });
        if (createdAny || (body.actionItems && body.actionItems.length > 0)) {
          await tx
            .update(reviewMeetings)
            .set({
              actionItems: stamped as any,
              followUpTaskCreated: "true",
              updatedAt: new Date(),
            } as any)
            .where(eq(reviewMeetings.id, id));
        }

        // ─── Automation: nudge the RM if notes are still empty ─────────
        const haveNotes = (body.meetingNotes ?? before.meetingNotes ?? "").trim().length > 0;
        if (!haveNotes && !before.notesReminderTaskId) {
          const notesTaskId = uuid();
          await tx.insert(tasks).values({
            id: notesTaskId,
            tenantId: session.tenantId,
            assigneeId: before.rmId ?? session.userId,
            subjectType: "investor",
            subjectId: before.investorId,
            type: "review_notes_pending",
            title: `Write up notes for review meeting with investor`,
            priority: "high",
            status: "open",
            dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            slaDueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          } as any);
          await tx
            .update(reviewMeetings)
            .set({ notesReminderTaskId: notesTaskId } as any)
            .where(eq(reviewMeetings.id, id));
        }
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
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "review_meeting.manage.all");
    await assertActiveLicense(session.tenantId, session.roles);
    const clientMeta = clientMetaFromHeaders(req.headers);
    await withTenant(session.tenantId, async (tx) => {
      await tx
        .update(reviewMeetings)
        .set({ status: "cancelled", updatedAt: new Date() } as any)
        .where(eq(reviewMeetings.id, id));
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "review_meeting.cancel",
        entityType: "review_meeting",
        entityId: id,
        ...clientMeta,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
