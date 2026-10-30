"use client";

import { PageHeaderCard } from "@/components/layout/PageHeaderCard";
/**
 * New Task form — Module 18 spec.
 *
 *   1. Title + description + remarks
 *   2. Related-entity pickers — Client (InvestorLookup), Lead, Meeting
 *   3. Type, Priority, Due date (department comes from the assignee, server-side)
 *   4. Assignee (defaults to creator on backend)
 *
 * The related-entity pickers all populate the same task row; whichever
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
  Calendar,
  LayoutTemplate,
  Plus,
  Bell,
  ShieldCheck,
} from "lucide-react";
import { InvestorLookup } from "@/components/common/InvestorLookup";
import { EMPTY_REQUEST, KYC_MODES, RequestPicker, emptyRow, num, type RequestValues } from "@/components/tasks/RequestPicker";
import { REQUEST_TYPE_BY_KEY, categoryOfType, type TaskCategory } from "@/lib/tasks/request-types";
import { notify } from "@/components/ui/Toast";
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

/** A sub-task: optionally delegated to a teammate with its own due date
 *  (TaskChecklistItem.assigneeId / actionDate — the task drawer shows both). */
type ChecklistItem = { id: string; text: string; done: boolean; assigneeId?: string | null; actionDate?: string };

/** General types the form's Type <SelectField> knows natively. Financial and
 *  non-financial requests are picked through RequestPicker instead. */
const KNOWN_TYPES = ["follow_up"];

