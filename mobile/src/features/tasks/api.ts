/**
 * Tasks data layer — GET /api/tasks (full web filter/sort/view set) + KPI strip
 * (GET /api/tasks/kpis). Create / edit / complete / delete via /api/tasks[/id].
 *
 * The task page's own endpoints (live CRM): comments (/comments — the old
 * `remarks` column is read-only "Earlier notes"; PATCHing remarks REPLACES it),
 * related records (/related; link/unlink by PATCHing related*Id), "Need
 * information" (/info-request — asking blocks the task, answering restores it)
 * and the approval loop (PATCH approvalAction; completing a task that needs
 * approval sends it for approval instead).
 */

import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import { queuedPatch } from "../../lib/offlineQueue";
import type { Tone } from "../../theme";

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
  assignee?: string | null;
  subjectType: string | null;
  relatedInvestorId: string | null;
  relatedLeadId: string | null;
  relatedServiceRequestId?: string | null;
  relatedMeetingId?: string | null;
  investorName?: string | null;
  leadName?: string | null;
  remarks: string | null;
  recurrence?: string | null;
  /** When the work came in (YYYY-MM-DD); the closed date is completedAt (set by the database). */
  entryDate?: string | null;
  requiresApproval?: boolean | null;
  approvalStatus?: "pending" | "approved" | "rejected" | null;
  createdById?: string | null;
  meta?: { checklist?: ChecklistItem[]; infoRequest?: InfoRequest | null; request?: TaskRequest | null; boValue?: number; boChannel?: string; businessEntryId?: string | null; [k: string]: any } | null;
  /** "How we do this" — the firm's SOPs for this task. */
  sops?: Array<{ sopId: string; key: string; title: string; category: string | null; versionNumber: number; markdown: string; matched: string }>;
  createdAt?: string | null;
  [key: string]: any;
}

export interface InfoRequest { question: string; askedById: string; askedByName?: string | null; askedToId: string; askedToName?: string | null; askedAt: string; answer?: string | null; answeredAt?: string | null }
export interface TaskRequest { kycMode?: string; folio?: string; rows?: Array<{ schemeName?: string; fromSchemeName?: string; amount?: number; units?: number; allUnits?: boolean; folio?: string; sipDay?: string; frequency?: string }> }

export interface ChecklistItem {
  id: string;
  text: string;
  status?: "not_started" | "in_progress" | "completed" | "assigned_to_other";
  done?: boolean;
  doneAt?: string | null;
  actionDate?: string | null;
  remark?: string | null;
  /** Delegated to a teammate (they are notified and may open the task). */
  assigneeId?: string | null;
  assigneeName?: string | null;
}

export interface TaskFilters {
  q?: string;
  status?: string;
  priority?: string;
  type?: string;
  department?: string;
  assignee?: string;
  due?: "" | "today" | "overdue" | "sla_risk";
  view?: "" | "to_me" | "by_me" | "kanban";
  /** "mine" = awaiting MY sign-off (the web's "Awaiting my approval" view). */
  approval?: "" | "pending" | "mine";
  sort?: "created" | "created_asc" | "due" | "due_desc" | "priority";
  created_from?: string;
  created_to?: string;
}

/** The API pages its list (50 a page, `total` alongside). */
export const TASK_PAGE_SIZE = 50;

/**
 * The task list, a page at a time — the API returns 50 rows a page, so a book
 * with more open tasks than that needs "load more" (it used to stop at 50
 * silently). Flatten with `tasksOf(data)`.
 */
export function useTasks(filters: TaskFilters) {
  return useInfiniteQuery({
    // "list" keeps the persisted cache of the old single-page shape from being
    // read as pages.
    queryKey: ["tasks", "list", filters],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      api.get<{ tasks: Task[]; total: number }>("/api/tasks", {
        q: filters.q || undefined,
        // The CRM's list is every unfinished task — a task waiting on "Need
        // information" is blocked, and the API alone would show only open ones.
        status: filters.status || (filters.view === "kanban" ? undefined : "open,in_progress,blocked"),
        priority: filters.priority || undefined,
        type: filters.type || undefined,
        department: filters.department || undefined,
        assignee: filters.assignee || undefined,
        due: filters.due || undefined,
        view: filters.view || undefined,
        approval: filters.approval || undefined,
        sort: filters.sort || undefined,
        created_from: filters.created_from || undefined,
        created_to: filters.created_to || undefined,
        page: pageParam,
      }),
    getNextPageParam: (last, pages, lastPage) => {
      const loaded = pages.reduce((n, p) => n + (p?.tasks?.length ?? 0), 0);
      return (last?.tasks?.length ?? 0) >= TASK_PAGE_SIZE && loaded < (last?.total ?? 0) ? lastPage + 1 : undefined;
    },
  });
}

/** Every task loaded so far, in order (a task that moved between pages shows once). */
export function tasksOf(data: { pages?: Array<{ tasks?: Task[] } | undefined> } | undefined): Task[] {
  const seen = new Set<string>();
  const out: Task[] = [];
  for (const p of data?.pages ?? []) for (const t of p?.tasks ?? []) if (t?.id && !seen.has(t.id)) { seen.add(t.id); out.push(t); }
  return out;
}

