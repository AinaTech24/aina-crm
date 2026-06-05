"use client";

/**
 * Custom date picker — branded calendar popup replacing the native
 * <input type="date">. Value is an ISO `yyyy-mm-dd` string (same as the native
 * input, so it's a drop-in for our forms); the trigger displays `dd-mm-yyyy`.
 *
 *   <DatePicker value={iso} onChange={setIso} />
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar as CalIcon, ChevronLeft, ChevronRight } from "lucide-react";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fromISO(s?: string): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}
export function formatDisplayDate(s?: string) {
  const d = fromISO(s);
  if (!d) return "";
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

export function DatePicker({
  value,
  onChange,
  placeholder = "dd-mm-yyyy",
  disabled,
  className = "",
  min,
  max,
  ariaLabel,
  size = "md",
  clearable = true,
}: {
  value: string;
  onChange: (iso: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  min?: string;
  max?: string;
  ariaLabel?: string;
  size?: "sm" | "md";
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [alignRight, setAlignRight] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => fromISO(value), [value]);
  const [view, setView] = useState<Date>(() => fromISO(value) ?? new Date());

  useEffect(() => {
    if (!open) return;
    setView(fromISO(value) ?? new Date());
    const el = ref.current;
    if (el && typeof window !== "undefined") {
      const rect = el.getBoundingClientRect();
      setAlignRight(window.innerWidth - rect.left < 296); // 17rem popup + margin
    }
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const y = view.getFullYear();
  const m = view.getMonth();
  const firstDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const minD = fromISO(min);
  const maxD = fromISO(max);
  const todayISO = toISO(new Date());

  const grid: Array<{ date: Date; inMonth: boolean }> = [];
  const prevDays = new Date(y, m, 0).getDate();
  for (let i = firstDow - 1; i >= 0; i--) grid.push({ date: new Date(y, m - 1, prevDays - i), inMonth: false });
  for (let d = 1; d <= daysInMonth; d++) grid.push({ date: new Date(y, m, d), inMonth: true });
  let nextDay = 1;
  while (grid.length < 42) grid.push({ date: new Date(y, m + 1, nextDay++), inMonth: false });

  function isDisabled(d: Date) {
    const iso = toISO(d);
    if (minD && iso < toISO(minD)) return true;
    if (maxD && iso > toISO(maxD)) return true;
    return false;
  }

  const sizes = size === "sm" ? "h-8 text-xs px-2.5" : "h-9 text-sm px-3";

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen((s) => !s)}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`w-full inline-flex items-center justify-between gap-2 rounded-lg border bg-card font-medium transition ${sizes}
          ${open ? "border-brand-cyan/60 ring-2 ring-brand-cyan/15" : "border-border hover:bg-secondary/60"}
          disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none`}
      >
        <span className={selected ? "text-foreground" : "text-muted-foreground"}>
          {selected ? formatDisplayDate(value) : placeholder}
        </span>
        <CalIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className={`absolute ${alignRight ? "right-0 origin-top-right" : "left-0 origin-top"} top-full mt-1 z-50 card-elevated bg-card p-3 w-[17rem] animate-scale-in`}>
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => setView(new Date(y, m - 1, 1))} className="size-7 grid place-items-center rounded-md hover:bg-secondary" aria-label="Previous month">
              <ChevronLeft className="size-4" />
            </button>
            <div className="text-sm font-semibold">{MONTHS[m]} {y}</div>
            <button type="button" onClick={() => setView(new Date(y, m + 1, 1))} className="size-7 grid place-items-center rounded-md hover:bg-secondary" aria-label="Next month">
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {DOW.map((d) => (
              <div key={d} className="text-[10px] font-semibold text-muted-foreground py-1">{d}</div>
            ))}
            {grid.map((c, i) => {
              const iso = toISO(c.date);
              const isSel = value === iso;
              const isToday = todayISO === iso;
              const dis = isDisabled(c.date);
              return (
                <button
                  key={i}
                  type="button"
                  disabled={dis}
                  onClick={() => { onChange(iso); setOpen(false); }}
                  className={`h-8 rounded-md text-xs transition
                    ${c.inMonth ? "text-foreground" : "text-muted-foreground/40"}
                    ${isSel ? "bg-brand-cyan text-white font-semibold hover:bg-brand-cyan" : "hover:bg-secondary"}
                    ${isToday && !isSel ? "ring-1 ring-brand-cyan/50" : ""}
                    disabled:opacity-30 disabled:cursor-not-allowed`}
                >
                  {c.date.getDate()}
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-border">
            {clearable ? (
              <button type="button" onClick={() => { onChange(""); setOpen(false); }} className="text-xs text-muted-foreground hover:text-rose-600">
                Clear
              </button>
            ) : <span />}
            <button type="button" onClick={() => { onChange(todayISO); setOpen(false); }} className="text-xs text-brand-cyan font-medium hover:underline">
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
