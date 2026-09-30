"use client";

/**
 * Drop-in replacement for <input type="datetime-local">: the CRM's date picker
 * plus a time list, side by side. Same value format as the native input —
 * `yyyy-mm-ddTHH:mm` in local time — and `onChange(e)` reading
 * `e.target.value`, so a conversion is a tag rename.
 *
 * Times come in 15-minute steps, shown as "9:30 am"; a stored time off that
 * grid (10:07) is kept and listed. Picking a date with no time yet uses
 * 10:00 am; picking a time with no date yet uses today. Clearing the date
 * clears the whole value.
 */

import { useMemo, useState } from "react";
import { DatePicker } from "./DatePicker";
import { dateEvent, layoutClasses, sizeFromClasses, type DateChangeEvent } from "./DateField";
import { formatTimeLabel, toIsoDate } from "@/lib/dates/typed-date";

const STEPS: string[] = [];
for (let h = 0; h < 24; h++) for (const m of [0, 15, 30, 45]) STEPS.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
const DEFAULT_TIME = "10:00";

function split(v: string | null | undefined): { date: string; time: string } {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(v ?? "");
  return m ? { date: m[1], time: m[2] ?? "" } : { date: "", time: "" };
}

export function DateTimeField({
  value,
  defaultValue,
  onChange,
  className,
  disabled,
  min,
  max,
  id,
  name,
  required,
  size,
  "aria-label": ariaLabel,
}: {
  value?: string | null;
  defaultValue?: string | null;
  onChange?: (e: DateChangeEvent) => void;
  className?: string;
  disabled?: boolean;
  /** A datetime-local bound; only its date part limits the calendar. */
  min?: string;
  max?: string;
  id?: string;
  name?: string;
  required?: boolean;
  size?: "sm" | "md";
  "aria-label"?: string;
  title?: string;
  placeholder?: string;
}) {
  const controlled = value !== undefined;
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = controlled ? value ?? "" : inner;
  const { date, time } = split(current);
  const sz = size ?? sizeFromClasses(className);

  const times = useMemo(() => (time && !STEPS.includes(time) ? [...STEPS, time].sort() : STEPS), [time]);

  function emit(next: string) {
    if (!controlled) setInner(next);
    onChange?.(dateEvent(next, name));
  }

  return (
    <div className={`flex items-stretch gap-2 ${layoutClasses(className) || "w-full"}`}>
      <DatePicker
        value={date}
        onChange={(d) => emit(d ? `${d}T${time || DEFAULT_TIME}` : "")}
        disabled={disabled}
        min={min?.slice(0, 10)}
        max={max?.slice(0, 10)}
        id={id}
        required={required}
        ariaLabel={ariaLabel ? `${ariaLabel} date` : "Date"}
        size={sz}
        className="min-w-0 flex-1"
      />
      <select
        aria-label={ariaLabel ? `${ariaLabel} time` : "Time"}
        value={time}
        disabled={disabled}
        onChange={(e) => emit(`${date || toIsoDate(new Date())}T${e.target.value}`)}
        className={`input-base w-32 shrink-0 cursor-pointer tabular-nums ${sz === "sm" ? "h-8 py-1 text-xs" : ""}`}
      >
        <option value="" disabled>
          Time
        </option>
        {times.map((t) => (
          <option key={t} value={t}>
            {formatTimeLabel(t)}
          </option>
        ))}
      </select>
      {name && <input type="hidden" name={name} value={date ? `${date}T${time || DEFAULT_TIME}` : ""} />}
    </div>
  );
}
