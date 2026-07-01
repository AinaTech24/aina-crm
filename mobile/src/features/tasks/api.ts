/**
 * Tasks data layer. GET /api/tasks ({ tasks }) — filtered client-side by status /
 * search. Complete / change status via PATCH /api/tasks/[id].
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";

export interface Task {
  id: string;
  title: string | null;
  description: string | null;
  type: string | null;
  priority: string | null;
  status: string | null;
  department: string | null;
  dueAt: string | null;
  slaDueAt: string | null;
  completedAt: string | null;
  assigneeId: string | null;
  subjectType: string | null;
  relatedInvestorId: string | null;
  relatedLeadId: string | null;
  remarks: string | null;
  createdAt?: string | null;
  [key: string]: any;
}

export type TaskFilter = "all" | "open" | "overdue" | "completed";

export function useTasks() {
  return useQuery({ queryKey: ["tasks"], queryFn: () => api.get<{ tasks: Task[] }>("/api/tasks") });
}

export function useTask(id?: string) {
  return useQuery({ queryKey: ["task", id], enabled: !!id, queryFn: () => api.get<Task>(`/api/tasks/${id}`) });
}

export function useUpdateTask(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Task>) => api.patch(`/api/tasks/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", id] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

const OPEN = new Set(["open", "in_progress", "blocked"]);

export function filterTasks(tasks: Task[], search: string, filter: TaskFilter): Task[] {
  const now = Date.now();
  const q = search.trim().toLowerCase();
  return tasks.filter((t) => {
    if (q && !`${t.title ?? ""} ${t.description ?? ""}`.toLowerCase().includes(q)) return false;
    switch (filter) {
      case "open":
        return OPEN.has(t.status ?? "");
      case "overdue":
        return OPEN.has(t.status ?? "") && !!t.dueAt && new Date(t.dueAt).getTime() < now;
      case "completed":
        return t.status === "completed";
      default:
        return true;
    }
  });
}

export const TASK_PRIORITY_TONE: Record<string, "danger" | "warning" | "info" | "neutral"> = {
  urgent: "danger",
  high: "warning",
  medium: "info",
  low: "neutral",
};
