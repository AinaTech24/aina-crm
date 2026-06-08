"use client";

import { useState, useEffect } from "react";
import { X, Calendar, User, Sparkles, LifeBuoy, AlertCircle, Trash, Plus, CheckCircle2, Circle, ListChecks, Loader2 } from "lucide-react";
import { RmSelector } from "@/components/common/RmSelector";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { taskChecklist, type Task, type TaskChecklistItem } from "@/db/schema";
import Link from "next/link";

interface TaskDetailDrawerProps {
  task: Task & {
    assigneeName?: string | null;
    investorName?: string | null;
    leadName?: string | null;
  };
  onClose: () => void;
  onUpdate: () => void;
}

const DEPARTMENTS: [string, string][] = [
  ["sales", "Sales"],
  ["operations", "Operations"],
  ["back_office", "Back Office"],
  ["compliance", "Compliance"],
  ["marketing", "Marketing"],
  ["advisory", "Advisory"],
  ["support", "Support"],
  ["leadership", "Leadership"],
  ["other", "Other"],
];

export function TaskDetailDrawer({ task, onClose, onUpdate }: TaskDetailDrawerProps) {
  const toast = useToast();
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [status, setStatus] = useState(task.status);
  const [priority, setPriority] = useState(task.priority);
  const [department, setDepartment] = useState(task.department ?? "");
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? "");
  const [dueDate, setDueDate] = useState(() => {
    if (!task.dueAt) return "";
    return new Date(task.dueAt).toISOString().split("T")[0];
  });
  const [slaDate, setSlaDate] = useState(() => {
    if (!task.slaDueAt) return "";
    return new Date(task.slaDueAt).toISOString().split("T")[0];
  });

  // Appending remarks log
  const [remarksHistory, setRemarksHistory] = useState(task.remarks ?? "");
  const [newRemark, setNewRemark] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Action points (checklist) — auto-saved on every change, independent of the
  // main "Save Changes" button so ticking a step persists instantly.
  const [checklist, setChecklist] = useState<TaskChecklistItem[]>(() => taskChecklist(task.meta));
  const [newPoint, setNewPoint] = useState("");
  const [checklistBusy, setChecklistBusy] = useState(false);
  const doneCount = checklist.filter((c) => c.done).length;
  const allDone = checklist.length > 0 && doneCount === checklist.length;

  async function persistChecklist(next: TaskChecklistItem[]) {
    const prev = checklist;
    setChecklist(next); // optimistic
    setChecklistBusy(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checklist: next }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d?.error ?? "Failed to save action points");
      }
      onUpdate();
    } catch (e: any) {
      setChecklist(prev); // revert
      toast.error(e?.message ?? "Couldn't save action points", "Save failed");
    } finally {
      setChecklistBusy(false);
    }
  }
  function addPoint() {
    const text = newPoint.trim();
    if (!text) return;
    const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.round(performance.now())}`;
    setNewPoint("");
    persistChecklist([...checklist, { id, text, done: false }]);
  }
  function togglePoint(id: string) {
    persistChecklist(
      checklist.map((c) => (c.id === id ? { ...c, done: !c.done, doneAt: !c.done ? new Date().toISOString() : null } : c))
    );
  }
  function removePoint(id: string) {
    persistChecklist(checklist.filter((c) => c.id !== id));
  }
  async function quickReschedule(days: number) {
    const base = dueDate ? new Date(dueDate) : new Date();
    base.setDate(base.getDate() + days);
    const iso = base.toISOString().split("T")[0];
    setDueDate(iso); // optimistic
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dueAt: new Date(iso).toISOString() }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(`Rescheduled to ${new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`);
      onUpdate();
    } catch {
      toast.error("Couldn't reschedule", "Update failed");
    }
  }
  async function completeTaskNow() {
    setStatus("completed" as any);
    setLoading(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Task marked complete");
      onUpdate();
    } catch {
      toast.error("Couldn't complete the task", "Update failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setStatus(task.status);
    setPriority(task.priority);
    setDepartment(task.department ?? "");
    setAssigneeId(task.assigneeId ?? "");
    setDueDate(task.dueAt ? new Date(task.dueAt).toISOString().split("T")[0] : "");
    setSlaDate(task.slaDueAt ? new Date(task.slaDueAt).toISOString().split("T")[0] : "");
    setRemarksHistory(task.remarks ?? "");
    setChecklist(taskChecklist(task.meta));
    // Re-initialise ONLY when switching to a different task — keyed on task.id,
    // not the whole object. A checklist add saves then triggers router.refresh,
    // which hands us a new (same-id) task object; depending on [task] here would
    // re-run this effect and overwrite the just-added point with the parent's
    // stale copy (the "action point disappears" bug). Same for in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id]);

  async function handleSave() {
    setLoading(true);
    setErr(null);
    try {
      // Append new remark to top if provided
      let finalRemarks = remarksHistory;
      if (newRemark.trim()) {
        const timestamp = new Date().toLocaleString("en-IN", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
        const entry = `[${timestamp}] ${newRemark.trim()}`;
        finalRemarks = remarksHistory ? `${entry}\n\n${remarksHistory}` : entry;
      }

      const payload = {
        title,
        description: description || undefined,
        status,
        priority,
        department: department || undefined,
        assigneeId: assigneeId || undefined,
        dueAt: dueDate ? new Date(dueDate).toISOString() : undefined,
        slaDueAt: slaDate ? new Date(slaDate).toISOString() : null,
        remarks: finalRemarks || undefined,
      };

      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error ?? `Failed to save task changes`);
      }
      setNewRemark("");
      if (data?.remarks) {
        setRemarksHistory(data.remarks);
      }
      toast.success("Task changes saved");
      onUpdate();
    } catch (error: any) {
      const msg = error?.message ?? "An unexpected error occurred";
      setErr(msg);
      toast.error(msg, "Couldn't save task");
    } finally {
      setLoading(false);
    }
  }

  async function doCancelTask() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? `Failed to cancel task`);
      }
      setConfirmCancelOpen(false);
      toast.success("Task cancelled");
      onClose();
      onUpdate();
    } catch (error: any) {
      const msg = error?.message ?? "Failed to cancel task";
      setErr(msg);
      toast.error(msg, "Couldn't cancel task");
      setLoading(false);
    }
  }

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 bg-black/35 backdrop-blur-[1px] z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Slide-over Panel */}
      <div className="fixed top-0 right-0 h-full w-full md:w-[480px] bg-card border-l border-border shadow-2xl z-50 flex flex-col animate-slide-in overflow-hidden bg-white text-slate-800">
        
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="font-bold text-sm text-slate-800 uppercase tracking-wider">
              Task Details
            </h3>
            <span className="text-[10px] text-muted-foreground font-mono">ID: {task.id.slice(0, 8)}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-thin">
          {err && (
            <div className="p-3 text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg flex items-center gap-1.5">
              <AlertCircle className="size-4 flex-shrink-0" />
              <span>{err}</span>
            </div>
          )}

          {/* Title and Description */}
          <div className="space-y-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Task title"
              className="text-lg font-bold bg-transparent border-none focus:outline-none w-full border-b focus:border-slate-300 py-0.5"
            />
            
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="No description provided. Click to add details..."
                className="input-base text-xs py-2 bg-slate-50 border-slate-200 focus:bg-white transition-colors"
              />
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Quick Stats Grid */}
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Status</label>
              <SelectField
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                size="sm"
                className="w-full"
              >
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="blocked">Blocked</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
              </SelectField>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Priority</label>
              <SelectField
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                size="sm"
                className="w-full"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </SelectField>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Due Date</label>
              <DateField
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                size="sm"
                className="w-full"
              />
              <div className="mt-1 flex items-center gap-1">
                <span className="text-[9px] uppercase text-slate-400 font-semibold">Snooze</span>
                {[["+1d", 1], ["+1w", 7], ["+1m", 30]].map(([label, days]) => (
                  <button
                    key={label as string}
                    type="button"
                    onClick={() => quickReschedule(days as number)}
                    className="text-[10px] px-1.5 py-0.5 rounded border border-slate-200 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">SLA Due Date</label>
              <DateField
                value={slaDate}
                onChange={(e) => setSlaDate(e.target.value)}
                size="sm"
                className="w-full"
              />
            </div>

            <div className="col-span-2">
              <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Department</label>
              <SelectField
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                size="sm"
                className="w-full"
              >
                <option value="">—</option>
                {DEPARTMENTS.map(([k, l]) => (
                  <option key={k} value={k}>{l}</option>
                ))}
              </SelectField>
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-bold text-slate-500 block mb-1">Assigned To</label>
            <RmSelector
              value={assigneeId || null}
              onChange={(id) => setAssigneeId(id ?? "")}
              placeholder="Unassigned (defaults to creator)"
            />
          </div>

          <hr className="border-slate-100" />

          {/* Related Entities Card Links */}
          <div className="space-y-2.5">
            <h4 className="text-[10px] uppercase font-bold text-slate-500">Related Entities</h4>
            
            <div className="grid grid-cols-1 gap-2">
              {task.relatedInvestorId && (
                <Link
                  href={`/dashboard/investors/${task.relatedInvestorId}`}
                  className="flex items-center justify-between p-2.5 border rounded-lg hover:bg-slate-50 border-brand-cyan/20 bg-brand-cyan-light/10 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <User className="size-4 text-brand-cyan-deep flex-shrink-0" />
                    <div className="truncate text-xs font-medium">
                      {task.investorName ?? "Client Profile"}
                    </div>
                  </div>
                  <span className="text-[9px] uppercase font-semibold text-brand-cyan-deep bg-brand-cyan-light/40 px-1.5 py-0.5 rounded">
                    Client
                  </span>
                </Link>
              )}

              {task.relatedLeadId && (
                <Link
                  href={`/dashboard/leads/${task.relatedLeadId}`}
                  className="flex items-center justify-between p-2.5 border rounded-lg hover:bg-slate-50 border-amber-200 bg-amber-50/10 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Sparkles className="size-4 text-amber-600 flex-shrink-0" />
                    <div className="truncate text-xs font-medium">
                      {task.leadName ?? "Lead Details"}
                    </div>
                  </div>
                  <span className="text-[9px] uppercase font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                    Lead
                  </span>
                </Link>
              )}

              {task.relatedServiceRequestId && (
                <div
                  className="flex items-center justify-between p-2.5 border rounded-lg border-blue-100 bg-blue-50/10"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <LifeBuoy className="size-4 text-blue-600 flex-shrink-0" />
                    <div className="truncate text-xs font-medium">
                      Service Ticket
                    </div>
                  </div>
                  <span className="text-[9px] uppercase font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded">
                    Service Req
                  </span>
                </div>
              )}

              {task.relatedMeetingId && (
                <Link
                  href={`/dashboard/review-meetings/${task.relatedMeetingId}`}
                  className="flex items-center justify-between p-2.5 border rounded-lg hover:bg-slate-50 border-emerald-100 bg-emerald-50/10 transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Calendar className="size-4 text-emerald-600 flex-shrink-0" />
                    <div className="truncate text-xs font-medium">
                      Review Meeting File
                    </div>
                  </div>
                  <span className="text-[9px] uppercase font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                    Meeting
                  </span>
                </Link>
              )}

              {!task.relatedInvestorId && !task.relatedLeadId && !task.relatedServiceRequestId && !task.relatedMeetingId && (
                <div className="text-xs text-muted-foreground p-3 border border-dashed rounded-lg text-center bg-slate-50">
                  No entities linked to this task.
                </div>
              )}
            </div>
          </div>

          <hr className="border-slate-100" />

          {/* Action points (checklist) — the sub-steps to complete this task. */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] uppercase font-bold text-slate-500 flex items-center gap-1.5">
                <ListChecks className="size-3.5" /> Action points
                {checklist.length > 0 && (
                  <span className="text-slate-400 normal-case font-semibold">· {doneCount}/{checklist.length} done</span>
                )}
              </h4>
              {checklistBusy && <Loader2 className="size-3 animate-spin text-brand-cyan" />}
            </div>

            {checklist.length > 0 && (
              <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.round((doneCount / checklist.length) * 100)}%` }}
                />
              </div>
            )}

            <div className="space-y-1.5">
              {checklist.map((c) => (
                <div key={c.id} className="group flex items-start gap-2 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-2">
                  <button type="button" onClick={() => togglePoint(c.id)} className="mt-0.5 shrink-0 text-slate-400 hover:text-emerald-600 transition-colors">
                    {c.done ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Circle className="size-4" />}
                  </button>
                  <span className={`flex-1 text-xs leading-relaxed ${c.done ? "line-through text-slate-400" : "text-slate-700"}`}>
                    {c.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => removePoint(c.id)}
                    className="shrink-0 text-slate-300 hover:text-rose-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Remove action point"
                  >
                    <Trash className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex gap-2">
              <input
                value={newPoint}
                onChange={(e) => setNewPoint(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addPoint(); } }}
                placeholder="Add an action point and press Enter…"
                className="input-base text-xs flex-1 bg-white"
              />
              <button
                type="button"
                onClick={addPoint}
                disabled={!newPoint.trim() || checklistBusy}
                className="btn-secondary text-xs px-2.5 disabled:opacity-50"
                aria-label="Add action point"
              >
                <Plus className="size-3.5" />
              </button>
            </div>

            {allDone && status !== "completed" && (
              <button
                type="button"
                onClick={completeTaskNow}
                disabled={loading}
                className="w-full btn-primary text-xs py-1.5 flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 className="size-3.5" /> All points done — mark task complete
              </button>
            )}
          </div>

          <hr className="border-slate-100" />

          {/* Remarks Append Section */}
          <div className="space-y-3">
            <h4 className="text-[10px] uppercase font-bold text-slate-500">Remarks & Comments Log</h4>
            
            <div className="space-y-2">
              <textarea
                value={newRemark}
                onChange={(e) => setNewRemark(e.target.value)}
                placeholder="Type a new comment/work log and click 'Save Changes' to append..."
                rows={2}
                className="input-base text-xs bg-slate-50 border-slate-200 focus:bg-white transition-colors"
              />
            </div>

            {remarksHistory ? (
              <div className="space-y-3 max-h-60 overflow-y-auto pr-1 scrollbar-thin">
                {remarksHistory.split("\n\n").map((chunk, idx) => {
                  const match = chunk.match(/^\[(.*?)\]\s*([\s\S]*)$/);
                  const timestamp = match ? match[1] : null;
                  const content = match ? match[2] : chunk;

                  return (
                    <div key={idx} className="flex gap-2.5 items-start">
                      {/* Timeline dot */}
                      <div className="w-6 h-6 rounded-full bg-slate-100 border text-[10px] font-bold text-slate-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                        💬
                      </div>
                      <div className="flex-1 min-w-0 bg-slate-50 border border-slate-100 rounded-lg p-2.5">
                        {timestamp && (
                          <div className="text-[10px] text-slate-400 font-semibold mb-1">
                            {timestamp}
                          </div>
                        )}
                        <div className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">
                          {content}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-[11px] text-muted-foreground text-center py-2">
                No comments registered yet.
              </div>
            )}
          </div>
        </div>

        {/* Footer controls */}
        <div className="px-5 py-4 border-t border-border bg-slate-50 flex justify-between gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={() => setConfirmCancelOpen(true)}
            disabled={loading}
            className="px-3 py-1.5 border border-rose-200 text-rose-700 hover:bg-rose-50 text-xs font-semibold rounded-md flex items-center gap-1 bg-white"
          >
            <Trash className="size-3.5" /> Cancel Task
          </button>
          
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-3 py-1.5 border hover:bg-slate-100 text-xs font-semibold rounded-md bg-white"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={loading}
              className="btn-primary text-xs py-1.5 px-4 font-semibold rounded-md flex items-center gap-1"
            >
              {loading ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>
      
      <ConfirmDialog
        open={confirmCancelOpen}
        title="Cancel this task?"
        message="The task will be marked cancelled. This can't be undone from here."
        confirmLabel="Cancel task"
        cancelLabel="Keep task"
        tone="danger"
        busy={loading}
        onConfirm={doCancelTask}
        onCancel={() => setConfirmCancelOpen(false)}
      />

      {/* Slide-in styles keyframe */}
      <style jsx global>{`
        @keyframes slide-in {
          from {
            transform: translateX(100%);
          }
          to {
            transform: translateX(0);
          }
        }
        .animate-slide-in {
          animation: slide-in 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
    </>
  );
}
