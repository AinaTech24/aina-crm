/**
 * Home dashboard data — GET /api/dashboard/home (the mobile JSON we added for
 * the role cockpits). KPI cards + a Today worklist of actionable counts.
 */

import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

export interface Kpi {
  key: string;
  label: string;
  value: number;
  format: "number" | "inr";
}

export interface WorklistItem {
  key: string;
  label: string;
  count: number;
  icon: string;
  tone: "danger" | "warning" | "info" | "success" | "neutral";
  href: string;
}

export interface DashboardHome {
  scope: "firm" | "me";
  kpis: Kpi[];
  worklist: WorklistItem[];
}

export function useDashboardHome() {
  return useQuery({
    queryKey: ["dashboard-home"],
    queryFn: () => api.get<DashboardHome>("/api/dashboard/home"),
    staleTime: 60_000,
  });
}
