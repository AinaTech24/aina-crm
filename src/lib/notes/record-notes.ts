/**
 * The Notes card on a lead or a client — every note written about the
 * person, newest first. SERVER-ONLY.
 *
 * Notes live in two stores, and the card used to read only one of them:
 *   - `activities` — the interaction log. "Add note", "Log call / visit",
 *     check-ins and the mobile call sync all write here, for leads and
 *     clients alike.
 *   - `leads.follow_up_notes` — a lead's older text log. The lead notes route
 *     still appends to it (and mirrors each entry into `activities`).
 * A lead's card read only the text log, so a note logged anywhere else never
 * showed ("No notes yet." on a lead with notes). Both are merged here with the
 * timeline's own rules (lib/timeline), so one note logged into both stores
 * appears once. Only entries that carry text are notes.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { activities, users } from "@/db/schema";
import { fromActivities, fromLeadNotes, mergeTimeline, type TimelineItem } from "@/lib/timeline";

export type RecordNote = Pick<TimelineItem, "id" | "kind" | "at" | "title" | "body" | "meta">;

export async function loadRecordNotes(
  tx: Tx,
  tenantId: string,
  subject: { type: "lead" | "investor"; id: string },
  followUpNotes?: string | null,
): Promise<RecordNote[]> {
  const rows = await tx
    .select({
      id: activities.id,
      kind: activities.kind,
      direction: activities.direction,
      status: activities.status,
      subject: activities.subject,
      notes: activities.notes,
      occurredAt: activities.occurredAt,
      durationSec: activities.durationSec,
      locationLabel: activities.locationLabel,
      nextFollowupAt: activities.nextFollowupAt,
      ownerName: users.name,
    })
    .from(activities)
    .leftJoin(users, eq(users.id, activities.ownerUserId))
    .where(
      and(
        eq(activities.tenantId, tenantId),
        eq(activities.subjectType, subject.type),
        eq(activities.subjectId, subject.id),
        sql`NULLIF(btrim(COALESCE(${activities.notes}, '')), '') IS NOT NULL`,
      ),
    )
    .orderBy(desc(activities.occurredAt))
    .limit(200);

  return mergeTimeline(fromActivities(rows), fromLeadNotes(followUpNotes ?? ""))
    .filter((i) => i.body && i.body.trim())
    .map(({ id, kind, at, title, body, meta }) => ({ id, kind, at, title, body, meta }));
}
