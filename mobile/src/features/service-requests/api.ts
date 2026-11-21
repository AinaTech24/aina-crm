/**
 * Service Requests — the client-servicing queue ("change my bank account",
 * "send capital-gains report"). These carry an SLA, and Home's command-centre
 * surfaces breaches, so an RM needs to see and move them from the phone.
 *
 * GET  /api/service-requests        → { serviceRequests: rows } (full rows)
 * GET  /api/service-requests/[id]   → row
 * PATCH /api/service-requests/[id]  → the web ticket workspace's fields: status,
 *   priority, assignee, internal remarks, resolution notes, a timeline note,
 *   "first response", CSAT and — for a complaint — the SEBI register fields.
 *   The server appends the activity timeline and stamps respondedAt /
 *   resolvedAt; a complaint is resolved or closed only with resolution notes.
 * Writes need service_request.manage (the list and the ticket are readable without).
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Tone } from "../../theme";

export type SrStatus = "open" | "in_progress" | "waiting_customer" | "resolved" | "closed" | "escalated";

export interface ServiceRequest {
  id: string;
  ticketNo: string | null;
  investorId: string | null;
  type: string | null;
  channel: string | null;
  subject: string | null;
  description: string | null;
  status: SrStatus | null;
  priority: string | null;
  assignedToUserId: string | null;
  slaResolutionAt: string | null;
  slaResponseAt?: string | null;
  respondedAt: string | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  remarks: string | null;
  createdAt: string | null;
  sebiCategory?: string | null;
  sebiSubCategory?: string | null;
  complaintSource?: string | null;
  scoresRefNo?: string | null;
  csatRating?: number | null;
  csatComment?: string | null;
  timeline?: SrTimelineEntry[] | null;
  [k: string]: any;
}

export interface SrTimelineEntry { at: string; by: string; event: string; note?: string }

export interface SrPatch {
  status?: SrStatus;
  priority?: string;
  assignedToUserId?: string;
  remarks?: string;
  resolutionNotes?: string;
  timelineNote?: string;
  markResponded?: boolean;
  csatRating?: number;
  csatComment?: string;
  sebiCategory?: string;
  sebiSubCategory?: string;
  complaintSource?: string;
  scoresRefNo?: string;
}

export function useServiceRequests() {
  return useQuery({
    queryKey: ["service-requests"],
    queryFn: () => api.get<{ serviceRequests: ServiceRequest[] }>("/api/service-requests").then((r) => r.serviceRequests),
    staleTime: 30_000,
  });
}

export function useServiceRequest(id: string) {
  return useQuery({
    queryKey: ["service-request", id],
    queryFn: () => api.get<ServiceRequest>(`/api/service-requests/${id}`),
    enabled: !!id,
  });
}

export function useUpdateServiceRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SrPatch) => api.patch<ServiceRequest>(`/api/service-requests/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["service-request", id] });
      qc.invalidateQueries({ queryKey: ["service-requests"] });
      qc.invalidateQueries({ queryKey: ["command-center"] });
    },
  });
}

// ── status metadata ──
export const SR_STATUSES: { value: SrStatus; label: string; tone: Tone }[] = [
  { value: "open", label: "Open", tone: "info" },
  { value: "in_progress", label: "In progress", tone: "brand" },
  { value: "waiting_customer", label: "Waiting on client", tone: "warning" },
  { value: "resolved", label: "Resolved", tone: "success" },
  { value: "closed", label: "Closed", tone: "neutral" },
  { value: "escalated", label: "Escalated", tone: "danger" },
];
export const srStatusMeta = (s?: string | null) =>
  SR_STATUSES.find((x) => x.value === s) ?? { value: "open" as SrStatus, label: s ? s.replace(/_/g, " ") : "—", tone: "neutral" as Tone };

const OPEN_SET = new Set(["open", "in_progress", "waiting_customer", "escalated"]);
export const isSrOpen = (r: ServiceRequest) => OPEN_SET.has(String(r.status ?? "open"));

/** SLA is breached when the resolution deadline has passed and it isn't done. */
export function isSlaBreached(r: ServiceRequest): boolean {
  if (!r.slaResolutionAt || !isSrOpen(r)) return false;
  const due = new Date(r.slaResolutionAt).getTime();
  return isFinite(due) && due < Date.now();
}

export const PRIORITY_TONE: Record<string, Tone> = { urgent: "danger", high: "warning", normal: "info", low: "neutral" };

