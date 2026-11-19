"use client";

/**
 * The quick filters on a standard report (Zoho's "quick view filter",
 * 2026-11-19): Period, RM and Branch, kept in the URL so a filtered report can
 * be bookmarked or shared. The page decides which of the three to show — a
 * report gets only the filters its query actually applies.
 *
 * A change re-renders the report on the server; while that runs the bar says
 * "Updating…" so a slow report never reads as "the filter did nothing".
 *
 * "Save view" is Zoho's "Save As" for a standard report: the report with these
 * filters, under the person's own name, listed in their Reports home.
 */

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookmarkPlus, Loader2, X } from "lucide-react";
import { SelectField } from "@/components/ui/SelectField";
import { DateRangeField } from "@/components/ui/DateRangeField";
import { Button } from "@/components/ui/Button";
import { promptDialog } from "@/components/ui/ConfirmProvider";
import { notify } from "@/components/ui/Toast";
import { REPORT_PERIOD_KEYS, REPORT_PERIOD_NAMES, type ReportPeriodKey } from "@/lib/reports/period";

type Option = { value: string; label: string };

export function StandardReportFilterBar({
  reportKey,
  reportTitle,
  period,
  rm,
  branch,
  people,
  branches,
}: {
  /** The standard report's key and title — what a saved view points at. */
  reportKey: string;
  reportTitle: string;
  /** Null when the report has no date to filter on. */
  period: { key: ReportPeriodKey; from: string; to: string; label: string; defaultKey: ReportPeriodKey } | null;
  /** Undefined = the RM filter is not offered; null = offered, not set. */
  rm?: string | null;
  branch?: string | null;
  people: Option[];
  branches: Option[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  // The date picker shows while choosing a range; an applied range folds to its label.
  const [custom, setCustom] = useState(false);
  const [range, setRange] = useState({ from: period?.from ?? "", to: period?.to ?? "" });

  // Back / Forward changes the URL under us — keep the draft in step.
  useEffect(() => {
    setCustom(false);
    setRange({ from: period?.from ?? "", to: period?.to ?? "" });
  }, [period?.key, period?.from, period?.to]);

  function go(patch: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    const qs = next.toString();
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function pickPeriod(k: string) {
    if (k === "custom") {
      setCustom(true);
      return;
    }
    setCustom(false);
    go({ period: period && k === period.defaultKey ? null : k, from: null, to: null });
  }

  async function saveView() {
    const name = await promptDialog({ title: "Save this view", label: "Name", defaultValue: `${reportTitle} — ${period ? REPORT_PERIOD_NAMES[period.key] : "filtered"}`, confirmLabel: "Save" });
    if (!name) return;
    const r = await fetch("/api/reports/prefs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ saveView: { key: reportKey, name, query: params.toString() } }),
    });
    if (r.ok) notify.success("Saved — find it under My saved views in Reports");
    else notify.error("Could not save the view");
  }

  const offerPeople = rm !== undefined;
  const narrowed = !!(rm || branch) || (period && period.key !== period.defaultKey);

  return (
    <div className={`card-surface p-3 flex flex-wrap items-end gap-3 print:hidden ${pending ? "opacity-70" : ""}`}>
      {period && (
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Period</span>
          <SelectField value={custom ? "custom" : period.key} onChange={(e) => pickPeriod(e.target.value)} className="min-w-44">
            {REPORT_PERIOD_KEYS.map((k) => (
              <option key={k} value={k}>
                {REPORT_PERIOD_NAMES[k]}
              </option>
            ))}
          </SelectField>
        </label>
      )}
      {offerPeople && (
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">RM / team member</span>
          <SelectField value={rm ?? ""} onChange={(e) => go({ rm: e.target.value || null })} className="min-w-44">
            <option value="">Everyone</option>
            {people.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </SelectField>
        </label>
      )}
      {offerPeople && branches.length > 1 && (
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Branch</span>
          <SelectField value={branch ?? ""} onChange={(e) => go({ branch: e.target.value || null })} className="min-w-40">
            <option value="">All branches</option>
            {branches.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </SelectField>
        </label>
      )}
      {narrowed && (
        <Button variant="ghost" size="sm" icon={<X className="size-3.5" />} onClick={() => go({ period: null, from: null, to: null, rm: null, branch: null })}>
          Clear filters
        </Button>
      )}
      {narrowed && (
        <Button variant="ghost" size="sm" icon={<BookmarkPlus className="size-3.5" />} onClick={saveView}>
          Save view
        </Button>
      )}
      <div className="ml-auto text-xs text-muted-foreground self-center">
        {pending ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin" /> Updating…
          </span>
        ) : period && !custom ? (
          <span className="inline-flex items-center gap-2">
            {period.label}
            {period.key === "custom" && (
              <Button variant="ghost" size="sm" onClick={() => setCustom(true)}>
                Change dates
              </Button>
            )}
          </span>
        ) : null}
      </div>
      {period && custom && (
        <div className="basis-full flex flex-wrap items-end gap-3">
          <div className="max-w-md">
            <DateRangeField from={range.from} to={range.to} onChange={(from, to) => setRange({ from, to })} />
          </div>
          <Button
            variant="primary"
            size="sm"
            disabled={!range.from || !range.to}
            loading={pending}
            onClick={() => go({ period: "custom", from: range.from, to: range.to })}
          >
            Apply
          </Button>
        </div>
      )}
    </div>
  );
}
