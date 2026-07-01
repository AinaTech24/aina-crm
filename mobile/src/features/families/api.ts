/**
 * Families data layer. GET /api/families returns the full family list ({ families });
 * search + quick-filters are applied client-side (the endpoint isn't paginated).
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export interface Family {
  id: string;
  headName: string | null;
  familyName: string | null;
  primaryInvestorId: string | null;
  rmId: string | null;
  familyCode: string | null;
  familyCategory: string | null;
  reviewFrequency: string | null;
  lastReviewAt: string | null;
  nextReviewAt: string | null;
  healthScore: number | null;
  healthBand: string | null;
  tags?: string[] | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  [key: string]: any;
}

export type FamilyQuickFilter = "all" | "review_due" | "at_risk" | "no_rm" | "no_primary";

export function useFamilies() {
  return useQuery({
    queryKey: ["families"],
    queryFn: () => api.get<{ families: Family[] }>("/api/families"),
  });
}

export function useFamily(id?: string) {
  return useQuery({
    queryKey: ["family", id],
    enabled: !!id,
    queryFn: () => api.get<Family>(`/api/families/${id}`),
  });
}

/** Client-side search + quick-filter (fields available on the list row). */
export function filterFamilies(list: Family[], search: string, filter: FamilyQuickFilter): Family[] {
  const now = Date.now();
  const q = search.trim().toLowerCase();
  return list.filter((f) => {
    if (q) {
      const hay = `${f.headName ?? ""} ${f.familyName ?? ""} ${f.familyCode ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    switch (filter) {
      case "review_due":
        return !!f.nextReviewAt && new Date(f.nextReviewAt).getTime() <= now;
      case "at_risk":
        return f.healthBand === "red";
      case "no_rm":
        return !f.rmId;
      case "no_primary":
        return !f.primaryInvestorId;
      default:
        return true;
    }
  });
}
