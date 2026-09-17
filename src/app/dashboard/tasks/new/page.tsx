"use client";

/**
 * New Task form — Module 18 spec.
 *
 *   1. Title + description + remarks
 *   2. Related-entity pickers — Client (InvestorLookup), Lead, Service Request, Meeting
 *   3. Department, Type, Priority, Due date
 *   4. Assignee (defaults to creator on backend)
 *
 * The four related-entity pickers all populate the same task row; whichever
 * is set first also seeds the legacy subjectType/subjectId so existing
 * queries keep working.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronDown,
  SlidersHorizontal,
  ListChecks,
  Save,
  Loader2,
  X,
  Search,
  Sparkles,
  LifeBuoy,
  Calendar,
  LayoutTemplate,
  Plus,
  Bell,
  ShieldCheck,
  Timer,
  Tag as TagIcon,
} from "lucide-react";
import { InvestorLookup } from "@/components/common/InvestorLookup";
import { RmSelector } from "@/components/common/RmSelector";
import { SelectField } from "@/components/ui/SelectField";
import { DateField } from "@/components/ui/DateField";

type TaskTemplate = {
  id: string;
  name: string;
  description: string | null;
  taskType: string | null;
  department: string | null;
  priority: string | null;
  dueOffsetDays: number | null;
  subtasks: Array<{ id: string; text: string }>;
  isActive: boolean;
};

type ChecklistItem = { id: string; text: string; done: boolean };

/** Type values the form's Type <SelectField> knows natively. */
const KNOWN_TYPES = [
  "follow_up",
  "review_meeting",
  "collect_document",
  "kyc_renewal",
  "mandate_renewal",
];

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

