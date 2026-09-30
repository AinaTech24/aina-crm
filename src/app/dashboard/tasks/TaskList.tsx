"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { RowActions } from "@/components/common/RowActions";
import { SelectField } from "@/components/ui/SelectField";
import { RmSelector } from "@/components/common/RmSelector";
import { useToast } from "@/components/ui/Toast";
import { TaskDetailDrawer } from "./TaskDetailDrawer";
import { Avatar } from "@/components/ui/Avatar";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { taskChecklist, type Task } from "@/db/schema";
import { Loader2, ListChecks, Trash2, Clock3, ShieldCheck, CalendarClock, Gauge, Check, X, Pencil, ChevronDown } from "lucide-react";
import { DateField } from "@/components/ui/DateField";

// Priority → left-accent stripe colour (row hierarchy at a glance).
const PRIORITY_ACCENT: Record<string, string> = {
  urgent: "bg-rose-500",
  high: "bg-amber-400",
  normal: "bg-slate-300",
  low: "bg-slate-200",
};
// Priority / status → tinted select text so the inline controls read as pills.
const PRIORITY_TEXT: Record<string, string> = {
  urgent: "text-rose-700",
  high: "text-amber-700",
  normal: "text-muted-foreground",
  low: "text-muted-foreground",
};
const STATUS_TEXT: Record<string, string> = {
  open: "text-sky-700",
  in_progress: "text-violet-700",
  blocked: "text-rose-700",
  completed: "text-emerald-700",
  cancelled: "text-muted-foreground",
};

// Due-date buckets for the "Group by due" view — fixed display order.
const BUCKET_ORDER = ["overdue", "today", "week", "later", "nodate", "done"] as const;
const BUCKET_META: Record<string, { label: string; tone: string }> = {
  overdue: { label: "Overdue", tone: "text-rose-600" },
  today: { label: "Due today", tone: "text-amber-600" },
  week: { label: "This week", tone: "text-foreground" },
  later: { label: "Later", tone: "text-muted-foreground" },
  nodate: { label: "No due date", tone: "text-muted-foreground" },
  done: { label: "Completed & closed", tone: "text-muted-foreground" },
};
function dueBucketKey(t: { status: string; dueAt: Date | string | null }): string {
  if (t.status === "completed" || t.status === "cancelled") return "done";
  if (!t.dueAt) return "nodate";
  const due = new Date(t.dueAt).getTime();
  const now = Date.now();
  if (due < now) return "overdue";
  if (new Date(t.dueAt).toDateString() === new Date().toDateString()) return "today";
  if (due < now + 7 * 86400000) return "week";
  return "later";
}

/**
 * "Today", "Tomorrow", "in 3 days", "5 days ago", else the date. A due date is
 * usually in the future, and the shared formatRelative only speaks the past.
 */
