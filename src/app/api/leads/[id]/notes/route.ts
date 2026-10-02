import { handleApiError } from "@/lib/api/error-handler";
/**
 * GET  /api/leads/[id]/notes — the lead's notes, newest first (lib/notes).
 * POST /api/leads/[id]/notes
 * Body: { note, activityType?: 'call'|'meeting'|'email'|'whatsapp'|'note'|'other' }
 *
 * Appends a timestamped activity entry to the lead. The latest goes to the top
 * of the followUpNotes field; stage_changed_at + last_contact_at are bumped so
 * the lead doesn't go stale and the missed-follow-up automation doesn't fire.
 *
 * The same entry is mirrored into `activities`, the interaction log that the
 * Activities page, the team scorecards ("calls logged today") and the lead's
 * engagement score read. Before this, a call logged from the lead page counted
 * for the blueprint but for nothing else, and the page offered a second
 * "Log call / visit" button that did the opposite. One button, both stores.
 */

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { withIdempotentMutation } from "@/lib/api/idempotent-mutation";
import { requireSession } from "@/lib/auth/session";
import { assertActiveLicense } from "@/lib/auth/license";
import { leads, eventsOutbox, activities, type ActivityKind } from "@/db/schema";
import { autoAdvance } from "@/lib/blueprints/auto-advance";
import { loadEditableLead, loadViewableLead } from "@/lib/leads/access";
import { loadRecordNotes } from "@/lib/notes/record-notes";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const Body = z.object({
  note: z.string().min(1).max(4000),
  activityType: z.enum(["call", "meeting", "email", "whatsapp", "note", "other"]).default("note"),
  nextFollowUpAt: z.string().datetime().optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    const notes = await withTenant(session.tenantId, async (tx) => {
      const lead = await loadViewableLead(tx, session, id);
      if (!lead) return null;
      return loadRecordNotes(tx, session.tenantId, { type: "lead", id }, lead.followUpNotes);
    });
    if (!notes) return NextResponse.json({ error: "lead not found" }, { status: 404 });
    return NextResponse.json({ notes });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });

    const result = await withIdempotentMutation(session, req, parse.data, async (tx) => {
      const lead = await loadEditableLead(tx, session, id);

      const ts = new Date();
      const stamp = ts.toISOString().slice(0, 16).replace("T", " ");
      const prefix = `[${stamp} · ${parse.data.activityType}${
        session.name ? " · " + session.name : ""
      }]`;
      const entry = `${prefix}\n${parse.data.note}`;
      const combined = lead.followUpNotes ? `${entry}\n\n---\n\n${lead.followUpNotes}` : entry;

      const [after] = await tx
        .update(leads)
        .set({
          followUpNotes: combined,
          lastContactAt: ts,
          lastFollowUpAt: ts,
          nextFollowUpAt: parse.data.nextFollowUpAt ? new Date(parse.data.nextFollowUpAt) : lead.nextFollowUpAt,
          updatedAt: ts,
        } as any)
        .where(eq(leads.id, id))
        .returning();

      // Mirror into the interaction log. A meeting is not one of its kinds (a
      // held meeting is a review_meetings row), so it is filed as "other" with
      // the subject saying what it was. A logged call is a conversation that
      // happened — the blueprint treats it as one — so it is "answered". No
      // follow-up date here: the lead's own next_follow_up_at carries that,
      // and the desk would otherwise list the lead twice.
      const ACTIVITY_KIND: Record<string, ActivityKind> = {
        call: "call", meeting: "other", email: "email", whatsapp: "whatsapp", note: "note", other: "other",
      };
      const kind = ACTIVITY_KIND[parse.data.activityType] ?? "note";
      await tx.insert(activities).values({
        tenantId: session.tenantId,
        branchId: session.branchId ?? null,
        subjectType: "lead",
        subjectId: id,
        subjectName: lead.name ?? null,
        subjectPhone: lead.phone ?? null,
        kind,
        direction: kind === "call" ? "outbound" : null,
        status: kind === "call" ? "answered" : null,
        subject: parse.data.activityType === "meeting" ? "Meeting" : null,
        notes: parse.data.note,
        occurredAt: ts,
        ownerUserId: session.userId,
      } as any);

      // Emit lead.updated so record_action "edit" workflow rules can react to a
      // logged activity (e.g. a contacted-lead follow-up cadence).
      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "lead.updated",
        entityType: "lead",
        entityId: id,
        before: lead as any,
        after: (after ?? lead) as any,
        meta: { userId: session.userId, source: "note" } as any,
      } as any);

      // ─── Smart blueprint advance — activity logged ────────────────
      // The activity type determines which stage the lead jumps to:
      //   - call    → call_done   (stage 2 of the SOP)
      //   - meeting → meeting_done (stage 8) — RM logged a past meeting
      // Other types (email, whatsapp, note) just refresh the lastContactAt
      // without moving the funnel.
      if (parse.data.activityType === "call") {
        await autoAdvance(tx, session.tenantId, id, "call.logged", {
          remarks: `Auto: call logged on ${formatDate(ts)} — "${parse.data.note.slice(0, 60)}".`,
        });
      } else if (parse.data.activityType === "meeting") {
        await autoAdvance(tx, session.tenantId, id, "meeting.completed", {
          remarks: `Auto: past meeting logged — "${parse.data.note.slice(0, 60)}".`,
        });
      }

      return { ok: true };
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
