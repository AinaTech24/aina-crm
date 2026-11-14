import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/[id]/call-outcome
 *   Body: { outcome, notes?, meeting?, followUpDate?, lostReason? }
 *
 * Logs the call outcome + advances the blueprint stage + creates side-effect
 * rows (meeting, follow-up task, etc.) as required.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { leads, tasks, reviewMeetings, eventsOutbox } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { transitionTo } from "@/lib/blueprints/engine";
import { loadEditableLead } from "@/lib/leads/access";
import { closeLeadTasks, touchClientContact } from "@/lib/leads/open-tasks";
import { scheduleNextTouchReminder } from "@/lib/blueprints/stage-side-effects";

export const dynamic = "force-dynamic";

const Body = z.object({
  outcome: z.enum(["connected", "not_reachable", "call_later", "not_interested", "wrong_number", "appointment_booked"]),
  notes: z.string().max(2000).optional(),
  meeting: z
    .object({
      date: z.string(),
      time: z.string(),
      mode: z.enum(["office", "client_place", "online", "phone"]).default("online"),
      location: z.string().optional(),
      agenda: z.string().optional(),
    })
    .optional(),
  followUpDate: z.string().optional(),
  lostReason: z.string().max(500).optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    const body = parsed.data;
    const now = new Date();

    const out = await withTenant(session.tenantId, async (tx) => {
      const lead = await loadEditableLead(tx, session, id);

      // 1. Log the call as a completed task
      await tx.insert(tasks).values({
        tenantId: session.tenantId,
        subjectType: "lead" as any,
        subjectId: id,
        relatedLeadId: id,
        type: "call",
        title: `Call: ${body.outcome.replace(/_/g, " ")}`,
        description: body.notes ?? null,
        priority: "normal",
        status: "completed",
        assigneeId: session.userId,
        department: "sales",
        startedAt: now,
        completedAt: now,
        remarks: body.notes ?? null,
        meta: { outcome: body.outcome } as any,
      } as any);

      // 2. Bump lastContactAt
      await tx
        .update(leads)
        .set({ lastContactAt: now, updatedAt: now })
        .where(eq(leads.id, id));
      // A converted lead is a client now: the call is client contact too.
      const converted = !!lead.convertedInvestorId;
      if (lead.convertedInvestorId) await touchClientContact(tx, session.tenantId, lead.convertedInvestorId, now);

      // 3. Side-effect: meeting / follow-up / close
      let toStageKey: string | null = null;

      if (body.outcome === "appointment_booked" && !body.meeting) {
        throw Object.assign(new Error("meeting details are required"), { status: 400 });
      }

      if (body.outcome === "appointment_booked" && body.meeting) {
        const dt = new Date(`${body.meeting.date}T${body.meeting.time}:00`);
        await tx.insert(reviewMeetings).values({
          tenantId: session.tenantId,
          leadId: id,
          category: "new" as any,
          meetingType: "discovery_call" as any,
          meetingDate: dt,
          durationMinutes: "30",
          meetingMode: body.meeting.mode as any,
          locationOrLink: body.meeting.location ?? null,
          discussionPoints: body.meeting.agenda ?? null,
          status: "scheduled" as any,
          rmId: lead.ownerId ?? session.userId,
        } as any);

        toStageKey = "meeting_scheduled";

        // emit event so the meeting-confirmation comm recipe can fire
        await tx.insert(eventsOutbox).values({
          tenantId: session.tenantId,
          kind: "meeting.scheduled",
          entityType: "lead",
          entityId: id,
          after: { meetingAt: dt.toISOString(), mode: body.meeting.mode },
          meta: { actorUserId: session.userId } as any,
        } as any);
      }

      if (body.outcome === "call_later" && body.followUpDate) {
        // The lead's ONE next-touch reminder moves (or is created), and its
        // next follow-up date with it — a second "call later" never adds a
        // second task (audit L14).
        const dueAt = new Date(`${body.followUpDate}T09:00:00`);
        await scheduleNextTouchReminder(tx, session.tenantId, id, lead.ownerId ?? session.userId, dueAt.toISOString(), "call_back_later");
        toStageKey = "call_back_later";
      }

      // A client is never marked lost from a call on their old lead record;
      // the lost reason is written only once the journey really closed.
      const losing = !converted && (body.outcome === "not_interested" || body.outcome === "wrong_number");
      if (losing) toStageKey = "not_qualified";

      // "connected" without an appointment → move to post-meeting qualification
      if (body.outcome === "not_reachable") toStageKey = "call_not_connected";
      if (body.outcome === "connected") toStageKey = "call_done";

      // 4. Advance blueprint stage if we picked one. The stage follows from
      //    the outcome rather than a chosen step, so it is an AUTOMATIC move:
      //    forward-only, and never back into the lead phase for a client
      //    (lib/blueprints/journey-rules.ts) — e.g. "not reachable" on a lead
      //    already at Meeting Done leaves it there.
      let transition = null as null | { ok?: boolean; fromStage?: string; toStage?: string; reason?: string };
      if (toStageKey) {
        transition = await tx.transaction((sp) =>
          transitionTo(sp as any, session.tenantId, id, toStageKey!, {
            actorUserId: session.userId,
            actorRoles: session.roles ?? [],
            systemBypass: true,
            automatic: true,
            remarks: body.notes,
          }),
        );
      }

      if (losing && transition?.ok && transition.toStage === "not_qualified") {
        await tx
          .update(leads)
          .set({
            lostReason: body.lostReason ?? body.outcome.replace(/_/g, " "),
            lostAt: now,
            updatedAt: now,
            followUpNotes: (lead.followUpNotes ? lead.followUpNotes + "\n\n---\n\n" : "") +
              `[${now.toISOString().slice(0, 16).replace("T", " ")} · ${body.outcome} · ${session.userId}]\n${body.lostReason ?? "no reason"}`,
          } as any)
          .where(eq(leads.id, id));
        await closeLeadTasks(tx, session.tenantId, id, { reason: `Lead closed as lost (${body.outcome.replace(/_/g, " ")}).` });
      }

      // Emit lead.updated (after all the outcome side-effects) so record_action
      // "edit" workflow rules can react to a logged call outcome — the dedicated
      // blueprint events alone don't satisfy a generic lead-edit rule.
      const [after] = await tx.select().from(leads).where(eq(leads.id, id)).limit(1);
      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "lead.updated",
        entityType: "lead",
        entityId: id,
        before: lead as any,
        after: (after ?? lead) as any,
        meta: { userId: session.userId, source: "call_outcome", outcome: body.outcome } as any,
      } as any);

      return { outcome: body.outcome, transition };
    });

    return NextResponse.json(out, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