function dueRelative(value: Date | string): string {
  const due = new Date(value);
  if (isNaN(due.getTime())) return "—";
  const now = new Date();
  const dayOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((dayOf(due) - dayOf(now)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  if (days > 1 && days < 7) return `in ${days} days`;
  if (days < -1 && days > -7) return `${-days} days ago`;
  return due.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    ...(due.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
}

const PRIORITY_LABEL: Record<string, string> = { urgent: "Urgent", high: "High", normal: "Normal", low: "Low" };

interface TaskRow {
  task: Task;
  assignee: string | null;
  /** Creator's name ("assigned by"). */
  createdBy?: string | null;
  /** Resolved from related_investor_id or the older subject link. */
  investorId?: string | null;
  investorName: string | null;
  investorAvatarUrl?: string | null;
  leadId?: string | null;
  leadName: string | null;
  leadAvatarUrl?: string | null;
}

interface TaskListProps {
  initialRows: TaskRow[];
  currentUserId: string;
  canManageAll?: boolean;
  /** ?task=<id> deep-link (e.g. from the Service tracker) — opens the drawer. */
  initialOpenTaskId?: string;
  /** Total tasks matching the current filters (across all pages). */
  total?: number;
  /** Search + filter + sort + view controls, rendered in the table header. */
  toolbar?: ReactNode;
}

export function TaskList({ initialRows, currentUserId, canManageAll = false, initialOpenTaskId, total = 0, toolbar }: TaskListProps) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState(initialRows);
  const [selectedRow, setSelectedRow] = useState<TaskRow | null>(null);

  // Open the drawer for a ?task=<id> deep-link. If the task isn't in the current
  // (filtered) page, fetch it directly so the link still works.
  useEffect(() => {
    if (!initialOpenTaskId) return;
    const inList = initialRows.find((r) => r.task.id === initialOpenTaskId);
    if (inList) { setSelectedRow(inList); return; }
    let cancelled = false;
    fetch(`/api/tasks/${initialOpenTaskId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((task) => {
        if (!cancelled && task && task.id) {
          setSelectedRow({ task, assignee: null, investorName: null, investorAvatarUrl: null, leadName: null, leadAvatarUrl: null });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialOpenTaskId]);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);

  // Bulk-select states
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [selectMenuOpen, setSelectMenuOpen] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const selectMenuRef = useRef<HTMLDivElement>(null);
  const sp = useSearchParams();

  // Human-readable name for whatever narrowed the list, so an empty result can
  // say WHICH filter found nothing ("No cancelled tasks") instead of a generic
  // "all caught up" that reads like the filter silently failed.
  const activeFilterLabel = (() => {
    const parts: string[] = [];
    const q = sp.get("q");
    if (q) parts.push(`matching “${q}”`);
    for (const [key, prefix] of [
      ["status", ""],
      ["priority", " priority"],
      ["type", ""],
      ["department", ""],
    ] as const) {
      const v = sp.get(key);
      if (!v) continue;
      parts.push(
        v
          .split(",")
          .filter(Boolean)
          .map((s) => s.replace(/_/g, " "))
          .join(" / ") + prefix
      );
    }
    if (sp.get("mine") === "1") parts.push("assigned to me");
    if (sp.get("overdue") === "1") parts.push("overdue");
    return parts.join(" · ");
  })();

  // Sync rows from parent when query changes
  if (JSON.stringify(initialRows.map(r => r.task.id)) !== JSON.stringify(rows.map(r => r.task.id))) {
    setRows(initialRows);
    setSelected(new Set());
  }

  useEffect(() => {
    if (!selectMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (selectMenuRef.current && !selectMenuRef.current.contains(e.target as Node)) setSelectMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [selectMenuOpen]);

  const pageIds = rows.map((r) => r.task.id);
  const allPageSelected = rows.length > 0 && pageIds.every((id) => selected.has(id));
  function toggleSelect(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function selectThisPage() {
    setSelected(new Set(pageIds));
    setSelectMenuOpen(false);
  }
  /** Select every task matching the current filters (across all pages). */
  async function selectAllPages() {
    setSelectMenuOpen(false);
    setSelectingAll(true);
    try {
      const res = await fetch(`/api/tasks/ids?${sp.toString()}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Failed");
      setSelected(new Set(Array.isArray(j.ids) ? j.ids : []));
      if (j.capped) toast.success(`Selected the first ${j.limit} tasks (the max per bulk action).`);
    } catch {
      toast.error("Couldn't select all tasks");
    } finally {
      setSelectingAll(false);
    }
  }

  async function runBulk(action: "status" | "priority" | "assign" | "cancel" | "delete" | "reschedule", value?: string) {
    if (selected.size === 0 || bulkBusy) return;
    setBulkBusy(true);
    try {
      const res = await fetch("/api/tasks/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], action, value }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Bulk action failed");
      const n = j.updated ?? j.deleted ?? 0;
      toast.success(action === "delete" ? `Deleted ${n} task${n === 1 ? "" : "s"}` : `Updated ${n} task${n === 1 ? "" : "s"}`);
      setSelected(new Set());
      setConfirmBulkDelete(false);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Bulk action failed", "Action failed");
    } finally {
      setBulkBusy(false);
    }
  }

  async function handleToggleComplete(taskId: string, isCompleted: boolean, e: React.MouseEvent) {
    e.stopPropagation(); // prevent opening the drawer
    setCompletingTaskId(taskId);
    
    // Optimistic Update
    const previousRows = [...rows];
    setRows(prev =>
      prev.map(r =>
        r.task.id === taskId
          ? { ...r, task: { ...r.task, status: isCompleted ? "completed" : "open" } }
          : r
      )
    );

    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: isCompleted ? "completed" : "open" }),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Failed to update status");
      }
      toast.success(isCompleted ? "Task marked complete" : "Task reopened");
      // Allow some animation feedback, then reload to filter out
      setTimeout(() => {
        router.refresh();
      }, 300);
    } catch (err: any) {
      // Revert on error
      setRows(previousRows);
      toast.error(err?.message ?? "Could not update the task", "Update failed");
    } finally {
      setCompletingTaskId(null);
    }
  }

  async function handleStatusChange(taskId: string, newStatus: string) {
    const previousRows = [...rows];
    setRows(prev =>
      prev.map(r =>
        r.task.id === taskId
          ? { ...r, task: { ...r.task, status: newStatus as any } }
          : r
      )
    );
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Failed to update status");
      }
      toast.success(`Status set to ${newStatus.replace(/_/g, " ")}`);
      router.refresh();
    } catch (err: any) {
      setRows(previousRows);
      toast.error(err?.message ?? "Could not update the status", "Update failed");
    }
  }

  async function handlePriorityChange(taskId: string, newPriority: string) {
    const previousRows = [...rows];
    setRows(prev =>
      prev.map(r =>
        r.task.id === taskId
          ? { ...r, task: { ...r.task, priority: newPriority as any } }
          : r
      )
    );
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: newPriority }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Failed to update priority");
      }
      toast.success(`Priority set to ${newPriority}`);
      router.refresh();
    } catch (err: any) {
      setRows(previousRows);
      toast.error(err?.message ?? "Could not update the priority", "Update failed");
    }
  }

  const handleUpdate = () => {
    router.refresh();
  };

  return (
    <div className="border rounded-lg bg-card bg-white overflow-hidden shadow-sm flex flex-col">
      {/* Bulk action bar — appears when rows are selected. */}
      {selected.size > 0 && (
        <div className="px-3 py-2 border-b bg-brand-cyan-light/20 flex items-center gap-2 flex-wrap text-xs">
          <span className="font-semibold text-foreground">{selected.size} selected</span>
          {/* The three things a selection is for, first: done, whose, when. */}
          <button onClick={() => runBulk("status", "completed")} disabled={bulkBusy} className="btn-secondary text-xs py-1 px-2.5 inline-flex items-center gap-1">
            <Check className="size-3.5" /> Mark done
          </button>
          <div className="w-44">
            <RmSelector value={null} onChange={(id) => id && runBulk("assign", id)} placeholder="Reassign to…" />
          </div>
          <div className="inline-flex items-center gap-1">
            <span className="text-muted-foreground">Change due date:</span>
            <button
              onClick={() => { const d = new Date(); d.setHours(18, 0, 0, 0); runBulk("reschedule", d.toISOString()); }}
              disabled={bulkBusy}
              className="btn-ghost text-xs py-1 px-2"
            >
              Today
            </button>
            <button
              onClick={() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(18, 0, 0, 0); runBulk("reschedule", d.toISOString()); }}
              disabled={bulkBusy}
              className="btn-ghost text-xs py-1 px-2"
            >
              Tomorrow
            </button>
            <button
              onClick={() => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(18, 0, 0, 0); runBulk("reschedule", d.toISOString()); }}
              disabled={bulkBusy}
              className="btn-ghost text-xs py-1 px-2"
            >
              Next week
            </button>
            <DateField
              onChange={(e) => { if (e.target.value) { const d = new Date(e.target.value); d.setHours(18, 0, 0, 0); runBulk("reschedule", d.toISOString()); } }}
              className="input-base h-7 text-xs w-[130px]"
              aria-label="Change due date to"
            />
          </div>
          <span className="h-4 w-px bg-border" aria-hidden />
          <div onClick={(e) => e.stopPropagation()}>
            <SelectField value="" onChange={(e) => e.target.value && runBulk("priority", e.target.value)} size="sm" className="w-32">
              <option value="">Set priority…</option>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </SelectField>
          </div>
          <button onClick={() => runBulk("cancel")} disabled={bulkBusy} className="btn-ghost text-xs py-1 px-2 text-rose-600">Cancel tasks</button>
          <button onClick={() => setConfirmBulkDelete(true)} disabled={bulkBusy} className="text-xs py-1 px-2.5 rounded-md border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 inline-flex items-center gap-1 font-medium">
            <Trash2 className="size-3.5" /> Delete
          </button>
          {bulkBusy && <Loader2 className="size-3.5 animate-spin text-brand-cyan" />}
          <button onClick={() => setSelected(new Set())} className="ml-auto text-muted-foreground hover:underline">Clear</button>
        </div>
      )}

      {/* The header always renders — including when the list is empty — so the
          search / filter / sort / view controls stay reachable. */}
      <div className="group/list">
        {/* Table header — select control (hover-reveal) + search/filter/sort/view toolbar. */}
        <div className="px-3 sm:px-4 py-2 border-b bg-white flex items-center gap-3">
          <div className={`flex items-center gap-2 shrink-0 transition-opacity ${selected.size > 0 ? "opacity-100" : "opacity-0 group-hover/list:opacity-100 focus-within:opacity-100"}`}>
            <input
              type="checkbox"
              checked={allPageSelected}
              onChange={() => (allPageSelected ? setSelected(new Set()) : selectThisPage())}
              className="size-3.5 rounded border-slate-300"
              aria-label="Select tasks on this page"
            />
            <div className="relative" ref={selectMenuRef}>
              <button
                type="button"
                onClick={() => setSelectMenuOpen((o) => !o)}
                className="inline-flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground"
              >
                {selectingAll ? <Loader2 className="size-3 animate-spin" /> : null}
                Select <ChevronDown className="size-3 opacity-60" />
              </button>
              {selectMenuOpen && (
                <div className="absolute left-0 top-full mt-1 z-20 w-56 rounded-md border bg-popover shadow-md py-1 text-xs">
                  <button type="button" onClick={selectThisPage} className="w-full text-left px-3 py-1.5 hover:bg-accent">
                    This page <span className="text-muted-foreground">({rows.length})</span>
                  </button>
                  <button type="button" onClick={selectAllPages} className="w-full text-left px-3 py-1.5 hover:bg-accent">
                    All tasks <span className="text-muted-foreground">({total.toLocaleString("en-IN")})</span>
                  </button>
                  {selected.size > 0 && (
                    <button type="button" onClick={() => { setSelected(new Set()); setSelectMenuOpen(false); }} className="w-full text-left px-3 py-1.5 hover:bg-accent text-rose-600">
                      Clear selection
                    </button>
                  )}
                </div>
              )}
            </div>
            {selected.size > 0 && <span className="text-2xs text-muted-foreground whitespace-nowrap">· {selected.size} selected</span>}
          </div>
          {toolbar && <div className="flex-1 min-w-0">{toolbar}</div>}
        </div>
        {/* min-h keeps the table the same height when a filter returns nothing,
            so the page doesn't collapse under the toolbar. The header above is
            always rendered — previously the empty state replaced it, which hid
            the very filter controls needed to undo the filter. */}
        {/* Column headings — named ONCE here instead of repeating a tiny
            "Assigned by / Assigned to" caption inside all 50 rows, which was
            most of the visual noise in the list. Hidden on the breakpoints
            where those columns themselves are hidden. */}
        {rows.length > 0 && (
          <div className="hidden md:flex items-center gap-2 px-4 py-1.5 border-b border-border bg-secondary/40 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="size-3.5 shrink-0" aria-hidden />
            <span className="size-5 shrink-0" aria-hidden />
            <span className="flex-1 min-w-0">Task</span>
            <span className="hidden xl:block w-32 shrink-0">Client / Lead</span>
            <span className="hidden sm:block w-20 shrink-0">Due</span>
            <span className="hidden sm:block w-14 shrink-0">Priority</span>
            <span className="w-32 shrink-0">Assigned to</span>
            <span className="hidden xl:block w-20 shrink-0">Source</span>
            <span className="w-[68px] shrink-0 text-right">Actions</span>
          </div>
        )}
        <ul className="divide-y divide-border max-h-[60vh] min-h-[240px] overflow-y-auto scrollbar-thin">
          {rows.length === 0 && (
            <li className="p-12 text-center">
              <div className="mx-auto size-12 rounded-full bg-secondary flex items-center justify-center mb-3">
                <ListChecks className="size-6 text-muted-foreground" />
              </div>
              <div className="text-sm font-semibold text-foreground">
                {activeFilterLabel ? `No ${activeFilterLabel} tasks` : "You're all caught up"}
              </div>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                {activeFilterLabel
                  ? `Nothing matches ${activeFilterLabel}. Clear the filter to see the rest.`
                  : "No tasks match this view. Create one, or let workflows add them automatically when SIPs fail, reviews come due, or KYC expires."}
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                {activeFilterLabel && (
                  <button
                    type="button"
                    onClick={() => router.push("/dashboard/tasks")}
                    className="btn-secondary !px-3 !py-1.5"
                  >
                    <X className="size-4" /> Clear filters
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => router.push("/dashboard/tasks/new")}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-sm font-medium"
                >
                  <ListChecks className="size-4" /> New task
                </button>
              </div>
            </li>
          )}
          {rows.map((row) => {
            const t = row.task;
            // `cancelled` and `completed` are different outcomes and must not
            // look identical: filtering by Cancelled used to render rows with
            // the green completed tick, so a correct result looked like the
            // filter was returning completed tasks.
            const isCompleted = t.status === "completed";
            const isCancelled = t.status === "cancelled";
            const isDone = isCompleted || isCancelled;
            const creatorName = row.createdBy ?? "System";
            // "You", not "Me": the list talks to the reader.
            const isYou = !!row.assignee && t.assigneeId === currentUserId;
            const assigneeLabel = row.assignee ? (isYou ? "You" : row.assignee) : "Unassigned";
            // A workflow stamps its run id; a task with no creator came from the
            // system too (imports, older automations).
            const automated = !!t.workflowRunId || !t.createdById;
            const overdue = !!t.dueAt && !isDone && new Date(t.dueAt).getTime() < Date.now();
            const investorId = row.investorId ?? t.relatedInvestorId;
            const leadId = row.leadId ?? t.relatedLeadId;
            const related = investorId && row.investorName
              ? { href: `/dashboard/investors/${investorId}`, name: row.investorName, kind: "Client" }
              : leadId && row.leadName
                ? { href: `/dashboard/leads/${leadId}`, name: row.leadName, kind: "Lead" }
                : null;
            return (
              <li
                key={t.id}
                onClick={() => setSelectedRow(row)}
                className={`group/row px-4 py-2.5 flex items-center gap-2 transition-colors cursor-pointer select-none hover:bg-secondary/70 ${isDone ? "opacity-70" : ""}`}
              >
                {/* Bulk-select checkbox — revealed on row hover (or when checked). */}
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSelect(t.id)}
                  className={`size-3.5 rounded border-slate-300 flex-shrink-0 transition-opacity ${
                    selected.has(t.id) ? "opacity-100" : "opacity-0 group-hover/row:opacity-100 focus:opacity-100"
                  }`}
                  aria-label="Select task"
                />

                {/* Complete / reopen — strikes through the title when done.
                    Cancelled shows a slate ✕ rather than the green tick. */}
                <button
                  type="button"
                  onClick={(e) => handleToggleComplete(t.id, !isDone, e)}
                  disabled={completingTaskId === t.id}
                  className={`shrink-0 rounded-full border size-7 flex items-center justify-center transition ${
                    isCompleted
                      ? "bg-emerald-500 border-emerald-500 text-white"
                      : isCancelled
                        ? "bg-muted-foreground border-muted-foreground text-white"
                        : "border-border text-transparent hover:border-success hover:text-success"
                  }`}
                  title={isDone ? "Reopen task" : "Mark complete"}
                  aria-label={isDone ? "Reopen task" : "Mark complete"}
                >
                  {completingTaskId === t.id ? (
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                  ) : isCancelled ? (
                    <X className="size-3.5" />
                  ) : (
                    <Check className="size-3.5" />
                  )}
                </button>

                {/* Task content */}
                <span className={`flex-1 min-w-0 text-sm truncate ${isDone ? "line-through text-muted-foreground font-normal" : "font-medium text-foreground"}`}>
                  {t.title}
                </span>
                {isCancelled && (
                  <span className="shrink-0 text-2xs font-semibold uppercase tracking-wide text-muted-foreground bg-secondary border border-border rounded px-1.5 py-0.5">
                    Cancelled
                  </span>
                )}

                {(t.status === "in_progress" || t.status === "blocked") && (
                  <span className={`shrink-0 text-2xs font-medium rounded px-1.5 py-0.5 border ${
                    t.status === "blocked" ? "text-rose-700 bg-rose-50 border-rose-200" : "text-violet-700 bg-violet-50 border-violet-200"
                  }`}>
                    {t.status === "blocked" ? "Blocked" : "In progress"}
                  </span>
                )}

                {/* Client / Lead — opens the record, not the task. */}
                <div className="hidden xl:block w-32 shrink-0 min-w-0 text-xs">
                  {related ? (
                    <Link
                      href={related.href}
                      onClick={(e) => e.stopPropagation()}
                      className="block truncate text-foreground hover:underline"
                      title={`${related.kind}: ${related.name}`}
                    >
                      {related.name}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </div>

                {/* Due — red only when it has passed. */}
                <div className="hidden sm:block w-20 shrink-0 text-xs">
                  {t.dueAt ? (
                    <span
                      className={`inline-flex items-center gap-1 ${overdue ? "font-semibold text-destructive" : "text-muted-foreground"}`}
                      title={`${overdue ? "Overdue — was due" : "Due"} ${new Date(t.dueAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}`}
                    >
                      <CalendarClock className="size-3" />
                      {dueRelative(t.dueAt)}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">No date</span>
                  )}
                </div>

                {/* Priority — tinted only when it asks for attention. */}
                <div
                  className={`hidden sm:block w-14 shrink-0 text-xs ${
                    isDone ? "text-muted-foreground" : t.priority === "urgent" ? "font-semibold text-rose-700" : t.priority === "high" ? "font-medium text-amber-700" : "text-muted-foreground"
                  }`}
                >
                  {PRIORITY_LABEL[t.priority] ?? t.priority}
                </div>

                {/* Assigned to — avatar + name. */}
                <div className="w-32 shrink-0 min-w-0 flex items-center gap-2 text-xs" title={`Assigned to ${assigneeLabel}`}>
                  {row.assignee ? (
                    <Avatar name={row.assignee} size={24} className="shrink-0" />
                  ) : (
                    <span className="size-6 shrink-0 rounded-full border border-dashed border-border" aria-hidden />
                  )}
                  <span className={`truncate ${row.assignee ? "font-medium text-foreground" : "text-muted-foreground"}`}>{assigneeLabel}</span>
                </div>

                {/* Source — taxonomy, so no colour. */}
                <div
                  className="hidden xl:block w-20 shrink-0 text-xs text-muted-foreground"
                  title={automated ? "Created automatically by a workflow" : `Created by ${creatorName}`}
                >
                  {automated ? "Automation" : "Manual"}
                </div>

                {/* Edit (opens the modal) + delete */}
                <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-0.5 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setSelectedRow(row)}
                    className="btn-icon"
                    aria-label="Edit task"
                    title="Edit"
                  >
                    <Pencil className="size-4" />
                  </button>
                  {/* Delete lives behind the ⋯ menu — not one accidental click away. */}
                  <RowActions deleteUrl={`/api/tasks/${t.id}`} itemLabel="task" itemName={t.title} verb="Delete" />
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {selectedRow && (
        <TaskDetailDrawer
          task={{
            ...selectedRow.task,
            assigneeName: selectedRow.assignee,
            investorName: selectedRow.investorName,
            leadName: selectedRow.leadName,
          }}
          currentUserId={currentUserId}
          canManageAll={canManageAll}
          onClose={() => setSelectedRow(null)}
          onUpdate={handleUpdate}
        />
      )}

      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete tasks?"
        message={`Move ${selected.size} selected task${selected.size === 1 ? "" : "s"} to Trash? You can restore ${selected.size === 1 ? "it" : "them"} from the Trash bin.`}
        confirmLabel="Delete"
        tone="danger"
        busy={bulkBusy}
        onConfirm={() => runBulk("delete")}
        onCancel={() => setConfirmBulkDelete(false)}
      />
    </div>
  );
}
