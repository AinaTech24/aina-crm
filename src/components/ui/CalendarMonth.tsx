"use client";

/**
 * One month of the CRM calendar — shared by the date field's popup
 * (DatePicker) and the inline range calendar in filter menus (DateRangeField).
 *
 * Header: ‹ [Month ▾] [Year ▾] ›. The dropdowns are native <select>s on purpose:
 * OS keyboard search (type "19" to jump to 1990) and a list that renders above
 * any popup with no z-index work.
 *
 * Grid keys: arrows move a day or a week, Page Up/Down a month (with Shift a
 * year), Home/End the ends of the week, Enter/Space pick, Escape hands back to
 * the caller. Only the focused day is a tab stop (roving tabindex).
 *
 * Selection is either one day (`selected`) or a range (`range`). While a range
 * has a start and no end, hovering previews the span.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MONTH_NAMES, MONTH_SHORT, formatDateLong, toIsoDate, withinBounds } from "@/lib/dates/typed-date";

const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Same day-of-month `n` months away, clamped to that month's last day. */
export function addMonthsClamped(d: Date, n: number): Date {
  const last = new Date(d.getFullYear(), d.getMonth() + n + 1, 0).getDate();
  return new Date(d.getFullYear(), d.getMonth() + n, Math.min(d.getDate(), last));
}

/**
 * Years in the dropdown, newest first: bounded by min/max when set (a date of
 * birth caps at today), otherwise a century back and a decade ahead. The year
 * on screen is always included.
 */
function yearRange(min: string | undefined, max: string | undefined, showing: number): number[] {
  const now = new Date().getFullYear();
  let lo = min ? Number(min.slice(0, 4)) : now - 100;
  let hi = max ? Number(max.slice(0, 4)) : now + 10;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) {
    lo = now - 100;
    hi = now + 10;
  }
  lo = Math.min(lo, showing);
  hi = Math.max(hi, showing);
  const out: number[] = [];
  for (let v = hi; v >= lo; v--) out.push(v);
  return out;
}

