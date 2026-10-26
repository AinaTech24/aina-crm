"use client";

/**
 * "What kind of task?" — General · Financial · Non-financial, then the
 * request within the category, then only what that request needs: request
 * fields (mode, a mandate's amount, a folio) and, for a financial request,
 * one or more SCHEME ROWS — a client often invests in several schemes at once.
 * Schemes come from the MF scheme catalog (free text for PMS / AIF).
 * The list, the fields and the starting checklists are lib/tasks/request-types.
 *
 * Controlled: the New task form owns the state and decides what a change
 * means for the title and the checklist.
 */

import { Plus, Trash2 } from "lucide-react";
import { ThemeSelect } from "@/components/ui/ThemeSelect";
import { SchemeAutocomplete } from "@/components/mf/SchemeAutocomplete";
import { formatMoney } from "@/lib/format";
import {
  FIELD_LABEL,
  FREQUENCIES,
  REQUEST_TYPE_BY_KEY,
  requestTypesFor,
  rowFieldLabel,
  type RequestType,
  type RowField,
  type TaskCategory,
} from "@/lib/tasks/request-types";

/** A scheme row as edited (strings, so a half-typed number survives). */
export type RowValues = {
  key: string;
  schemeCode: string;
  schemeName: string;
  amcName: string;
  assetCategory: string;
  fromSchemeCode: string;
  fromSchemeName: string;
  amount: string;
  units: string;
  allUnits: boolean;
  folio: string;
  sipDay: string;
  frequency: string;
};

export type RequestValues = {
  amount: string;
  folio: string;
  mode: "" | "online" | "offline";
  /** KYC / KYC update only: which KYC the client will do. */
  kycMode: "" | "online" | "physical";
  rows: RowValues[];
};

/** The two ways a client's KYC is done (the task says which). */
export const KYC_MODES: Array<{ key: "online" | "physical"; label: string; hint: string }> = [
  { key: "online", label: "Online KYC", hint: "e-KYC via Aadhaar OTP / DigiLocker" },
  { key: "physical", label: "Physical KYC", hint: "In-person verification (IPV)" },
];

let rowSeq = 0;
export const emptyRow = (): RowValues => ({
  key: `r${++rowSeq}`,
  schemeCode: "",
  schemeName: "",
  amcName: "",
  assetCategory: "",
  fromSchemeCode: "",
  fromSchemeName: "",
  amount: "",
  units: "",
  allUnits: false,
  folio: "",
  sipDay: "",
  frequency: "monthly",
});

export const EMPTY_REQUEST: RequestValues = { amount: "", folio: "", mode: "", kycMode: "", rows: [] };

