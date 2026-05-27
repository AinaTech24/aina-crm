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
import { transitionTo } from "@/lib/blueprints/engine";

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
    const { id } = await params;
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    const body = parsed.data;
    const now = new Date();

    const out = await withTenant(session.tenantId, async (tx) => {
      const [lead] = await tx.select().from(leads).where(eq(leads.id, id));
      if (!lead) throw Object.assign(new Error("Lead not found"), { status: 404 });

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

      // 3. Side-effect: meeting / follow-up / close
      let toStageKey: string | null = null;

      if (body.outcome === "appointment_booked" && body.meeting) {
        const dt = new Date(`${body.meeting.date}T${body.meeting.time}:00`);
        await tx.insert(reviewMeetings).values({
          tenantId: session.tenantId,
          investorId: id, // polymorphic — using lead id here, view layer reads name from lead/investor
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

        toStageKey = "appointment_scheduled";

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
        const dueAt = new Date(`${body.followUpDate}T09:00:00`);
        await tx.insert(tasks).values({
          tenantId: session.tenantId,
          subjectType: "lead" as any,
          subjectId: id,
          relatedLeadId: id,
          type: "follow_up",
          title: `Follow-up call: ${lead.name}`,
          description: body.notes ?? null,
          priority: "normal",
          status: "open",
          assigneeId: lead.ownerId ?? session.userId,
          department: "sales",
          dueAt,
        } as any);
        // Stage stays on first_call_pending; we just scheduled the next call.
      }

      if (body.outcome === "not_interested" || body.outcome === "wrong_number") {
        await tx
          .update(leads)
          .set({
            stage: "not_interested" as any,
            stageChangedAt: now,
            updatedAt: now,
            followUpNotes: (lead.followUpNotes ? lead.followUpNotes + "\n\n---\n\n" : "") +
              `[${now.toISOString().slice(0, 16).replace("T", " ")} · ${body.outcome} · ${session.userId}]\n${body.lostReason ?? "no reason"}`,
          } as any)
          .where(eq(leads.id, id));
        // No further stage transitions needed.
      }

      // "connected" without an appointment → move to post-meeting qualification
      if (body.outcome === "connected") toStageKey = "post_meeting_qualified";

      // 4. Advance blueprint stage if we picked one — systemBypass so we
      //    can jump from any source stage (e.g. directly new → meeting_done).
      let transition = null as null | { fromStage?: string; toStage?: string; reason?: string };
      if (toStageKey) {
        transition = await transitionTo(tx, session.tenantId, id, toStageKey, {
          actorUserId: session.userId,
          actorRoles: session.roles ?? [],
          systemBypass: true,
          remarks: body.notes,
        });
      }

      return { outcome: body.outcome, transition };
    });

    return NextResponse.json(out, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message ?? "internal" }, { status: err.status ?? 500 });
  }
}
