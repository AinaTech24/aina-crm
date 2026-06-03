/**
 * Attendance policy + helpers (client-safe — pure data/functions).
 */

export const ATTENDANCE_STATUS_LABELS: Record<string, string> = {
  present: "Present",
  absent: "Absent",
  half_day: "Half day",
  week_off: "Week Off",
  holiday: "Holiday",
  on_leave: "On Leave",
};

/** Short cell label for the monthly grid. */
export const ATTENDANCE_STATUS_SHORT: Record<string, string> = {
  present: "P",
  absent: "A",
  half_day: "½",
  week_off: "WO",
  holiday: "H",
  on_leave: "L",
};

export const ATTENDANCE_STATUS_TONE: Record<string, string> = {
  present: "bg-emerald-50 text-emerald-700",
  absent: "bg-rose-50 text-rose-700",
  half_day: "bg-amber-50 text-amber-700",
  week_off: "bg-slate-100 text-slate-500",
  holiday: "bg-violet-50 text-violet-700",
  on_leave: "bg-blue-50 text-blue-700",
};

/** Default weekly off = Sunday (0). Tunable later via firm settings. */
export function isWeekOff(d: Date): boolean {
  return d.getDay() === 0;
}

/** Worked minutes between clock-in and clock-out (clamped ≥ 0). */
export function minutesBetween(clockIn: Date, clockOut: Date): number {
  const ms = clockOut.getTime() - clockIn.getTime();
  return ms > 0 ? Math.round(ms / 60000) : 0;
}

/** "4h 32m" / "—" from minutes. */
export function fmtMinutes(min: number | null | undefined): string {
  if (min == null || min <= 0) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
