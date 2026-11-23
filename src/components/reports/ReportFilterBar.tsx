"use client";

/**
 * The custom-report view's filter bar, Zoho style (We Care, 2026-11-19): a
 * date field, a period (presets apply at once; a custom range when both ends
 * are picked), a Branch (2026-11-21, when the report's module has one) and, for
 * a summary report, Show details. It narrows one run
 * only — the saved report is untouched.
 */

import { useState } from "react";
import { CalendarRange, X } from "lucide-react";
import { DateField } from "@/components/ui/DateField";
import { SelectField } from "@/components/ui/SelectField";
import { buttonClass } from "@/components/ui/button-class";
import { formatRange, resolvePeriod } from "@/lib/dashboards/system/period";

const PERIODS: Array<[key: string, label: string]> = [
  ["", "All time"],
  ["today", "Today"],
  ["week", "This week"],
  ["month", "This month"],
  ["last_month", "Last month"],
  ["quarter", "This quarter"],
  ["fy", "This FY"],
  ["last_fy", "Last FY"],
  ["custom", "Custom range"],
];

export type ReportFilter = { field: string; period: string; from: string; to: string; details: boolean; branch?: string };

export function reportFilterQuery(f: ReportFilter): string {
  const q = new URLSearchParams();
  let from = "";
  let to = "";
  if (f.period === "custom") {
    from = f.from;
    to = f.to;
  } else if (f.period) {
    const r = resolvePeriod(f.period);
    from = r.from;
    to = r.to;
  }
  if (f.field && (from || to)) {
    q.set("dateField", f.field);
    if (from) q.set("from", from);
    if (to) q.set("to", to);
  }
  if (f.branch) q.set("branch", f.branch);
  q.set("details", f.details ? "1" : "0");
  return q.toString();
}

export function ReportFilterBar({
  dateFields,
  showDetailsSwitch,
  value,
  onApply,
  branches = [],
  desks = [],
}: {
  dateFields: Array<{ key: string; label: string }>;
  /** The firm's branch names; empty = this report's module has no branch, so no picker. */
  branches?: string[];
  /** Desks (sub-teams) listed under their branch; a desk is picked as "desk:<name>". */
  desks?: Array<{ name: string; branch: string }>;
  showDetailsSwitch: boolean;
  value: ReportFilter;
  onApply: (f: ReportFilter) => void;
}) {
  const [draft, setDraft] = useState<ReportFilter>(value);
  const set = (patch: Partial<ReportFilter>, apply: boolean) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (apply) onApply(next);
  };
  const customReady = draft.period !== "custom" || (!!draft.from && !!draft.to);
  const shown =
    value.period === "custom" && value.from && value.to
      ? formatRange(value.from, value.to)
      : value.period
        ? `${PERIODS.find(([k]) => k === value.period)?.[1]} (${resolvePeriod(value.period).range})`
        : "All time";

  return (
    <div className="card-surface px-4 py-3 print:hidden">
      <div className="flex flex-wrap items-end gap-3">
        {dateFields.length > 1 && (
          <label className="text-sm min-w-44">
            <span className="block text-xs text-muted-foreground mb-1">Date</span>
            <SelectField value={draft.field} onChange={(e) => set({ field: e.target.value }, !!draft.period && customReady)} className="w-full">
              {dateFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
            </SelectField>
          </label>
        )}
        <label className="text-sm min-w-44">
          <span className="block text-xs text-muted-foreground mb-1">{dateFields.length === 1 ? dateFields[0].label : "Period"}</span>
          <SelectField
            value={draft.period}
            onChange={(e) => set({ period: e.target.value }, e.target.value !== "custom")}
            className="w-full"
          >
            {PERIODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </SelectField>
        </label>
        {branches.length > 0 && (
          <label className="text-sm min-w-44">
            <span className="block text-xs text-muted-foreground mb-1">Branch</span>
            <SelectField value={draft.branch ?? ""} onChange={(e) => set({ branch: e.target.value }, customReady)} className="w-full">
              <option value="">All branches</option>
              {branches.flatMap((b) => [
                <option key={b} value={b}>{b}</option>,
                ...desks.filter((d) => d.branch === b).map((d) => (
                  <option key={`desk:${d.name}`} value={`desk:${d.name}`}>{d.name}</option>
                )),
              ])}
            </SelectField>
          </label>
        )}
        {draft.period === "custom" && (
          <>
            <label className="text-sm w-40">
              <span className="block text-xs text-muted-foreground mb-1">From</span>
              <DateField size="sm" value={draft.from} max={draft.to || undefined} onChange={(e) => set({ from: e.target.value }, false)} aria-label="From" />
            </label>
            <label className="text-sm w-40">
              <span className="block text-xs text-muted-foreground mb-1">To</span>
              <DateField size="sm" value={draft.to} min={draft.from || undefined} onChange={(e) => set({ to: e.target.value }, false)} aria-label="To" />
            </label>
            <button type="button" className={buttonClass("primary", "sm")} disabled={!customReady} onClick={() => onApply(draft)}>
              Apply
            </button>
          </>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-3 pb-1.5 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <CalendarRange className="size-3.5" />
            <span className="text-foreground font-medium">{shown}</span>
            {value.branch ? <span className="text-foreground font-medium">· {value.branch.replace(/^desk:/, "")}</span> : null}
          </span>
          {(value.period || value.branch) && (
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 hover:bg-secondary"
              onClick={() => {
                const next = { ...draft, period: "", from: "", to: "", branch: "" };
                setDraft(next);
                onApply(next);
              }}
            >
              <X className="size-3" /> Clear
            </button>
          )}
          {showDetailsSwitch && (
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer select-none">
              <input type="checkbox" checked={draft.details} onChange={(e) => set({ details: e.target.checked }, true)} />
              Show details
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
