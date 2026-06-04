"use client";

/**
 * Zoho-CRM-style filter bar — generic, drop-in for any list page.
 *
 * Renders a horizontal strip with:
 *   - Search input (full-text, free-form)
 *   - Multi-select chip filters (status, owner, source, segment …)
 *   - Single-select dropdowns (when needed)
 *   - Date-range pickers (created, due, etc.)
 *   - "Clear" button when any filter is active
 *
 * All state is encoded into URL search params so the SSR'd list page can
 * read them and apply WHERE clauses. URLs are shareable / bookmarkable.
 *
 * Designed to pair with <CustomViews> which saves filter combos by name.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, X, ChevronDown, Filter as FilterIcon, Loader2 } from "lucide-react";

export type FilterDef =
  | { type: "search"; key: string; placeholder?: string }
  | { type: "select"; key: string; label: string; options: { value: string; label: string }[] }
  | { type: "multi"; key: string; label: string; options: { value: string; label: string }[] }
  | { type: "date_range"; key: string; label: string };

export function FilterBar({
  filters,
  totalCount,
  rightSlot,
}: {
  filters: FilterDef[];
  /** Show "Showing N of M" — pass the count returned by the SSR'd query. */
  totalCount?: number;
  /** Optional slot for "Custom views" or other right-aligned controls. */
  rightSlot?: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [busy, setBusy] = useState(false);

  // Read current values from the URL
  const values = useMemo(() => {
    const out: Record<string, any> = {};
    for (const f of filters) {
      if (f.type === "multi") {
        const v = sp.get(f.key);
        out[f.key] = v ? v.split(",").filter(Boolean) : [];
      } else if (f.type === "date_range") {
        out[`${f.key}_from`] = sp.get(`${f.key}_from`) ?? "";
        out[`${f.key}_to`] = sp.get(`${f.key}_to`) ?? "";
      } else {
        out[f.key] = sp.get(f.key) ?? "";
      }
    }
    return out;
  }, [sp, filters]);

  function pushParams(next: Record<string, any>) {
    setBusy(true);
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) {
        params.delete(k);
      } else if (Array.isArray(v)) {
        params.set(k, v.join(","));
      } else {
        params.set(k, String(v));
      }
    }
    // Any filter/search change resets paging — otherwise you can land on an
    // out-of-range page of a now-smaller result set and see nothing.
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
    // Keep "busy" on until route transition completes — Next.js refresh hooks
    // would expose this cleanly; for now a short timer is fine.
    setTimeout(() => setBusy(false), 600);
  }

  const activeCount = filters.reduce((n, f) => {
    if (f.type === "multi") return n + ((values[f.key] as string[]).length > 0 ? 1 : 0);
    if (f.type === "date_range")
      return n + (values[`${f.key}_from`] || values[`${f.key}_to`] ? 1 : 0);
    return n + (values[f.key] ? 1 : 0);
  }, 0);

  function clearAll() {
    pushParams(
      filters.reduce((acc, f) => {
        if (f.type === "multi") acc[f.key] = [];
        else if (f.type === "date_range") {
          acc[`${f.key}_from`] = "";
          acc[`${f.key}_to`] = "";
        } else acc[f.key] = "";
        return acc;
      }, {} as Record<string, any>)
    );
  }

  const searchFilter = filters.find((f) => f.type === "search") as
    | { type: "search"; key: string; placeholder?: string }
    | undefined;
  const otherFilters = filters.filter((f) => f.type !== "search");

  // `relative z-30` on the root gives the toolbar its own stacking context that
  // sits ABOVE the results table below it — otherwise the table (a later sibling
  // in the DOM) paints over any open filter / "View" dropdown, making the
  // dropdown look transparent / cut off.
  return (
    <div className="card-surface p-3 space-y-2 relative z-30">
      <div className="flex items-center gap-2 flex-wrap">
        {searchFilter && (
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
            <SearchInput
              initial={values[searchFilter.key] ?? ""}
              placeholder={searchFilter.placeholder ?? "Search…"}
              onSubmit={(v) => pushParams({ [searchFilter.key]: v })}
            />
          </div>
        )}

        {otherFilters.map((f) =>
          f.type === "multi" ? (
            <MultiSelectChip
              key={f.key}
              label={f.label}
              options={f.options}
              value={values[f.key] as string[]}
              onChange={(v) => pushParams({ [f.key]: v })}
            />
          ) : f.type === "select" ? (
            <SingleSelect
              key={f.key}
              label={f.label}
              options={f.options}
              value={values[f.key] as string}
              onChange={(v) => pushParams({ [f.key]: v })}
            />
          ) : f.type === "date_range" ? (
            <DateRange
              key={f.key}
              label={f.label}
              from={values[`${f.key}_from`] as string}
              to={values[`${f.key}_to`] as string}
              onChange={(from, to) =>
                pushParams({ [`${f.key}_from`]: from, [`${f.key}_to`]: to })
              }
            />
          ) : null
        )}

        {activeCount > 0 && (
          <button
            onClick={clearAll}
            className="btn-ghost text-xs text-muted-foreground hover:text-rose-600"
          >
            <X className="size-3" /> Clear ({activeCount})
          </button>
        )}

        <div className="flex-1" />

        {busy && <Loader2 className="size-3.5 animate-spin text-brand-cyan" />}
        {totalCount != null && (
          <span className="text-xs text-muted-foreground tabular-nums">
            {totalCount.toLocaleString("en-IN")} result{totalCount === 1 ? "" : "s"}
          </span>
        )}
        {rightSlot}
      </div>
    </div>
  );
}

