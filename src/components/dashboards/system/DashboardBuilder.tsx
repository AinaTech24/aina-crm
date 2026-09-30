"use client";

/**
 * New / Edit dashboard (D7): name and description, then widgets from the
 * library — drag to reorder (or use the arrows), size S / M / L, at most 12,
 * with a warning when the same widget is added twice. People who may manage
 * dashboards also choose which filters the dashboard offers and its default
 * period (D9).
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, GripVertical, Plus, X } from "lucide-react";
import { buttonClass } from "@/components/ui/button-class";
import { notify } from "@/components/ui/Toast";
import {
  MAX_WIDGETS, SYSTEM_WIDGETS, SYSTEM_WIDGETS_BY_KEY, duplicateWidgets, type LayoutItem, type WidgetSize,
} from "@/lib/dashboards/system/catalog";
import { EXTRA_FILTERS, FILTER_FIELDS, type FilterConfig, type FilterKey } from "@/lib/dashboards/system/filters";
import { PERIOD_KEYS, PERIOD_NAMES, type PeriodKey } from "@/lib/dashboards/system/period";

const SIZE_LABEL: Record<WidgetSize, string> = { S: "Small", M: "Half width", L: "Full width" };
const SIZE_SPAN: Record<WidgetSize, string> = { S: "col-span-4", M: "col-span-6", L: "col-span-12" };

let seq = 0;
const newId = (key: string) => `${key}-${Date.now().toString(36)}${(seq++).toString(36)}`;

export function DashboardBuilder({
  mode,
  dashboardId,
  initial,
  canConfigureFilters,
  starters,
}: {
  mode: "new" | "edit";
  dashboardId?: string;
  initial: { name: string; description: string; layout: LayoutItem[]; filters: FilterConfig };
  canConfigureFilters: boolean;
  /** System dashboards to start from (new only). */
  starters: Array<{ key: string; name: string; layout: LayoutItem[] }>;
}) {
  const router = useRouter();
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [items, setItems] = useState<LayoutItem[]>(initial.layout);
  const [fields, setFields] = useState<FilterKey[]>(initial.filters.fields.length ? initial.filters.fields : EXTRA_FILTERS);
  const [period, setPeriod] = useState<PeriodKey>(initial.filters.defaults?.period ?? "fy");
  const [drag, setDrag] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const dups = useMemo(() => duplicateWidgets(items), [items]);
  const full = items.length >= MAX_WIDGETS;
  const categories = [...new Set(SYSTEM_WIDGETS.map((w) => w.category))];

  function add(key: string) {
    if (full) return;
    const meta = SYSTEM_WIDGETS_BY_KEY[key];
    setItems((xs) => [...xs, { id: newId(key), widgetKey: key, size: meta.defaultSize }]);
  }
  function move(from: number, to: number) {
    if (to < 0 || to >= items.length || from === to) return;
    setItems((xs) => {
      const next = [...xs];
      const [x] = next.splice(from, 1);
      next.splice(to, 0, x);
      return next;
    });
  }

  async function save() {
    if (!name.trim()) return notify.error("Give the dashboard a name");
    if (!items.length) return notify.error("Add at least one widget");
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        layout: items,
        ...(canConfigureFilters ? { filterConfig: { fields, defaults: { period } } } : {}),
      };
      const res = await fetch(mode === "new" ? "/api/dashboards" : `/api/dashboards/${dashboardId}`, {
        method: mode === "new" ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error ?? "Could not save the dashboard");
      notify.success(mode === "new" ? "Dashboard created" : "Dashboard saved");
      router.push(`/dashboard/${mode === "new" ? j.id : dashboardId}`);
      router.refresh();
    } catch (e) {
      notify.error(e instanceof Error ? e.message : "Could not save the dashboard");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="xl:col-span-2 space-y-4">
        <div className="card-surface p-5 space-y-3">
          <div>
            <label htmlFor="dash-name" className="block text-sm font-medium mb-1">Name</label>
            <input id="dash-name" className="input-base w-full" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="dash-desc" className="block text-sm font-medium mb-1">Description <span className="text-muted-foreground font-normal">(optional)</span></label>
            <input id="dash-desc" className="input-base w-full" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {mode === "new" && starters.length > 0 && items.length === 0 && (
            <div>
              <div className="text-sm font-medium mb-1">Start from</div>
              <div className="flex flex-wrap gap-2">
                {starters.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className={buttonClass("secondary", "sm")}
                    onClick={() => setItems(s.layout.map((x) => ({ ...x, id: newId(x.widgetKey) })))}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="card-surface p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="section-title">Widgets</h2>
            <span className={`text-xs ${full ? "text-rose-700 font-medium" : "text-muted-foreground"}`}>{items.length} of {MAX_WIDGETS}</span>
          </div>
          {dups.length > 0 && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {dups.map((k) => SYSTEM_WIDGETS_BY_KEY[k]?.title ?? k).join(", ")} {dups.length === 1 ? "is" : "are"} on this dashboard more than once.
            </p>
          )}
          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add widgets from the library.</p>
          ) : (
            <ol className="space-y-2">
              {items.map((it, i) => {
                const meta = SYSTEM_WIDGETS_BY_KEY[it.widgetKey];
                return (
                  <li
                    key={it.id}
                    draggable
                    onDragStart={() => setDrag(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (drag != null) move(drag, i);
                      setDrag(null);
                    }}
                    className={`flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 ${drag === i ? "opacity-60" : ""}`}
                  >
                    <GripVertical className="size-4 text-muted-foreground cursor-grab" aria-hidden />
                    <span className="flex-1 min-w-0 text-sm font-medium truncate">{meta?.title ?? it.widgetKey}</span>
                    <label htmlFor={`size-${it.id}`} className="sr-only">Size</label>
                    <select
                      id={`size-${it.id}`}
                      className="input-base text-xs py-1"
                      value={it.size}
                      onChange={(e) => setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, size: e.target.value as WidgetSize } : x)))}
                    >
                      {(meta?.sizes ?? ["M"]).map((s) => (
                        <option key={s} value={s}>{s} · {SIZE_LABEL[s]}</option>
                      ))}
                    </select>
                    <button type="button" className="btn-icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}>
                      <ArrowUp className="size-4" aria-hidden />
                    </button>
                    <button type="button" className="btn-icon" aria-label="Move down" disabled={i === items.length - 1} onClick={() => move(i, i + 1)}>
                      <ArrowDown className="size-4" aria-hidden />
                    </button>
                    <button type="button" className="btn-icon" aria-label={`Remove ${meta?.title ?? "widget"}`} onClick={() => setItems((xs) => xs.filter((x) => x.id !== it.id))}>
                      <X className="size-4" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {items.length > 0 && (
            <div aria-hidden className="grid grid-cols-12 gap-1.5 pt-2">
              {items.map((it) => (
                <div key={it.id} className={`${SIZE_SPAN[it.size]} h-8 rounded-md bg-secondary text-2xs text-muted-foreground grid place-items-center truncate px-1`}>
                  {SYSTEM_WIDGETS_BY_KEY[it.widgetKey]?.title}
                </div>
              ))}
            </div>
          )}
        </div>

        {canConfigureFilters && (
          <div className="card-surface p-5 space-y-3">
            <h2 className="section-title">Filters</h2>
            <div>
              <label htmlFor="dash-period" className="block text-sm font-medium mb-1">Default period</label>
              <select id="dash-period" className="input-base" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)}>
                {PERIOD_KEYS.filter((k) => k !== "custom").map((k) => (
                  <option key={k} value={k}>{PERIOD_NAMES[k]}</option>
                ))}
              </select>
            </div>
            <fieldset>
              <legend className="text-sm font-medium mb-1">Offered under “+ Filter”</legend>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {EXTRA_FILTERS.map((k) => (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={fields.includes(k)}
                      onChange={(e) => setFields((fs) => (e.target.checked ? [...fs, k] : fs.filter((x) => x !== k)))}
                    />
                    {FILTER_FIELDS[k].label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" className={buttonClass("ghost", "md")} onClick={() => router.back()}>Cancel</button>
          <button type="button" className={buttonClass("primary", "md")} disabled={busy} onClick={save}>
            {mode === "new" ? "Create dashboard" : "Save"}
          </button>
        </div>
      </div>

      <aside className="card-surface p-4 h-fit space-y-4">
        <h2 className="section-title">Widget library</h2>
        {categories.map((c) => (
          <div key={c}>
            <div className="text-xs font-medium text-muted-foreground mb-1">{c}</div>
            <ul className="space-y-1">
              {SYSTEM_WIDGETS.filter((w) => w.category === c).map((w) => (
                <li key={w.key}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-secondary disabled:opacity-50"
                    disabled={full}
                    onClick={() => add(w.key)}
                    title={full ? `A dashboard holds at most ${MAX_WIDGETS} widgets` : undefined}
                  >
                    <Plus className="size-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{w.title}</span>
                      <span className="block text-xs text-muted-foreground">{w.description}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </aside>
    </div>
  );
}
