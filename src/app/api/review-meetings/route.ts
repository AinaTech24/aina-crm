import { handleApiError } from "@/lib/api/error-handler";
/**
 * Review meetings — collection endpoint.
 *
 *   GET  /api/review-meetings   — list with investor + RM joined
 *   POST /api/review-meetings   — schedule a new meeting
 *
 * Automations fired on create:
 *   1. Insert a reminder task for the RM (1 day before the meeting)
 *   2. Outbox event so any subscribed workflow can hook in (WA reminder, etc.)
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { sql, eq, and } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { autoAdvance, resolveLeadIdForInvestor } from "@/lib/blueprints/auto-advance";
import {
  reviewMeetings,
  investors,
  leads,
  tasks,
  eventsOutbox,
  REVIEW_MEETING_TYPES,
  REVIEW_MEETING_MODES,
  MEETING_CATEGORIES,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    // Exactly one of these must be set — refined below.
    investorId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
    familyId: z.string().uuid().optional(),
    rmId: z.string().uuid().optional(),
    category: z.enum(MEETING_CATEGORIES).default("review"),
    parentMeetingId: z.string().uuid().optional(),
    meetingType: z.enum(REVIEW_MEETING_TYPES),
    /** Optional free-text headline. */
    subject: z.string().max(300).optional(),
    meetingDate: z.string(), // ISO datetime
    durationMinutes: z.number().int().positive().default(30),
    meetingMode: z.enum(REVIEW_MEETING_MODES),
    locationOrLink: z.string().optional(),
    discussionPoints: z.string().optional(),
    /** Initial status — defaults to scheduled. */
    status: z.enum(["scheduled", "confirmed"]).default("scheduled"),
  })
  .refine((b) => Boolean(b.investorId) !== Boolean(b.leadId), {
    message: "Provide exactly one of investorId or leadId",
    path: ["investorId"],
  });

export async function GET() {
  try {
    const session = await requireSession();
    const rows = await withTenant(session.tenantId, async (tx) => {
      const r = await tx.execute(sql`
        SELECT m.*, i.name AS investor_name, i.segment_tag, i.pan AS investor_pan,
               u.name AS rm_name
        FROM review_meetings m
        LEFT JOIN investors i ON i.id = m.investor_id
        LEFT JOIN users u ON u.id = m.rm_id
        WHERE m.tenant_id = ${session.tenantId}::uuid
        ORDER BY m.meeting_date DESC
        LIMIT 500
      `);
      return r.rows;
    });
    return NextResponse.json({ meetings: rows });
  } catch (err: any) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "review_meeting.manage.all");
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body", issues: parse.error.issues }, { status: 400 });
    }
    const body = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const result = await withTenant(session.tenantId, async (tx) => {
      // Resolve the subject — investor OR lead. The XOR was enforced by zod.
      let subjectName = "";
      let subjectRmId: string | null = null;
      let subjectType: "investor" | "lead" = "investor";
      let subjectId = "";
      if (body.investorId) {
        const inv = (await tx.select().from(investors).where(and(eq(investors.id, body.investorId), eq(investors.tenantId, session.tenantId))).limit(1))[0];
        if (!inv) throw Object.assign(new Error("investor not found"), { status: 404 });
        subjectName = inv.name;
        subjectRmId = inv.rmId ?? null;
        subjectType = "investor";
        subjectId = body.investorId;
      } else {
        const ld = (await tx.select().from(leads).where(and(eq(leads.id, body.leadId!), eq(leads.tenantId, session.tenantId))).limit(1))[0];
        if (!ld) throw Object.assign(new Error("lead not found"), { status: 404 });
        subjectName = ld.name;
        subjectRmId = (ld as any).ownerId ?? null;
        subjectType = "lead";
        subjectId = body.leadId!;
      }

      const id = uuid();
      const rmId = body.rmId ?? subjectRmId ?? session.userId;
      const meetingDate = new Date(body.meetingDate);

      // ─── Automation 1 — reminder task (1 day before) ───────────────
      const reminderTaskId = uuid();
      const reminderAt = new Date(meetingDate.getTime() - 24 * 60 * 60 * 1000);
      await tx.insert(tasks).values({
        id: reminderTaskId,
        tenantId: session.tenantId,
        branchId: session.branchId ?? null,
        assigneeId: rmId,
        subjectType,
        subjectId,
        type: "review_meeting_reminder",
        title: `Reminder: ${labelForType(body.meetingType)} with ${subjectName} tomorrow`,
        description: `Mode: ${labelForMode(body.meetingMode)}${body.locationOrLink ? " · " + body.locationOrLink : ""}.${body.discussionPoints ? " Agenda: " + body.discussionPoints : ""}`,
        priority: "normal",
        status: "open",
        dueAt: reminderAt,
      } as any);

      await tx.insert(reviewMeetings).values({
        id,
        tenantId: session.tenantId,
        investorId: body.investorId ?? null,
        leadId: body.leadId ?? null,
        familyId: body.familyId ?? null,
        rmId,
        category: body.category,
        parentMeetingId: body.parentMeetingId ?? null,
        meetingType: body.meetingType,
        subject: body.subject ?? null,
        meetingDate,
        durationMinutes: String(body.durationMinutes),
        meetingMode: body.meetingMode,
        locationOrLink: body.locationOrLink ?? null,
        discussionPoints: body.discussionPoints ?? null,
        status: body.status,
        reminderTaskId,
      } as any);

      // Outbox so subscribed workflows can confirm + remind the client. The
      // entity pointer is the *person* (investor/lead) — not the meeting — so a
      // subscribed recipe's subject resolves to someone with a phone/email to
      // message. `reminderAt` (meeting − 1 day, already computed above for the
      // RM reminder task) lets a recipe wait_until_date and fire a day-before
      // reminder. Meeting linkage stays in `after`.
      await tx.insert(eventsOutbox).values({
        tenantId: session.tenantId,
        kind: "review_meeting.scheduled",
        entityType: subjectType,
        entityId: subjectId,
        after: {
          reviewMeetingId: id,
          investorId: body.investorId ?? null,
          leadId: body.leadId ?? null,
          meetingType: body.meetingType,
          meetingDate: meetingDate.toISOString(),
          reminderAt: reminderAt.toISOString(),
          mode: body.meetingMode,
          locationOrLink: body.locationOrLink ?? null,
        },
        meta: { userId: session.userId } as any,
      } as any);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "review_meeting.create",
        entityType: "review_meeting",
        entityId: id,
        after: {
          investorId: body.investorId ?? null,
          leadId: body.leadId ?? null,
          meetingType: body.meetingType,
          mode: body.meetingMode,
        } as any,
        ...clientMeta,
      });

      // ─── Smart blueprint advance ───────────────────────────────────
      // If this meeting was scheduled against a lead, push the lead's
      // blueprint to `appointment_scheduled` so the user doesn't have to
      // hop to the lead detail page and click Advance.
      if (body.leadId) {
        await autoAdvance(tx, session.tenantId, body.leadId, "meeting.scheduled.lead", {
          remarks: `Auto: ${labelForType(body.meetingType)} scheduled for ${meetingDate.toLocaleDateString("en-IN")}.`,
        });
      }

      return { id, rmId, reminderTaskId };
    });

    return NextResponse.json(result, { status: 201 });
  } catch (err: any) {
    return handleApiError(err);
  }
}

function labelForType(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function labelForMode(m: string): string {
  return m === "client_place" ? "Client place" : m.charAt(0).toUpperCase() + m.slice(1);
}
