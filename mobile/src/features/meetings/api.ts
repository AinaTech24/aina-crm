/**
 * Review Meetings data layer — full web-parity filter/sort set + stats ribbon.
 *
 *   GET   /api/review-meetings            → { meetings[], stats }
 *   GET   /api/review-meetings/[id]       → meeting bundle (+ prep brief)
 *   PATCH /api/review-meetings/[id]       → status / attendees / action items / reschedule
 *   DELETE/api/review-meetings/[id]       → cancel (status='cancelled')
 *
 * The list GET returns snake_case (raw SQL), so the Meeting interface is
 * snake_case; the PATCH/POST bodies stay camelCase (Zod-validated server-side).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Tone } from "../../theme";

export interface Meeting {
  id: string;
  subject: string | null;
  meeting_type: string | null;
  category: string | null;
  meeting_date: string | null;
  duration_minutes: string | null;
  meeting_mode: string | null;
  location_or_link: string | null;
  status: string | null;
  outcome: string | null;
  outcome_notes: string | null;
  discussion_points: string | null;
  meeting_notes: string | null;
  action_items?: any[] | null;
  attendees?: any[] | null;
  attachments?: any[] | null;
  next_review_date?: string | null;
  reschedule_count?: number | null;
  follow_up_task_created?: string | null;
  investor_id: string | null;
  lead_id: string | null;
  family_id: string | null;
  rm_id: string | null;
  // joined
  investor_name?: string | null;
  lead_name?: string | null;
  segment_tag?: string | null;
  investor_pan?: string | null;
  rm_name?: string | null;
  subject_name?: string | null;
  subject_kind?: "client" | "lead" | null;
  prep?: any | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: any;
}

export interface MeetingStats {
  upcoming: number;
  this_week: number;
  completed_mtd: number;
  overdue: number;
}

export interface MeetingFilters {
  q?: string;
  /** Comma-joined multi-selects. */
  category?: string;
  status?: string;
  mode?: string;
  type?: string;
  rm?: string;
  meeting_from?: string;
  meeting_to?: string;
  sort?: "meeting_asc" | "meeting_desc";
}

export function useMeetings(filters: MeetingFilters = {}) {
  return useQuery({
    queryKey: ["meetings", filters],
    queryFn: () =>
      api.get<{ meetings: Meeting[]; stats: MeetingStats }>("/api/review-meetings", {
        q: filters.q || undefined,
        category: filters.category || undefined,
        status: filters.status || undefined,
        mode: filters.mode || undefined,
        type: filters.type || undefined,
        rm: filters.rm || undefined,
        meeting_from: filters.meeting_from || undefined,
        meeting_to: filters.meeting_to || undefined,
        sort: filters.sort || undefined,
      }),
  });
}

export function useMeeting(id?: string) {
  return useQuery({
    queryKey: ["meeting", id],
    enabled: !!id,
    queryFn: () => api.get<Meeting>(`/api/review-meetings/${id}`),
    staleTime: 15_000,
  });
}

function invalidateMeeting(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: ["meeting", id] });
  qc.invalidateQueries({ queryKey: ["meetings"] });
  // Action items are tasks and a move shifts the calendar.
  qc.invalidateQueries({ queryKey: ["calendar"] });
  qc.invalidateQueries({ queryKey: ["tasks"] });
}

/** PATCH a meeting — status / notes / discussion / action items / attendees /
 *  outcome / next review / reschedule. The server runs the completion chain. */
export function useUpdateMeeting(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, any>) => api.patch<{ ok: boolean; completed?: boolean; actionItems?: MeetingActionItem[]; attendees?: MeetingAttendee[]; familyMembers?: string[] }>(`/api/review-meetings/${id}`, body),
    onSuccess: () => invalidateMeeting(qc, id),
  });
}

/** Cancel a meeting (status → cancelled; its T-1 reminder task goes with it). */
export function useCancelMeeting(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.del(`/api/review-meetings/${id}`),
    onSuccess: () => { invalidateMeeting(qc, id); invalidateAround(qc); },
  });
}

/**
 * Cancel whichever meeting is passed — for a list, where the row is chosen in a
 * sheet that closes first. (useCancelMeeting(rowId) read the id at render, so
 * by the time the confirm fired the sheet had closed, the id was "" and the
 * DELETE went to /api/review-meetings/.)
 */
