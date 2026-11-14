/**
 * Fixed deposits a client placed through the firm (the CRM's module,
 * src/lib/fixed-deposits/) — one row per receipt.
 *
 *   GET    /api/fixed-deposits        ?investorId ?status=live|all|<status> ?within=30 ?q
 *                                     → { rows, totals }
 *   POST   /api/fixed-deposits        record one (schedules its maturity follow-up)
 *   GET    /api/fixed-deposits/[id]   → { fixedDeposit }
 *   PATCH  /api/fixed-deposits/[id]   edit / change status (re-syncs the follow-up)
 *   DELETE /api/fixed-deposits/[id]   soft delete (cancels the follow-up)
 *
 * The server keeps the maturity reminder (an expected inflow whose task
 * reaches the RM 15 days before), marks Cross-sell FD held and wins the
 * client's open FD opportunity — the app only records the deposit.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

export interface FdRow {
  id: string;
  investorId: string;
  investorName: string;
  rmId: string | null;
  rmName: string | null;
  issuer: string;
  issuerType: string;
  schemeName: string | null;
  fdNumber: string | null;
  depositDate: string;
  maturityDate: string;
  tenureMonths: number | null;
  tenureDays: number | null;
  principal: number;
  interestRate: number;
  payout: string;
  maturityAmount: number | null;
  status: string;
  autoRenew: boolean;
  seniorCitizen: boolean;
  taxForm: string;
}

export interface FdTotals {
  liveCount: number; livePrincipal: number; liveMaturity: number;
  maturing30: number; maturing30Amount: number; maturing90: number; maturing90Amount: number;
  overdue: number; clients: number;
}

export interface FdFilters { investorId?: string; status?: string; within?: number; q?: string }

export function useFds(f: FdFilters) {
  return useQuery({
    queryKey: ["fixed-deposits", f],
    queryFn: () => api.get<{ rows: FdRow[]; totals: FdTotals }>("/api/fixed-deposits", {
      investorId: f.investorId, status: f.status, within: f.within, q: f.q?.trim() || undefined,
    }),
    placeholderData: (prev) => prev,
  });
}

export function useFd(id?: string) {
  return useQuery({
    queryKey: ["fixed-deposit", id],
    enabled: !!id,
    queryFn: () => api.get<{ fixedDeposit: any }>(`/api/fixed-deposits/${id}`).then((r) => r.fixedDeposit),
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["fixed-deposits"] });
    qc.invalidateQueries({ queryKey: ["fixed-deposit"] });
    qc.invalidateQueries({ queryKey: ["client-opportunities"] });
  };
}

export function useUpdateFd(id: string) {
  const done = useInvalidate();
  return useMutation({ mutationFn: (body: Record<string, unknown>) => api.patch(`/api/fixed-deposits/${id}`, body), onSuccess: done });
}

export function useDeleteFd() {
  const done = useInvalidate();
  return useMutation({ mutationFn: (id: string) => api.del(`/api/fixed-deposits/${id}`), onSuccess: done });
}