export default function NewTaskPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "",
    description: "",
    type: "follow_up",
    customType: "", // name entered when type === "custom"
    priority: "normal",
    dueDate: defaultDueDate(3),
    department: "",
    assigneeId: "",
    remarks: "",
    requiresApproval: false,
    reminder: "none", // none | at_due | 1h | 3h | 1d | 2d | 1w  (relative to due)
    estimateMinutes: "", // planned effort (minutes)
    tags: [] as string[],
    recurrence: "", // "" = one-off
    recurrenceUntil: "",
    relatedInvestorId: "",
    relatedInvestorName: "",
    relatedLeadId: "",
    relatedLeadName: "",
    relatedServiceRequestId: "",
    relatedServiceRequestLabel: "",
    relatedMeetingId: "",
    relatedMeetingLabel: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState("");
  function addTag(raw: string) {
    const v = raw.trim().replace(/,$/, "").slice(0, 40);
    setForm((s) => (v && !s.tags.includes(v) ? { ...s, tags: [...s.tags, v] } : s));
    setTagInput("");
  }

  // ── Task templates ──
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [titleTouched, setTitleTouched] = useState(false);
  // "More options" is closed by default, but never hides something that is
  // already set — a template or an earlier edit that touched an advanced
  // field keeps the section open so the user can see what will be saved.
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/task-templates");
        if (!r.ok) return;
        const j = await r.json();
        setTemplates(Array.isArray(j.templates) ? j.templates : []);
      } catch {
        /* templates are optional — ignore */
      }
    })();
  }, []);

  function applyTemplate(id: string) {
    setTemplateId(id);
    if (!id) {
      // "— blank task —": drop template-derived sub-tasks; leave typed fields alone.
      setChecklist([]);
      if (!titleTouched) set("title", "");
      return;
    }
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setForm((s) => {
      const next = { ...s };
      if (!titleTouched || !s.title.trim()) next.title = t.name;
      if (t.description && !s.description.trim()) next.description = t.description;
      if (t.taskType) {
        if (KNOWN_TYPES.includes(t.taskType)) {
          next.type = t.taskType;
          next.customType = "";
        } else {
          next.type = "custom";
          next.customType = t.taskType;
        }
      }
      if (t.priority && ["low", "normal", "high", "urgent"].includes(t.priority))
        next.priority = t.priority;
      if (t.department && DEPARTMENTS.some(([k]) => k === t.department))
        next.department = t.department;
      if (t.dueOffsetDays != null) next.dueDate = defaultDueDate(t.dueOffsetDays);
      return next;
    });
    setChecklist(
      (t.subtasks ?? []).map((st) => ({
        id: st.id || crypto.randomUUID(),
        text: st.text,
        done: false,
      }))
    );
  }

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((s) => ({ ...s, [k]: v }));
  }

  async function save() {
    if (!form.title.trim()) {
      setErr("Title is required.");
      return;
    }
    if (form.type === "custom" && !form.customType.trim()) {
      setErr("Enter a name for the custom task type.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const payload: any = {
        title: form.title,
        description: form.description || undefined,
        type: form.type === "custom" ? form.customType.trim() : form.type,
        priority: form.priority,
        dueAt: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
        department: form.department || undefined,
        assigneeId: form.assigneeId || undefined,
        remarks: form.remarks || undefined,
        requiresApproval: form.requiresApproval || undefined,
        estimateMinutes: form.estimateMinutes ? Math.max(0, parseInt(form.estimateMinutes, 10) || 0) : undefined,
        tags: form.tags.length ? form.tags : undefined,
      };
      // Reminder — computed relative to the due date.
      if (form.reminder !== "none" && form.dueDate) {
        const offsetMin: Record<string, number> = { at_due: 0, "1h": 60, "3h": 180, "1d": 1440, "2d": 2880, "1w": 10080 };
        const base = new Date(form.dueDate).getTime();
        payload.remindAt = new Date(base - (offsetMin[form.reminder] ?? 0) * 60000).toISOString();
      }
      const cleanChecklist = checklist
        .map((c) => ({ id: c.id.slice(0, 64), text: c.text.trim(), done: false }))
        .filter((c) => c.text.length > 0);
      if (cleanChecklist.length > 0) payload.checklist = cleanChecklist;
      if (form.recurrence) {
        payload.recurrence = form.recurrence;
        if (form.recurrenceUntil) payload.recurrenceUntil = form.recurrenceUntil;
      }
      if (form.relatedInvestorId) payload.relatedInvestorId = form.relatedInvestorId;
      if (form.relatedLeadId) payload.relatedLeadId = form.relatedLeadId;
      if (form.relatedServiceRequestId)
        payload.relatedServiceRequestId = form.relatedServiceRequestId;
      if (form.relatedMeetingId) payload.relatedMeetingId = form.relatedMeetingId;

      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json();
      if (!res.ok) {
        setErr(j.error ?? `Save failed (${res.status})`);
        return;
      }
      router.push(`/dashboard/tasks`);
    } finally {
      setBusy(false);
    }
  }

  const advancedTouched =
    !!form.description.trim() ||
    !!form.department ||
    form.type !== "follow_up" ||
    form.reminder !== "none" ||
    form.requiresApproval ||
    !!form.estimateMinutes ||
    form.tags.length > 0 ||
    !!form.recurrence ||
    !!form.relatedLeadId ||
    !!form.relatedServiceRequestId ||
    !!form.relatedMeetingId ||
    checklist.length > 0;
  const showMore = moreOpen || advancedTouched;

  const DUE_CHIPS: [string, number][] = [
    ["Today", 0],
    ["Tomorrow", 1],
    ["3 days", 3],
    ["1 week", 7],
  ];
  const PRIORITIES: [string, string, string][] = [
    ["low", "Low", "data-[on=true]:bg-slate-600 data-[on=true]:text-white"],
    ["normal", "Normal", "data-[on=true]:bg-primary data-[on=true]:text-primary-foreground"],
    ["high", "High", "data-[on=true]:bg-amber-500 data-[on=true]:text-white"],
    ["urgent", "Urgent", "data-[on=true]:bg-rose-600 data-[on=true]:text-white"],
  ];

  return (
    <div
      className="space-y-4 max-w-3xl mx-auto"
      onKeyDown={(e) => {
        // Ctrl/Cmd+Enter saves from anywhere in the form.
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !busy && form.title.trim()) {
          e.preventDefault();
          void save();
        }
      }}
    >
      <Link
        href="/dashboard/tasks"
        className="text-sm text-muted-foreground hover:underline hover:text-foreground flex items-center gap-1"
      >
        <ChevronLeft className="size-4" /> Back to tasks
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">
          <ListChecks className="size-6 text-muted-foreground" /> New task
        </h1>
        {templates.length > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <LayoutTemplate className="size-3.5 text-brand-cyan" />
            <SelectField
              value={templateId}
              onChange={(e) => applyTemplate(e.target.value)}
              className="w-56"
            >
              <option value="">Start from a template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </SelectField>
          </label>
        )}
      </div>

      {/* ── The three facts that make a task: what, for whom, by when. ── */}
      <div className="card-surface p-5 space-y-4">
        <label className="block">
          <div className="text-xs font-medium mb-1">
            What needs doing <span className="text-rose-600">*</span>
          </div>
          <input
            value={form.title}
            autoFocus
            onChange={(e) => {
              setTitleTouched(true);
              set("title", e.target.value);
            }}
            placeholder="e.g. Call Ramesh about the SIP top-up"
            className="input-base text-base py-2.5"
          />
        </label>

        <div className="block">
          <div className="text-xs font-medium mb-1">
            For client <span className="ml-1 text-2xs text-muted-foreground font-normal">· optional</span>
          </div>
          <InvestorLookup
            value={form.relatedInvestorId || null}
            displayName={form.relatedInvestorName || null}
            onSelect={(id, name) =>
              setForm((s) => ({ ...s, relatedInvestorId: id, relatedInvestorName: name }))
            }
            onClear={() =>
              setForm((s) => ({ ...s, relatedInvestorId: "", relatedInvestorName: "" }))
            }
            placeholder="Search clients by name, PAN or phone…"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="block">
            <div className="text-xs font-medium mb-1">Due</div>
            <DateField
              value={form.dueDate}
              onChange={(e) => set("dueDate", e.target.value)}
              className="w-full"
            />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {DUE_CHIPS.map(([label, days]) => {
                const v = defaultDueDate(days);
                const on = form.dueDate === v;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => set("dueDate", v)}
                    className={`rounded-full border px-2 py-0.5 text-2xs transition ${
                      on ? "bg-brand-cyan-light/50 border-brand-cyan/40 text-brand-cyan-deep font-medium" : "bg-card hover:bg-secondary"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="block">
            <div className="text-xs font-medium mb-1">
              Assign to <span className="ml-1 text-2xs text-muted-foreground font-normal">· leave blank for yourself</span>
            </div>
            <RmSelector
              value={form.assigneeId || null}
              onChange={(id) => set("assigneeId", id ?? "")}
              placeholder="Me"
            />
          </label>
        </div>

        <div className="block">
          <div className="text-xs font-medium mb-1">Priority</div>
          <div className="inline-flex rounded-lg border border-border bg-card p-0.5 gap-0.5" role="radiogroup" aria-label="Priority">
            {PRIORITIES.map(([value, label, onCls]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={form.priority === value}
                data-on={form.priority === value}
                onClick={() => set("priority", value)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition hover:bg-secondary ${onCls}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Everything else, behind one disclosure. ── */}
      <div className="card-surface">
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={showMore}
          className="w-full flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-secondary/40 rounded-lg"
        >
          <span className="flex items-center gap-2 font-medium">
            <SlidersHorizontal className="size-4 text-brand-cyan" /> More options
            <span className="text-2xs text-muted-foreground font-normal">
              · description, type, reminder, repeat, links, sub-tasks
            </span>
          </span>
          <ChevronDown className={`size-4 text-muted-foreground transition-transform ${showMore ? "rotate-180" : ""}`} />
        </button>

        {showMore && (
          <div className="px-5 pb-5 space-y-5 border-t border-border pt-4">
            <label className="block">
              <div className="text-xs font-medium mb-1">Description</div>
              <textarea
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                rows={3}
                placeholder="Context, what good looks like, links…"
                className="input-base"
              />
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <div className="text-xs font-medium mb-1">Type</div>
                <SelectField
                  value={form.type}
                  onChange={(e) => set("type", e.target.value)}
                  className="w-full"
                >
                  <option value="follow_up">Follow-up</option>
                  <option value="review_meeting">Review meeting</option>
                  <option value="collect_document">Collect document</option>
                  <option value="kyc_renewal">KYC renewal</option>
                  <option value="mandate_renewal">Mandate renewal</option>
                  <option value="custom">Custom…</option>
                </SelectField>
                {form.type === "custom" && (
                  <input
                    value={form.customType}
                    onChange={(e) => set("customType", e.target.value)}
                    placeholder="Custom type name (e.g. Portfolio rebalance)"
                    autoFocus
                    className="mt-2 input-base"
                  />
                )}
              </label>
              <label className="block">
                <div className="text-xs font-medium mb-1">Department</div>
                <SelectField
                  value={form.department}
                  onChange={(e) => set("department", e.target.value)}
                  className="w-full"
                >
                  <option value="">Not set</option>
                  {DEPARTMENTS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </SelectField>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block">
                <div className="text-xs font-medium mb-1 flex items-center gap-1">
                  <Bell className="size-3.5 text-brand-cyan" /> Reminder
                </div>
                <SelectField
                  value={form.reminder}
                  onChange={(e) => set("reminder", e.target.value)}
                  className="w-full"
                  disabled={!form.dueDate}
                >
                  <option value="none">None</option>
                  <option value="at_due">At due time</option>
                  <option value="1h">1 hour before</option>
                  <option value="3h">3 hours before</option>
                  <option value="1d">1 day before</option>
                  <option value="2d">2 days before</option>
                  <option value="1w">1 week before</option>
                </SelectField>
              </label>
              <label className="block">
                <div className="text-xs font-medium mb-1 flex items-center gap-1">
                  <Timer className="size-3.5 text-brand-cyan" /> Estimate <span className="text-2xs text-muted-foreground font-normal">· minutes</span>
                </div>
                <input
                  type="number"
                  min={0}
                  value={form.estimateMinutes}
                  onChange={(e) => set("estimateMinutes", e.target.value)}
                  placeholder="e.g. 30"
                  className="input-base"
                />
              </label>
              <label className="flex items-start gap-2 sm:pt-6 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.requiresApproval}
                  onChange={(e) => set("requiresApproval", e.target.checked)}
                  className="size-3.5 rounded mt-0.5"
                />
                <span className="text-xs">
                  <span className="font-medium flex items-center gap-1"><ShieldCheck className="size-3.5 text-brand-cyan" /> Needs my approval</span>
                  <span className="block text-2xs text-muted-foreground mt-0.5">
                    Assignee submits for sign-off instead of closing it.
                  </span>
                </span>
              </label>
            </div>

            <div className="block">
              <div className="text-xs font-medium mb-1 flex items-center gap-1">
                <TagIcon className="size-3.5 text-brand-cyan" /> Tags
              </div>
              <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-1.5 min-h-[38px]">
                {form.tags.map((tg) => (
                  <span key={tg} className="chip text-2xs bg-slate-100 text-slate-600 border border-slate-200 inline-flex items-center gap-1">
                    {tg}
                    <button type="button" onClick={() => set("tags", form.tags.filter((x) => x !== tg))} className="hover:text-rose-600" aria-label={`Remove ${tg}`}>
                      <X className="size-2.5" />
                    </button>
                  </span>
                ))}
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(tagInput); } }}
                  onBlur={() => tagInput.trim() && addTag(tagInput)}
                  placeholder="Add tag…"
                  className="flex-1 min-w-[80px] bg-transparent text-xs focus:outline-none"
                />
              </div>
            </div>

            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.recurrence}
                  onChange={(e) => set("recurrence", e.target.checked ? "monthly" : "")}
                  className="size-3.5 rounded"
                />
                <span className="text-xs font-medium">Repeat this task</span>
                <span className="text-2xs text-muted-foreground">· the next one is created when this is completed</span>
              </label>
              {form.recurrence && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <label className="block">
                    <div className="text-xs font-medium mb-1">Every</div>
                    <SelectField
                      value={form.recurrence}
                      onChange={(e) => set("recurrence", e.target.value)}
                      className="w-full"
                    >
                      <option value="daily">Day</option>
                      <option value="weekly">Week</option>
                      <option value="monthly">Month</option>
                      <option value="quarterly">Quarter</option>
                      <option value="yearly">Year</option>
                    </SelectField>
                  </label>
                  <label className="block">
                    <div className="text-xs font-medium mb-1">Until <span className="text-2xs text-muted-foreground font-normal">· optional</span></div>
                    <DateField
                      value={form.recurrenceUntil}
                      onChange={(e) => set("recurrenceUntil", e.target.value)}
                      className="w-full"
                    />
                  </label>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="text-xs font-medium">Also link to</div>
              <RelatedSearch
                label="Lead"
                icon={Sparkles}
                placeholder="Search leads by name…"
                pickedId={form.relatedLeadId}
                pickedLabel={form.relatedLeadName}
                searchFn={async (q) => {
                  const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
                  const j = await r.json();
                  return (j.leads ?? []).map((l: any) => ({
                    id: l.id,
                    label: l.name,
                    sub: `${l.stage ?? "—"} · ${l.source ?? "—"}`,
                  }));
                }}
                onPick={(id, label) =>
                  setForm((s) => ({ ...s, relatedLeadId: id, relatedLeadName: label }))
                }
                onClear={() => setForm((s) => ({ ...s, relatedLeadId: "", relatedLeadName: "" }))}
              />
              <RelatedSearch
                label="Service request"
                icon={LifeBuoy}
                placeholder="Search SR by ticket no. or subject…"
                pickedId={form.relatedServiceRequestId}
                pickedLabel={form.relatedServiceRequestLabel}
                searchFn={async (q) => {
                  const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
                  const j = await r.json();
                  return (j.serviceRequests ?? []).map((sr: any) => ({
                    id: sr.id,
                    label: sr.ticket_no ?? sr.id,
                    sub: `${sr.subject ?? "—"} · ${sr.status ?? "—"}`,
                  }));
                }}
                onPick={(id, label) =>
                  setForm((s) => ({
                    ...s,
                    relatedServiceRequestId: id,
                    relatedServiceRequestLabel: label,
                  }))
                }
                onClear={() =>
                  setForm((s) => ({
                    ...s,
                    relatedServiceRequestId: "",
                    relatedServiceRequestLabel: "",
                  }))
                }
              />
              <MeetingPicker
                pickedId={form.relatedMeetingId}
                pickedLabel={form.relatedMeetingLabel}
                onPick={(id, label) =>
                  setForm((s) => ({ ...s, relatedMeetingId: id, relatedMeetingLabel: label }))
                }
                onClear={() =>
                  setForm((s) => ({ ...s, relatedMeetingId: "", relatedMeetingLabel: "" }))
                }
              />
            </div>

            {checklist.length > 0 ? (
              <div className="rounded-lg border border-border bg-secondary/30 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <ListChecks className="size-3.5 text-brand-cyan" />
                  <span className="text-xs font-medium">Sub-tasks</span>
                  <span className="inline-flex items-center rounded-full bg-brand-cyan-light/60 text-brand-cyan-deep text-2xs font-medium px-2 py-0.5">
                    {checklist.length}
                  </span>
                </div>
                {checklist.map((c, i) => (
                  <div key={c.id} className="flex items-center gap-2">
                    <input
                      value={c.text}
                      onChange={(e) =>
                        setChecklist((list) =>
                          list.map((x, j) => (j === i ? { ...x, text: e.target.value } : x))
                        )
                      }
                      placeholder="Sub-task…"
                      className="input-base flex-1"
                    />
                    <button
                      type="button"
                      onClick={() => setChecklist((list) => list.filter((_, j) => j !== i))}
                      className="btn-icon"
                      title="Remove sub-task"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setChecklist((list) => [
                      ...list,
                      { id: crypto.randomUUID(), text: "", done: false },
                    ])
                  }
                  className="btn-secondary text-xs"
                >
                  <Plus className="size-3.5" /> Add sub-task
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() =>
                  setChecklist([{ id: crypto.randomUUID(), text: "", done: false }])
                }
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
              >
                <Plus className="size-3.5" /> Add sub-tasks
              </button>
            )}
          </div>
        )}
      </div>

      {err && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 text-destructive text-sm px-3 py-2">
          {err}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-2xs text-muted-foreground hidden sm:inline">Ctrl + Enter to save</span>
        <div className="flex gap-2 ml-auto">
          <Link href="/dashboard/tasks" className="btn-secondary">
            Cancel
          </Link>
          <button
            type="button"
            onClick={save}
            disabled={busy || !form.title.trim()}
            className="btn-primary"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {busy ? "Saving…" : "Create task"}
          </button>
        </div>
      </div>
    </div>
  );
}

function defaultDueDate(daysOut: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysOut);
  return d.toISOString().slice(0, 10);
}

/* ─────────────── Generic search-then-pick row ─────────────── */

function RelatedSearch({
  label,
  icon: Icon,
  placeholder,
  pickedId,
  pickedLabel,
  searchFn,
  onPick,
  onClear,
}: {
  label: string;
  icon: any;
  placeholder: string;
  pickedId: string;
  pickedLabel: string;
  searchFn: (q: string) => Promise<Array<{ id: string; label: string; sub?: string }>>;
  onPick: (id: string, label: string) => void;
  onClear: () => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Array<{ id: string; label: string; sub?: string }>>([]);

  useEffect(() => {
    if (pickedId || q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(async () => setResults(await searchFn(q)), 220);
    return () => clearTimeout(t);
  }, [q, pickedId, searchFn]);

  if (pickedId) {
    return (
      <div>
        <div className="text-xs font-medium mb-1">{label}</div>
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 rounded-lg border border-brand-cyan/40 bg-brand-cyan-light/40 px-3 py-2">
            <Icon className="size-3.5 text-brand-cyan-deep flex-shrink-0" />
            <span className="font-medium text-sm truncate">{pickedLabel}</span>
          </div>
          <button type="button" onClick={onClear} className="btn-icon" title="Clear">
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-xs font-medium mb-1">{label}</div>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="input-base pl-9"
        />
        {results.length > 0 && (
          <div className="absolute left-0 right-0 mt-1 z-30 card-elevated max-h-56 overflow-y-auto scrollbar-thin">
            <ul className="py-1">
              {results.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onPick(r.id, r.label);
                      setQ("");
                      setResults([]);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-brand-cyan-light/40"
                  >
                    <div className="font-semibold text-sm truncate">{r.label}</div>
                    {r.sub && (
                      <div className="text-2xs text-muted-foreground truncate">{r.sub}</div>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────── Meeting picker (loads recent meetings) ─────────────── */

function MeetingPicker({
  pickedId,
  pickedLabel,
  onPick,
  onClear,
}: {
  pickedId: string;
  pickedLabel: string;
  onPick: (id: string, label: string) => void;
  onClear: () => void;
}) {
  const [meetings, setMeetings] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/review-meetings");
        const j = await r.json();
        setMeetings(j.meetings ?? []);
      } catch {
        setMeetings([]);
      }
    })();
  }, []);

  if (pickedId) {
    return (
      <div>
        <div className="text-xs font-medium mb-1">Related meeting</div>
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 rounded-lg border border-brand-cyan/40 bg-brand-cyan-light/40 px-3 py-2">
            <Calendar className="size-3.5 text-brand-cyan-deep flex-shrink-0" />
            <span className="font-medium text-sm truncate">{pickedLabel}</span>
          </div>
          <button type="button" onClick={onClear} className="btn-icon" title="Clear">
            <X className="size-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <label className="block">
      <div className="text-xs font-medium mb-1">Related meeting</div>
      <SelectField
        value=""
        placeholder="Pick a recent meeting (optional)"
        onChange={(e) => {
          const id = e.target.value;
          if (!id) return;
          const m = meetings.find((x) => x.id === id);
          if (!m) return;
          const date = new Date(m.meeting_date).toLocaleString("en-IN", {
            day: "numeric",
            month: "short",
          });
          onPick(
            id,
            `${date} · ${m.investor_name ?? "—"} · ${String(m.category ?? "review").replace(
              /_/g,
              " "
            )}`
          );
        }}
        className="w-full"
      >
        <option value="">Pick a recent meeting (optional)</option>
        {meetings.slice(0, 50).map((m) => {
          const date = new Date(m.meeting_date).toLocaleString("en-IN", {
            day: "numeric",
            month: "short",
          });
          return (
            <option key={m.id} value={m.id}>
              {date} — {m.investor_name ?? "—"}
              {m.category ? ` · ${String(m.category).replace(/_/g, " ")}` : ""}
            </option>
          );
        })}
      </SelectField>
    </label>
  );
}
