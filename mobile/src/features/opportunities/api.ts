/**
 * Opportunities — an existing client wants another product (the CRM's
 * Opportunities module, src/lib/opportunities/). A lead is a new person; a
 * client asking for insurance, a new SIP, NPS or an FD is an opportunity on
 * their record.
 *
 *   GET  /api/opportunities                       the module's rows + headline figures
 *   GET  /api/investors/[id]/opportunities        one client's (+ assignees, canWork)
 *   POST /api/investors/[id]/opportunities        start one (follow-up date, or later)
 *   GET  /api/opportunities/[id]                  one view (stages, next, gate)
 *   PATCH /api/opportunities/[id]                 followUpOn, ownerId, expectedValue …
 *   POST /api/opportunities/[id]/step             the current step's action
 *   POST /api/opportunities/[id]/advance          { to: "lost", lostReason, revisitOn? }
 *   POST /api/opportunities/[id]/later            park { revisitOn, reason } / resume
 *   POST /api/opportunities/[id]/transaction-review   approve / reject the order
 *
 * Follow-ups ARE tasks: the next follow-up is the earliest open task of the
 * opportunity. Every write returns the refreshed view.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

export type Pipeline = "mf" | "insurance" | "general";

export interface Prerequisite { label: string; satisfied: boolean; hint?: string; cta?: { href: string; label: string }; completeTaskId?: string }
export interface StageView { key: string; name: string; status: "done" | "auto" | "skipped" | "current" | "upcoming"; note?: string | null }

export interface OpportunityView {
  id: string;
  investorId: string;
  product: string;
  productLabel: string;
  pipeline: Pipeline;
  status: "open" | "won" | "lost";
  expectedValue: number | null;
  investmentMode: "sip" | "lumpsum" | null;
  source: string;
  ownerId: string | null;
  ownerName: string | null;
  notes: string | null;
  lostReason: string | null;
  revisitOn: string | null;
  followUpAt: string | null;
  later: null | { since: string; revisitOn: string; reason: string | null; count: number; money: { label: string; amount: number | null; expectedOn: string } | null };
  createdAt: string;
  closedAt: string | null;
  current: { key: string; name: string; enteredAt: string; slaDays: number | null; delayed: boolean };
  stages: StageView[];
  next: { key: string; name: string } | null;
  gate: Prerequisite[];
  canSync: boolean;
  meeting: { id: string; at: string; status: string; mode: string | null } | null;
  stepTasks: Array<{ stage: string; title: string; assigneeName: string | null; dueAt: string | null }>;
}

export interface BoardRow {
  id: string;
  investorId: string;
  investorName: string;
  product: string;
  productLabel: string;
  status: "open" | "won" | "lost";
  expectedValue: number | null;
  ownerName: string | null;
  stageKey: string;
  stageName: string;
  column: string;
  delayed: boolean;
  followUpAt: string | null;
  createdAt: string;
  closedAt: string | null;
  lostReason: string | null;
  later: { revisitOn: string; reason: string | null } | null;
}

export interface BoardKpis {
  open: number; openValue: number; overdue: number; dueToday: number; noFollowUp: number;
  wonThisMonth: number; wonValueThisMonth: number; later: number; laterValue: number; laterNext30: number;
}

export interface Staff { id: string; name: string }

/** The products (the Cross-sell vocabulary plus "other" — web lib/opportunities/products). */
export const OPPORTUNITY_PRODUCTS: Array<{ key: string; label: string; pipeline: Pipeline }> = [
  { key: "mutual_funds", label: "Mutual Funds", pipeline: "mf" },
  { key: "demat", label: "Demat A/c", pipeline: "general" },
  { key: "life_insurance", label: "Life Insurance", pipeline: "insurance" },
  { key: "general_insurance", label: "General Insurance", pipeline: "insurance" },
  { key: "health_insurance", label: "Health / Mediclaim", pipeline: "insurance" },
  { key: "nps", label: "NPS", pipeline: "general" },
  { key: "fd_bonds_ncd", label: "FD / Bonds / NCD", pipeline: "general" },
  { key: "pms", label: "PMS", pipeline: "general" },
  { key: "loan", label: "Loan", pipeline: "general" },
  { key: "other", label: "Other", pipeline: "general" },
];

