/**
 * Review Meetings data layer. GET /api/review-meetings ({ meetings }); detail via
 * /[id]. Status filter is client-side.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export interface Meeting {
  id: string;
  subject: string | null;
  meetingType: string | null;
  category: string | null;
  meetingDate: string | null;
  durationMinutes: string | null;
  meetingMode: string | null;
  locationOrLink: string | null;
  status: string | null;
  outcome: string | null;
  outcomeNotes: string | null;
  discussionPoints: string | null;
  meetingNotes: string | null;
  actionItems?: any[] | null;
  investorId: string | null;
  leadId: string | null;
  familyId: string | null;
  rmId: string | null;
  createdAt?: string | null;
  [key: string]: any;
}

export function useMeetings() {
  return useQuery({ queryKey: ["meetings"], queryFn: () => api.get<{ meetings: Meeting[] }>("/api/review-meetings") });
}

export function useMeeting(id?: string) {
  return useQuery({ queryKey: ["meeting", id], enabled: !!id, queryFn: () => api.get<Meeting>(`/api/review-meetings/${id}`) });
}

export function filterMeetings(list: Meeting[], search: string, status: string): Meeting[] {
  const q = search.trim().toLowerCase();
  return list.filter((m) => {
    if (status && m.status !== status) return false;
    if (q && !`${m.subject ?? ""} ${m.meetingType ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export const MEETING_STATUSES = ["scheduled", "confirmed", "in_progress", "completed", "rescheduled", "cancelled", "no_show"];
