/**
 * Meeting attendees — the plain shapes, safe to import in the browser. The SQL
 * that finds a person's meetings is in ./attendees.ts.
 *
 * An attendee is someone in the CRM — a client, a lead or a team member picked
 * from the lookup — or, when they are nobody the CRM knows (a client's CA, an
 * AMC RM), a guest typed by name. A looked-up attendee carries `kind` + `refId`;
 * rows saved before the lookup existed have neither and read as guests.
 */

export const ATTENDEE_KINDS = ["client", "lead", "user", "guest"] as const;
export type AttendeeKind = (typeof ATTENDEE_KINDS)[number];

export type MeetingAttendee = {
  name: string;
  role:
    | "rm"
    | "investor"
    | "spouse"
    | "family"
    | "ca"
    | "amc_rm"
    | "sub_distributor"
    | "back_office"
    | "compliance"
    | "other";
  isExternal: boolean;
  notes?: string;
  kind?: AttendeeKind;
  refId?: string;
};

/** One row of the attendee lookup (GET /api/review-meetings/attendee-search). */
export type AttendeeHit = { kind: "client" | "lead" | "user"; id: string; name: string; detail: string | null };

/** The stored role for a looked-up attendee (kept for the older readers of `role`). */
export function roleForKind(kind: AttendeeKind): MeetingAttendee["role"] {
  return kind === "user" ? "rm" : kind === "client" ? "investor" : "other";
}

/** In memory: is this user an attendee of the meeting row? */
export function hasUserAttendee(attendees: unknown, userId: string): boolean {
  return Array.isArray(attendees) && attendees.some((a: any) => a?.kind === "user" && a?.refId === userId);
}