/** Parse a typed rupee / unit figure ("5,00,000" → 500000); null when blank or bad. */
export const num = (s: string): number | null => {
  const t = s.replace(/,/g, "").trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const CATEGORIES: Array<[TaskCategory, string]> = [
  ["general", "General"],
  ["financial", "Financial"],
  ["non_financial", "Non-financial"],
];

const DAYS: [string, string][] = [["", "—"], ...Array.from({ length: 28 }, (_, i) => [String(i + 1), String(i + 1)] as [string, string])];

export function RequestPicker({
  category,
  requestKey,
  values,
  onCategory,
  onRequest,
  onKycMode,
  onValues,
}: {
  category: TaskCategory;
  requestKey: string;
  values: RequestValues;
  onCategory: (c: TaskCategory) => void;
  onRequest: (key: string) => void;
  /** Called when the KYC mode buttons are used, so the form can retitle the task. */
  onKycMode: (mode: "online" | "physical") => void;
  onValues: (v: RequestValues) => void;
}) {
  const req = requestKey ? REQUEST_TYPE_BY_KEY[requestKey] : undefined;
  const set = <K extends keyof RequestValues>(k: K, v: RequestValues[K]) => onValues({ ...values, [k]: v });
  const setRow = (i: number, patch: Partial<RowValues>) =>
    onValues({ ...values, rows: values.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const total = values.rows.reduce((s, r) => s + (num(r.amount) ?? 0), 0);

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

          {req?.key === "kyc_renewal" && (
            <div role="radiogroup" aria-label="Which KYC">
              <div className="mb-1 text-xs font-medium">
                Which KYC? <span className="text-destructive">*</span>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {KYC_MODES.map((m) => {
                  const on = values.kycMode === m.key;
                  return (
                    <button
                      key={m.key}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => onKycMode(m.key)}
                      className={`rounded-lg border px-3 py-2 text-left transition ${
                        on ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-secondary"
                      }`}
                    >
                      <div className="text-sm font-semibold">{m.label}</div>
                      <div className="text-2xs text-muted-foreground">{m.hint}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {req && req.rowFields.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium">
                  Schemes <span className="text-destructive">*</span>
                </div>
                {total > 0 && <div className="text-xs text-muted-foreground">Total {formatMoney(total)}</div>}
              </div>
              {values.rows.map((row, i) => (
                <SchemeRow
                  key={row.key}
                  req={req}
                  row={row}
                  index={i}
                  onChange={(p) => setRow(i, p)}
                  onRemove={values.rows.length > 1 ? () => set("rows", values.rows.filter((_, j) => j !== i)) : undefined}
                />
              ))}
              <button
                type="button"
                onClick={() => set("rows", [...values.rows, emptyRow()])}
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                <Plus className="size-3.5" /> Add another scheme
              </button>
            </div>
          )}

          {req && req.fields.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {req.fields.includes("amount") && (
                <label className="block">
                  <div className="mb-1 text-xs font-medium">{FIELD_LABEL.amount}</div>
                  <input value={values.amount} onChange={(e) => set("amount", e.target.value)} inputMode="decimal" placeholder="e.g. 25000" className="input-base" />
                </label>
              )}
              {req.fields.includes("folio") && (
                <label className="block">
                  <div className="mb-1 text-xs font-medium">{FIELD_LABEL.folio}</div>
                  <input value={values.folio} onChange={(e) => set("folio", e.target.value)} maxLength={60} placeholder="Folio number" className="input-base" />
                </label>
              )}
              {req.fields.includes("mode") && (
                <label className="block">
                  <div className="mb-1 text-xs font-medium">{FIELD_LABEL.mode}</div>
                  <ThemeSelect
                    value={values.mode}
                    onChange={(v) => set("mode", v as RequestValues["mode"])}
                    options={[["", "Not set"], ["online", "Online"], ["offline", "Offline (physical form)"]]}
                  />
                </label>
              )}
            </div>
          )}

          {req && (
            <p className="text-2xs text-muted-foreground">
              {req.checklist.length > 0
                ? `Adds ${req.checklist.length} sub-tasks for this request under More options — edit them as you need.`
                : "Add sub-tasks under More options if you need them."}
              {req.business && " Saving also books it in Business entries (as a draft, confirmed when the task is completed)."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function SchemeRow({
  req,
  row,
  index,
  onChange,
  onRemove,
}: {
  req: RequestType;
  row: RowValues;
  index: number;
  onChange: (p: Partial<RowValues>) => void;
  onRemove?: () => void;
}) {
  const has = (f: RowField) => req.rowFields.includes(f);
  const lbl = (f: RowField) => rowFieldLabel(f, req);

  const schemeInput = (which: "scheme" | "fromScheme") => {
    const name = which === "scheme" ? row.schemeName : row.fromSchemeName;
    return (
      <div className="min-w-0">
        <div className="mb-1 text-xs font-medium">{lbl(which)}</div>
        {req.catalog !== false ? (
          <SchemeAutocomplete
            size="sm"
            defaultValue={name}
            placeholder="Search schemes…"
            onClear={() =>
              onChange(which === "scheme" ? { schemeName: "", schemeCode: "", amcName: "", assetCategory: "" } : { fromSchemeName: "", fromSchemeCode: "" })
            }
            onSelect={(s) =>
              onChange(
                which === "scheme"
                  ? { schemeName: s.schemeName, schemeCode: s.schemeCode, amcName: s.amc ?? "", assetCategory: s.category ?? "" }
                  : { fromSchemeName: s.schemeName, fromSchemeCode: s.schemeCode },
              )
            }
          />
        ) : (
          <input
            value={name}
            onChange={(e) => onChange({ schemeName: e.target.value, schemeCode: "" })}
            maxLength={250}
            placeholder={req.key === "aif" ? "AIF name" : "PMS strategy / provider"}
            aria-label={lbl(which)}
            className="input-base h-8 text-xs"
          />
        )}
        {which === "scheme" && row.amcName && <div className="mt-0.5 truncate text-2xs text-muted-foreground">{row.amcName}</div>}
      </div>
    );
  };

  return (
    <div className="rounded-lg border border-border bg-card p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Scheme {index + 1}</span>
        {onRemove && (
          <button type="button" onClick={onRemove} className="btn-icon text-muted-foreground hover:text-destructive" aria-label={`Remove scheme ${index + 1}`} title="Remove">
            <Trash2 className="size-4" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        {has("fromScheme") && schemeInput("fromScheme")}
        {has("scheme") && schemeInput("scheme")}
        {has("amount") && (
          <label className="block">
            <div className="mb-1 text-xs font-medium">{lbl("amount")}</div>
            <input
              value={row.amount}
              onChange={(e) => onChange({ amount: e.target.value })}
              inputMode="decimal"
              placeholder="e.g. 500000"
              className="input-base h-8 text-xs"
            />
          </label>
        )}
        {has("units") && (
          <div>
            <div className="mb-1 text-xs font-medium">{lbl("units")}</div>
            <div className="flex items-center gap-3">
              <input
                value={row.units}
                onChange={(e) => onChange({ units: e.target.value })}
                disabled={row.allUnits}
                inputMode="decimal"
                placeholder="Units (optional)"
                aria-label={`Scheme ${index + 1} units`}
                className="input-base h-8 min-w-0 flex-1 text-xs"
              />
              <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs">
                <input type="checkbox" checked={row.allUnits} onChange={(e) => onChange({ allUnits: e.target.checked })} className="size-3.5 rounded" />
                All units
              </label>
            </div>
          </div>
        )}
        {has("sipDay") && (
          <label className="block">
            <div className="mb-1 text-xs font-medium">{lbl("sipDay")}</div>
            <ThemeSelect value={row.sipDay} onChange={(v) => onChange({ sipDay: v })} options={DAYS} className="h-8 py-0 text-xs" />
          </label>
        )}
        {has("frequency") && (
          <label className="block">
            <div className="mb-1 text-xs font-medium">{lbl("frequency")}</div>
            <ThemeSelect value={row.frequency} onChange={(v) => onChange({ frequency: v })} options={FREQUENCIES} className="h-8 py-0 text-xs" />
          </label>
        )}
        {has("folio") && (
          <label className="block">
            <div className="mb-1 text-xs font-medium">{lbl("folio")}</div>
            <input
              value={row.folio}
              onChange={(e) => onChange({ folio: e.target.value })}
              maxLength={60}
              placeholder="Folio number (optional)"
              className="input-base h-8 text-xs"
            />
          </label>
        )}
      </div>
    </div>
  );
}
