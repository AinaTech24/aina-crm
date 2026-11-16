/**
 * Fields a person can ADD as a column on the Meetings list, beyond the ones the
 * tables draw by default. Each field is an expression over `m` (review_meetings),
 * `i` (the client), `l` (the lead), `ur` (the client's
 * RM), `lo` (the lead's owner), `b` (the client's / lead's branch), `f` (the
 * family) and `p` (the meeting this one follows up) — static text, never user
 * input. A key a cookie names that is not here is dropped, so nothing outside
 * this list can be asked for.
 *
 * Values come back as display text (dates in India time). A meeting has no
 * custom fields of its own, so there are no `cf:` keys here.
 */
import { sql } from "drizzle-orm";
import type { ExtraFieldDef } from "./types";

type Def = ExtraFieldDef & { expr: string; /** licence field the client's own data is withheld under */ gate?: string };

const D = (e: string) => `to_char(${e}, 'DD Mon YYYY')`;
const TS = (e: string) => `to_char(${e} AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY')`;
const TST = (e: string) => `to_char(${e} AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')`;
const YN = (e: string) => `CASE WHEN ${e} THEN 'Yes' ELSE 'No' END`;
const HUMAN = (e: string) => `initcap(replace(${e}, '_', ' '))`;

export const MEETING_EXTRA_FIELDS: Def[] = [
  // The meeting
  { key: "time", label: "Time", group: "Meeting", expr: `to_char(m.meeting_date AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM')` },
  { key: "duration", label: "Duration (minutes)", group: "Meeting", expr: "m.duration_minutes" },
  { key: "location", label: "Location / link", group: "Meeting", expr: "m.location_or_link" },
  { key: "discussion", label: "Discussion points", group: "Meeting", expr: "m.discussion_points" },
  { key: "attendees", label: "Attendees", group: "Meeting", expr: "NULLIF(array_to_string(ARRAY(SELECT a->>'name' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.attendees) = 'array' THEN m.attendees ELSE '[]'::jsonb END) a WHERE a->>'name' IS NOT NULL), ', '), '')" },
  { key: "follow_up_of", label: "Follow-up of", group: "Meeting", expr: `CASE WHEN p.id IS NOT NULL THEN ${TS("p.meeting_date")} END` },
  { key: "next_review", label: "Next review date", group: "Meeting", expr: D("m.next_review_date") },
  // After the meeting
  { key: "outcome", label: "Outcome", group: "After the meeting", expr: HUMAN("m.outcome") },
  { key: "outcome_notes", label: "Outcome notes", group: "After the meeting", expr: "m.outcome_notes" },
  { key: "ended", label: "Ended at", group: "After the meeting", expr: TST("m.actual_end_at") },
  { key: "tasks_made", label: "Follow-up tasks created", group: "After the meeting", expr: YN("m.follow_up_task_created = 'true'") },
  { key: "reschedules", label: "Times rescheduled", group: "After the meeting", expr: "m.reschedule_count::text" },
  { key: "reschedule_reason", label: "Reschedule reason", group: "After the meeting", expr: "m.reschedule_reason" },
  { key: "created", label: "Created on", group: "After the meeting", expr: TS("m.created_at") },
  { key: "updated", label: "Last updated", group: "After the meeting", expr: TS("m.updated_at") },
  // The client or lead the meeting is with
  { key: "party_kind", label: "Client or lead", group: "Client / lead", expr: "CASE WHEN i.id IS NOT NULL THEN 'Client' WHEN l.id IS NOT NULL THEN 'Lead' END" },
  { key: "email", label: "Client / lead email", group: "Client / lead", expr: "COALESCE(i.email, l.email)", gate: "email" },
  { key: "phone", label: "Client / lead mobile", group: "Client / lead", expr: "COALESCE(i.phone, l.phone)", gate: "phone" },
  { key: "city", label: "City", group: "Client / lead", expr: "COALESCE(i.address->>'city', l.city)" },
  { key: "segment", label: "Client segment", group: "Client / lead", expr: "i.segment_tag" },
  { key: "family", label: "Family", group: "Client / lead", expr: "f.family_name" },
  { key: "branch", label: "Branch", group: "Client / lead", expr: "b.name" },
  { key: "client_rm", label: "Client's relationship manager", group: "Client / lead", expr: "ur.name" },
  { key: "lead_owner", label: "Lead owner", group: "Client / lead", expr: "lo.name" },
  { key: "lead_stage", label: "Lead stage", group: "Client / lead", expr: HUMAN("l.stage") },
  { key: "lead_source", label: "Lead source", group: "Client / lead", expr: HUMAN("l.source") },
];

const BY_KEY = new Map(MEETING_EXTRA_FIELDS.map((f) => [f.key, f]));

/**
 * Fields offered for this firm: the catalog minus any its licence withholds.
 * `allowed` is asked about the CLIENT's licence field ("email", "phone").
 */
export function meetingExtraOptions(allowed: (field: string) => boolean): ExtraFieldDef[] {
  return MEETING_EXTRA_FIELDS.filter((f) => !f.gate || allowed(f.gate)).map(({ key, label, group }) => ({ key, label, group }));
}

/** Values of the chosen fields for these meetings: `{ [meetingId]: { [fieldKey]: text } }`. */
export async function loadMeetingExtra(
  tx: { execute: (q: any) => Promise<{ rows: any[] }> },
  ids: string[],
  keys: string[],
  allowed: Set<string>,
): Promise<Record<string, Record<string, string>>> {
  const fields = keys.filter((k) => allowed.has(k) && BY_KEY.has(k));
  if (!ids.length || !fields.length) return {};
  const cols = fields.map((k, n) => sql`(${sql.raw(BY_KEY.get(k)!.expr)}) AS ${sql.raw(`"c${n}"`)}`);
  const res = await tx.execute(sql`
    SELECT m.id, ${sql.join(cols, sql`, `)}
    FROM review_meetings m
    LEFT JOIN investors i ON i.id = m.investor_id
    LEFT JOIN leads l ON l.id = m.lead_id
    LEFT JOIN users ur ON ur.id = i.rm_id
    LEFT JOIN users lo ON lo.id = l.owner_id
    LEFT JOIN branches b ON b.id = COALESCE(i.branch_id, l.branch_id)
    LEFT JOIN families f ON f.id = COALESCE(i.family_id, m.family_id)
    LEFT JOIN review_meetings p ON p.id = m.parent_meeting_id
    WHERE m.id IN (${sql.join(ids.map((x) => sql`${x}::uuid`), sql`, `)})
  `);
  const out: Record<string, Record<string, string>> = {};
  for (const r of res.rows as any[]) {
    const o: Record<string, string> = {};
    fields.forEach((k, n) => {
      const v = r[`c${n}`];
      if (v == null || String(v).trim() === "") return;
      o[k] = String(v);
    });
    out[String(r.id)] = o;
  }
  return out;
}

/** Keys that exist for this firm — what a cookie's choice is checked against. */
export function allowedMeetingExtraKeys(options: ExtraFieldDef[]): Set<string> {
  return new Set(options.map((o) => o.key));
}
