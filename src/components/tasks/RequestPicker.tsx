"use client";

/**
 * "What kind of task?" — General · Financial · Non-financial, then the
 * request within the category, then only the details that request needs.
 * The list, the fields and the starting checklists are lib/tasks/request-types.
 *
 * Controlled: the New task form owns the state and decides what a change
 * means for the title and the checklist.
 */

import { ThemeSelect } from "@/components/ui/ThemeSelect";
import { DateField } from "@/components/ui/DateField";
import {
  FIELD_LABEL,
  FREQUENCIES,
  REQUEST_TYPE_BY_KEY,
  requestTypesFor,
  type RequestField,
  type TaskCategory,
} from "@/lib/tasks/request-types";

export type RequestValues = {
  amount: string;
  scheme: string;
  toScheme: string;
  folio: string;
  mode: "" | "online" | "offline";
  sipDate: string;
  frequency: string;
  units: string;
  allUnits: boolean;
};

export const EMPTY_REQUEST: RequestValues = {
  amount: "",
  scheme: "",
  toScheme: "",
  folio: "",
  mode: "",
  sipDate: "",
  frequency: "monthly",
  units: "",
  allUnits: false,
};

const CATEGORIES: Array<[TaskCategory, string]> = [
  ["general", "General"],
  ["financial", "Financial"],
  ["non_financial", "Non-financial"],
];

export function RequestPicker({
  category,
  requestKey,
  values,
  onCategory,
  onRequest,
  onValues,
}: {
  category: TaskCategory;
  requestKey: string;
  values: RequestValues;
  onCategory: (c: TaskCategory) => void;
  onRequest: (key: string) => void;
  onValues: (v: RequestValues) => void;
}) {
  const req = requestKey ? REQUEST_TYPE_BY_KEY[requestKey] : undefined;
  const set = <K extends keyof RequestValues>(k: K, v: RequestValues[K]) => onValues({ ...values, [k]: v });

  return (
    <div className="space-y-3">
      <div>
        <div className="mb-1 text-xs font-medium">Type of task</div>
        <div className="inline-flex gap-0.5 rounded-lg border border-border bg-card p-0.5" role="radiogroup" aria-label="Type of task">
          {CATEGORIES.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={category === key}
              onClick={() => onCategory(key)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                category === key ? "bg-primary text-primary-foreground" : "hover:bg-secondary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {category !== "general" && (
        <div className="space-y-3 rounded-lg border border-border bg-secondary/30 p-3">
          <label className="block">
            <div className="mb-1 text-xs font-medium">
              {category === "financial" ? "Financial request" : "Non-financial request"} <span className="text-destructive">*</span>
            </div>
            <ThemeSelect
              value={requestKey}
              onChange={onRequest}
              options={[["", "Select a request…"], ...requestTypesFor(category).map((r) => [r.key, r.label] as [string, string])]}
            />
          </label>

          {req && req.fields.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {req.fields.map((f) => (
                <Field key={f} field={f} values={values} set={set} />
              ))}
            </div>
          )}
          {req && (
            <p className="text-2xs text-muted-foreground">
              {req.checklist.length > 0
                ? `Adds ${req.checklist.length} sub-tasks for this request under More options — edit them as you need.`
                : "Add sub-tasks under More options if you need them."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Field({
  field,
  values,
  set,
}: {
  field: RequestField;
  values: RequestValues;
  set: <K extends keyof RequestValues>(k: K, v: RequestValues[K]) => void;
}) {
  const label = FIELD_LABEL[field];
  const input = (k: "amount" | "scheme" | "toScheme" | "folio" | "units", props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <div className="mb-1 text-xs font-medium">{label}</div>
      <input value={values[k]} onChange={(e) => set(k, e.target.value)} className="input-base" {...props} />
    </label>
  );

  switch (field) {
    case "amount":
      return input("amount", { inputMode: "decimal", placeholder: "e.g. 500000" });
    case "scheme":
      return input("scheme", { placeholder: "e.g. HDFC Flexi Cap Fund – Regular Growth", maxLength: 200 });
    case "toScheme":
      return input("toScheme", { placeholder: "Scheme it moves into", maxLength: 200 });
    case "folio":
      return input("folio", { placeholder: "Folio number", maxLength: 60 });
    case "units":
      return (
        <div>
          <div className="mb-1 text-xs font-medium">{label}</div>
          <div className="flex items-center gap-3">
            <input
              value={values.units}
              onChange={(e) => set("units", e.target.value)}
              disabled={values.allUnits}
              inputMode="decimal"
              placeholder="Units, or leave blank for an amount"
              aria-label="Units"
              className="input-base min-w-0 flex-1"
            />
            <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs">
              <input type="checkbox" checked={values.allUnits} onChange={(e) => set("allUnits", e.target.checked)} className="size-3.5 rounded" />
              All units
            </label>
          </div>
        </div>
      );
    case "mode":
      return (
        <label className="block">
          <div className="mb-1 text-xs font-medium">{label}</div>
          <ThemeSelect
            value={values.mode}
            onChange={(v) => set("mode", v as RequestValues["mode"])}
            options={[["", "Not set"], ["online", "Online"], ["offline", "Offline (physical form)"]]}
          />
        </label>
      );
    case "sipDate":
      return (
        <div className="block">
          <div className="mb-1 text-xs font-medium">{label}</div>
          <DateField value={values.sipDate} onChange={(e: any) => set("sipDate", e.target.value)} className="w-full" aria-label={label} />
        </div>
      );
    case "frequency":
      return (
        <label className="block">
          <div className="mb-1 text-xs font-medium">{label}</div>
          <ThemeSelect value={values.frequency} onChange={(v) => set("frequency", v)} options={FREQUENCIES} />
        </label>
      );
  }
}
