"use client";

/**
 * The dashboard filter bar (D9), Zoho-style:
 *
 *   [Period ▾] [RM ▾] [Branch ▾] [+ Filter]   chips ×   Clear all   Apply · Saved filters ▾ · Save filter
 *
 * Period is always there and shows its resolved range. RM and Branch appear
 * only when they can narrow anything for this viewer. "+ Filter" adds up to
 * three more from the dashboard's list. Editing changes a draft; "Apply" puts
 * it in the URL (this session only, and shareable as a link); "Save filter"
 * stores it under a name, and "Saved filters" lists the viewer's saved ones for
 * this dashboard: pick one to apply it, star one to open the dashboard with it,
 * rename or delete one. Saving while a saved filter is showing asks whether to
 * overwrite it or keep it and save the filters as a new one
 * (lib/dashboards/system/saved-filters.ts).
 *
 * While the dashboard reloads with the new filter the button says
 * "Applying…" and the dashboard dims (DashboardNav) — without that, a reload
 * of several seconds read as "the filter did nothing". The draft follows the
 * page whenever the page's filter changes (Back / Forward, a link), so the
 * bar never shows one filter while the cards count another.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bookmark, ChevronDown, ChevronLeft, ChevronRight, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { confirmDialog, promptDialog } from "@/components/ui/ConfirmProvider";
import { MultiSelectField } from "@/components/ui/MultiSelectField";
import { buttonClass } from "@/components/ui/button-class";
import { notify } from "@/components/ui/Toast";
import {
  FILTER_FIELDS, MAX_EXTRA_FILTERS, filterStateToParams, type FilterKey, type FilterState,
} from "@/lib/dashboards/system/filters";
import { ALL_TIME, PERIOD_KEYS, PERIOD_NAMES, indiaToday, resolvePeriod, type PeriodKey } from "@/lib/dashboards/system/period";
import type { FilterOptions } from "@/lib/dashboards/system/options";
import { DateRangeField } from "@/components/ui/DateRangeField";
import { formatDateLabel } from "@/lib/dates/typed-date";
import { useDashboardNav } from "./DashboardNav";
import { MAX_SAVED_FILTERS, MAX_SAVED_NAME, SAVED_FILTER_PARAM, type SavedFilter, type SavedFilterList } from "@/lib/dashboards/system/saved-filters";

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

/** "This FY · RM, Client category" — what a saved filter holds, in a line. */
function summarise(st: FilterState): string {
  const period = st.period === "custom" && st.from
    ? `${formatDateLabel(st.from)}${st.to ? ` – ${formatDateLabel(st.to)}` : ""}`
    : PERIOD_NAMES[st.period] ?? "";
  const fields = (Object.keys(st.values) as FilterKey[]).filter((k) => st.values[k]?.length).map((k) => FILTER_FIELDS[k]?.label ?? k);
  return [period, fields.join(", ")].filter(Boolean).join(" · ");
}