export interface TaskKpis { open: number; today: number; overdue: number; slaRisk: number }
export function useTaskKpis(filters: TaskFilters) {
  return useQuery({
    queryKey: ["task-kpis", { q: filters.q, view: filters.view, priority: filters.priority, department: filters.department, assignee: filters.assignee }],
    queryFn: () =>
      api.get<TaskKpis>("/api/tasks/kpis", {
        q: filters.q || undefined, view: filters.view || undefined, priority: filters.priority || undefined,
        department: filters.department || undefined, assignee: filters.assignee || undefined,
      }),
    staleTime: 30_000,
  });
}

export function useTask(id?: string) {
  return useQuery({ queryKey: ["task", id], enabled: !!id, queryFn: () => api.get<Task>(`/api/tasks/${id}`) });
}

export interface NewTask { title: string; description?: string; type?: string; priority?: string; dueAt?: string }
export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (body: NewTask) => api.post<{ id: string }>("/api/tasks", body), onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }) });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/tasks/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["task-kpis"] }); qc.invalidateQueries({ queryKey: ["trash"] }); qc.invalidateQueries({ queryKey: ["command-center"] }); },
  });
}

export interface TaskComment { id: string; body: string; authorId: string; authorName: string | null; createdAt: string }
export function useTaskComments(id?: string) {
  return useQuery({ queryKey: ["task-comments", id], enabled: !!id, queryFn: () => api.get<{ comments: TaskComment[] }>(`/api/tasks/${id}/comments`).then((r) => r.comments) });
}
export function useAddTaskComment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => api.post(`/api/tasks/${id}/comments`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["task-comments", id] }),
  });
}

export interface TaskLink { kind: "client" | "lead" | "meeting" | "request"; id: string; name: string; sub: string | null; href: string; fixed: boolean }
export function useTaskRelated(id?: string) {
  return useQuery({ queryKey: ["task-related", id], enabled: !!id, queryFn: () => api.get<{ links: TaskLink[]; canEdit: boolean }>(`/api/tasks/${id}/related`) });
}

/** Ask (blocks the task) or answer (restores its status) a "Need information" question. */
export function useInfoRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { action: "ask"; question: string; askToId?: string } | { action: "answer"; answer: string }) => api.post(`/api/tasks/${id}/info-request`, body),
    // Asking blocks the task and answering restores it; both post a comment.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["task", id] }); qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["task-kpis"] }); qc.invalidateQueries({ queryKey: ["task-comments", id] });
    },
  });
}

export function useUpdateTask(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<Task>) => queuedPatch(`/api/tasks/${id}`, patch, "Task update"),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["task", id] }); qc.invalidateQueries({ queryKey: ["tasks"] }); qc.invalidateQueries({ queryKey: ["task-kpis"] }); qc.invalidateQueries({ queryKey: ["task-related", id] }); },
  });
}

// ── Constants ─────────────────────────────────────────────────────────────────
export const TASK_STATUSES: { key: string; label: string; tone: Tone }[] = [
  { key: "open", label: "Open", tone: "info" },
  { key: "in_progress", label: "In Progress", tone: "violet" },
  { key: "blocked", label: "Blocked", tone: "danger" },
  { key: "completed", label: "Completed", tone: "success" },
  { key: "cancelled", label: "Cancelled", tone: "neutral" },
];
export const TASK_PRIORITIES = [
  { key: "urgent", label: "Urgent" }, { key: "high", label: "High" }, { key: "normal", label: "Normal" }, { key: "low", label: "Low" },
];
export const TASK_DEPARTMENTS = ["sales", "operations", "back_office", "compliance", "marketing", "advisory", "support", "leadership", "other"];

export const statusMeta = (s?: string | null) => TASK_STATUSES.find((x) => x.key === s);
export const TASK_PRIORITY_TONE: Record<string, Tone> = { urgent: "danger", high: "warning", normal: "info", low: "neutral", medium: "info" };

const STATUS_INDEX = new Map(TASK_STATUSES.map((s, i) => [s.key, i]));
export function groupTasksByStatus(tasks: Task[]): { key: string; label: string; tone: Tone; tasks: Task[] }[] {
  const buckets = new Map<string, Task[]>();
  for (const s of TASK_STATUSES) buckets.set(s.key, []);
  for (const t of tasks) { const k = t.status ?? "open"; (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(t); }
  return Array.from(buckets.entries())
    .map(([key, ts]) => ({ key, label: statusMeta(key)?.label ?? key, tone: statusMeta(key)?.tone ?? "neutral", tasks: ts }))
    .sort((a, b) => (STATUS_INDEX.get(a.key) ?? 99) - (STATUS_INDEX.get(b.key) ?? 99));
}

/** SLA badge text/tone from slaDueAt. */
export function slaInfo(t: Task): { label: string; tone: Tone } | null {
  if (!t.slaDueAt || t.status === "completed" || t.status === "cancelled") return null;
  const ms = new Date(t.slaDueAt).getTime() - Date.now();
  if (ms < 0) return { label: "SLA breached", tone: "danger" };
  const h = ms / 3_600_000;
  if (h < 24) return { label: `SLA ${Math.max(1, Math.round(h))}h`, tone: "warning" };
  return { label: `SLA ${Math.round(h / 24)}d`, tone: "neutral" };
}

export function checklistProgress(t: Task): { done: number; total: number } {
  const items = t.meta?.checklist ?? [];
  return { done: items.filter((i) => i.status === "completed" || i.done).length, total: items.length };
}
