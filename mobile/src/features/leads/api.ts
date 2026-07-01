/**
 * Leads data layer. GET /api/leads (envelope { leads }) supports q/stage/source;
 * we also filter client-side as a safety net. Mutations: stage advance + convert.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

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
  leadType: string | null;
  lastContactAt: string | null;
  nextFollowUpAt: string | null;
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
  stage?: string;
  source?: string;
}

export function useLeads(filters: LeadFilters) {
  return useQuery({
    queryKey: ["leads", filters.q ?? "", filters.stage ?? "", filters.source ?? ""],
    queryFn: () =>
      api.get<{ leads: Lead[] }>("/api/leads", {
        q: filters.q || undefined,
        stage: filters.stage || undefined,
        source: filters.source || undefined,
      }),
  });
}

export function useLead(id?: string) {
  return useQuery({
    queryKey: ["lead", id],
    enabled: !!id,
    queryFn: () => api.get<Lead>(`/api/leads/${id}`),
  });
}

/** PATCH the lead's stage (POST /api/leads/[id]/stage). */
export function useUpdateLeadStage(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stage: string) => api.post(`/api/leads/${id}/stage`, { stage }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead", id] });
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

/** Canonical stage order + labels for the board columns + filter chips. Unknown
 *  stages fall through and are title-cased where shown. */
export const LEAD_STAGES: { key: string; label: string }[] = [
  { key: "new", label: "New" },
  { key: "contacted", label: "Contacted" },
  { key: "call_done", label: "Call Done" },
  { key: "call_back_later", label: "Call Back" },
  { key: "meeting_scheduled", label: "Meeting Set" },
  { key: "meeting_done", label: "Met" },
  { key: "risk_profiled", label: "Risk Profiled" },
  { key: "proposal_shared", label: "Proposal Sent" },
  { key: "proposal_approved", label: "Proposal OK" },
  { key: "docs_received", label: "Docs In" },
  { key: "converted", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "not_interested", label: "Not Interested" },
];

const STAGE_INDEX = new Map(LEAD_STAGES.map((s, i) => [s.key, i]));

/** Group leads into board columns, canonical stages first, extras appended. */
export function groupByStage(leads: Lead[]): { key: string; label: string; leads: Lead[] }[] {
  const buckets = new Map<string, Lead[]>();
  for (const l of leads) {
    const k = l.stage ?? "unknown";
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(l);
  }
  return Array.from(buckets.entries())
    .map(([key, ls]) => ({ key, label: LEAD_STAGES.find((s) => s.key === key)?.label ?? key, leads: ls }))
    .sort((a, b) => (STAGE_INDEX.get(a.key) ?? 99) - (STAGE_INDEX.get(b.key) ?? 99));
}

export function filterLeads(leads: Lead[], q: string, stage: string): Lead[] {
  const s = q.trim().toLowerCase();
  return leads.filter((l) => {
    if (stage && l.stage !== stage) return false;
    if (s) {
      const hay = `${l.name ?? ""} ${l.phone ?? ""} ${l.email ?? ""} ${l.city ?? ""}`.toLowerCase();
      if (!hay.includes(s)) return false;
    }
    return true;
  });
}