export function DashboardFilterBar({
  dashboardId,
  state,
  options,
  bar,
  usingSaved,
  saved,
  /** The Operations page saves under its own dashboard id but lives at its own path. */
  savePath,
  allTime = false,
}: {
  dashboardId: string;
  state: FilterState;
  /** The dashboard's default filter — what a first visit shows. "Clear all"
   *  does NOT return to it (that re-applied Status: Open on Operations). */
  defaults: FilterState;
  options: FilterOptions;
  bar: { rm: boolean; branch: boolean; extras: FilterKey[]; pinned: FilterKey[] };
  usingSaved: boolean;
  /** The viewer's saved filters for this dashboard, and which one is showing. */
  saved?: SavedFilterList;
  savePath?: string;
  /** The firm has the "dashboardAllTime" flag: offer "All time" as a period. */
  allTime?: boolean;
}) {
  const nav = useDashboardNav();
  const router = useRouter();
  const pathname = usePathname();
  const [draft, setDraft] = useState<FilterState>(state);
  const [listOpen, setListOpen] = useState(false);
  const [decideOpen, setDecideOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
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
  // Operations page's tab, a view toggle) stays where it was. `sf` names the saved
  // filter showing: undefined leaves it, null clears it, an id sets it.
  function push(next: FilterState, sf?: string | null) {
    const keep = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
    for (const k of ["period", "from", "to", ...Object.values(FILTER_FIELDS).map((f) => f.param)]) keep.delete(k);
    for (const [k, v] of filterStateToParams(tidyRange(next))) keep.set(k, v);
    if (sf === null) keep.delete(SAVED_FILTER_PARAM);
    else if (sf) keep.set(SAVED_FILTER_PARAM, sf);
    nav.go(`${pathname}?${keep.toString()}`);
  }

  const items = saved?.items ?? [];
  const active = items.find((i) => i.id === saved?.activeId) ?? null;
  // The filters on screen differ from the saved one that is showing.
  const changed = !!active && !same(tidyRange(draft), tidyRange(active.state));

  const prefsUrl = savePath ?? `/api/dashboards/${dashboardId}/prefs`;
  async function post(body: object): Promise<{ id: string | null }> {
    const res = await fetch(prefsUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.error ?? "Could not save the filter");
    return j;
  }
  /** Run a change to the saved list: busy while it runs, a toast if it fails. */
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try { await fn(); } catch (e) { notify.error(e instanceof Error ? e.message : "Could not save the filter"); } finally { setBusy(false); }
  }

  /** "Save filter": a saved filter is showing -> ask overwrite or new; otherwise name a new one. */
  function save() {
    if (active) setDecideOpen(true);
    else void saveAsNew();
  }
  async function saveAsNew(suggest = "") {
    const name = await promptDialog({
      title: "Save this filter",
      message: "Name it so you can pick it again from Saved filters.",
      label: "Filter name",
      defaultValue: suggest,
      confirmLabel: "Save",
      maxLength: MAX_SAVED_NAME,
    });
    if (name === null) return;
    await run(async () => {
      const r = await post({ savedFilter: { op: "create", name, state: tidyRange(draft) } });
      notify.success(`Saved as \u201c${name}\u201d`);
      push(draft, r.id);
      router.refresh();
    });
  }
  async function overwrite() {
    if (!active) return;
    setDecideOpen(false);
    await run(async () => {
      await post({ savedFilter: { op: "update", id: active.id, state: tidyRange(draft) } });
      notify.success(`\u201c${active.name}\u201d updated`);
      push(draft, active.id);
      router.refresh();
    });
  }

  function choose(item: SavedFilter) {
    setListOpen(false);
    setDraft(item.state);
    setPeriodOpen(false);
    push(item.state, item.id);
  }
  async function toggleDefault(item: SavedFilter) {
    const makeNone = saved?.defaultId === item.id;
    await run(async () => {
      await post({ savedFilter: { op: "default", id: makeNone ? null : item.id } });
      notify.success(makeNone ? "The dashboard will open with its usual filters" : `The dashboard will open with \u201c${item.name}\u201d`);
      router.refresh();
    });
  }
  async function rename(item: SavedFilter) {
    const name = await promptDialog({ title: "Rename saved filter", label: "Filter name", defaultValue: item.name, confirmLabel: "Rename", maxLength: MAX_SAVED_NAME });
    if (name === null || name === item.name) return;
    await run(async () => {
      await post({ savedFilter: { op: "update", id: item.id, name } });
      notify.success("Renamed");
      router.refresh();
    });
  }
  async function remove(item: SavedFilter) {
    const yes = await confirmDialog({
      title: `Delete \u201c${item.name}\u201d?`,
      message: "This removes the saved filter. The filters you have on screen stay as they are.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!yes) return;
    await run(async () => {
      await post({ savedFilter: { op: "delete", id: item.id } });
      notify.success("Saved filter deleted");
      if (active?.id === item.id) push(draft, null);
      router.refresh();
    });
  }

  // Close the saved-filters list on a click outside it, or Escape.
  useEffect(() => {
    if (!listOpen) return;
    const down = (e: MouseEvent) => { if (listRef.current && !listRef.current.contains(e.target as Node)) setListOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setListOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [listOpen]);

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
                  {[...PERIOD_KEYS.filter((k) => k !== "custom"), ...(allTime ? [ALL_TIME] : [])].map((k) => (
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

        {/* Apply and Save wrap together, never one without the other. Apply
            shows once the draft differs from the page — a disabled primary
            button sitting in the bar all day read as broken. */}
        <span className="inline-flex shrink-0 items-center gap-2">
          {(dirty || nav.pending) && (
            <button
              type="button"
              className={buttonClass("primary", "sm")}
              disabled={busy || nav.pending || needsRange}
              title={needsRange ? "Pick a start and an end date for the custom range" : undefined}
              onClick={() => { setPeriodOpen(false); push(draft); }}
            >
              {nav.pending ? "Applying…" : "Apply"}
            </button>
          )}
          <div className="relative" ref={listRef}>
            <button
              type="button"
              className={buttonClass("secondary", "sm")}
              aria-expanded={listOpen}
              aria-haspopup="menu"
              onClick={() => setListOpen((o) => !o)}
              title="Your saved filters for this dashboard"
            >
              <Bookmark className="size-3.5" aria-hidden />
              <span className="max-w-40 truncate">{active ? active.name : items.length ? `Saved filters (${items.length})` : "Saved filters"}</span>
              <ChevronDown className="size-3.5" aria-hidden />
            </button>
            {listOpen && (
              <div role="menu" className="absolute right-0 top-full z-40 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-1 shadow-lg">
                {items.length === 0 ? (
                  <p className="px-3 py-3 text-sm text-muted-foreground">
                    No saved filters yet. Set the filters you want, then click <b className="font-semibold text-foreground">Save filter</b> to keep them here.
                  </p>
                ) : (
                  <ul className="max-h-80 overflow-y-auto">
                    {items.map((i) => (
                      <li key={i.id} className={`flex items-center gap-0.5 rounded-md ${i.id === active?.id ? "bg-secondary" : "hover:bg-secondary/70"}`}>
                        <button type="button" role="menuitem" className="min-w-0 flex-1 px-3 py-2 text-left" onClick={() => choose(i)}>
                          <span className="block truncate text-sm font-medium">{i.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{summarise(i.state)}</span>
                        </button>
                        <button
                          type="button"
                          className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
                          disabled={busy}
                          onClick={() => toggleDefault(i)}
                          aria-pressed={saved?.defaultId === i.id}
                          title={saved?.defaultId === i.id ? "Opens with this filter - click to stop" : "Open the dashboard with this filter"}
                        >
                          <Star className={`size-3.5 ${saved?.defaultId === i.id ? "fill-amber-400 text-amber-500" : ""}`} aria-hidden />
                          <span className="sr-only">Open the dashboard with {i.name}</span>
                        </button>
                        <button
                          type="button"
                          className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-background hover:text-foreground disabled:opacity-50"
                          disabled={busy}
                          onClick={() => rename(i)}
                          title="Rename"
                        >
                          <Pencil className="size-3.5" aria-hidden />
                          <span className="sr-only">Rename {i.name}</span>
                        </button>
                        <button
                          type="button"
                          className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-background hover:text-destructive disabled:opacity-50"
                          disabled={busy}
                          onClick={() => remove(i)}
                          title="Delete"
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                          <span className="sr-only">Delete {i.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {items.length >= MAX_SAVED_FILTERS && (
                  <p className="px-3 pb-2 pt-1 text-xs text-muted-foreground">You have {MAX_SAVED_FILTERS} saved filters, the most you can keep.</p>
                )}
              </div>
            )}
          </div>
          <button type="button" className={buttonClass("secondary", "sm")} disabled={busy || nav.pending || needsRange} onClick={save}>
            Save filter
          </button>
        </span>
      </div>

      {panelOpen && overflow.length > 0 && (
        <div className="flex flex-wrap gap-2 lg:justify-end">{overflow.map(fieldControl)}</div>
      )}

      {(chipValues.length > 0 || usingSaved || active) && (
        <div className="flex flex-wrap items-center gap-1.5 lg:justify-end text-xs">
          {active ? (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              Saved filter: <b className="font-semibold text-foreground">{active.name}</b>
              {(changed || dirty) && <span>(changed)</span>}
              <button
                type="button"
                className="-my-1 inline-grid size-6 place-items-center rounded-full hover:bg-secondary"
                aria-label="Stop using this saved filter"
                title="Stop using this saved filter (the filters stay as they are)"
                onClick={() => push(draft, null)}
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ) : usingSaved && !dirty ? (
            <span className="text-muted-foreground">Saved filter</span>
          ) : null}
          {chipValues.map((c) => (
            <span key={`${c.k}:${c.v}`} className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/60 px-2 py-0.5">
              <span className="text-muted-foreground">{FILTER_FIELDS[c.k].label}:</span> {c.label}
              <button
                type="button"
                // 24px hit area (the floor) without making the chip taller.
                className="-my-1 -mr-1.5 inline-grid size-6 place-items-center rounded-full hover:bg-secondary"
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
              className="inline-flex min-h-6 items-center rounded px-1 text-primary hover:underline"
              onClick={() => {
                // Clear every filter, keep the period. It used to push the
                // dashboard's DEFAULTS, so on the Operations Dashboard (default
                // Status: Open) "Clear all" put the Open filter straight back.
                // The URL still carries the period, so the page reads this as an
                // explicit, empty filter rather than "no filter → use defaults".
                const cleared: FilterState = { ...draft, values: {} };
                setDraft(cleared);
                setAdded([]);
                push(cleared);
              }}
            >
              Clear all
            </button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={decideOpen}
        title={`Save changes to \u201c${active?.name ?? ""}\u201d?`}
        message="Overwrite it with the filters on screen, or leave it as it is and save these filters as a new saved filter."
        confirmLabel="Overwrite"
        busy={busy}
        secondary={{ label: "Save as new\u2026", onClick: () => { setDecideOpen(false); void saveAsNew(active ? `${active.name} copy` : ""); } }}
        onConfirm={overwrite}
        onCancel={() => setDecideOpen(false)}
      />
    </div>
  );
}
