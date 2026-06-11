"use client";

/**
 * Zoho-CRM-style 4-step rule builder.
 *
 *   1. Basic info — module + name + description
 *   2. Trigger    — Record Action / Date Field / Score / Recurring / Note
 *   3. Criteria   — pattern editor with field/operator/value rows
 *   4. Actions    — Instant + Scheduled (with delay)
 *
 * Mirrors https://help.zoho.com/portal/en/kb/crm/automate-business-processes/workflows
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, Trash2, Save, AlertTriangle, Sparkles } from "lucide-react";

type ModuleField = {
  key: string;
  label: string;
  type: string;
  writable: boolean;
  dateAnchor: boolean;
  scoreField: boolean;
  enumValues: string[] | null;
};
type Module = { key: string; label: string; fields: ModuleField[] };

type Trigger =
  | { kind: "record_action"; when: "create" | "edit" | "create_or_edit" | "delete" | "field_update"; fields: string[]; repeat: boolean }
  | { kind: "date_field"; field: string; when: "before" | "on" | "after"; offset: number; unit: "day" | "week" | "month"; recurrence: "once" | "every_month" | "every_year"; time: string }
  | { kind: "score_change"; field: string; direction: "increase" | "decrease" | "updated"; threshold?: number }
  | { kind: "recurrence"; cron: string }
  | { kind: "note"; when: "added" | "modified" | "deleted" | "added_or_modified" };

type CriteriaRow = { field: string; operator: string; value: any };

type Action = { type: string; label?: string; config: Record<string, any> };
type ScheduledAction = Action & { delay: { amount: number; unit: "minute" | "hour" | "day" | "week"; anchor: "trigger" | "date_field"; anchorField?: string } };

/** Extra condition set beyond the main criteria (Zoho: ≤10 per rule). The main
 *  Conditions/Actions steps act as Branch 1; a record falls into the FIRST
 *  branch (top-down) whose conditions match. */
type Branch = {
  name: string;
  criteriaPattern: string;
  criteriaRows: CriteriaRow[];
  instantActions: Action[];
  scheduledActions: ScheduledAction[];
};

const ACTION_TYPES: Array<{ key: string; label: string; description: string; instantOnly?: boolean }> = [
  { key: "send_email", label: "Email Notification", description: "Send a templated email to the subject or recipient list." },
  { key: "send_whatsapp", label: "WhatsApp Message", description: "Send a Meta-approved WhatsApp template." },
  { key: "send_sms", label: "SMS Message", description: "Send a DLT-compliant SMS." },
  { key: "create_task", label: "Task", description: "Create a task assigned to the RM, owner, or a specific user." },
  { key: "schedule_meeting", label: "Meeting", description: "Schedule a review/follow-up meeting." },
  { key: "schedule_call", label: "Call", description: "Schedule a call (creates a task with type=call)." },
  { key: "update_field", label: "Field Update", description: "Update one or more writable fields on the record." },
  { key: "add_tag", label: "Add Tag", description: "Append a tag to the record." },
  { key: "remove_tag", label: "Remove Tag", description: "Remove a tag from the record." },
  { key: "webhook", label: "Webhook", description: "POST the record payload to an external URL." },
  // custom_function + create_record are intentionally absent — the backend
  // rejects them as unimplemented stubs (see lib/workflow-rules/guard.ts), so
  // offering them here would only produce a save-time error.
  { key: "convert_lead", label: "Convert Lead", description: "Convert a lead into an investor.", instantOnly: true },
  { key: "create_notification", label: "In-app Notification", description: "Send an in-app bell notification." },
];

const OPERATORS: Array<{ key: string; label: string; types: string[] }> = [
  { key: "is", label: "is", types: ["string", "enum", "boolean", "uuid", "integer", "number", "currency"] },
  { key: "is_not", label: "is not", types: ["string", "enum", "boolean", "uuid", "integer", "number", "currency"] },
  { key: "contains", label: "contains", types: ["string", "text", "email", "phone"] },
  { key: "starts_with", label: "starts with", types: ["string", "text", "email", "phone"] },
  { key: "ends_with", label: "ends with", types: ["string", "text", "email", "phone"] },
  { key: "is_empty", label: "is empty", types: ["*"] },
  { key: "is_not_empty", label: "is not empty", types: ["*"] },
  { key: "greater_than", label: ">", types: ["integer", "number", "currency", "date", "datetime"] },
  { key: "less_than", label: "<", types: ["integer", "number", "currency", "date", "datetime"] },
  { key: "greater_or_equal", label: "≥", types: ["integer", "number", "currency", "date", "datetime"] },
  { key: "less_or_equal", label: "≤", types: ["integer", "number", "currency", "date", "datetime"] },
  { key: "in", label: "in (any of)", types: ["enum", "string"] },
  { key: "not_in", label: "not in (none of)", types: ["enum", "string"] },
  { key: "today", label: "is today", types: ["date", "datetime"] },
  { key: "yesterday", label: "is yesterday", types: ["date", "datetime"] },
  { key: "tomorrow", label: "is tomorrow", types: ["date", "datetime"] },
  { key: "last_n_days", label: "in last N days", types: ["date", "datetime"] },
  { key: "next_n_days", label: "in next N days", types: ["date", "datetime"] },
];

