/**
 * Meetings — the Excel import (2026-11-24). Columns are specs/meetings.ts.
 *
 * Scheduling a meeting by hand (POST /api/review-meetings) also queues a client
 * confirmation / reminder workflow, advances the lead's journey and pings every
 * colleague. An imported meeting is a RECORD: none of that runs, so a history
 * import cannot message a client. What it keeps from the normal flow:
 *   - the same-RM double-booking guard, for meetings still to happen
 *     (checked against the firm's live meetings AND the earlier rows of the file);
 *   - the RM's reminder task, for a meeting more than a day away.
 */
import { sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { reviewMeetings, tasks } from "@/db/schema";
import type { Tx } from "@/db/client";
import type { SessionUser } from "@/lib/auth/session";
import { requireAny } from "@/lib/auth/rbac";
import { loadClients, loadLeads, loadUsers, type ClientLookup, type LeadLookup, type UserLookup, type UserRef } from "./lookups";
import type { ImportModule, Problem } from "./run";
import {
  MEETING_CATEGORY_OPTIONS, MEETING_MODE_OPTIONS, MEETING_STATUS_OPTIONS, MEETING_TYPE_OPTIONS, meetingsSpec,
} from "./specs/meetings";
import { humanise, istInstant, parseDay, parseEnum, parseInteger, parseList, parseTime } from "./values";

type Slot = { rmId: string; start: number; end: number };
type Prep = { users: UserLookup; clients: ClientLookup; leads: LeadLookup; live: Slot[] };
type Attendee = { name: string; role: string; isExternal: boolean; kind: "user" | "guest"; refId?: string };
type Item = {
  investorId: string | null; leadId: string | null; subjectName: string; rmId: string; category: string; meetingType: string;
  subject: string | null; meetingDate: Date; durationMinutes: number; meetingMode: string; locationOrLink: string | null;
  discussionPoints: string | null; status: string; attendees: Attendee[];
};

const LIVE = new Set(["scheduled", "confirmed", "in_progress"]);
const roleOf = (u: UserRef) =>
  u.roles.some((r) => ["rm", "branch_head", "owner"].includes(r)) ? "rm"
  : u.roles.some((r) => ["back_office", "ops"].includes(r)) ? "back_office"
  : u.roles.includes("compliance") ? "compliance" : "other";

export const meetingsImport: ImportModule<Prep, Item> = {
  spec: meetingsSpec,

  authorize(session) {
    requireAny(session.roles, ["review_meeting.manage.all"], session.permissions);
  },

  async prepare(tx, session, rows) {
    const [users, clients, leads] = await Promise.all([
      loadUsers(tx, session.tenantId),
      loadClients(tx, session, rows.map((r) => ({ pan: r.get("clientPan"), name: r.get("clientName") }))),
      loadLeads(tx, session, rows.map((r) => ({ mobile: r.get("leadMobile"), name: r.get("leadName") }))),
    ]);
    // The firm's live meetings around the dates in the file, for the double-booking check.
    const days = rows.map((r) => parseDay(r.get("meetingDate"))).flatMap((p) => (p.ok ? [p.value] : [])).sort();
    let live: Slot[] = [];
    if (days.length) {
      const r = await tx.execute(sql`
        SELECT rm_id::text AS "rmId", meeting_date AS d,
               COALESCE(NULLIF(duration_minutes, ''), '30')::int AS mins
          FROM review_meetings
         WHERE tenant_id = ${session.tenantId}::uuid AND rm_id IS NOT NULL
           AND status IN ('scheduled', 'confirmed', 'in_progress')
           AND meeting_date >= (${days[0]}::date - interval '1 day')
           AND meeting_date < (${days[days.length - 1]}::date + interval '2 days')
      `);
      live = (r.rows as Array<{ rmId: string; d: string | Date; mins: number }>).map((m) => ({
        rmId: m.rmId, start: new Date(m.d).getTime(), end: new Date(m.d).getTime() + m.mins * 60_000,
      }));
    }
    return { users, clients, leads, live };
  },

  parse(row, prep, session) {
    const choice = (key: string, options: Array<{ value: string; label: string }>, fallback: string | null, required = false) => {
      const raw = row.get(key);
      if (!raw) { if (required) row.fail(key, "Required"); return fallback; }
      const p = parseEnum(raw, options);
      if (p.ok) return p.value;
      row.fail(key, p.error);
      return fallback;
    };
    const category = choice("category", MEETING_CATEGORY_OPTIONS, "review") as string;
    const meetingType = choice("meetingType", MEETING_TYPE_OPTIONS, null, true);
    const meetingMode = choice("meetingMode", MEETING_MODE_OPTIONS, null, true);
    const statusGiven = choice("status", MEETING_STATUS_OPTIONS, null);

    // Date and time (India time).
    let meetingDate: Date | null = null;
    if (!row.get("meetingDate")) row.fail("meetingDate", "Required");
    else {
      const d = parseDay(row.get("meetingDate"));
      let time = "10:00";
      if (row.get("meetingTime")) {
        const t = parseTime(row.get("meetingTime"));
        if (t.ok) time = t.value; else row.fail("meetingTime", t.error);
      }
      if (d.ok) meetingDate = istInstant(d.value, time); else row.fail("meetingDate", d.error);
    }
    let durationMinutes = 30;
    if (row.get("durationMinutes")) {
      const p = parseInteger(row.get("durationMinutes"), 1, 1440);
      if (p.ok) durationMinutes = p.value; else row.fail("durationMinutes", p.error);
    }
    const subject = row.get("subject");
    if (subject.length > 300) row.fail("subject", "Too long — 300 characters at most");
    const discussionPoints = row.get("discussionPoints");
    if (discussionPoints.length > 20000) row.fail("discussionPoints", "Too long — 20,000 characters at most");

    // Exactly one of: a client, a lead.
    const c = prep.clients.find({ pan: row.get("clientPan"), name: row.get("clientName") });
    const l = prep.leads.find({ mobile: row.get("leadMobile"), name: row.get("leadName") });
    if (!c.ok) row.fail(row.get("clientPan") ? "clientPan" : "clientName", c.error);
    if (!l.ok) row.fail(row.get("leadMobile") ? "leadMobile" : "leadName", l.error);
    const client = c.ok ? c.value : null;
    const lead = l.ok ? l.value : null;
    if (c.ok && l.ok) {
      if (client && lead) row.fail("clientPan", "Give a client OR a lead, not both");
      else if (!client && !lead) row.fail("clientPan", "Give the client (PAN or name) or the lead (mobile or name)");
    }

    // RM: the one named, else the client's / lead's own, else the person importing.
    let rmId = client?.rmId ?? lead?.ownerId ?? session.userId;
    if (row.get("rm")) {
      const f = prep.users.find(row.get("rm"));
      if (f.ok) rmId = f.value.id; else row.fail("rm", f.error);
    }

    const attendees: Attendee[] = [];
    for (const who of parseList(row.get("coAttendees"), 10)) {
      const f = prep.users.find(who);
      if (f.ok) {
        if (f.value.id !== rmId && !attendees.some((a) => a.refId === f.value.id)) {
          attendees.push({ name: f.value.name || "Team member", role: roleOf(f.value), isExternal: false, kind: "user", refId: f.value.id });
        }
      } else {
        attendees.push({ name: who.slice(0, 120), role: "other", isExternal: true, kind: "guest" });
      }
    }

    if (row.failed || !meetingDate || !meetingType || !meetingMode) return null;
    const status = statusGiven ?? (meetingDate.getTime() < Date.now() ? "completed" : "scheduled");

    // The same-RM double-booking guard: only for a meeting still to happen.
    if (LIVE.has(status)) {
      const start = meetingDate.getTime();
      const end = start + durationMinutes * 60_000;
      const clash = prep.live.find((s) => s.rmId === rmId && s.start < end && s.end > start);
      if (clash) {
        row.fail("meetingDate", `${prep.users.all.find((u) => u.id === rmId)?.name ?? "The RM"} already has a meeting at this time`);
        return null;
      }
      prep.live.push({ rmId, start, end }); // the rows after this one are checked against it
    }

    return {
      investorId: client?.id ?? null, leadId: lead?.id ?? null, subjectName: client?.name ?? lead?.name ?? "",
      rmId, category, meetingType, subject: subject || null, meetingDate, durationMinutes, meetingMode,
      locationOrLink: row.get("locationOrLink") || null, discussionPoints: discussionPoints || null, status, attendees,
    };
  },

  async commit(tx: Tx, session: SessionUser, items) {
    const failed: Problem[] = [];
    let saved = 0;
    const now = Date.now();
    for (const { n, item: m } of items) {
      const id = uuid();
      try {
        await tx.transaction(async (sp) => {
          // The RM's reminder, a day before — only for a meeting still ahead of that.
          const reminderAt = new Date(m.meetingDate.getTime() - 24 * 3_600_000);
          let reminderTaskId: string | null = null;
          if (LIVE.has(m.status) && reminderAt.getTime() > now) {
            reminderTaskId = uuid();
            const label = humanise(m.meetingType);
            await sp.insert(tasks).values({
              id: reminderTaskId,
              tenantId: session.tenantId,
              assigneeId: m.rmId,
              subjectType: m.investorId ? "investor" : "lead",
              subjectId: m.investorId ?? m.leadId,
              type: "review_meeting_reminder",
              title: `Reminder: ${label} with ${m.subjectName} tomorrow`,
              description: `Mode: ${humanise(m.meetingMode)}${m.locationOrLink ? " · " + m.locationOrLink : ""}.${m.discussionPoints ? " Agenda: " + m.discussionPoints : ""}`,
              priority: "normal",
              status: "open",
              dueAt: reminderAt,
            } as never);
          }
          await sp.insert(reviewMeetings).values({
            id,
            tenantId: session.tenantId,
            investorId: m.investorId,
            leadId: m.leadId,
            rmId: m.rmId,
            category: m.category,
            meetingType: m.meetingType,
            subject: m.subject,
            meetingDate: m.meetingDate,
            durationMinutes: String(m.durationMinutes),
            meetingMode: m.meetingMode,
            locationOrLink: m.locationOrLink,
            discussionPoints: m.discussionPoints,
            status: m.status,
            attendees: m.attendees,
            reminderTaskId,
            // A meeting recorded as completed ended when it was due to.
            ...(m.status === "completed" ? { actualEndAt: new Date(m.meetingDate.getTime() + m.durationMinutes * 60_000) } : {}),
          } as never);
        });
        saved++;
      } catch (e) {
        failed.push({ row: n, column: "—", message: `Could not be saved: ${(e as Error).message?.slice(0, 160) ?? "database error"}` });
      }
    }
    return { saved, failed };
  },
};