export function CalendarMonth({
  view,
  onViewChange,
  min,
  max,
  selected,
  range,
  onPick,
  focusDay,
  onFocusDayChange,
  autoFocusDay,
  onEscape,
  footer,
  label = "date",
  compact,
}: {
  /** Any day in the month shown. */
  view: Date;
  onViewChange: (firstOfMonth: Date) => void;
  min?: string;
  max?: string;
  /** Single selection (yyyy-mm-dd). */
  selected?: string;
  /** Range selection (yyyy-mm-dd each; either may be empty). */
  range?: { from: string; to: string };
  onPick: (d: Date) => void;
  focusDay: Date;
  onFocusDayChange: (d: Date) => void;
  /** Put keyboard focus on `focusDay` when the month first renders. */
  autoFocusDay?: boolean;
  onEscape?: () => void;
  footer?: ReactNode;
  /** What is being chosen, for the grid's accessible name. */
  label?: string;
  /** Narrow host (a filter menu): month names shortened in the dropdown. */
  compact?: boolean;
}) {
  const gridRef = useRef<HTMLDivElement>(null);
  const kbdRef = useRef(!!autoFocusDay);
  const [hover, setHover] = useState<string | null>(null);

  const y = view.getFullYear();
  const m = view.getMonth();
  const years = useMemo(() => yearRange(min, max, y), [min, max, y]);
  const todayIso = toIsoDate(new Date());
  const focusIso = toIsoDate(focusDay);

  const first = new Date(y, m, 1);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) days.push(addDays(first, i - first.getDay()));
  const tabStop = days.some((d) => toIsoDate(d) === focusIso && d.getMonth() === m) ? focusIso : toIsoDate(first);

  // Keyboard moves focus to the day it lands on, once that day is rendered.
  useEffect(() => {
    if (!kbdRef.current) return;
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-day="${focusIso}"]`)?.focus();
  }, [focusIso, m, y]);

  function step(to: Date) {
    kbdRef.current = false;
    onViewChange(new Date(to.getFullYear(), to.getMonth(), 1));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    let next: Date | null = null;
    switch (e.key) {
      case "ArrowLeft": next = addDays(focusDay, -1); break;
      case "ArrowRight": next = addDays(focusDay, 1); break;
      case "ArrowUp": next = addDays(focusDay, -7); break;
      case "ArrowDown": next = addDays(focusDay, 7); break;
      case "PageUp": next = addMonthsClamped(focusDay, e.shiftKey ? -12 : -1); break;
      case "PageDown": next = addMonthsClamped(focusDay, e.shiftKey ? 12 : 1); break;
      case "Home": next = addDays(focusDay, -focusDay.getDay()); break;
      case "End": next = addDays(focusDay, 6 - focusDay.getDay()); break;
      case "Escape":
        if (onEscape) {
          e.preventDefault();
          e.stopPropagation();
          onEscape();
        }
        return;
      default:
        return;
    }
    e.preventDefault();
    kbdRef.current = true;
    onFocusDayChange(next);
    if (next.getMonth() !== m || next.getFullYear() !== y) onViewChange(new Date(next.getFullYear(), next.getMonth(), 1));
  }

  // Range shading: the committed span, or the preview while an end is pending.
  const from = range?.from || "";
  const to = range?.to || (from && hover && hover >= from ? hover : "");

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-1">
        <button type="button" onClick={() => step(new Date(y, m - 1, 1))} className="btn-icon size-8 shrink-0" aria-label="Previous month" data-first-stop>
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5">
          <select
            aria-label="Month"
            value={m}
            onChange={(e) => step(new Date(y, Number(e.target.value), 1))}
            className="h-8 min-w-0 flex-1 cursor-pointer rounded-md border border-border bg-card px-2 text-sm font-semibold hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring/30"
          >
            {(compact ? MONTH_SHORT : MONTH_NAMES).map((n, i) => (
              <option key={n} value={i}>{n}</option>
            ))}
          </select>
          <select
            aria-label="Year"
            value={y}
            onChange={(e) => step(new Date(Number(e.target.value), m, 1))}
            className="h-8 w-20 shrink-0 cursor-pointer rounded-md border border-border bg-card px-2 text-sm font-semibold tabular-nums hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-ring/30"
          >
            {years.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
        <button type="button" onClick={() => step(new Date(y, m + 1, 1))} className="btn-icon size-8 shrink-0" aria-label="Next month">
          <ChevronRight className="size-4" aria-hidden />
        </button>
      </div>

      <div ref={gridRef} role="grid" aria-label={`${label}: ${MONTH_NAMES[m]} ${y}`} onKeyDown={onKeyDown} onMouseLeave={() => setHover(null)}>
        <div role="row" className="grid grid-cols-7 text-center">
          {DOW.map((d) => (
            <div key={d} role="columnheader" className="py-1 text-2xs font-semibold text-muted-foreground">{d}</div>
          ))}
        </div>
        {[0, 1, 2, 3, 4, 5].map((w) => (
          <div key={w} role="row" className="grid grid-cols-7 gap-y-0.5">
            {days.slice(w * 7, w * 7 + 7).map((d) => {
              const dIso = toIsoDate(d);
              const inMonth = d.getMonth() === m;
              const isToday = dIso === todayIso;
              const allowed = withinBounds(dIso, min, max);
              const isEnd = range ? dIso === from || dIso === to : dIso === selected;
              const between = !!(range && from && to && dIso > from && dIso < to);
              return (
                <div key={dIso} role="gridcell" aria-selected={isEnd || between} className={between ? "bg-brand-cyan/10" : ""}>
                  <button
                    type="button"
                    data-day={dIso}
                    tabIndex={dIso === tabStop ? 0 : -1}
                    disabled={!allowed}
                    aria-label={formatDateLong(d)}
                    aria-current={isToday ? "date" : undefined}
                    onClick={() => onPick(d)}
                    onMouseEnter={() => range && setHover(dIso)}
                    onFocus={() => {
                      if (dIso !== focusIso) onFocusDayChange(d);
                    }}
                    className={`h-9 w-full rounded-md text-sm tabular-nums transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring
                      ${isEnd ? "bg-brand-cyan font-semibold text-white hover:bg-brand-cyan" : inMonth ? "text-foreground hover:bg-secondary" : "text-muted-foreground/50 hover:bg-secondary"}
                      ${isToday && !isEnd ? "font-semibold ring-1 ring-inset ring-brand-cyan/50" : ""}
                      disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent`}
                  >
                    {d.getDate()}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {footer}
    </div>
  );
}