function opsForType(type: string) {
  return OPERATORS.filter((o) => o.types.includes("*") || o.types.includes(type));
}

export function RuleBuilder({ modules }: { modules: Module[] }) {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1
  const [moduleKey, setModuleKey] = useState(modules[0]?.key ?? "");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Step 2
  const [trigger, setTrigger] = useState<Trigger>({ kind: "record_action", when: "create", fields: [], repeat: false });

  // Step 3
  const [criteriaRows, setCriteriaRows] = useState<CriteriaRow[]>([]);
  const [criteriaPattern, setCriteriaPattern] = useState<string>("");

  // Step 4
  const [instantActions, setInstantActions] = useState<Action[]>([]);
  const [scheduledActions, setScheduledActions] = useState<ScheduledAction[]>([]);
  // Extra condition branches (optional) — first match wins, top-down.
  const [branches, setBranches] = useState<Branch[]>([]);

  const mod = useMemo(() => modules.find((m) => m.key === moduleKey), [moduleKey, modules]);
  const dateFields = mod?.fields.filter((f) => f.dateAnchor) ?? [];
  const scoreFields = mod?.fields.filter((f) => f.scoreField) ?? [];

  function canProceed(): boolean {
    if (step === 1) return !!(moduleKey && name.trim().length >= 2);
    if (step === 2) {
      if (trigger.kind === "date_field" && !trigger.field) return false;
      if (trigger.kind === "score_change" && !trigger.field) return false;
      if (trigger.kind === "recurrence" && !trigger.cron) return false;
      return true;
    }
    return true;
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const body = {
        module: moduleKey,
        name: name.trim(),
        description: description.trim() || undefined,
        triggerType: trigger.kind,
        triggerConfig: triggerConfigFromState(trigger),
        criteriaPattern: criteriaPattern.trim() || null,
        criteriaRows,
        instantActions,
        scheduledActions,
        branches: branches.map((b) => ({
          name: b.name.trim() || undefined,
          criteriaPattern: b.criteriaPattern.trim() || null,
          criteriaRows: b.criteriaRows,
          instantActions: b.instantActions,
          scheduledActions: b.scheduledActions,
        })),
        enabled: true,
        executionOrder: 100,
      };
      const r = await fetch("/api/workflow-rules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data?.error ?? `HTTP ${r.status}`);
      }
      router.push("/dashboard/workflows/rules");
    } catch (e: any) {
      setError(e?.message ?? "Failed to save rule");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">
            <Sparkles className="size-6 text-brand-cyan" /> Create Workflow Rule
          </h1>
          <p className="page-subtitle">
            Trigger → Criteria → Actions · same flow as Zoho CRM.
          </p>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2">
        {["Basic Info", "When", "Conditions", "Actions"].map((label, i) => {
          const n = i + 1;
          const active = step === n;
          const done = step > n;
          return (
            <div key={n} className="flex items-center gap-2 flex-1">
              <div
                className={`size-7 rounded-full grid place-items-center text-xs font-semibold ${
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                      ? "bg-brand-cyan text-white"
                      : "bg-secondary text-muted-foreground"
                }`}
              >
                {done ? "✓" : n}
              </div>
              <div className={`text-xs ${active ? "font-semibold" : "text-muted-foreground"}`}>{label}</div>
              {n < 4 && <div className={`flex-1 h-px ${done ? "bg-emerald-300" : "bg-border"}`} />}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="card-surface p-3 text-sm text-rose-700 bg-rose-50/40 flex items-start gap-2">
          <AlertTriangle className="size-4 mt-0.5" /> {error}
        </div>
      )}

      {/* Step body */}
      <div className="card-surface p-6 space-y-5">
        {step === 1 && (
          <>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Module *</label>
              <select
                value={moduleKey}
                onChange={(e) => setModuleKey(e.target.value)}
                className="input-base mt-1 w-full"
              >
                {modules.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                This rule will apply to records in the selected module.
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Rule name *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Send welcome email when investor is created"
                className="input-base mt-1 w-full"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-muted-foreground">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Optional — what this rule does and why."
                className="input-base mt-1 w-full"
              />
            </div>
          </>
        )}

        {step === 2 && (
          <TriggerStep
            trigger={trigger}
            onChange={setTrigger}
            mod={mod}
            dateFields={dateFields}
            scoreFields={scoreFields}
          />
        )}

        {step === 3 && (
          <CriteriaStep
            mod={mod}
            rows={criteriaRows}
            setRows={setCriteriaRows}
            pattern={criteriaPattern}
            setPattern={setCriteriaPattern}
          />
        )}

        {step === 4 && (
          <>
            <ActionsStep
              mod={mod}
              instantActions={instantActions}
              setInstantActions={setInstantActions}
              scheduledActions={scheduledActions}
              setScheduledActions={setScheduledActions}
              dateFields={dateFields}
            />
            <BranchesSection
              mod={mod}
              dateFields={dateFields}
              branches={branches}
              setBranches={setBranches}
              mainHasCriteria={criteriaRows.length > 0}
            />
          </>
        )}
      </div>

      {/* Nav */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={step === 1}
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          className="btn-secondary text-sm"
        >
          <ChevronLeft className="size-4" /> Back
        </button>
        {step < 4 ? (
          <button
            type="button"
            disabled={!canProceed()}
            onClick={() => setStep((s) => s + 1)}
            className="btn-primary text-sm disabled:opacity-40"
          >
            Next <ChevronRight className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            disabled={
              submitting ||
              (instantActions.length + scheduledActions.length === 0 &&
                !branches.some((b) => b.instantActions.length + b.scheduledActions.length > 0))
            }
            onClick={submit}
            className="btn-primary text-sm disabled:opacity-40"
          >
            <Save className="size-4" /> {submitting ? "Saving…" : "Save Rule"}
          </button>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// STEP 2 — Trigger
// =============================================================================

function TriggerStep({
  trigger,
  onChange,
  mod,
  dateFields,
  scoreFields,
}: {
  trigger: Trigger;
  onChange: (t: Trigger) => void;
  mod: Module | undefined;
  dateFields: ModuleField[];
  scoreFields: ModuleField[];
}) {
  const trig = trigger as any;
  return (
    <div className="space-y-5">
      <div>
        <label className="text-xs font-semibold text-muted-foreground">Execute the rule based on</label>
        <div className="grid grid-cols-2 gap-2 mt-2">
          <RadioCard
            checked={trigger.kind === "record_action"}
            onClick={() =>
              onChange({ kind: "record_action", when: "create", fields: [], repeat: false })
            }
            title="A record action"
            desc="Run when a record is created, edited, or deleted."
          />
          <RadioCard
            checked={trigger.kind === "date_field"}
            onClick={() =>
              onChange({
                kind: "date_field",
                field: dateFields[0]?.key ?? "",
                when: "on",
                offset: 0,
                unit: "day",
                recurrence: "once",
                time: "09:00",
              })
            }
            title="A date field"
            desc="Run before / on / after a date stored on the record."
            disabled={dateFields.length === 0}
          />
          <RadioCard
            checked={trigger.kind === "score_change"}
            onClick={() =>
              onChange({ kind: "score_change", field: scoreFields[0]?.key ?? "", direction: "updated" })
            }
            title="A score change"
            desc="Run when a numeric score field increases / decreases."
            disabled={scoreFields.length === 0}
          />
          <RadioCard
            checked={trigger.kind === "recurrence"}
            onClick={() => onChange({ kind: "recurrence", cron: "0 9 * * 1" })}
            title="A recurring schedule"
            desc="Run on a cron schedule (e.g. every Monday at 9am)."
          />
        </div>
      </div>

      {trigger.kind === "record_action" && (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">When</label>
            <select
              value={trig.when}
              onChange={(e) =>
                onChange({ ...trigger, when: e.target.value as any } as any)
              }
              className="input-base mt-1 w-full"
            >
              <option value="create">Create</option>
              <option value="edit">Edit</option>
              <option value="create_or_edit">Create or Edit</option>
              <option value="field_update">Field Update (specific fields)</option>
              <option value="delete">Delete</option>
            </select>
          </div>
          {(trig.when === "edit" || trig.when === "field_update") && (
            <div>
              <label className="text-xs font-semibold text-muted-foreground">
                Only when these fields change (max 5)
              </label>
              <select
                multiple
                value={trig.fields ?? []}
                onChange={(e) =>
                  onChange({
                    ...trigger,
                    fields: Array.from(e.target.selectedOptions).map((o) => o.value).slice(0, 5),
                  } as any)
                }
                className="input-base mt-1 w-full h-32"
              >
                {(mod?.fields ?? []).map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">
                Leave empty to fire on any field change. Cmd/Ctrl-click to select multiple.
              </p>
            </div>
          )}
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={trig.repeat ?? false}
              onChange={(e) => onChange({ ...trigger, repeat: e.target.checked } as any)}
            />
            Repeat this rule every time a matching edit happens (Zoho's "Recurrence" toggle)
          </label>
        </div>
      )}

      {trigger.kind === "date_field" && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Date field</label>
            <select
              value={trig.field}
              onChange={(e) => onChange({ ...trigger, field: e.target.value } as any)}
              className="input-base mt-1 w-full"
            >
              {dateFields.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">When</label>
            <select
              value={trig.when}
              onChange={(e) => onChange({ ...trigger, when: e.target.value } as any)}
              className="input-base mt-1 w-full"
            >
              <option value="before">Before</option>
              <option value="on">On the day</option>
              <option value="after">After</option>
            </select>
          </div>
          {trig.when !== "on" && (
            <>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Offset</label>
                <input
                  type="number"
                  min={0}
                  value={trig.offset ?? 0}
                  onChange={(e) => onChange({ ...trigger, offset: Number(e.target.value) } as any)}
                  className="input-base mt-1 w-full"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-muted-foreground">Unit</label>
                <select
                  value={trig.unit}
                  onChange={(e) => onChange({ ...trigger, unit: e.target.value } as any)}
                  className="input-base mt-1 w-full"
                >
                  <option value="day">Days</option>
                  <option value="week">Weeks</option>
                  <option value="month">Months</option>
                </select>
              </div>
            </>
          )}
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Recurrence</label>
            <select
              value={trig.recurrence}
              onChange={(e) => onChange({ ...trigger, recurrence: e.target.value } as any)}
              className="input-base mt-1 w-full"
            >
              <option value="once">Once</option>
              <option value="every_month">Every month</option>
              <option value="every_year">Every year</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Time of day</label>
            <input
              type="time"
              value={trig.time ?? "09:00"}
              onChange={(e) => onChange({ ...trigger, time: e.target.value } as any)}
              className="input-base mt-1 w-full"
            />
          </div>
        </div>
      )}

      {trigger.kind === "score_change" && (
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Score field</label>
            <select
              value={trig.field}
              onChange={(e) => onChange({ ...trigger, field: e.target.value } as any)}
              className="input-base mt-1 w-full"
            >
              {scoreFields.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Direction</label>
            <select
              value={trig.direction}
              onChange={(e) => onChange({ ...trigger, direction: e.target.value } as any)}
              className="input-base mt-1 w-full"
            >
              <option value="increase">Increase</option>
              <option value="decrease">Decrease</option>
              <option value="updated">Either</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-muted-foreground">Threshold (optional)</label>
            <input
              type="number"
              value={trig.threshold ?? ""}
              onChange={(e) =>
                onChange({ ...trigger, threshold: e.target.value === "" ? undefined : Number(e.target.value) } as any)
              }
              className="input-base mt-1 w-full"
              placeholder="e.g. 75"
            />
          </div>
        </div>
      )}

      {trigger.kind === "recurrence" && (
        <div>
          <label className="text-xs font-semibold text-muted-foreground">Cron expression</label>
          <input
            value={trig.cron}
            onChange={(e) => onChange({ ...trigger, cron: e.target.value } as any)}
            className="input-base mt-1 w-full font-mono"
            placeholder="0 9 * * 1   (every Mon 9:00am)"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Standard cron format: minute hour day-of-month month day-of-week
          </p>
        </div>
      )}
    </div>
  );
}

function RadioCard({
  checked,
  onClick,
  title,
  desc,
  disabled,
}: {
  checked: boolean;
  onClick: () => void;
  title: string;
  desc: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`text-left rounded-lg border p-3 transition-colors disabled:opacity-40 ${
        checked ? "border-brand-cyan bg-brand-cyan-light/40" : "border-border hover:bg-secondary/40"
      }`}
    >
      <div className="font-semibold text-sm flex items-center gap-2">
        <span
          className={`size-3 rounded-full border ${
            checked ? "bg-brand-cyan border-brand-cyan" : "border-muted-foreground"
          }`}
        />
        {title}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1 pl-5">{desc}</p>
    </button>
  );
}

// =============================================================================
// STEP 3 — Criteria
// =============================================================================

function CriteriaStep({
  mod,
  rows,
  setRows,
  pattern,
  setPattern,
}: {
  mod: Module | undefined;
  rows: CriteriaRow[];
  setRows: (r: CriteriaRow[]) => void;
  pattern: string;
  setPattern: (p: string) => void;
}) {
  function addRow() {
    if (rows.length >= 10) return;
    const f = mod?.fields[0];
    setRows([...rows, { field: f?.key ?? "", operator: "is", value: "" }]);
  }
  function update(i: number, patch: Partial<CriteriaRow>) {
    setRows(rows.map((r, ix) => (ix === i ? { ...r, ...patch } : r)));
  }
  function removeRow(i: number) {
    setRows(rows.filter((_, ix) => ix !== i));
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        Add conditions to narrow when this rule fires. Leave empty to run for every record.
        Each row is numbered — combine them with a pattern like <code className="bg-secondary px-1 rounded">1 AND (2 OR 3)</code> below.
      </div>

      {rows.length === 0 ? (
        <div className="card-surface p-6 text-center text-xs text-muted-foreground border-dashed border-2">
          No conditions yet. The rule will fire for <strong>every</strong> record that triggers it.
          <div className="mt-3">
            <button onClick={addRow} className="btn-secondary text-xs">
              <Plus className="size-3.5" /> Add condition
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => {
            const field = mod?.fields.find((f) => f.key === row.field);
            const ops = opsForType(field?.type ?? "string");
            const noValue = row.operator === "is_empty" || row.operator === "is_not_empty" || ["today", "yesterday", "tomorrow"].includes(row.operator);
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[11px] font-mono w-6 text-muted-foreground">{i + 1}.</span>
                <select
                  value={row.field}
                  onChange={(e) => update(i, { field: e.target.value, operator: "is", value: "" })}
                  className="input-base text-xs flex-1"
                >
                  {(mod?.fields ?? []).map((f) => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </select>
                <select
                  value={row.operator}
                  onChange={(e) => update(i, { operator: e.target.value })}
                  className="input-base text-xs flex-1"
                >
                  {ops.map((o) => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
                {!noValue && (
                  <CriteriaValueInput
                    field={field}
                    op={row.operator}
                    value={row.value}
                    onChange={(v) => update(i, { value: v })}
                  />
                )}
                <button onClick={() => removeRow(i)} className="btn-icon h-7 text-rose-600">
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            );
          })}
          <button onClick={addRow} className="btn-ghost text-xs">
            <Plus className="size-3.5" /> Add condition
          </button>
        </div>
      )}

      {rows.length >= 2 && (
        <div className="mt-4">
          <label className="text-xs font-semibold text-muted-foreground">Pattern (optional)</label>
          <input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder={`e.g. 1 AND (2 OR 3)`}
            className="input-base text-xs mt-1 w-full font-mono"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Use AND, OR, NOT and parentheses with the row numbers above. Empty defaults to AND of all rows.
          </p>
        </div>
      )}
    </div>
  );
}

function CriteriaValueInput({ field, op, value, onChange }: { field: ModuleField | undefined; op: string; value: any; onChange: (v: any) => void }) {
  if (!field) return <input className="input-base text-xs flex-1" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  if (field.type === "enum" && field.enumValues) {
    return (
      <select className="input-base text-xs flex-1" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {field.enumValues.map((v) => (
          <option key={v} value={v}>{v}</option>
        ))}
      </select>
    );
  }
  if (field.type === "boolean") {
    return (
      <select className="input-base text-xs flex-1" value={String(value ?? "")} onChange={(e) => onChange(e.target.value === "true")}>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  }
  if (field.type === "date" || field.type === "datetime") {
    if (op === "last_n_days" || op === "next_n_days") {
      return <input type="number" className="input-base text-xs flex-1" min={1} value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))} placeholder="N days" />;
    }
    return <input type="date" className="input-base text-xs flex-1" value={value ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }
  if (field.type === "integer" || field.type === "number" || field.type === "currency") {
    return <input type="number" className="input-base text-xs flex-1" value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))} />;
  }
  return <input className="input-base text-xs flex-1" value={value ?? ""} onChange={(e) => onChange(e.target.value)} placeholder="value" />;
}

// =============================================================================
// STEP 4 — Actions
// =============================================================================

function ActionsStep({
  mod,
  instantActions,
  setInstantActions,
  scheduledActions,
  setScheduledActions,
  dateFields,
}: {
  mod: Module | undefined;
  instantActions: Action[];
  setInstantActions: (a: Action[]) => void;
  scheduledActions: ScheduledAction[];
  setScheduledActions: (a: ScheduledAction[]) => void;
  dateFields: ModuleField[];
}) {
  function addInstant(typeKey: string) {
    setInstantActions([...instantActions, { type: typeKey, config: defaultConfigFor(typeKey, mod) }]);
  }
  function addScheduled(typeKey: string) {
    setScheduledActions([
      ...scheduledActions,
      { type: typeKey, config: defaultConfigFor(typeKey, mod), delay: { amount: 1, unit: "day", anchor: "trigger" } },
    ]);
  }

  return (
    <div className="space-y-6">
      {/* Instant */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="font-semibold text-sm">Instant Actions</h3>
            <p className="text-[11px] text-muted-foreground">Fire immediately when the rule matches.</p>
          </div>
          <ActionTypePicker onPick={addInstant} />
        </div>
        {instantActions.length === 0 ? (
          <div className="card-surface p-6 text-center text-xs text-muted-foreground border-dashed border-2">
            No instant actions yet — add one above.
          </div>
        ) : (
          <div className="space-y-2">
            {instantActions.map((a, i) => (
              <ActionRow
                key={i}
                action={a}
                onChange={(next) => setInstantActions(instantActions.map((x, ix) => (ix === i ? next : x)))}
                onRemove={() => setInstantActions(instantActions.filter((_, ix) => ix !== i))}
                mod={mod}
              />
            ))}
          </div>
        )}
      </div>

      {/* Scheduled */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="font-semibold text-sm">Scheduled Actions</h3>
            <p className="text-[11px] text-muted-foreground">Fire after a delay relative to the trigger.</p>
          </div>
          <ActionTypePicker onPick={addScheduled} excludeKeys={["convert_lead"]} />
        </div>
        {scheduledActions.length === 0 ? (
          <div className="card-surface p-6 text-center text-xs text-muted-foreground border-dashed border-2">
            No scheduled actions — Zoho's time-delayed actions like "send reminder 3 days after creation".
          </div>
        ) : (
          <div className="space-y-2">
            {scheduledActions.map((a, i) => (
              <ScheduledActionRow
                key={i}
                action={a}
                onChange={(next) =>
                  setScheduledActions(scheduledActions.map((x, ix) => (ix === i ? next : x)))
                }
                onRemove={() => setScheduledActions(scheduledActions.filter((_, ix) => ix !== i))}
                mod={mod}
                dateFields={dateFields}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionTypePicker({ onPick, excludeKeys = [] }: { onPick: (k: string) => void; excludeKeys?: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="btn-secondary text-xs">
        <Plus className="size-3.5" /> Add action
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-30 card-elevated w-72 max-h-72 overflow-y-auto">
            {ACTION_TYPES.filter((a) => !excludeKeys.includes(a.key)).map((a) => (
              <button
                key={a.key}
                onClick={() => {
                  onPick(a.key);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-2 hover:bg-brand-cyan-light/40 border-b last:border-0"
              >
                <div className="font-medium text-xs">{a.label}</div>
                <div className="text-[10px] text-muted-foreground">{a.description}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ActionRow({
  action,
  onChange,
  onRemove,
  mod,
}: {
  action: Action;
  onChange: (a: Action) => void;
  onRemove: () => void;
  mod: Module | undefined;
}) {
  const meta = ACTION_TYPES.find((t) => t.key === action.type);
  return (
    <div className="card-surface p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{meta?.label ?? action.type}</div>
        <button onClick={onRemove} className="btn-icon h-6 text-rose-600">
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <ActionConfigEditor action={action} onChange={onChange} mod={mod} />
    </div>
  );
}

function ScheduledActionRow({
  action,
  onChange,
  onRemove,
  mod,
  dateFields,
}: {
  action: ScheduledAction;
  onChange: (a: ScheduledAction) => void;
  onRemove: () => void;
  mod: Module | undefined;
  dateFields: ModuleField[];
}) {
  const meta = ACTION_TYPES.find((t) => t.key === action.type);
  return (
    <div className="card-surface p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold">{meta?.label ?? action.type}</div>
        <button onClick={onRemove} className="btn-icon h-6 text-rose-600">
          <Trash2 className="size-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2 items-end">
        <div className="col-span-1">
          <label className="text-[10px] text-muted-foreground">Delay amount</label>
          <input
            type="number"
            min={1}
            value={action.delay.amount}
            onChange={(e) =>
              onChange({ ...action, delay: { ...action.delay, amount: Number(e.target.value) } })
            }
            className="input-base text-xs w-full"
          />
        </div>
        <div className="col-span-1">
          <label className="text-[10px] text-muted-foreground">Unit</label>
          <select
            value={action.delay.unit}
            onChange={(e) => onChange({ ...action, delay: { ...action.delay, unit: e.target.value as any } })}
            className="input-base text-xs w-full"
          >
            <option value="minute">Minutes</option>
            <option value="hour">Hours</option>
            <option value="day">Days</option>
            <option value="week">Weeks</option>
          </select>
        </div>
        <div className="col-span-2">
          <label className="text-[10px] text-muted-foreground">Anchor</label>
          <select
            value={action.delay.anchor}
            onChange={(e) =>
              onChange({ ...action, delay: { ...action.delay, anchor: e.target.value as any } })
            }
            className="input-base text-xs w-full"
          >
            <option value="trigger">After rule fires (default)</option>
            {dateFields.length > 0 && <option value="date_field">Relative to a date field</option>}
          </select>
        </div>
        {action.delay.anchor === "date_field" && (
          <div className="col-span-4">
            <label className="text-[10px] text-muted-foreground">Date field</label>
            <select
              value={action.delay.anchorField ?? dateFields[0]?.key ?? ""}
              onChange={(e) =>
                onChange({ ...action, delay: { ...action.delay, anchorField: e.target.value } })
              }
              className="input-base text-xs w-full"
            >
              {dateFields.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <ActionConfigEditor action={action} onChange={(next) => onChange({ ...action, ...next })} mod={mod} />
    </div>
  );
}

// Module-level cache so the template list is fetched once, not per action row.
let _ruleTplCache: Array<{ key: string; name: string; channel: string; status?: string }> | null = null;

function ActionConfigEditor({
  action,
  onChange,
  mod,
}: {
  action: Action;
  onChange: (next: Action) => void;
  mod: Module | undefined;
}) {
  const c = action.config ?? {};
  function set(patch: Record<string, any>) {
    onChange({ ...action, config: { ...c, ...patch } });
  }

  const [allTemplates, setAllTemplates] = useState(_ruleTplCache ?? []);
  useEffect(() => {
    if (_ruleTplCache) return;
    fetch("/api/templates")
      .then((r) => r.json())
      .then((j) => { _ruleTplCache = j.templates ?? []; setAllTemplates(_ruleTplCache!); })
      .catch(() => {});
  }, []);

  switch (action.type) {
    case "send_email":
    case "send_whatsapp":
    case "send_sms":
      return (
        (() => {
          const channel = action.type === "send_email" ? "email" : action.type === "send_whatsapp" ? "whatsapp" : "sms";
          const opts = allTemplates.filter((t) => t.channel === channel);
          const chosen = String(c.templateKey ?? "");
          const knownKey = !chosen || opts.some((t) => t.key === chosen);
          return (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Template</label>
                  <select
                    value={chosen}
                    onChange={(e) => set({ templateKey: e.target.value })}
                    className="input-base text-xs w-full"
                  >
                    <option value="">{opts.length ? "Select a template…" : "No templates yet — create one first"}</option>
                    {opts.map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.name}{t.status && t.status !== "approved" ? ` (${t.status.replace(/_/g, " ")})` : ""}
                      </option>
                    ))}
                    {!knownKey && <option value={chosen}>{chosen} (custom)</option>}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Category</label>
                  <select
                    value={String(c.category ?? "transactional")}
                    onChange={(e) => set({ category: e.target.value })}
                    className="input-base text-xs w-full"
                  >
                    <option value="transactional">Transactional</option>
                    <option value="utility">Utility</option>
                    <option value="marketing">Marketing</option>
                  </select>
                </div>
              </div>
              {action.type === "send_email" && (
                <div>
                  <label className="text-[10px] text-muted-foreground">Send from</label>
                  <select
                    value={String(c.fromAddress ?? "organization")}
                    onChange={(e) => set({ fromAddress: e.target.value })}
                    className="input-base text-xs w-full"
                  >
                    <option value="organization">Organization email (firm default)</option>
                    <option value="record_owner">Record owner — the client&apos;s RM</option>
                  </select>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                {opts.length === 0
                  ? "Create a template under Templates → New (channel: " + channel + ") — it'll appear in this list."
                  : "Pick a template your firm created. It must be Approved to actually send."}
              </p>
            </div>
          );
        })()
      );
    case "create_task":
    case "schedule_call":
      return (
        <div className="grid grid-cols-2 gap-2">
          <input
            value={String(c.title ?? "")}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Task title"
            className="input-base text-xs col-span-2"
          />
          <select value={String(c.priority ?? "normal")} onChange={(e) => set({ priority: e.target.value })} className="input-base text-xs">
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>
          <input
            value={String(c.assignee ?? "subject.rm_id")}
            onChange={(e) => set({ assignee: e.target.value })}
            placeholder="subject.rm_id | fixed:<userId>"
            className="input-base text-xs font-mono"
          />
        </div>
      );
    case "schedule_meeting":
      return (
        <div className="grid grid-cols-2 gap-2">
          <select value={String(c.category ?? "review")} onChange={(e) => set({ category: e.target.value })} className="input-base text-xs">
            <option value="review">Review</option>
            <option value="new">New</option>
            <option value="follow_up">Follow-up</option>
          </select>
          <select value={String(c.mode ?? "online")} onChange={(e) => set({ mode: e.target.value })} className="input-base text-xs">
            <option value="online">Online</option>
            <option value="office">Office</option>
            <option value="client_place">Client place</option>
            <option value="phone">Phone</option>
          </select>
        </div>
      );
    case "update_field":
      return (
        <UpdateFieldEditor
          value={(c.updates as Record<string, any>) ?? {}}
          mod={mod}
          onChange={(updates) => set({ updates })}
        />
      );
    case "add_tag":
    case "remove_tag":
      return (
        <input
          value={String(c.tag ?? "")}
          onChange={(e) => set({ tag: e.target.value })}
          placeholder="e.g. hot-lead"
          className="input-base text-xs w-full"
        />
      );
    case "webhook":
      return (
        <div className="grid grid-cols-3 gap-2">
          <input
            value={String(c.url ?? "")}
            onChange={(e) => set({ url: e.target.value })}
            placeholder="https://example.com/webhook"
            className="input-base text-xs col-span-2"
          />
          <select value={String(c.method ?? "POST")} onChange={(e) => set({ method: e.target.value })} className="input-base text-xs">
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="GET">GET</option>
          </select>
        </div>
      );
    case "create_notification":
      return (
        <div className="space-y-2">
          <input
            value={String(c.title ?? "")}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Notification title"
            className="input-base text-xs w-full"
          />
          <textarea
            value={String(c.body ?? "")}
            onChange={(e) => set({ body: e.target.value })}
            placeholder="Notification body"
            rows={2}
            className="input-base text-xs w-full"
          />
          <label className="flex items-center gap-2 text-[11px]">
            <input
              type="checkbox"
              checked={!!(c.audience as any)?.subjectRm}
              onChange={(e) =>
                set({
                  audience: { ...(c.audience as any), subjectRm: e.target.checked },
                })
              }
            />
            Notify subject's RM
          </label>
        </div>
      );
    default:
      return (
        <div className="text-[11px] text-muted-foreground italic">
          Default config — edit JSON via the rule's detail page after save.
        </div>
      );
  }
}

function UpdateFieldEditor({
  value,
  mod,
  onChange,
}: {
  value: Record<string, any>;
  mod: Module | undefined;
  onChange: (next: Record<string, any>) => void;
}) {
  const writable = (mod?.fields ?? []).filter((f) => f.writable);
  const entries = Object.entries(value);
  function addBlank() {
    if (!writable.length) return;
    onChange({ ...value, [writable[0].key]: "" });
  }
  function update(key: string, newKey: string, newValue: any) {
    const next: Record<string, any> = {};
    for (const [k, v] of entries) {
      if (k === key) next[newKey] = newValue;
      else next[k] = v;
    }
    onChange(next);
  }
  function remove(key: string) {
    const next = { ...value };
    delete next[key];
    onChange(next);
  }
  return (
    <div className="space-y-1">
      {entries.length === 0 && <div className="text-[11px] text-muted-foreground italic">No field updates yet.</div>}
      {entries.map(([k, v]) => {
        const field = writable.find((f) => f.key === k);
        return (
          <div key={k} className="flex items-center gap-1">
            <select value={k} onChange={(e) => update(k, e.target.value, v)} className="input-base text-xs flex-1">
              {writable.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
            {field?.type === "enum" && field.enumValues ? (
              <select value={String(v ?? "")} onChange={(e) => update(k, k, e.target.value)} className="input-base text-xs flex-1">
                <option value="">—</option>
                {field.enumValues.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <input value={String(v ?? "")} onChange={(e) => update(k, k, e.target.value)} className="input-base text-xs flex-1" />
            )}
            <button onClick={() => remove(k)} className="btn-icon h-6 text-rose-600">
              <Trash2 className="size-3" />
            </button>
          </div>
        );
      })}
      <button onClick={addBlank} className="btn-ghost text-[11px]" disabled={!writable.length}>
        <Plus className="size-3" /> Add field update
      </button>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function defaultConfigFor(typeKey: string, mod: Module | undefined): Record<string, any> {
  switch (typeKey) {
    case "send_email":
    case "send_whatsapp":
    case "send_sms":
      return { templateKey: "", category: "transactional" };
    case "create_task":
    case "schedule_call":
      return { title: "", priority: "normal", assignee: "subject.rm_id" };
    case "schedule_meeting":
      return { category: "review", meetingType: "portfolio_review", mode: "online", durationMinutes: 30 };
    case "update_field":
      return { updates: {} };
    case "webhook":
      return { url: "", method: "POST" };
    case "create_notification":
      return { title: "", body: "", audience: { subjectRm: true } };
    case "add_tag":
    case "remove_tag":
      return { tag: "" };
    default:
      return {};
  }
}

function triggerConfigFromState(t: Trigger): Record<string, any> {
  const { kind, ...rest } = t as any;
  return rest;
}

// =============================================================================
// Condition branches (Zoho: multiple conditions per rule, first match wins)
// =============================================================================

function BranchesSection({
  mod,
  dateFields,
  branches,
  setBranches,
  mainHasCriteria,
}: {
  mod: Module | undefined;
  dateFields: ModuleField[];
  branches: Branch[];
  setBranches: (b: Branch[]) => void;
  mainHasCriteria: boolean;
}) {
  function addBranch() {
    if (branches.length >= 9) return; // main criteria + 9 = Zoho's 10-condition cap
    setBranches([
      ...branches,
      { name: `Condition ${branches.length + 2}`, criteriaPattern: "", criteriaRows: [], instantActions: [], scheduledActions: [] },
    ]);
  }
  function patch(i: number, p: Partial<Branch>) {
    setBranches(branches.map((b, idx) => (idx === i ? { ...b, ...p } : b)));
  }
  function remove(i: number) {
    setBranches(branches.filter((_, idx) => idx !== i));
  }

  return (
    <div className="pt-5 border-t border-border space-y-4">
      <div>
        <div className="text-sm font-semibold">Condition branches <span className="text-muted-foreground font-normal">(optional)</span></div>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          The Conditions + Actions above are <strong>Condition 1</strong>. Add more branches and a record
          falls into the <strong>first</strong> branch (top-down) whose conditions match — e.g. “Hot lead → call task,
          Cold lead → nurture email” in one rule.
        </p>
        {branches.length > 0 && !mainHasCriteria && (
          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2.5 py-1.5 mt-2">
            Condition 1 has no criteria, so it matches <strong>every</strong> record and the branches below
            will never be reached. Add criteria to Condition 1 (step 3), ordering specific → general.
          </p>
        )}
      </div>

      {branches.map((b, i) => (
        <div key={i} className="rounded-xl border border-border bg-secondary/20 p-4 space-y-4">
          <div className="flex items-center gap-2">
            <span className="chip bg-brand-cyan-light text-brand-cyan-deep text-[10px] font-bold shrink-0">
              Condition {i + 2}
            </span>
            <input
              value={b.name}
              onChange={(e) => patch(i, { name: e.target.value })}
              placeholder="Branch name (e.g. Hot leads)"
              className="input-base text-sm flex-1"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="size-8 grid place-items-center rounded-lg border border-border/60 text-muted-foreground hover:text-rose-600 hover:border-rose-200"
              title="Remove this branch"
            >
              <Trash2 className="size-4" />
            </button>
          </div>

          <CriteriaStep
            mod={mod}
            rows={b.criteriaRows}
            setRows={(rows) => patch(i, { criteriaRows: rows })}
            pattern={b.criteriaPattern}
            setPattern={(pattern) => patch(i, { criteriaPattern: pattern })}
          />

          <ActionsStep
            mod={mod}
            instantActions={b.instantActions}
            setInstantActions={(a) => patch(i, { instantActions: a })}
            scheduledActions={b.scheduledActions}
            setScheduledActions={(a) => patch(i, { scheduledActions: a })}
            dateFields={dateFields}
          />
        </div>
      ))}

      <button
        type="button"
        onClick={addBranch}
        disabled={branches.length >= 9}
        className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-xs font-semibold text-muted-foreground hover:text-brand-cyan-deep hover:border-brand-cyan/50 hover:bg-brand-cyan-light/30 py-2.5 transition-colors disabled:opacity-40"
      >
        <Plus className="size-3.5" /> Add condition branch
      </button>
    </div>
  );
}
