"use client";

/**
 * ColumnManager — per-user, per-module "manage columns" dropdown.
 *
 * Design choice: instead of conditionally rendering columns from a client
 * wrapper around each table (which would require rebuilding 15+ list
 * pages as client components), we leave the server-rendered tables
 * untouched and inject a tiny <style> block that hides the columns the
 * user has unchecked.
 *
 * Wiring on a list page:
 *
 *   <table data-table="leads">
 *     <thead>
 *       <tr>
 *         <th data-col="name">Name</th>
 *         <th data-col="email">Email</th>
 *         ...
 *       </tr>
 *     </thead>
 *     <tbody>
 *       <tr>
 *         <td data-col="name">...</td>
 *         <td data-col="email">...</td>
 *       </tr>
 *     </tbody>
 *   </table>
 *
 *   <ColumnManager
 *     moduleKey="leads"
 *     columns={[
 *       { key: "name", label: "Name", required: true },
 *       { key: "email", label: "Email" },
 *       ...
 *     ]}
 *   />
 *
 * The component:
 *   - Reads/writes the hidden-set to `localStorage` under key
 *     `cols:<moduleKey>` (per browser, per user — good enough for v1).
 *   - Emits scoped CSS:
 *       [data-table="leads"] [data-col="email"] { display: none !important; }
 *   - Required columns can't be unchecked.
 *   - Defaults: columns marked `defaultHidden: true` start hidden.
 *
 * Flash-of-content: the table briefly renders with all columns before
 * the style block kicks in (~16ms). Acceptable for v1; can be fixed
 * later with an inline pre-paint script if it bothers users.
 */

import { useEffect, useMemo, useState, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Columns3, Check, RotateCcw, ArrowUp, ArrowDown, Plus, Search } from "lucide-react";
import {
  EXTRA_PREFIX,
  MAX_EXTRA_COLUMNS,
  moveKey,
  orderKeys,
  prefsCookieName,
  serializePrefs,
  type ColumnPrefs,
} from "@/lib/list-columns/prefs";
import type { ExtraFieldDef } from "@/lib/list-columns/types";

export type ColumnDef = {
  /** Matches `data-col="…"` on the <th> and <td>. */
  key: string;
  /** Human label shown in the dropdown. */
  label: string;
  /** Optional sub-label / group. */
  group?: string;
  /** Always shown, can't be hidden (e.g. primary identifier + actions). */
  required?: boolean;
  /** Off by default — user has to opt in. */
  defaultHidden?: boolean;
};

