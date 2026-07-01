/**
 * Business Entries data layer. GET /api/business-entries ({ entries }); detail /[id].
 * Manual transaction entries used when RTA auto-import isn't available.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export interface BusinessEntry {
  id: string;
  investorId: string | null;
  clientName: string | null;
  productType: string | null;
  platform: string | null;
  status: string | null;
  rmId: string | null;
  amcName: string | null;
  folioNo: string | null;
  totalAmount: string | null;
  liquidNet: string | null;
  notes: string | null;
  emailedAt: string | null;
  createdAt?: string | null;
  [key: string]: any;
}

export function useBusinessEntries() {
  return useQuery({ queryKey: ["business-entries"], queryFn: () => api.get<{ entries: BusinessEntry[] }>("/api/business-entries") });
}

export function useBusinessEntry(id?: string) {
  return useQuery({
    queryKey: ["business-entry", id],
    enabled: !!id,
    queryFn: () => api.get<BusinessEntry>(`/api/business-entries/${id}`),
  });
}

export function filterEntries(list: BusinessEntry[], search: string, status: string): BusinessEntry[] {
  const q = search.trim().toLowerCase();
  return list.filter((e) => {
    if (status && e.status !== status) return false;
    if (q && !`${e.clientName ?? ""} ${e.amcName ?? ""} ${e.folioNo ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export const ENTRY_STATUSES = ["draft", "pending", "submitted", "confirmed", "processed", "rejected", "cancelled"];
