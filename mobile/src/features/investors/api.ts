/**
 * Investors data layer. Infinite-scroll list (GET /api/investors) + single
 * record (GET /api/investors/[id]). Same endpoints + query params the web uses
 * (q, segment, page, limit); pagination is offset-based per the API.
 */

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export interface Investor {
  id: string;
  name: string;
  pan: string | null;
  phone: string | null;
  email: string | null;
  segmentTag: string | null;
  status: string | null;
  kycStatus: string | null;
  serviceTier: string | null;
  healthBand: string | null;
  healthScore: number | null;
  aum: string | null;
  rmId: string | null;
  city?: string | null;
  updatedAt?: string | null;
  // The row carries ~110 fields; the detail screen reads more off `any`.
  [key: string]: any;
}

interface ListResponse {
  rows: Investor[];
  total: number;
  page: number;
  limit: number;
}

const PAGE_SIZE = 30;

export interface InvestorFilters {
  q?: string;
  segment?: string;
}

export function useInvestors(filters: InvestorFilters) {
  return useInfiniteQuery({
    queryKey: ["investors", filters.q ?? "", filters.segment ?? ""],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.get<ListResponse>("/api/investors", {
        q: filters.q || undefined,
        segment: filters.segment || undefined,
        page: pageParam,
        limit: PAGE_SIZE,
      }),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.rows.length, 0);
      return loaded < last.total ? last.page + 1 : undefined;
    },
  });
}

/** Flatten infinite-query pages into one row array + the reported total. */
export function flattenInvestors(data?: { pages: ListResponse[] }): { rows: Investor[]; total: number } {
  if (!data) return { rows: [], total: 0 };
  return { rows: data.pages.flatMap((p) => p.rows), total: data.pages[0]?.total ?? 0 };
}

export function useInvestor(id?: string) {
  return useQuery({
    queryKey: ["investor", id],
    enabled: !!id,
    queryFn: () => api.get<Investor>(`/api/investors/${id}`),
  });
}
