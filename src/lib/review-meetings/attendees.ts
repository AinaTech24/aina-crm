/**
 * Finding a person's meetings through `review_meetings.attendees` (jsonb).
 *
 * A looked-up attendee carries `kind` + `refId` (see ./attendee-kinds.ts), and
 * that is what shows the meeting to that person: on a team member's meetings,
 * calendar and dashboard, and on the client's or lead's own record.
 */

import { sql, type SQL } from "drizzle-orm";
import type { AttendeeKind } from "./attendee-kinds";

export * from "./attendee-kinds";

/**
 * The meeting lists this client / lead / team member as an attendee.
 * `column` is the attendees column: `sql.raw("m.attendees")` in hand-written
 * SQL, or `sql\`${reviewMeetings.attendees}\`` in a Drizzle query.
 */
export function attendeeIs(kind: Exclude<AttendeeKind, "guest">, id: string, column: SQL = sql.raw("m.attendees")): SQL {
  return sql`COALESCE(${column}, '[]'::jsonb) @> ${JSON.stringify([{ kind, refId: id }])}::jsonb`;
}

/** Any of these team members is an attendee (a branch view passes everyone in it). */
export function attendeeIsAnyUser(userIds: string[], column: SQL = sql.raw("m.attendees")): SQL {
  if (userIds.length === 0) return sql`FALSE`;
  return sql`EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(${column}, '[]'::jsonb)) att
     WHERE att->>'kind' = 'user'
       AND att->>'refId' IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})
  )`;
}