export const OPPORTUNITY_LOST_REASONS = [
  "Not interested now", "Chose another distributor", "Budget / cash flow", "Already covered elsewhere",
  "Not eligible (medical / underwriting)", "Other",
];

/** The board's columns (web lib/opportunities/board-columns). */
export const BOARD_COLUMNS = [
  { key: "identified", label: "Need identified" },
  { key: "discussion", label: "Discussion" },
  { key: "suitability", label: "Suitability" },
  { key: "proposal", label: "Proposal shared" },
  { key: "accepted", label: "Client accepted" },
  { key: "processing", label: "Processing" },
  { key: "later", label: "Later" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
];

/** YYYY-MM-DD in India, n days from today. */
export const istDay = (n = 0) => new Date(Date.now() + 5.5 * 36e5 + n * 864e5).toISOString().slice(0, 10);
export const istDayOf = (iso: string) => new Date(new Date(iso).getTime() + 5.5 * 36e5).toISOString().slice(0, 10);

export interface BoardFilters { status?: string; q?: string; fu?: string; mine?: boolean }

export function useOpportunityBoard(f: BoardFilters) {
  return useQuery({
    queryKey: ["opportunities", f],
    queryFn: () => api.get<{ rows: BoardRow[]; kpis: BoardKpis; canWork: boolean }>("/api/opportunities", {
      status: f.status || undefined, q: f.q?.trim() || undefined, fu: f.fu || undefined, mine: f.mine ? "1" : undefined,
    }),
    placeholderData: (prev) => prev,
  });
}

export function useOpportunity(id?: string) {
  return useQuery({
    queryKey: ["opportunity", id],
    enabled: !!id,
    queryFn: () => api.get<{ opportunity: OpportunityView }>(`/api/opportunities/${id}`).then((r) => r.opportunity),
  });
}

export function useClientOpportunities(investorId?: string) {
  return useQuery({
    queryKey: ["client-opportunities", investorId],
    enabled: !!investorId,
    queryFn: () => api.get<{ items: OpportunityView[]; assignees: Staff[] | { list?: Staff[] }; staff: Staff[]; me: string; canWork: boolean }>(`/api/investors/${investorId}/opportunities`),
  });
}

/** Who an opportunity of this client can be given to (GET's `assignees`). */
export const assigneeList = (a: unknown): Staff[] => (Array.isArray(a) ? a : Array.isArray((a as any)?.list) ? (a as any).list : []);

function useRefresh() {
  const qc = useQueryClient();
  return (v?: OpportunityView) => {
    if (v) qc.setQueryData(["opportunity", v.id], v);
    qc.invalidateQueries({ queryKey: ["opportunities"] });
    qc.invalidateQueries({ queryKey: ["client-opportunities"] });
    qc.invalidateQueries({ queryKey: ["opportunity"] });
  };
}

export function useCreateOpportunity(investorId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ opportunity: OpportunityView; created: boolean }>(`/api/investors/${investorId}/opportunities`, body),
    onSuccess: (r) => refresh(r.opportunity),
  });
}

type Out = { opportunity?: OpportunityView; moved?: boolean; stage?: string; skipped?: string[] };

/** Every write on one opportunity; the server answers with the refreshed view. */
export function useOpportunityWrite(id: string) {
  const refresh = useRefresh();
  const done = (r: Out) => refresh(r.opportunity);
  return {
    step: useMutation({ mutationFn: (body: Record<string, unknown>) => api.post<Out>(`/api/opportunities/${id}/step`, body), onSuccess: done }),
    advance: useMutation({ mutationFn: (body: Record<string, unknown>) => api.post<Out>(`/api/opportunities/${id}/advance`, body), onSuccess: done }),
    later: useMutation({ mutationFn: (body: Record<string, unknown>) => api.post<Out>(`/api/opportunities/${id}/later`, body), onSuccess: done }),
    review: useMutation({ mutationFn: (body: Record<string, unknown>) => api.post<Out>(`/api/opportunities/${id}/transaction-review`, body), onSuccess: done }),
    patch: useMutation({ mutationFn: (body: Record<string, unknown>) => api.patch<Out>(`/api/opportunities/${id}`, body), onSuccess: done }),
    completeTask: useMutation({ mutationFn: (taskId: string) => api.patch(`/api/tasks/${taskId}`, { status: "completed" }), onSuccess: () => refresh() }),
  };
}
