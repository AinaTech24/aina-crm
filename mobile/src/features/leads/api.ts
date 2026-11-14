/**
 * Leads data layer. GET /api/leads (full web filter/sort set) + the bundled
 * GET /api/leads/[id]/full for the detail. Mutations: stage change, log activity,
 * convert-to-client, edit (via the form engine's PATCH), delete.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { queuedPost } from "../../lib/offlineQueue";
import type { Tone } from "../../theme";

export interface Lead {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  pan: string | null;
  city: string | null;
  source: string | null;
  stage: string | null;
  pipelineStage: string | null;
  score: string | number | null;
  leadScore: number | null;
  scoreBand: string | null;
  intendedAmount: string | null;
  expectedBusinessAmount: string | null;
  aumPotential?: string | null;
  leadType: string | null;
  ownerId?: string | null;
  ownerName?: string | null;
  lastContactAt: string | null;
  nextFollowUpAt: string | null;
  followUpNotes?: string | null;
  convertedInvestorId: string | null;
  convertedAt: string | null;
  lostReason: string | null;
  notes: string | null;
  interestProducts?: string[] | null;
  tags?: string[] | null;
  createdAt?: string | null;
  [key: string]: any;
}

export interface LeadFilters {
  q?: string;
  /** Comma-joined multi-selects. */
  stage?: string;
  source?: string;
  owner?: string;
  created_from?: string;
  created_to?: string;
  sort?: "score" | "recent";
  dir?: "asc" | "desc";
  /** Quick-filter flags ("1" when on). */
  mine?: string;
  unassigned?: string;
  hot?: string;
  stuck?: string;
  followup_today?: string;
  followup_overdue?: string;
  new_week?: string;
}

export function useLeads(filters: LeadFilters) {
  return useQuery({
    queryKey: ["leads", filters],
    queryFn: () =>
      api.get<{ leads: Lead[]; total: number }>("/api/leads", {
        q: filters.q || undefined,
        stage: filters.stage || undefined,
        source: filters.source || undefined,
        owner: filters.owner || undefined,
        created_from: filters.created_from || undefined,
        created_to: filters.created_to || undefined,
        sort: filters.sort || undefined,
        dir: filters.dir || undefined,
        mine: filters.mine || undefined,
        unassigned: filters.unassigned || undefined,
        hot: filters.hot || undefined,
        stuck: filters.stuck || undefined,
        followup_today: filters.followup_today || undefined,
        followup_overdue: filters.followup_overdue || undefined,
        new_week: filters.new_week || undefined,
        limit: 400,
      }),
  });
}

export function useLead(id?: string) {
  return useQuery({ queryKey: ["lead", id], enabled: !!id, queryFn: () => api.get<Lead>(`/api/leads/${id}`) });
}

/** The bundled detail payload (lead + owner + tasks + comms + risk + proposal + stats). */
export function useLeadFull(id?: string) {
  return useQuery({
    queryKey: ["lead-full", id],
    enabled: !!id,
    queryFn: () => api.get<any>(`/api/leads/${id}/full`),
    staleTime: 20_000,
  });
}

function invalidateLead(qc: ReturnType<typeof useQueryClient>, id: string) {
  qc.invalidateQueries({ queryKey: ["lead-full", id] });
  qc.invalidateQueries({ queryKey: ["lead", id] });
  qc.invalidateQueries({ queryKey: ["leads"] });
}

export function useLogActivity(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { note: string; activityType: string; nextFollowUpAt?: string }) => queuedPost(`/api/leads/${id}/notes`, v, "Lead note"),
    onSuccess: () => invalidateLead(qc, id),
  });
}

export function useConvertLead(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { pan?: string; segmentTag?: string; investorCategory?: string; notes?: string }) =>
      api.post<{ investorId: string; alreadyConverted?: boolean }>(`/api/leads/${id}/convert`, v),
    onSuccess: () => invalidateLead(qc, id),
  });
}

export function useDeleteLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/leads/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leads"] }),
  });
}

