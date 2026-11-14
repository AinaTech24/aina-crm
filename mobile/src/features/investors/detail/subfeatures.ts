/**
 * Data hooks for the client-360 sub-features: documents (list/upload/download/
 * delete), gifts (list/add/budget/delete), onboarding blueprint, AI brief,
 * avatar upload, and the onboarding wizard's per-step PATCH. All endpoints
 * already exist on the backend.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../api/client";
import { queuedPatch } from "../../../lib/offlineQueue";
import { API_BASE_URL } from "../../../config";
import { useSession } from "../../../state/session";

// ── Documents ────────────────────────────────────────────────────────────────
export interface InvestorDoc {
  id: string;
  name: string;
  category: string;
  description: string | null;
  mimeType: string | null;
  sizeBytes: string | null;
  tags: string[];
  clientUploaded: boolean;
  createdAt: string;
}

/** Documents live on a client or — attachments the CRM moves to the client on
 *  conversion — on a lead; the two APIs are the same shape. */
export type DocSubject = "investor" | "lead";
const docBase = (subject: DocSubject, id: string) => `/api/${subject === "lead" ? "leads" : "investors"}/${id}/documents`;

export function useDocuments(id: string, subject: DocSubject = "investor") {
  return useQuery({
    queryKey: [`${subject}-docs`, id],
    queryFn: () => api.get<{ documents: InvestorDoc[] }>(docBase(subject, id)),
    staleTime: 30_000,
  });
}

/** 2-step upload: proxy the file to S3, then register it against the client / lead. */
export function useUploadDocument(id: string, subject: DocSubject = "investor") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { uri: string; name: string; mime: string; category: string; clientName?: string }) => {
      const form = new FormData();
      form.append("file", { uri: input.uri, name: input.name, type: input.mime } as any);
      form.append("kind", "compliance");
      form.append("docType", "kyc");
      if (input.clientName) form.append("clientName", input.clientName);
      const up = await api.upload<{ key: string; contentType: string; sizeBytes: number }>("/api/compliance/upload", form);
      return api.post<{ id: string }>(docBase(subject, id), {
        name: input.name,
        // A lead's document has no category (the lead API takes none).
        ...(subject === "investor" ? { category: input.category } : {}),
        storageKey: up.key,
        mimeType: up.contentType,
        sizeBytes: up.sizeBytes,
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [`${subject}-docs`, id] }),
  });
}

export function useDeleteDocument(id: string, subject: DocSubject = "investor") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docId: string) => api.del(`${docBase(subject, id)}?docId=${docId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: [`${subject}-docs`, id] }),
  });
}

export async function getDocumentUrl(id: string, docId: string, inline = true, subject: DocSubject = "investor"): Promise<string> {
  const r = await api.get<{ url: string }>(`${docBase(subject, id)}/download`, { docId, inline: inline ? "1" : "0" });
  return r.url;
}

// ── Gifts ────────────────────────────────────────────────────────────────────
export interface Gift {
  id: string;
  occasion: string;
  title: string;
  amount: number;
  givenOn: string;
  notes: string | null;
  createdAt: string;
}
export interface GiftsData {
  dob: string | null;
  budget: number | null;
  spent: number;
  gifts: Gift[];
}

export function useGifts(id: string) {
  return useQuery({
    queryKey: ["investor-gifts", id],
    queryFn: () => api.get<GiftsData>(`/api/investors/${id}/gifts`),
    staleTime: 30_000,
  });
}
export function useAddGift(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (g: { occasion: string; title: string; amount: number; givenOn: string; notes?: string }) =>
      api.post(`/api/investors/${id}/gifts`, g),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["investor-gifts", id] }),
  });
}
export function useSetGiftBudget(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (budget: number | null) => api.put(`/api/investors/${id}/gifts`, { budget }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["investor-gifts", id] }),
  });
}
export function useDeleteGift(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (giftId: string) => api.del(`/api/investors/${id}/gifts/${giftId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["investor-gifts", id] }),
  });
}

// ── Blueprint ────────────────────────────────────────────────────────────────
export interface BlueprintStage { key: string; name: string; order: number; status: "done" | "current" | "upcoming" | "skipped"; phase?: string }
export interface BlueprintData {
  leadId: string | null;
  synthetic: boolean;
  current: { key: string; name: string; order: number } | null;
  allStages: BlueprintStage[];
}
export function useBlueprint(id: string) {
  return useQuery({
    queryKey: ["investor-blueprint", id],
    queryFn: () => api.get<BlueprintData>(`/api/investors/${id}/blueprint`),
    staleTime: 60_000,
  });
}

// ── AI brief ─────────────────────────────────────────────────────────────────
export interface ClientBrief {
  summary: string;
  talkingPoints: string[];
  recommendedActions: string[];
  watchouts: string[];
  suggestedOpener: string;
}
export function useGenerateBrief(id: string) {
  return useMutation({
    mutationFn: () => api.post<{ brief: ClientBrief }>(`/api/ai/client-brief/${id}`, {}),
  });
}

// ── Avatar ───────────────────────────────────────────────────────────────────
/** The authed avatar URL (RN Image can pass the Bearer header). */
export function avatarUri(id: string): string {
  return `${API_BASE_URL}/api/investors/${id}/avatar`;
}
export function useAvatarHeaders(): Record<string, string> {
  const token = useSession((s) => s.token);
  return token ? { Authorization: `Bearer ${token}` } : {};
}
export function useUploadAvatar(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { uri: string; name: string; mime: string; clientName?: string }) => {
      const form = new FormData();
      form.append("file", { uri: input.uri, name: input.name, type: input.mime } as any);
      form.append("kind", "general");
      form.append("docType", "avatar");
      if (input.clientName) form.append("clientName", input.clientName);
      const up = await api.upload<{ key: string }>("/api/compliance/upload", form);
      return api.patch(`/api/investors/${id}`, { avatarUrl: up.key });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["investor-full", id] });
      qc.invalidateQueries({ queryKey: ["investors"] });
    },
  });
}

// ── Onboarding wizard (per-step PATCH) ───────────────────────────────────────
export function useOnboardingStep(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Record<string, any>) => queuedPatch(`/api/investors/${id}`, patch, "Onboarding step"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["investor-full", id] });
      qc.invalidateQueries({ queryKey: ["investor", id] });
    },
  });
}
