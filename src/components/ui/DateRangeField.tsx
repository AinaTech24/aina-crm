"use client";

/**
 * From–To dates with the calendar INLINE — for filter menus and panels.
 *
 * A floating calendar opened from inside a dropdown has nowhere good to go: it
 * covers the menu it came from (the native date input did exactly that on the
 * dashboard period menu). Here the calendar is part of the menu: two typed
 * fields on top, one month below that shows the range.
 *
 * Click a start day, then an end day; the span between is shaded, and hovering
 * previews it. Clicking again starts a new range. A day before the start
 * becomes the new start. Either field can also be typed (30-09-2026,
 * 30 Sep 2026 …) and each bounds the other, so the range can't run backwards.
 */

import { useEffect, useState } from "react";
import { DatePicker } from "./DatePicker";
import { CalendarMonth } from "./CalendarMonth";
import { fromIsoDate, toIsoDate } from "@/lib/dates/typed-date";

export function DateRangeField({
  from,
  to,
  onChange,
  min,
  max,
  fromLabel = "From",
  toLabel = "To",
  size = "sm",
}: {
  from: string;
  to: string;
  /** Called with both ends; `to` is "" while only the start is chosen. */
  onChange: (from: string, to: string) => void;
  min?: string;
  max?: string;
  fromLabel?: string;
  toLabel?: string;
  size?: "sm" | "md";
}) {
  const anchor = fromIsoDate(to) ?? fromIsoDate(from) ?? new Date();
  const [view, setView] = useState(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const [focusDay, setFocusDay] = useState<Date>(anchor);

  // Typing a date moves the calendar to it.
  useEffect(() => {
    const d = fromIsoDate(to) ?? fromIsoDate(from);
    if (d) setView(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [from, to]);

  function pick(d: Date) {
    const iso = toIsoDate(d);
    if (!from || to || iso < from) onChange(iso, "");
    else onChange(from, iso);
  }

  const showFrom = (d?: string) => (d ? fromIsoDate(d) : null);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="block min-w-0">
          <span className="mb-1 block text-2xs text-muted-foreground">{fromLabel}</span>
          <DatePicker
            value={from}
            withCalendar={false}
            size={size}
            min={min}
            max={to || max}
            ariaLabel={fromLabel}
            onChange={(v) => onChange(v, v && to && v > to ? "" : to)}
            onFieldFocus={() => {
              const d = showFrom(from);
              if (d) setView(new Date(d.getFullYear(), d.getMonth(), 1));
            }}
          />
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-2xs text-muted-foreground">{toLabel}</span>
          <DatePicker
            value={to}
            withCalendar={false}
            size={size}
            min={from || min}
            max={max}
            ariaLabel={toLabel}
            onChange={(v) => onChange(from, v)}
            onFieldFocus={() => {
              const d = showFrom(to);
              if (d) setView(new Date(d.getFullYear(), d.getMonth(), 1));
            }}
          />
        </label>
      </div>
      <div className="rounded-lg border border-border p-2">
        <CalendarMonth
          view={view}
          onViewChange={setView}
          min={min}
          max={max}
          range={{ from, to }}
          onPick={pick}
          focusDay={focusDay}
          onFocusDayChange={setFocusDay}
          label="Date range"
          compact
        />
        <p className="mt-1.5 text-2xs text-muted-foreground" aria-live="polite">
          {!from ? "Pick the first day." : !to ? "Now pick the last day." : "Pick a day to start a new range."}
        </p>
      </div>
    </div>
  );
}

/**
 * One date with the calendar INLINE — the single-date sibling of
 * DateRangeField, for "since a date" style choices inside a menu.
 */
export function DateFieldInline({
  value,
  onChange,
  min,
  max,
  label = "Date",
  size = "sm",
}: {
  value: string;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  label?: string;
  size?: "sm" | "md";
}) {
  const anchor = fromIsoDate(value) ?? new Date();
  const [view, setView] = useState(() => new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const [focusDay, setFocusDay] = useState<Date>(anchor);

  useEffect(() => {
    const d = fromIsoDate(value);
    if (d) setView(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [value]);

  return (
    <div className="space-y-2">
      <DatePicker value={value} withCalendar={false} size={size} min={min} max={max} ariaLabel={label} onChange={onChange} />
      <div className="rounded-lg border border-border p-2">
        <CalendarMonth
          view={view}
          onViewChange={setView}
          min={min}
          max={max}
          selected={value}
          onPick={(d) => onChange(toIsoDate(d))}
          focusDay={focusDay}
          onFocusDayChange={setFocusDay}
          label={label}
          compact
        />
      </div>
    </div>
  );
}
