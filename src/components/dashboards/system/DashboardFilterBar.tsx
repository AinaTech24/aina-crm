"use client";

/**
 * The dashboard filter bar (D9), Zoho-style:
 *
 *   [Period ▾] [RM ▾] [Branch ▾] [+ Filter]   chips ×   Clear all   Apply · Save filter
 *
 * Period is always there and shows its resolved range. RM and Branch appear
 * only when they can narrow anything for this viewer. "+ Filter" adds up to
 * three more from the dashboard's list. Editing changes a draft; "Apply" puts
 * it in the URL (this session only, and shareable as a link); "Save filter"
 * also stores it as this viewer's filter for this dashboard.
 *
 * While the dashboard reloads with the new filter the button says
 * "Applying…" and the dashboard dims (DashboardNav) — without that, a reload
 * of several seconds read as "the filter did nothing". The draft follows the
 * page whenever the page's filter changes (Back / Forward, a link), so the
 * bar never shows one filter while the cards count another.
 */

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { MultiSelectField } from "@/components/ui/MultiSelectField";
import { buttonClass } from "@/components/ui/button-class";
import { notify } from "@/components/ui/Toast";
import {
  FILTER_FIELDS, MAX_EXTRA_FILTERS, filterStateToParams, type FilterKey, type FilterState,
} from "@/lib/dashboards/system/filters";
import { PERIOD_KEYS, PERIOD_NAMES, indiaToday, resolvePeriod, type PeriodKey } from "@/lib/dashboards/system/period";
import type { FilterOptions } from "@/lib/dashboards/system/options";
import { DateRangeField } from "@/components/ui/DateRangeField";
import { formatDateLabel } from "@/lib/dates/typed-date";
import { useDashboardNav } from "./DashboardNav";

const same = (a: FilterState, b: FilterState) =>
  filterStateToParams(a).toString() === filterStateToParams(b).toString();

/**
 * A custom range as it is sent: the two dates in order (a range picked
 * backwards is still the range meant) and ending no later than today —
 * there is nothing to count after it.
 */
function tidyRange(s: FilterState): FilterState {
  if (s.period !== "custom" || !s.from) return s;
  let from = s.from;
  let to = s.to;
  if (to && to < from) [from, to] = [to, from];
  const today = indiaToday();
  if (to && to > today) to = today;
  return { ...s, from, to };
}