/* ─────────────────── Sub-components ─────────────────── */

function SearchInput({
  initial,
  placeholder,
  onSubmit,
}: {
  initial: string;
  placeholder: string;
  onSubmit: (v: string) => void;
}) {
  const [v, setV] = useState(initial);
  useEffect(() => setV(initial), [initial]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        placeholder={placeholder}
        className="input-base pl-9 text-xs h-8"
      />
    </form>
  );
}

function MultiSelectChip({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const active = value.length > 0;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 h-8 text-xs font-medium transition ${
          active
            ? "bg-brand-cyan-light/40 border-brand-cyan/40 text-brand-cyan-deep"
            : "bg-card border-border hover:bg-secondary"
        }`}
      >
        <FilterIcon className="size-3" />
        <span>{label}</span>
        {active && (
          <span className="bg-brand-cyan text-white rounded-full px-1.5 text-[10px] font-bold tabular-nums">
            {value.length}
          </span>
        )}
        <ChevronDown className="size-3 opacity-60" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 card-elevated bg-card p-1.5 min-w-[200px] max-h-64 overflow-y-auto scrollbar-thin">
          {options.length === 0 ? (
            <div className="text-[11px] text-muted-foreground p-2">No options</div>
          ) : (
            <ul className="space-y-0.5">
              {options.map((o) => {
                const checked = value.includes(o.value);
                return (
                  <li key={o.value}>
                    <label className="flex items-center gap-2 px-2 py-1.5 text-xs hover:bg-secondary rounded cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = checked
                            ? value.filter((v) => v !== o.value)
                            : [...value, o.value];
                          onChange(next);
                        }}
                        className="size-3.5 rounded border-border text-brand-cyan focus:ring-brand-cyan"
                      />
                      <span className="capitalize">{o.label}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function SingleSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`rounded-lg border px-2 h-8 text-xs font-medium bg-card focus:outline-none focus:ring-2 focus:ring-brand-cyan/30 ${
          value ? "border-brand-cyan/40 bg-brand-cyan-light/40 text-brand-cyan-deep" : "border-border"
        }`}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Quick presets → compute [from, to] as yyyy-mm-dd. India FY = Apr–Mar. */
function rangePreset(key: string): [string, string] {
  const now = new Date();
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const y = now.getFullYear(), m = now.getMonth();
  const fyStartYear = m >= 3 ? y : y - 1;
  const qStartMonth = m >= 3 && m <= 5 ? 3 : m >= 6 && m <= 8 ? 6 : m >= 9 && m <= 11 ? 9 : 0;
  switch (key) {
    case "today": return [iso(now), iso(now)];
    case "yesterday": { const d = new Date(now); d.setDate(d.getDate() - 1); return [iso(d), iso(d)]; }
    case "7d": { const d = new Date(now); d.setDate(d.getDate() - 6); return [iso(d), iso(now)]; }
    case "30d": { const d = new Date(now); d.setDate(d.getDate() - 29); return [iso(d), iso(now)]; }
    case "month": return [iso(new Date(y, m, 1)), iso(now)];
    case "lastmonth": { const s = new Date(y, m - 1, 1); const e = new Date(y, m, 0); return [iso(s), iso(e)]; }
    case "quarter": return [iso(new Date(qStartMonth === 0 ? y : y, qStartMonth, 1)), iso(now)];
    case "fy": return [iso(new Date(fyStartYear, 3, 1)), iso(now)];
    default: return ["", ""];
  }
}
const PRESETS: Array<[string, string]> = [
  ["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"], ["30d", "Last 30 days"],
  ["month", "This month"], ["lastmonth", "Last month"], ["quarter", "This quarter"], ["fy", "This FY"],
];

function DateRange({
  label,
  from,
  to,
  onChange,
}: {
  label: string;
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  const active = !!(from || to);
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 h-8 text-xs ${
        active ? "border-brand-cyan/40 bg-brand-cyan-light/40" : "border-border bg-card"
      }`}
    >
      <span className="text-muted-foreground">{label}</span>
      <select
        value=""
        onChange={(e) => { if (e.target.value) { const [f, t] = rangePreset(e.target.value); onChange(f, t); } }}
        className="bg-transparent text-xs outline-none cursor-pointer"
        title="Quick range"
      >
        <option value="">Range…</option>
        {PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      <span className="text-muted-foreground/50">|</span>
      <input
        type="date"
        value={from}
        onChange={(e) => onChange(e.target.value, to)}
        className="bg-transparent text-xs outline-none"
        title="From"
      />
      <span className="text-muted-foreground">→</span>
      <input
        type="date"
        value={to}
        onChange={(e) => onChange(from, e.target.value)}
        className="bg-transparent text-xs outline-none"
        title="To"
      />
      {active && (
        <button
          onClick={() => onChange("", "")}
          className="text-muted-foreground hover:text-rose-600 ml-1"
          aria-label="Clear date range"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}