export function useCancelMeetingById() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/review-meetings/${id}`),
    onSuccess: (_r, id) => { invalidateMeeting(qc, id); invalidateAround(qc); },
  });
}

/** Its reminder task counts on the task KPIs, and Home shows the day's meetings. */
function invalidateAround(qc: ReturnType<typeof useQueryClient>) {
  for (const key of ["task-kpis", "command-center"]) qc.invalidateQueries({ queryKey: [key] });
}

/** May this viewer cancel the meeting? DELETE is the owner's (its RM) or a manage.all user's — an attendee may edit, not cancel. */
export const canCancelMeeting = (m: Pick<Meeting, "rm_id"> | null | undefined, myId: string | null | undefined, manageAll: boolean) =>
  manageAll || (!!m && !!myId && m.rm_id === myId);

// ── Enums (mirror src/db/schema/review_meetings.ts) ──
export const MEETING_STATUSES = ["scheduled", "confirmed", "in_progress", "completed", "rescheduled", "cancelled", "no_show"];

export const MEETING_MODES = ["office", "client_place", "online", "phone"];

export const MEETING_CATEGORIES: { value: string; label: string }[] = [
  { value: "new", label: "New Meeting" },
  { value: "review", label: "Review Meeting" },
  { value: "follow_up", label: "Follow-up Meeting" },
];

export const MEETING_TYPES = [
  "portfolio_review", "goal_review", "service_discussion", "family_review", "complaint_discussion",
  "discovery_call", "new_client_kickoff", "new_investment_discussion", "product_demo", "sales_pitch",
  "follow_up_call", "follow_up_visit", "other",
];

/** Rows saved before the attendee lookup carry only a role. */
export const ATTENDEE_ROLES: { value: string; label: string }[] = [
  { value: "rm", label: "RM (firm)" },
  { value: "investor", label: "Investor" },
  { value: "spouse", label: "Spouse" },
  { value: "family", label: "Family member" },
  { value: "ca", label: "CA / Tax advisor" },
  { value: "amc_rm", label: "AMC RM" },
  { value: "sub_distributor", label: "Sub-distributor" },
  { value: "back_office", label: "Back office" },
  { value: "compliance", label: "Compliance" },
  { value: "other", label: "Other" },
];

// ── Attendees and action items (CRM rules of 2026-10-01) ──
// An attendee is looked up — a team member, client or lead — or typed as a
// guest (lib/review-meetings/attendee-kinds.ts). `kind` + `refId` is what
// shows the meeting to that person. An action item IS a task: it has an owner
// and a due date, and the server creates / edits / cancels its task on save.

export type AttendeeKind = "client" | "lead" | "user" | "guest";
export interface MeetingAttendee { name: string; role: string; isExternal: boolean; notes?: string; kind?: AttendeeKind; refId?: string }
export interface AttendeeHit { kind: "client" | "lead" | "user"; id: string; name: string; detail: string | null }
export interface MeetingActionItem { title: string; assigneeId?: string; dueAt?: string; taskId?: string }

export const ATTENDEE_KIND_LABEL: Record<AttendeeKind, string> = { user: "Team", client: "Client", lead: "Lead", guest: "Guest" };

/** The stored role for a looked-up attendee (web roleForKind). */
export const roleForKind = (kind: AttendeeKind) => (kind === "user" ? "rm" : kind === "client" ? "investor" : "other");

export function useAttendeeSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: ["attendee-search", term],
    queryFn: () => api.get<{ hits: AttendeeHit[] }>("/api/review-meetings/attendee-search", { q: term }).then((r) => r.hits ?? []),
    enabled: term.length >= 2,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
}

/** Active team members — who an action item can be given to. */
export function useMeetingTeam() {
  return useQuery({
    queryKey: ["meeting-team"],
    queryFn: () => api.get<{ team: { id: string; name: string }[]; me: string }>("/api/review-meetings/team"),
    staleTime: 5 * 60_000,
  });
}

export const OUTCOME_TONE: Record<string, Tone> = {
  ready: "success", more_info: "warning", not_ready: "neutral", not_interested: "danger", no_show: "danger",
};