export default function NewTaskPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    title: "",
    description: "",
    type: "follow_up",
    customType: "", // name entered when type === "custom"
    priority: "normal",
    entryDate: todayLocal(), // today; the person may change it
    dueDate: defaultDueDate(3),
    assigneeId: "",
    remarks: "",
    requiresApproval: false,
    reminder: "none", // none | at_due | 1h | 3h | 1d | 2d | 1w  (relative to due)
    recurrence: "", // "" = one-off
    recurrenceUntil: "",
    relatedInvestorId: "",
    relatedInvestorName: "",
    relatedLeadId: "",
    relatedLeadName: "",
    relatedMeetingId: "",
    relatedMeetingLabel: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ── Financial / non-financial request ──
  // The category picks the list; the request picks the fields, the starting
  // checklist and the stored task type (lib/tasks/request-types).
  const [category, setCategory] = useState<TaskCategory>("general");
  const [requestKey, setRequestKey] = useState("");
  const [requestValues, setRequestValues] = useState<RequestValues>(EMPTY_REQUEST);
  /** The checklist a request put in, so switching request replaces it — but
   *  never a checklist the user typed or a template brought. */
  const [autoChecklistKey, setAutoChecklistKey] = useState<string | null>(null);

  // ── Task templates ──
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  // Known once the fetch settles, so "no templates yet" never flashes first.
  const [templatesLoaded, setTemplatesLoaded] = useState(false);
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
      } finally {
        setTemplatesLoaded(true);
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
    // A template whose type is a financial / non-financial request opens that
    // request in the picker (an old bare "financial" opens the category only).
    const tplCategory = categoryOfType(t.taskType);
    if (t.taskType && tplCategory !== "general") {
      setCategory(tplCategory);
      setRequestKey(REQUEST_TYPE_BY_KEY[t.taskType] ? t.taskType : "");
    }
    setAutoChecklistKey(null); // the template's own sub-tasks win
    setForm((s) => {
      const next = { ...s };
      if (!titleTouched || !s.title.trim()) next.title = t.name;
      if (t.description && !s.description.trim()) next.description = t.description;
      if (t.taskType) {
        if (tplCategory !== "general") {
          next.type = REQUEST_TYPE_BY_KEY[t.taskType] ? t.taskType : "follow_up";
          next.customType = "";
        } else if (KNOWN_TYPES.includes(t.taskType)) {
          next.type = t.taskType;
          next.customType = "";
        } else {
          next.type = "custom";
          next.customType = t.taskType;
        }
      }
      if (t.priority && ["low", "normal", "high", "urgent"].includes(t.priority))
        next.priority = t.priority;
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

  /** The title a request suggests — "Redemption — Rajesh Patel". A KYC names
   *  the KYC the client will do: "Online KYC — Rajesh Patel". */
  const autoTitle = (key: string, client: string, kycMode: RequestValues["kycMode"] = requestValues.kycMode) => {
    const r = REQUEST_TYPE_BY_KEY[key];
    if (!r) return "";
    const label = key === "kyc_renewal" && kycMode ? KYC_MODES.find((m) => m.key === kycMode)?.label ?? r.label : r.label;
    return client ? `${label} — ${client}` : label;
  };
  /** Still the suggested title (or empty) — so a request change may replace it.
   *  A title the user typed, or a template's, is never overwritten. */
  const titleIsAuto = (title: string, key: string, client: string, kycMode: RequestValues["kycMode"] = requestValues.kycMode) =>
    !titleTouched && (!title.trim() || title === autoTitle(key, client, kycMode));

  function changeCategory(c: TaskCategory) {
    if (c === category) return;
    setCategory(c);
    setRequestKey("");
    setRequestValues(EMPTY_REQUEST);
    if (autoChecklistKey) {
      setChecklist([]);
      setAutoChecklistKey(null);
    }
    setForm((s) => ({
      ...s,
      type: "follow_up",
      customType: "",
      title: titleIsAuto(s.title, requestKey, s.relatedInvestorName) ? "" : s.title,
    }));
  }

  function changeRequest(key: string) {
    const prev = requestKey;
    setRequestKey(key);
    const r = REQUEST_TYPE_BY_KEY[key];
    const prevMode = requestValues.kycMode;
    // A request with scheme rows starts with one row; one without has none. The
    // KYC choice belongs to the KYC request only.
    setRequestValues((v) => ({
      ...v,
      kycMode: "",
      rows: r?.rowFields.length ? (v.rows.length ? v.rows : [emptyRow()]) : [],
    }));
    setForm((s) => ({
      ...s,
      type: key || "follow_up",
      customType: "",
      title: titleIsAuto(s.title, prev, s.relatedInvestorName, prevMode) ? autoTitle(key, s.relatedInvestorName, "") : s.title,
    }));
    // The request's checklist fills an empty list, or replaces the one the
    // previous request put in — never one the user or a template wrote.
    if (checklist.length === 0 || autoChecklistKey) {
      if (r?.checklist.length) {
        setChecklist(r.checklist.map((text) => ({ id: crypto.randomUUID(), text, done: false })));
        setAutoChecklistKey(key);
      } else {
        setChecklist([]);
        setAutoChecklistKey(null);
      }
    }
  }

  /** Online or Physical KYC: recorded on the task, and named in an untouched title. */
  function changeKycMode(mode: "online" | "physical") {
    const prevMode = requestValues.kycMode;
    setRequestValues((v) => ({ ...v, kycMode: mode }));
    setForm((s) => ({
      ...s,
      title: titleIsAuto(s.title, requestKey, s.relatedInvestorName, prevMode) ? autoTitle(requestKey, s.relatedInvestorName, mode) : s.title,
    }));
  }

  function pickClient(id: string, name: string) {
    setForm((s) => ({
      ...s,
      relatedInvestorId: id,
      relatedInvestorName: name,
      title: requestKey && titleIsAuto(s.title, requestKey, s.relatedInvestorName) ? autoTitle(requestKey, name) : s.title,
    }));
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
    const req = requestKey ? REQUEST_TYPE_BY_KEY[requestKey] : undefined;
    if (category !== "general") {
      if (!req) {
        setErr(`Pick the ${category === "financial" ? "financial" : "non-financial"} request.`);
        return;
      }
      if (!form.relatedInvestorId) {
        setErr("Pick the client this request is for.");
        return;
      }
    }
    if (requestKey === "kyc_renewal" && !requestValues.kycMode) {
      setErr("Choose Online KYC or Physical KYC.");
      return;
    }
    const amount = num(requestValues.amount);
    if (req?.fields.includes("amount") && requestValues.amount.trim() && amount == null) {
      setErr("Enter the amount as a number, e.g. 500000.");
      return;
    }
    // Scheme rows: every row needs its scheme (a blank last row is dropped),
    // and amounts / units must be numbers.
    const rows = req?.rowFields.length
      ? requestValues.rows.filter((r, i, all) => r.schemeName.trim() || r.amount.trim() || i < all.length - 1)
      : [];
    if (req?.rowFields.length) {
      if (rows.length === 0) {
        setErr("Add at least one scheme.");
        return;
      }
      for (const [i, r] of rows.entries()) {
        if (!r.schemeName.trim()) {
          setErr(`Scheme ${i + 1}: pick the scheme.`);
          return;
        }
        if (req.rowFields.includes("fromScheme") && !r.fromSchemeName.trim()) {
          setErr(`Scheme ${i + 1}: pick the scheme it moves from.`);
          return;
        }
        if ((r.amount.trim() && num(r.amount) == null) || (r.units.trim() && !r.allUnits && num(r.units) == null)) {
          setErr(`Scheme ${i + 1}: enter amounts and units as numbers.`);
          return;
        }
      }
    }
    setBusy(true);
    setErr(null);
    try {
      const payload: any = {
        title: form.title,
        description: form.description || undefined,
        type: form.type === "custom" ? form.customType.trim() : form.type,
        priority: form.priority,
        entryDate: form.entryDate || undefined,
        dueAt: form.dueDate ? new Date(form.dueDate).toISOString() : undefined,
        assigneeId: form.assigneeId || undefined,
        remarks: form.remarks || undefined,
        requiresApproval: form.requiresApproval || undefined,
      };
      // Reminder — computed relative to the due date.
      if (form.reminder !== "none" && form.dueDate) {
        const offsetMin: Record<string, number> = { at_due: 0, "1h": 60, "3h": 180, "1d": 1440, "2d": 2880, "1w": 10080 };
        const base = new Date(form.dueDate).getTime();
        payload.remindAt = new Date(base - (offsetMin[form.reminder] ?? 0) * 60000).toISOString();
      }
      const cleanChecklist = checklist
        .map((c) => ({
          id: c.id.slice(0, 64), text: c.text.trim(), done: false,
          ...(c.assigneeId ? { assigneeId: c.assigneeId } : {}),
          ...(c.actionDate ? { actionDate: c.actionDate } : {}),
        }))
        .filter((c) => c.text.length > 0);
      if (cleanChecklist.length > 0) payload.checklist = cleanChecklist;
      // The template applied — recorded on the task (meta.templateId) so the
      // template's SOPs show in the task's "How we do this".
      if (templateId) payload.templateId = templateId;
      if (form.recurrence) {
        payload.recurrence = form.recurrence;
        if (form.recurrenceUntil) payload.recurrenceUntil = form.recurrenceUntil;
      }
      // A request's details: the total amount and mode where the Operations
      // Dashboard already reads them (boValue / boChannel), the scheme rows and
      // folio in meta.request. The API also books the Business entry.
      if (req) {
        const hasF = (f: string) => req.fields.includes(f as any);
        const hasR = (f: string) => req.rowFields.includes(f as any);
        const rowTotal = rows.reduce((t, r) => t + (num(r.amount) ?? 0), 0);
        if (hasF("amount") && amount != null) payload.boValue = amount;
        else if (rowTotal > 0) payload.boValue = rowTotal;
        if (hasF("mode") && requestValues.mode) payload.boChannel = requestValues.mode;
        payload.request = {
          ...(req.key === "kyc_renewal" && requestValues.kycMode ? { kycMode: requestValues.kycMode } : {}),
          ...(hasF("folio") && requestValues.folio.trim() ? { folio: requestValues.folio.trim() } : {}),
          ...(rows.length
            ? {
                rows: rows.map((r) => ({
                  schemeName: r.schemeName.trim(),
                  ...(r.schemeCode ? { schemeCode: r.schemeCode } : {}),
                  ...(r.amcName ? { amcName: r.amcName } : {}),
                  ...(r.assetCategory ? { assetCategory: r.assetCategory } : {}),
                  ...(hasR("fromScheme") ? { fromSchemeName: r.fromSchemeName.trim(), ...(r.fromSchemeCode ? { fromSchemeCode: r.fromSchemeCode } : {}) } : {}),
                  ...(hasR("amount") && num(r.amount) != null ? { amount: num(r.amount)! } : {}),
                  ...(hasR("units") && r.allUnits ? { allUnits: true } : {}),
                  ...(hasR("units") && !r.allUnits && num(r.units) != null ? { units: num(r.units)! } : {}),
                  ...(hasR("folio") && r.folio.trim() ? { folio: r.folio.trim() } : {}),
                  ...(hasR("sipDay") && r.sipDay ? { sipDay: r.sipDay } : {}),
                  ...(hasR("frequency") && r.frequency ? { frequency: r.frequency } : {}),
                })),
              }
            : {}),
        };
      }
      if (form.relatedInvestorId) payload.relatedInvestorId = form.relatedInvestorId;
      if (form.relatedLeadId) payload.relatedLeadId = form.relatedLeadId;
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
      // Say what happened to the Business entry a financial request books.
      if (j.businessEntryId) {
        notify.success("Booked in Business entries as a draft — it is confirmed when the task is completed.", "Task created");
      } else if (j.businessNotBooked === "not_allowed") {
        notify.warning("Task created, but your role cannot book Business entries — ask Operations to add it.", "Not booked");
      }
      router.push(`/dashboard/tasks`);
    } finally {
      setBusy(false);
    }
  }

  const advancedTouched =
    !!form.description.trim() ||
    (category === "general" && form.type !== "follow_up") ||
    form.reminder !== "none" ||
    form.requiresApproval ||
    !!form.recurrence ||
    !!form.relatedLeadId ||
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

      <PageHeaderCard title={<><ListChecks className="size-6 text-muted-foreground" /> New task</>} />

      {/* Templates up front, as one-click chips: a template fills the title,
          type, priority, due date and checklist. The picker used to be a small
          dropdown that rendered nothing at all for a firm with no templates,
          so nobody learned the feature existed. */}
      {templatesLoaded &&
        (templates.length > 0 ? (
          <div className="card-surface p-3 flex flex-wrap items-center gap-2" role="group" aria-label="Start from a template">
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <LayoutTemplate className="size-3.5" /> Start from a template
            </span>
            {templates.slice(0, 8).map((t) => {
              const on = templateId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => applyTemplate(on ? "" : t.id)}
                  className={`inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors ${
                    on ? "border-primary/30 bg-primary/10 text-primary" : "border-border bg-card text-foreground/80 hover:bg-secondary"
                  }`}
                >
                  {t.name}
                </button>
              );
            })}
            {templates.length > 8 && (
              <SelectField
                value={templates.slice(8).some((t) => t.id === templateId) ? templateId : ""}
                onChange={(e) => applyTemplate(e.target.value)}
                size="sm"
                className="w-48"
                aria-label="More templates"
              >
                <option value="">More templates…</option>
                {templates.slice(8).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </SelectField>
            )}
          </div>
        ) : (
          <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <LayoutTemplate className="size-3.5" /> No task templates yet.
            <Link href="/dashboard/settings/task-templates" className="text-brand-cyan-deep hover:underline">
              Set them up in Settings → Task templates
            </Link>
            to start common tasks in one click.
          </p>
        ))}

      {/* ── The three facts that make a task: what, for whom, by when. ── */}
      <div className="card-surface p-5 space-y-4">
        <div className="block">
          <div className="text-xs font-medium mb-1">
            For client{" "}
            {category === "general" ? (
              <span className="ml-1 text-2xs text-muted-foreground font-normal">· optional</span>
            ) : (
              <span className="text-rose-600">*</span>
            )}
          </div>
          <InvestorLookup
            value={form.relatedInvestorId || null}
            displayName={form.relatedInvestorName || null}
            onSelect={pickClient}
            onClear={() => pickClient("", "")}
            placeholder="Search clients by name, PAN or phone…"
          />
        </div>

        <label className="block">
          <div className="text-xs font-medium mb-1">
            What needs doing <span className="text-rose-600">*</span>
          </div>
          <input
            value={form.title}
            onChange={(e) => {
              setTitleTouched(true);
              set("title", e.target.value);
            }}
            placeholder="e.g. Call Ramesh about the SIP top-up"
            className="input-base text-base py-2.5"
          />
        </label>

        <RequestPicker
          category={category}
          requestKey={requestKey}
          values={requestValues}
          onCategory={changeCategory}
          onRequest={changeRequest}
          onKycMode={changeKycMode}
          onValues={setRequestValues}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="block">
            <div className="text-xs font-medium mb-1">Entry date</div>
            <DateField
              value={form.entryDate}
              onChange={(e) => set("entryDate", e.target.value)}
              className="w-full"
            />
            <div className="mt-1.5 text-2xs text-muted-foreground">The day this task was entered. Today unless you change it.</div>
          </div>

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

            {/* General tasks only — financial and non-financial requests are
                chosen at the top of the form, where they bring their own fields. */}
            {category === "general" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <div className="text-xs font-medium mb-1">Kind of general task</div>
                <SelectField
                  value={form.type}
                  onChange={(e) => set("type", e.target.value)}
                  className="w-full"
                >
                  <option value="follow_up">Follow-up</option>
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
            </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                  <div key={c.id} className="flex flex-wrap items-center gap-2 xl:flex-nowrap">
                    <input
                      value={c.text}
                      onChange={(e) =>
                        setChecklist((list) =>
                          list.map((x, j) => (j === i ? { ...x, text: e.target.value } : x))
                        )
                      }
                      placeholder="Sub-task…"
                      aria-label={`Sub-task ${i + 1}`}
                      className="input-base min-w-0 w-full xl:w-auto xl:flex-1"
                    />
                    <RmSelector
                      value={c.assigneeId ?? null}
                      onChange={(v) =>
                        setChecklist((list) => list.map((x, j) => (j === i ? { ...x, assigneeId: v } : x)))
                      }
                      placeholder="Assign to…"
                      className="min-w-0 flex-1 xl:w-48 xl:flex-none"
                    />
                    <DateField
                      value={c.actionDate ?? ""}
                      onChange={(e) =>
                        setChecklist((list) => list.map((x, j) => (j === i ? { ...x, actionDate: e.target.value } : x)))
                      }
                      aria-label={`Sub-task ${i + 1} due date`}
                      placeholder="Due date"
                      className="w-40 shrink-0"
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

/** Today on the person's own clock (toISOString is UTC, which is yesterday before 5:30 am in India). */
function todayLocal() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
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