export function ColumnManager({
  moduleKey,
  columns,
  // Icon-only by default so every module's table toolbar is one consistent row
  // of glyphs (Filters / Sort / Columns / Views). Pass compact={false} for the
  // rare toolbar that wants the text label.
  compact = true,
  version,
  extraFields,
  prefs: initialPrefs,
  pinFirst = [],
  pinLast = [],
}: {
  moduleKey: string;
  columns: ColumnDef[];
  /**
   * Fields the person may ADD as a column ("More fields"). Needs `prefs` and a
   * table that draws `x:<key>` columns from the server (see lib/list-columns).
   */
  extraFields?: ExtraFieldDef[];
  /** The saved order + added fields, read on the server from the cookie. */
  prefs?: ColumnPrefs;
  /** Columns that never move: the name stays first, the row actions last. */
  pinFirst?: string[];
  pinLast?: string[];
  /** Icon-only trigger (no "Columns" label) — for compact toolbars. */
  compact?: boolean;
  /**
   * Bump when a page changes its DEFAULT columns. The first visit saves the
   * defaults of the day as the user's choice, so without a new key a changed
   * default never reaches anyone who has opened the page before.
   */
  version?: number;
}) {
  const storageKey = version ? `cols:${moduleKey}:v${version}` : `cols:${moduleKey}`;

  // null = not yet hydrated — we don't emit any CSS so the SSR table
  // shows fully. Once hydrated, we apply prefs.
  const [hidden, setHidden] = useState<Set<string> | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // ── Order and added fields ──────────────────────────────────────────────
  // Saved in a cookie so the SERVER draws the table already in this order and
  // with these fields; a change writes it and asks the page to re-render.
  const router = useRouter();
  const [, startNav] = useTransition();
  const orderable = !!initialPrefs;
  const [prefs, setPrefs] = useState<ColumnPrefs>(initialPrefs ?? { order: [], extra: [] });
  const [fieldQuery, setFieldQuery] = useState("");
  const extraDefs = useMemo(() => new Map((extraFields ?? []).map((f) => [f.key, f])), [extraFields]);

  function commitPrefs(next: ColumnPrefs) {
    setPrefs(next);
    try {
      document.cookie = `${prefsCookieName(moduleKey)}=${serializePrefs(next)}; path=/; max-age=31536000; samesite=lax`;
    } catch {}
    startNav(() => router.refresh());
  }

  /** Every column drawn right now, in the order it is drawn. */
  const shownKeys = useMemo(() => {
    const available = [
      ...columns.map((c) => c.key),
      ...prefs.extra.filter((k) => extraDefs.has(k)).map((k) => EXTRA_PREFIX + k),
    ];
    return orderKeys(available, prefs.order, pinFirst, pinLast);
  }, [columns, prefs, extraDefs, pinFirst, pinLast]); // eslint-disable-line react-hooks/exhaustive-deps

  const colByKey = useMemo(() => new Map(columns.map((c) => [c.key, c])), [columns]);
  const labelOf = (key: string) =>
    key.startsWith(EXTRA_PREFIX) ? extraDefs.get(key.slice(EXTRA_PREFIX.length))?.label ?? key : colByKey.get(key)?.label ?? key;

  function move(key: string, dir: -1 | 1) {
    const next = moveKey(shownKeys, key, dir, pinFirst, pinLast);
    if (next !== shownKeys) commitPrefs({ ...prefs, order: next });
  }
  function addField(fieldKey: string) {
    if (prefs.extra.includes(fieldKey) || prefs.extra.length >= MAX_EXTRA_COLUMNS) return;
    commitPrefs({ order: [...shownKeys, EXTRA_PREFIX + fieldKey], extra: [...prefs.extra, fieldKey] });
  }
  function removeField(colKey: string) {
    const f = colKey.slice(EXTRA_PREFIX.length);
    commitPrefs({ order: shownKeys.filter((k) => k !== colKey), extra: prefs.extra.filter((k) => k !== f) });
  }

  const pickable = useMemo(() => {
    const q = fieldQuery.trim().toLowerCase();
    return (extraFields ?? []).filter(
      (f) => !prefs.extra.includes(f.key) && (!q || f.label.toLowerCase().includes(q) || (f.group ?? "").toLowerCase().includes(q)),
    );
  }, [extraFields, prefs.extra, fieldQuery]);
  const pickableGroups = useMemo(() => {
    const m = new Map<string, ExtraFieldDef[]>();
    for (const f of pickable) {
      const g = f.group ?? "More";
      if (!m.has(g)) m.set(g, []);
      m.get(g)!.push(f);
    }
    return [...m.entries()];
  }, [pickable]);

  // Load prefs once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        setHidden(new Set(arr));
        return;
      }
    } catch {}
    // No personal choice → firm default (owner-set), else built-in defaultHidden.
    const firm = (typeof window !== "undefined" && (window as any).__AINA_FIRM_LAYOUTS__?.[moduleKey]?.columns) || null;
    if (Array.isArray(firm)) {
      setHidden(new Set(firm as string[]));
      return;
    }
    setHidden(
      new Set(columns.filter((c) => c.defaultHidden && !c.required).map((c) => c.key))
    );
  }, [storageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist on change.
  useEffect(() => {
    if (hidden == null) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify([...hidden]));
    } catch {}
  }, [hidden, storageKey]);

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function toggle(key: string) {
    if (columns.find((c) => c.key === key)?.required) return;
    setHidden((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function reset() {
    setHidden(
      new Set(columns.filter((c) => c.defaultHidden && !c.required).map((c) => c.key))
    );
    if (orderable && (prefs.order.length || prefs.extra.length)) commitPrefs({ order: [], extra: [] });
  }

  // Firm-admins can save the current columns as the firm-wide default.
  const canSaveFirm = typeof window !== "undefined" && (window as any).__AINA_LAYOUT_ADMIN__ === true;
  const [savedFirm, setSavedFirm] = useState(false);
  async function saveFirmDefault() {
    if (!hidden) return;
    await fetch("/api/settings/ui-layout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ moduleKey, kind: "columns", data: [...hidden] }),
    }).catch(() => {});
    setSavedFirm(true);
    setTimeout(() => setSavedFirm(false), 2000);
  }

  // Build the CSS once per hidden-set change.
  const css = useMemo(() => {
    if (!hidden || hidden.size === 0) return "";
    const sel = (key: string) =>
      `[data-table="${moduleKey}"] [data-col="${key}"]`;
    return [...hidden].map((k) => `${sel(k)} { display: none !important; }`).join("\n");
  }, [hidden, moduleKey]);

  const hiddenCount = hidden?.size ?? 0;
  const visibleCount = columns.length - hiddenCount + prefs.extra.length;

  // Group columns for the dropdown (if any have group attr).
  const grouped = useMemo(() => {
    const map = new Map<string, ColumnDef[]>();
    for (const c of columns) {
      const g = c.group ?? "";
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(c);
    }
    return [...map.entries()];
  }, [columns]);

  return (
    <>
      {css ? <style dangerouslySetInnerHTML={{ __html: css }} /> : null}
      <div className="relative" ref={rootRef}>
        {compact ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            title={`Columns (${visibleCount}/${columns.length})`}
            aria-label="Show or hide columns"
            className={`relative inline-flex items-center justify-center rounded-lg border size-8 transition ${
              hiddenCount > 0 ? "bg-brand-cyan-light/40 border-brand-cyan/40 text-brand-cyan-deep" : "bg-card border-border hover:bg-secondary"
            }`}
          >
            <Columns3 className="size-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 text-xs font-medium hover:bg-secondary inline-flex items-center gap-1.5"
            title="Show or hide columns"
          >
            <Columns3 className="size-3.5" />
            Columns
            <span className="text-2xs text-muted-foreground tabular-nums">
              {visibleCount}/{columns.length}
            </span>
          </button>
        )}
        {open && (
          <div
            className="absolute right-0 mt-1 z-50 w-72 max-h-[480px] overflow-y-auto bg-card border border-border rounded-lg shadow-xl py-1"
            role="menu"
          >
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold">Manage columns</div>
                <div className="text-2xs text-muted-foreground">
                  {orderable ? "Show, hide and reorder; add more fields." : "Pick what you want to see in the table."}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {canSaveFirm && (
                  <button
                    type="button"
                    onClick={saveFirmDefault}
                    className="text-2xs text-brand-cyan-deep hover:underline"
                    title="Make these columns the default for everyone in your firm"
                  >
                    {savedFirm ? "✓ Saved" : "Save as firm default"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={reset}
                  className="text-2xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  title="Reset to defaults"
                >
                  <RotateCcw className="size-3" /> Reset
                </button>
              </div>
            </div>
            {orderable ? (
              <>
                <div className="py-1">
                  {shownKeys.map((key, idx) => {
                    const isExtra = key.startsWith(EXTRA_PREFIX);
                    const c = isExtra ? null : colByKey.get(key);
                    const pinned = pinFirst.includes(key) || pinLast.includes(key);
                    const visible = isExtra || !(hidden?.has(key) ?? false);
                    const movable = shownKeys.filter((k) => !pinFirst.includes(k) && !pinLast.includes(k));
                    const mi = movable.indexOf(key);
                    return (
                      <div key={key} className="flex items-center gap-1 pr-2 hover:bg-accent">
                        <button
                          type="button"
                          onClick={() => (isExtra ? removeField(key) : toggle(key))}
                          disabled={!!c?.required}
                          className={`flex-1 min-w-0 text-left pl-3 py-1.5 text-sm flex items-center gap-2 ${c?.required ? "opacity-60 cursor-not-allowed" : ""}`}
                        >
                          <span
                            className={`inline-block size-4 rounded border ${
                              visible ? "bg-primary border-primary" : "bg-background border-border"
                            } flex-shrink-0 grid place-items-center`}
                          >
                            {visible && <Check className="size-3 text-primary-foreground" />}
                          </span>
                          <span className="flex-1 truncate">{labelOf(key)}</span>
                          {c?.required && <span className="text-2xs text-muted-foreground italic">required</span>}
                          {isExtra && <span className="text-2xs text-muted-foreground">added</span>}
                        </button>
                        {pinned ? (
                          <span className="w-[52px]" />
                        ) : (
                          <span className="flex items-center">
                            <button
                              type="button"
                              onClick={() => move(key, -1)}
                              disabled={mi <= 0}
                              aria-label={`Move ${labelOf(key)} up`}
                              title="Move up"
                              className="size-6 grid place-items-center rounded hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <ArrowUp className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => move(key, 1)}
                              disabled={mi < 0 || mi >= movable.length - 1}
                              aria-label={`Move ${labelOf(key)} down`}
                              title="Move down"
                              className="size-6 grid place-items-center rounded hover:bg-secondary disabled:opacity-30 disabled:cursor-not-allowed"
                            >
                              <ArrowDown className="size-3.5" />
                            </button>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                {(extraFields?.length ?? 0) > 0 && (
                  <div className="border-t border-border py-1">
                    <div className="px-3 pt-1.5 pb-1 text-2xs uppercase tracking-wider text-muted-foreground font-semibold">
                      Add a field
                      {prefs.extra.length >= MAX_EXTRA_COLUMNS && (
                        <span className="normal-case tracking-normal font-normal"> · limit of {MAX_EXTRA_COLUMNS} reached</span>
                      )}
                    </div>
                    <div className="px-3 pb-1.5">
                      <div className="relative">
                        <Search className="size-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <input
                          value={fieldQuery}
                          onChange={(e) => setFieldQuery(e.target.value)}
                          placeholder="Search fields…"
                          className="w-full rounded-md border border-border bg-background pl-7 pr-2 py-1 text-xs"
                        />
                      </div>
                    </div>
                    {pickableGroups.length === 0 ? (
                      <div className="px-3 py-2 text-2xs text-muted-foreground">No more fields match.</div>
                    ) : (
                      pickableGroups.map(([group, fields]) => (
                        <div key={group}>
                          <div className="px-3 pt-1 text-2xs text-muted-foreground">{group}</div>
                          {fields.map((f) => (
                            <button
                              key={f.key}
                              type="button"
                              onClick={() => addField(f.key)}
                              disabled={prefs.extra.length >= MAX_EXTRA_COLUMNS}
                              className="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 hover:bg-accent disabled:opacity-50"
                            >
                              <Plus className="size-3.5 text-muted-foreground" />
                              <span className="truncate">{f.label}</span>
                            </button>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
            {grouped.map(([group, cols]) => (
                <div key={group} className="py-1">
                  {group && (
                    <div className="px-3 pt-1.5 pb-0.5 text-2xs uppercase tracking-wider text-muted-foreground font-semibold">
                      {group}
                    </div>
                  )}
                  {cols.map((c) => {
                    const isHidden = hidden?.has(c.key) ?? false;
                    const visible = !isHidden;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => toggle(c.key)}
                        disabled={c.required}
                        className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 ${
                          c.required ? "opacity-60 cursor-not-allowed" : "hover:bg-accent"
                        }`}
                      >
                        <span
                          className={`inline-block size-4 rounded border ${
                            visible
                              ? "bg-primary border-primary"
                              : "bg-background border-border"
                          } flex-shrink-0 grid place-items-center`}
                        >
                          {visible && <Check className="size-3 text-primary-foreground" />}
                        </span>
                        <span className="flex-1 truncate">{c.label}</span>
                        {c.required && (
                          <span className="text-2xs text-muted-foreground italic">
                            required
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ))}
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