/** The web detail page's TYPE_LABEL (legacy types read as their current names). */
export const SR_TYPE_LABEL: Record<string, string> = {
  nominee_update: "Nominee Update", bank_update: "Bank Update", mobile_update: "Mobile Update",
  email_update: "Email Update", kyc_update: "KYC Update", minor_to_major: "Minor to Major",
  capital_gain_report: "Capital Gain Report", statement_request: "Statement Request",
  redemption_request: "Redemption Request", switch_request: "Switch Request",
  transmission_case: "Transmission Case", folio_correction: "Folio Correction", other: "Other",
  complaint: "Complaint", redemption_help: "Redemption Request", switch_help: "Switch Request",
  transaction_query: "Other",
};
export const srTypeLabel = (t?: string | null) => (t ? SR_TYPE_LABEL[t] ?? t.replace(/_/g, " ") : "");

/** Mirrors SEBI_COMPLAINT_CATEGORIES / COMPLAINT_SOURCES (web ServiceRequestDetailEditor). */
export const SEBI_CATEGORIES = [
  { value: "service", label: "Service / TAT" }, { value: "mis_selling", label: "Mis-selling" }, { value: "transaction", label: "Transaction / order" },
  { value: "fee", label: "Fee / commission" }, { value: "kyc", label: "KYC / documents" }, { value: "communication", label: "Communication / statements" }, { value: "other", label: "Other" },
];
export const COMPLAINT_SOURCES = [
  { value: "direct", label: "Direct (client)" }, { value: "scores", label: "SCORES (SEBI)" }, { value: "amfi", label: "AMFI" }, { value: "amc", label: "AMC" },
  { value: "email", label: "Email" }, { value: "phone", label: "Phone" }, { value: "walk_in", label: "Walk-in" }, { value: "website", label: "Website form" }, { value: "other", label: "Other" },
];
export const SR_EVENT_LABEL: Record<string, string> = {
  created: "Created", status: "Status changed", first_response: "First response", note: "Note",
  resolution: "Resolution", assigned: "Reassigned", csat: "CSAT", escalated: "Escalated",
};

/** "2d 4h" / "5h 10m" / "12m" — two units at most, for a countdown. */
export function fmtSpan(ms: number): string {
  const m = Math.max(0, Math.round(Math.abs(ms) / 60_000));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = m % 60;
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return min ? `${h}h ${min}m` : `${h}h`;
  return `${min}m`;
}

/**
 * A ticket's live SLA countdown for the list: "Respond in 3h" / "Response
 * overdue 2h", then "Resolve in 2d 4h" / "Resolution overdue 1d"; once done,
 * met or missed. Same rule as slaClock (overdue → red, within a day → amber).
 */
export function slaCountdown(kind: "response" | "resolution", due?: string | null, done?: string | null, now = Date.now()): { label: string; tone: Tone } | null {
  if (!due) return null;
  const d = new Date(due).getTime();
  if (!isFinite(d)) return null;
  const noun = kind === "response" ? "Response" : "Resolution";
  if (done) {
    const t = new Date(done).getTime();
    if (!isFinite(t)) return null;
    return t <= d ? { label: `${noun} on time`, tone: "success" } : { label: `${noun} late by ${fmtSpan(t - d)}`, tone: "danger" };
  }
  const ms = d - now;
  if (ms < 0) return { label: `${noun} overdue ${fmtSpan(ms)}`, tone: "danger" };
  const verb = kind === "response" ? "Respond" : "Resolve";
  return { label: `${verb} in ${fmtSpan(ms)}`, tone: ms < 24 * 3_600_000 ? "warning" : "neutral" };
}

/** One SLA clock (web SlaCard): met / missed once done, else due / overdue / due within a day. */
export function slaClock(due?: string | null, done?: string | null): { label: string; tone: Tone } | null {
  if (!due) return null;
  const d = new Date(due).getTime();
  if (!isFinite(d)) return null;
  if (done) {
    const t = new Date(done).getTime();
    return isFinite(t) && t <= d ? { label: "Met", tone: "success" } : { label: "Missed", tone: "danger" };
  }
  const ms = d - Date.now();
  if (ms < 0) return { label: "Overdue", tone: "danger" };
  if (ms < 24 * 3_600_000) return { label: "Due soon", tone: "warning" };
  return { label: "On track", tone: "neutral" };
}
