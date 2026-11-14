/**
 * Discovery (fact-find) — the CRM's Financial Discovery module
 * (/dashboard/discovery). Same endpoints as the web:
 *
 *   GET   /api/discovery                 → { discoveries } (newest first, ≤300,
 *                                          only those whose client / lead the
 *                                          viewer can see — lib/discovery/access)
 *   POST  /api/discovery                 { subjectType, subjectId } → { id, existing }
 *                                          a draft prefilled from the record; an
 *                                          open one for the same person is reused
 *   GET   /api/discovery/[id]            → { discovery }
 *   PATCH /api/discovery/[id]            { data, markReviewed? } — the server
 *                                          cleans the sections, keeps its own
 *                                          fields and recomputes the score
 *   POST  /api/discovery/[id]/share      { expiresInDays } → { url, recipient, firmName }
 *   POST  /api/discovery/[id]/risk       save the questionnaire as a PROVISIONAL
 *                                          risk profile (client, none on record)
 *   POST  /api/discovery/[id]/apply      { fields } — copy what the client
 *                                          corrected onto the record
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { DiscoveryData } from "./calc";
import type { RecordDiff } from "./record-diff";

export type DiscoveryStatus = "draft" | "shared" | "submitted" | "reviewed";

/** The web list's status colours: draft grey, shared blue, submitted amber, reviewed green. */
export const STATUS_TONE: Record<string, "neutral" | "info" | "warning" | "success"> = {
  draft: "neutral",
  shared: "info",
  submitted: "warning",
  reviewed: "success",
};

export interface DiscoveryRow {
  id: string;
  subjectType: "investor" | "lead";
  subjectId: string;
  title: string | null;
  status: DiscoveryStatus;
  reviewType: string | null;
  healthScore: number | null;
  updatedAt: string;
  submittedAt: string | null;
}

export interface Discovery extends DiscoveryRow {
  data: DiscoveryData | null;
  sharedAt?: string | null;
  reviewedAt?: string | null;
}

/** What GET /api/discovery/[id] returns. `diffs` / `canEdit` are read when the
 *  server supplies them (as the web page computes them); otherwise the screen
 *  works them out from the record's own API. */
export interface DiscoveryResponse {
  discovery: Discovery;
  diffs?: RecordDiff[];
  canEdit?: boolean;
}

export interface ShareResult {
  url: string;
  expiresAt?: string;
  recipient: { name: string | null; phone: string | null; email: string | null };
  firmName: string | null;
}

export function useDiscoveries() {
  return useQuery({
    queryKey: ["discoveries"],
    queryFn: () => api.get<{ discoveries: DiscoveryRow[] }>("/api/discovery").then((r) => r.discoveries ?? []),
    placeholderData: (prev) => prev,
  });
}

export function useDiscovery(id?: string) {
  return useQuery({
    queryKey: ["discovery", id],
    enabled: !!id,
    queryFn: () => api.get<DiscoveryResponse>(`/api/discovery/${id}`),
    // The editor seeds its form once from this; a background refetch must not
    // look like new data mid-edit.
    staleTime: 5 * 60_000,
  });
}

export function useCreateDiscovery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: { subjectType: "investor" | "lead"; subjectId: string }) =>
      api.post<{ id: string; existing: boolean }>("/api/discovery", b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["discoveries"] }),
  });
}

/**
 * Save the fact-find. Silent: the editor shows "Could not save — your changes
 * are still on this page" beside the status instead of a toast per autosave.
 */
export function useSaveDiscovery(id: string) {
  const qc = useQueryClient();
  return useMutation({
    meta: { silent: true },
    mutationFn: (b: { data: DiscoveryData; markReviewed?: boolean }) =>
      api.patch<{ discovery: Discovery }>(`/api/discovery/${id}`, b),
    onSuccess: (r) => {
      // Keep the cached copy current without re-seeding the open form.
      qc.setQueryData<DiscoveryResponse>(["discovery", id], (prev) => (prev ? { ...prev, discovery: r.discovery } : { discovery: r.discovery }));
      qc.invalidateQueries({ queryKey: ["discoveries"] });
    },
  });
}

export function useShareDiscovery(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ShareResult>(`/api/discovery/${id}/share`, { expiresInDays: 14 }),
    // A draft becomes "shared". The open form is not re-seeded by a refetch.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["discoveries"] });
      qc.invalidateQueries({ queryKey: ["discovery", id] });
    },
  });
}

export function useSaveRiskProfile(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true; category: string; bandLabel: string }>(`/api/discovery/${id}/risk`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["discoveries"] }),
  });
}

export function useApplyRecordChanges(id: string, subject: { type: string; id: string }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: string[]) => api.post<{ applied: string[] }>(`/api/discovery/${id}/apply`, { fields }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [subject.type === "lead" ? "lead" : "investor", subject.id] });
      qc.invalidateQueries({ queryKey: ["discovery", id] });
    },
  });
}

/**
 * The client / lead record the fact-find is compared with (RecordChanges).
 * Same keys and endpoints as features/investors and features/leads, so the
 * cache is shared with the client and lead screens.
 */
export function useSubjectRecord(subjectType: string | undefined, subjectId: string | undefined, enabled: boolean) {
  const isLead = subjectType === "lead";
  return useQuery({
    queryKey: [isLead ? "lead" : "investor", subjectId],
    enabled: enabled && !!subjectId && !!subjectType,
    queryFn: () => api.get<any>(isLead ? `/api/leads/${subjectId}` : `/api/investors/${subjectId}`),
    staleTime: 60_000,
    select: (r: any): Record<string, any> | null => (isLead ? r ?? null : r?.investor ?? null),
  });
}