export function DashboardFilterBar({
  dashboardId,
  state,
  defaults,
  options,
  bar,
  usingSaved,
  /** The Operations page saves under its own dashboard id but lives at its own path. */
  savePath,
}: {
  dashboardId: string;
  state: FilterState;
  defaults: FilterState;
  options: FilterOptions;
  bar: { rm: boolean; branch: boolean; extras: FilterKey[]; pinned: FilterKey[] };
  usingSaved: boolean;
  savePath?: string;
}) {
  const nav = useDashboardNav();
  const pathname = usePathname();
  const [draft, setDraft] = useState<FilterState>(state);
  const [periodOpen, setPeriodOpen] = useState(false);
  // The period menu shows either the presets or the custom-range calendar.
  const [customView, setCustomView] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Fields on the bar: pinned (Operations: RM, Status), RM, Branch, then any
  // "+ Filter" field that holds a value or was just added.
  const [added, setAdded] = useState<FilterKey[]>(() =>
    bar.extras.filter((k) => (state.values[k]?.length ?? 0) > 0),
  );

  // The page's filter changed under the bar (Back / Forward, a link, a
  // corrected range): start again from what the cards now count.
  const stateKey = filterStateToParams(state).toString();
  useEffect(() => {
    setDraft(state);
    setAdded((a) => [...new Set([...a, ...bar.extras.filter((k) => (state.values[k]?.length ?? 0) > 0)])]);
  }, [stateKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const main: FilterKey[] = useMemo(() => {
    const out: FilterKey[] = [];
    for (const k of bar.pinned) if (!out.includes(k)) out.push(k);
    if (bar.rm && !out.includes("rm")) out.push("rm");
    if (bar.branch && !out.includes("branch")) out.push("branch");
    return out.filter((k) => options[k]?.length);
  }, [bar, options]);
  const extras = added.filter((k) => !main.includes(k));
  const fields = [...main, ...extras];
  // Period + 3 visible; the rest behind "+N".
  const visible = fields.slice(0, 3);
  const overflow = fields.slice(3);

  const dirty = !same(tidyRange(draft), state);
  // A custom range is applied once both its dates are picked.
  const needsRange = draft.period === "custom" && !(draft.from && draft.to);
  const period = resolvePeriod(draft.period, { from: draft.from, to: draft.to });

  function setValues(k: FilterKey, v: string[]) {
    setDraft((d) => {
      const values = { ...d.values };
      if (v.length) values[k] = v;
      else delete values[k];
      return { ...d, values };
    });
  }

  // Apply rewrites only the filter params; anything else in the URL (the
  // Operations page's tab, a view toggle) stays where it was.
  function push(next: FilterState) {
    const keep = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    for (const k of ["period", "from", "to", ...Object.values(FILTER_FIELDS).map((f) => f.param)]) keep.delete(k);
    for (const [k, v] of filterStateToParams(tidyRange(next))) keep.set(k, v);
    nav.go(`${pathname}?${keep.toString()}`);
  }

  async function save() {
    setBusy(true);
    try {
      const res = await fetch(savePath ?? `/api/dashboards/${dashboardId}/prefs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ savedFilters: tidyRange(draft) }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? "Could not save the filter");
      notify.success("Filter saved");
      push(draft);
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save the filter");
    } finally {
      setBusy(false);
    }
  }

  const chipValues = fields.flatMap((k) =>
    (draft.values[k] ?? []).map((v) => ({
      k,
      v,
      label: options[k]?.find((o) => o.value === v)?.label ?? v,
    })),
  );

  const fieldControl = (k: FilterKey) => (
    <div key={k} className="min-w-40 max-w-56">
      <label htmlFor={`df-${k}`} className="sr-only">{FILTER_FIELDS[k].label}</label>
      <MultiSelectField
        id={`df-${k}`}
        values={draft.values[k] ?? []}
        onChange={(v) => setValues(k, v)}
        options={options[k] ?? []}
        placeholder={FILTER_FIELDS[k].label}
      />
    </div>
  );

  return (
    <div className="flex flex-col items-stretch gap-2 lg:items-end">
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        {/* Period */}
        <div className="relative">
          <button
            type="button"
            className={buttonClass("secondary", "sm")}
            aria-expanded={periodOpen}
            onClick={() => {
              setCustomView(draft.period === "custom");
              setPeriodOpen((o) => !o);
            }}
          >
            {needsRange ? "Custom range: pick the dates" : period.label} <ChevronDown className="size-3.5" aria-hidden />
          </button>
          {periodOpen && (
            <div className="absolute left-0 lg:left-auto lg:right-0 top-full mt-1 z-40 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-1 shadow-lg">
              {customView ? (
                // The calendar lives inside the menu: a floating one opened from
                // here would cover the presets it came from.
                <div className="space-y-2 p-2">
                  <button
                    type="button"
                    onClick={() => setCustomView(false)}
                    className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <ChevronLeft className="size-3.5" aria-hidden /> Presets
                  </button>
                  <DateRangeField
                    from={draft.period === "custom" ? draft.from ?? "" : ""}
                    to={draft.period === "custom" ? draft.to ?? "" : ""}
                    onChange={(from, to) => setDraft((d) => ({ ...d, period: "custom", from: from || undefined, to: to || undefined }))}
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      className={buttonClass("secondary", "sm")}
                      disabled={!(draft.period === "custom" && draft.from && draft.to)}
                      onClick={() => setPeriodOpen(false)}
                    >
                      Done
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {PERIOD_KEYS.filter((k) => k !== "custom").map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-secondary ${draft.period === k ? "font-semibold" : ""}`}
                      onClick={() => {
                        setDraft((d) => ({ ...d, period: k as PeriodKey, from: undefined, to: undefined }));
                        setPeriodOpen(false);
                      }}
                    >
                      {PERIOD_NAMES[k as PeriodKey]}
                      <span className="block text-xs text-muted-foreground">{resolvePeriod(k).range}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`mt-1 flex w-full items-center justify-between gap-2 rounded-md border-t border-border px-3 py-2 text-left text-sm hover:bg-secondary ${draft.period === "custom" ? "font-semibold" : ""}`}
                    onClick={() => setCustomView(true)}
                  >
                    <span className="min-w-0">
                      Custom range
                      <span className="block text-xs font-normal text-muted-foreground">
                        {draft.period === "custom" && draft.from && draft.to
                          ? `${formatDateLabel(draft.from)} – ${formatDateLabel(draft.to)}`
                          : "Pick any start and end date"}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                </>
              )}
              <p className="px-3 pb-2 text-xs text-muted-foreground">Compared with the same period last year</p>
            </div>
          )}
        </div>

        {visible.map(fieldControl)}

        {overflow.length > 0 && (
          <button type="button" className={buttonClass("secondary", "sm")} onClick={() => setPanelOpen((o) => !o)} aria-expanded={panelOpen}>
            +{overflow.length}
          </button>
        )}

        {/* + Filter */}
        {bar.extras.length > 0 && (
          <div className="relative">
            <button
              type="button"
              className={buttonClass("ghost", "sm")}
              disabled={extras.length >= MAX_EXTRA_FILTERS}
              title={extras.length >= MAX_EXTRA_FILTERS ? `Up to ${MAX_EXTRA_FILTERS} extra filters` : undefined}
              onClick={() => setAddOpen((o) => !o)}
              aria-expanded={addOpen}
            >
              <Plus className="size-3.5" aria-hidden /> Filter
            </button>
            {addOpen && (
              <div className="absolute right-0 top-full mt-1 z-40 w-52 rounded-lg border border-border bg-card p-1 shadow-lg">
                {bar.extras.filter((k) => !fields.includes(k) && options[k]?.length).map((k) => (
                  <button
                    key={k}
                    type="button"
                    className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-secondary"
                    onClick={() => {
                      setAdded((a) => [...a, k]);
                      setAddOpen(false);
                    }}
                  >
                    {FILTER_FIELDS[k].label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Apply and Save wrap together, never one without the other. */}
        <span className="inline-flex shrink-0 items-center gap-2">
          <button
            type="button"
            className={buttonClass("primary", "sm")}
            disabled={!dirty || busy || nav.pending || needsRange}
            title={needsRange ? "Pick a start and an end date for the custom range" : undefined}
            onClick={() => { setPeriodOpen(false); push(draft); }}
          >
            {nav.pending ? "Applying…" : "Apply"}
          </button>
          <button type="button" className={buttonClass("secondary", "sm")} disabled={busy || nav.pending || needsRange} onClick={save}>
            Save filter
          </button>
        </span>
      </div>

      {panelOpen && overflow.length > 0 && (
        <div className="flex flex-wrap gap-2 lg:justify-end">{overflow.map(fieldControl)}</div>
      )}

      {(chipValues.length > 0 || usingSaved) && (
        <div className="flex flex-wrap items-center gap-1.5 lg:justify-end text-xs">
          {usingSaved && !dirty && <span className="text-muted-foreground">Saved filter</span>}
          {chipValues.map((c) => (
            <span key={`${c.k}:${c.v}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/60 px-2 py-0.5">
              <span className="text-muted-foreground">{FILTER_FIELDS[c.k].label}:</span> {c.label}
              <button
                type="button"
                className="rounded-full hover:bg-secondary p-0.5"
                aria-label={`Remove ${c.label}`}
                onClick={() => {
                  const next = { ...draft, values: { ...draft.values, [c.k]: (draft.values[c.k] ?? []).filter((x) => x !== c.v) } };
                  if (!next.values[c.k]?.length) delete next.values[c.k];
                  setDraft(next);
                  push(next);
                }}
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
          {chipValues.length > 0 && (
            <button
              type="button"
              className="text-primary hover:underline"
              onClick={() => {
                setDraft(defaults);
                setAdded([]);
                push(defaults);
              }}
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
