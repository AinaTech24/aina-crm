"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatRelative } from "@/lib/utils";
import { RowActions } from "@/components/common/RowActions";
import { SelectField } from "@/components/ui/SelectField";
import { RmSelector } from "@/components/common/RmSelector";
import { useToast } from "@/components/ui/Toast";
import { TaskDetailDrawer } from "./TaskDetailDrawer";
import { taskChecklist, type Task } from "@/db/schema";
import { CheckSquare, Square, Loader2, Plus, ListChecks } from "lucide-react";

interface TaskRow {
  task: Task;
  assignee: string | null;
  investorName: string | null;
  leadName: string | null;
}

interface TaskListProps {
  initialRows: TaskRow[];
  currentUserId: string;
}

export function TaskList({ initialRows, currentUserId }: TaskListProps) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState(initialRows);
  const [selectedRow, setSelectedRow] = useState<TaskRow | null>(null);
  const [completingTaskId, setCompletingTaskId] = useState<string | null>(null);

  // Quick Add states
  const [quickTitle, setQuickTitle] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);

  // Bulk-select states
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  // Sync rows from parent when query changes
  if (JSON.stringify(initialRows.map(r => r.task.id)) !== JSON.stringify(rows.map(r => r.task.id))) {
    setRows(initialRows);
    setSelected(new Set());
  }

  const allSelected = rows.length > 0 && selected.size === rows.length;
  function toggleSelect(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function runBulk(action: "status" | "priority" | "assign" | "cancel", value?: string) {
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
      toast.success(`Updated ${j.updated} task${j.updated === 1 ? "" : "s"}`);
      setSelected(new Set());
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

  async function handleQuickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!quickTitle.trim()) return;
    setQuickBusy(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: quickTitle.trim(),
          type: "follow_up",
          priority: "normal",
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Failed to create task");
      }
      setQuickTitle("");
      toast.success("Task added");
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message ?? "Could not add the task", "Add failed");
    } finally {
      setQuickBusy(false);
    }
  }

  const handleUpdate = () => {
    router.refresh();
  };

  return (
    <div className="border rounded-lg bg-card bg-white overflow-hidden shadow-sm flex flex-col">
      {/* Inline Quick Add Input */}
      <form onSubmit={handleQuickAdd} className="p-3 border-b bg-slate-50/50 flex gap-2 items-center">
        <input
          value={quickTitle}
          onChange={(e) => setQuickTitle(e.target.value)}
          disabled={quickBusy}
          placeholder="⚡ Quick add a follow-up task... (Press Enter to save)"
          className="flex-1 input-base text-xs py-1.5 px-3 bg-white"
        />
        <button
          type="submit"
          disabled={quickBusy || !quickTitle.trim()}
          className="btn-primary text-xs py-1.5 px-3 flex-shrink-0 flex items-center gap-1"
        >
          {quickBusy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3.5" />}
          Add Task
        </button>
      </form>

      {/* Bulk action bar — appears when rows are selected. */}
      {selected.size > 0 && (
        <div className="px-3 py-2 border-b bg-brand-cyan-light/20 flex items-center gap-2 flex-wrap text-xs">
          <span className="font-semibold text-slate-700">{selected.size} selected</span>
          <button onClick={() => runBulk("status", "completed")} disabled={bulkBusy} className="btn-secondary text-xs py-1 px-2.5">Complete</button>
          <div onClick={(e) => e.stopPropagation()}>
            <SelectField value="" onChange={(e) => e.target.value && runBulk("priority", e.target.value)} size="sm" className="w-32">
              <option value="">Set priority…</option>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </SelectField>
          </div>
          <div className="w-44">
            <RmSelector value={null} onChange={(id) => id && runBulk("assign", id)} placeholder="Reassign to…" />
          </div>
          <button onClick={() => runBulk("cancel")} disabled={bulkBusy} className="btn-ghost text-xs py-1 px-2 text-rose-600">Cancel tasks</button>
          {bulkBusy && <Loader2 className="size-3.5 animate-spin text-brand-cyan" />}
          <button onClick={() => setSelected(new Set())} className="ml-auto text-muted-foreground hover:underline">Clear</button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="p-12 text-center text-sm text-muted-foreground bg-slate-50/20">
          No open tasks found. Workflows will create tasks automatically when SIPs fail, reviews come due, etc.
        </div>
      ) : (
        <>
        {/* Select-all header */}
        <div className="px-4 py-1.5 border-b bg-white flex items-center gap-2.5">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.task.id)))}
            className="size-3.5 rounded border-slate-300"
            aria-label="Select all tasks"
          />
          <span className="text-[11px] text-muted-foreground">{allSelected ? "Deselect all" : "Select all"}</span>
        </div>
        <ul className="divide-y divide-slate-100">
          {rows.map((row) => {
            const t = row.task;
            const assigneeName = row.assignee;
            const isDone = t.status === "completed";
            const isOverdue = t.dueAt && new Date(t.dueAt).getTime() < Date.now() && !isDone;
            const checklist = taskChecklist(t.meta);
            const checklistDone = checklist.filter((c) => c.done).length;

            // SLA warning badges
            const isSlaBreached = t.slaDueAt && new Date(t.slaDueAt).getTime() < Date.now() && !isDone;
            const isSlaAtRisk = t.slaDueAt && new Date(t.slaDueAt).getTime() < Date.now() + 24 * 60 * 60 * 1000 && !isDone;
            
            let slaText = "";
            let slaColor = "";
            if (t.slaDueAt && !isDone) {
              const diffMs = new Date(t.slaDueAt).getTime() - Date.now();
              const diffHours = Math.round(diffMs / (60 * 60 * 1000));
              if (isSlaBreached) {
                slaText = "SLA Breached";
                slaColor = "bg-rose-100 text-rose-800 border-rose-200 font-bold";
              } else if (diffHours <= 24) {
                slaText = `SLA: ${diffHours}h left`;
                slaColor = "bg-amber-100 text-amber-800 border-amber-200 font-semibold animate-pulse";
              } else {
                const diffDays = Math.round(diffHours / 24);
                slaText = `SLA: ${diffDays}d left`;
                slaColor = "bg-slate-100 text-slate-600 border-slate-200";
              }
            }

            return (
              <li
                key={t.id}
                onClick={() => setSelectedRow(row)}
                className={`px-4 py-3.5 flex items-center gap-3 hover:bg-slate-50/70 transition-colors cursor-pointer select-none ${
                  isDone ? "opacity-60 bg-slate-50/30" : ""
                }`}
              >
                {/* Bulk select */}
                <input
                  type="checkbox"
                  checked={selected.has(t.id)}
                  onClick={(e) => e.stopPropagation()}
                  onChange={() => toggleSelect(t.id)}
                  className="size-3.5 rounded border-slate-300 flex-shrink-0"
                  aria-label="Select task"
                />

                {/* Complete checkbox */}
                <button
                  type="button"
                  onClick={(e) => handleToggleComplete(t.id, !isDone, e)}
                  disabled={completingTaskId === t.id}
                  className="text-slate-400 hover:text-primary transition-colors focus:outline-none flex-shrink-0"
                >
                  {isDone ? (
                    <CheckSquare className="size-4.5 text-emerald-600" />
                  ) : (
                    <Square className="size-4.5" />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <div
                    className={`font-semibold text-sm text-slate-800 truncate ${
                      isDone ? "line-through text-slate-400 font-normal" : ""
                    }`}
                  >
                    {t.title}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                    <span className="font-mono bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded border text-[10px] uppercase font-bold tracking-wide">
                      {t.type.replace(/_/g, " ")}
                    </span>
                    {t.workflowRunId && (
                      <span className="text-[11px] text-slate-400 font-medium">via workflow</span>
                    )}
                    {t.department && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span className="capitalize text-[11px] text-slate-500 font-medium">{t.department}</span>
                      </>
                    )}
                    {(row.investorName || row.leadName) && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span className="text-[11px] text-slate-500 truncate max-w-[150px]">
                          {row.investorName ? `Client: ${row.investorName}` : `Lead: ${row.leadName}`}
                        </span>
                      </>
                    )}
                    {checklist.length > 0 && (
                      <>
                        <span className="text-slate-300">·</span>
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-medium ${
                            checklistDone === checklist.length ? "text-emerald-600" : "text-slate-500"
                          }`}
                          title={`${checklistDone} of ${checklist.length} action points done`}
                        >
                          <ListChecks className="size-3" /> {checklistDone}/{checklist.length}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                {/* SLA Warning Badge */}
                {slaText && (
                  <span className={`text-[10px] px-2 py-0.5 rounded border ${slaColor} flex-shrink-0`}>
                    {slaText}
                  </span>
                )}

                {/* Priority Selector (branded dropdown) */}
                <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
                  <SelectField
                    value={t.priority}
                    onChange={(e) => handlePriorityChange(t.id, e.target.value)}
                    size="sm"
                    className="w-28"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </SelectField>
                </div>

                {/* Status Selector (branded dropdown) */}
                <div onClick={(e) => e.stopPropagation()} className="flex-shrink-0">
                  <SelectField
                    value={t.status}
                    onChange={(e) => handleStatusChange(t.id, e.target.value)}
                    size="sm"
                    className="w-32"
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="blocked">Blocked</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </SelectField>
                </div>

                {t.dueAt && (
                  <span className={`text-xs tabular-nums flex-shrink-0 font-semibold ${
                    isOverdue ? "text-rose-600" : "text-muted-foreground"
                  }`}>
                    {formatRelative(t.dueAt)}
                    {isOverdue && " (Overdue)"}
                  </span>
                )}

                {assigneeName && (
                  <span className="text-xs text-slate-600 font-medium border bg-slate-50 px-2 py-0.5 rounded flex-shrink-0">
                    {t.assigneeId === currentUserId ? "Me" : assigneeName}
                  </span>
                )}

                <div onClick={(e) => e.stopPropagation()}>
                  <RowActions
                    deleteUrl={`/api/tasks/${t.id}`}
                    itemLabel="task"
                    itemName={t.title}
                    verb="Cancel"
                  />
                </div>
              </li>
            );
          })}
        </ul>
        </>
      )}

      {selectedRow && (
        <TaskDetailDrawer
          task={{
            ...selectedRow.task,
            assigneeName: selectedRow.assignee,
            investorName: selectedRow.investorName,
            leadName: selectedRow.leadName,
          }}
          onClose={() => setSelectedRow(null)}
          onUpdate={handleUpdate}
        />
      )}
    </div>
  );
}