// ── Stages: the CRM's Leads pipeline (src/lib/leads/stages.ts LEAD_PIPELINE) ──
// Seven columns. The call-loop stages (call back later / not connected / contact
// in future) live in Contacted and show as a TAG, and a tentative meeting lives
// in Meeting Scheduled — exactly as on the web board. Legacy values fold in.
export interface LeadColumn { key: string; label: string; tone: Tone; members: readonly string[] }
export const LEAD_STAGES: LeadColumn[] = [
  { key: "new", label: "New", tone: "info", members: ["new"] },
  { key: "call_done", label: "Contacted", tone: "info",
    members: ["call_done", "call_back_later", "call_not_connected", "contact_in_future", "contacted", "first_call_pending", "follow_up"] },
  { key: "meeting_scheduled", label: "Meeting Scheduled", tone: "warning",
    members: ["meeting_scheduled", "meeting_pending", "appointment_scheduled", "qualified"] },
  { key: "meeting_done", label: "Meeting Done", tone: "violet", members: ["meeting_done"] },
  { key: "proposal_sent", label: "Proposal Sent", tone: "violet", members: ["proposal_sent"] },
  { key: "won_lead", label: "Won", tone: "success", members: ["won_lead", "converted", "post_meeting_qualified"] },
  { key: "not_qualified", label: "Lost", tone: "danger", members: ["not_qualified", "lost", "not_interested", "cold"] },
];

/** The outcome a loop stage stands for, shown as a tag (web LEAD_STAGE_TAG). */
export const LEAD_STAGE_TAG: Record<string, string> = {
  call_back_later: "Call back later",
  call_not_connected: "Call not connected",
  contact_in_future: "Contact in future",
  follow_up: "Contact in future",
  meeting_pending: "Meeting pending",
};

const COLUMN_OF = new Map<string, string>(LEAD_STAGES.flatMap((c) => c.members.map((m) => [m, c.key] as const)));
/** The column a stored stage sits in ("new" when unset). */
export const canonicalStage = (s?: string | null): string => (s ? COLUMN_OF.get(s) ?? s : "new");
export const stageMeta = (s?: string | null) => LEAD_STAGES.find((x) => x.key === canonicalStage(s));
/** "Contacted · Call back later" for a loop stage, the column name otherwise. */
export function stageDisplay(s?: string | null): string {
  const col = stageMeta(s);
  const tag = s ? LEAD_STAGE_TAG[s] : undefined;
  return col ? (tag ? `${col.label} · ${tag}` : col.label) : (s ?? "New").replace(/_/g, " ");
}
/** A column filter sends every stored value in the column (the API filters on raw stage). */
export const stageFilterValues = (columnKeys: string[]): string[] =>
  columnKeys.flatMap((k) => LEAD_STAGES.find((c) => c.key === k)?.members ?? [k]);

const STAGE_INDEX = new Map(LEAD_STAGES.map((s, i) => [s.key, i]));

/** Group leads into the board's seven columns, in pipeline order. */
export function groupByStage(leads: Lead[]): { key: string; label: string; tone: Tone; leads: Lead[] }[] {
  const buckets = new Map<string, Lead[]>();
  for (const s of LEAD_STAGES) buckets.set(s.key, []);
  for (const l of leads) {
    const k = canonicalStage(l.stage);
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(l);
  }
  return Array.from(buckets.entries())
    .map(([key, ls]) => ({ key, label: stageMeta(key)?.label ?? key, tone: stageMeta(key)?.tone ?? "neutral", leads: ls }))
    .sort((a, b) => (STAGE_INDEX.get(a.key) ?? 99) - (STAGE_INDEX.get(b.key) ?? 99));
}

/** Client-side search fallback (name/phone/email/city). */
export function filterLeads(leads: Lead[], q: string): Lead[] {
  const s = q.trim().toLowerCase();
  if (!s) return leads;
  return leads.filter((l) => `${l.name ?? ""} ${l.phone ?? ""} ${l.email ?? ""} ${l.city ?? ""}`.toLowerCase().includes(s));
}
