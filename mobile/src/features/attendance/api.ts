/**
 * Attendance — clocking in and out of the WORK DAY.
 *
 * Not to be confused with the field-visit check-in (features/activities/
 * checkin.ts), which stamps a client visit. This is the RM's own day: one row
 * per person per date, with clock-in/out times, total minutes and an optional
 * GPS stamp — which matters for a field team who never see an office.
 *
 * POST /api/attendance/clock { action: "in" | "out", lat?, lng? }
 * GET  /api/attendance?employee=me|&date=|&from=  → { attendance: rows }
 * GET  /api/attendance/settings  → { settings: { workStart, workEnd, … } }
 *
 * A day can hold several sessions (clock out for a client meeting, clock in
 * again): `total_minutes` is the closed sessions, and the row's last punch says
 * whether the person is in now and since when. The daily seed marks everyone
 * absent (source auto) — until the work day ends that reads "Not clocked in".
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api/client";
import type { Tone } from "../../theme";
import { fmtTime, parseDate } from "../../lib/format";

export type AttendanceStatus = "present" | "absent" | "half_day" | "week_off" | "holiday" | "on_leave";

export interface AttendanceRow {
  id: string;
  employee_user_id: string;
  employee_name: string | null;
  attendance_date: string; // YYYY-MM-DD
  status: AttendanceStatus | null;
  clock_in_at: string | null;
  clock_out_at: string | null;
  total_minutes: number | null;
  note: string | null;
  source: string | null;
  clock_in_lat: string | number | null;
  clock_in_lng: string | number | null;
  /** The day's last punch — "in" means working now, since last_punch_at. */
  last_punch_kind?: "in" | "out" | null;
  last_punch_at?: string | null;
  [k: string]: any;
}

export function useAttendance(params: { employee?: string; date?: string; from?: string; limit?: number } = {}, enabled = true) {
  return useQuery({
    queryKey: ["attendance", params],
    enabled,
    queryFn: () => api.get<{ attendance: AttendanceRow[] }>("/api/attendance", {
      limit: String(params.limit ?? 120), employee: params.employee, date: params.date, from: params.from,
    }).then((r) => r.attendance),
    staleTime: 30_000,
  });
}

export function useAttendanceSettings() {
  return useQuery({
    queryKey: ["attendance-settings"],
    queryFn: () => api.get<{ settings: { workStart?: string; workEnd?: string } }>("/api/attendance/settings").then((r) => r.settings),
    staleTime: 10 * 60_000,
  });
}

/** Working right now: the last punch is a clock-in (older rows: in, not out). */
export function isClockedIn(row?: AttendanceRow): boolean {
  if (!row) return false;
  if (row.last_punch_kind) return row.last_punch_kind === "in";
  return !!row.clock_in_at && !row.clock_out_at;
}

/** The seed's "absent" before the work day is over is "Not clocked in" (web rule). */
export function notClockedInYet(row: AttendanceRow, workEnd: string | undefined, now = new Date()): boolean {
  if (row.status !== "absent" || row.source !== "auto" || row.clock_in_at) return false;
  const ist = new Date(now.getTime() + 330 * 60_000);
  const hhmm = `${String(ist.getUTCHours()).padStart(2, "0")}:${String(ist.getUTCMinutes()).padStart(2, "0")}`;
  const today = ist.toISOString().slice(0, 10);
  return String(row.attendance_date).slice(0, 10) === today && hhmm < (workEnd ?? "19:00");
}

export function statusLabel(row: AttendanceRow, workEnd?: string): { label: string; tone: Tone } | null {
  if (!row.status) return null;
  if (notClockedInYet(row, workEnd)) return { label: "Not clocked in", tone: "neutral" };
  return { label: row.status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()), tone: STATUS_TONE[row.status] ?? "neutral" };
}

export interface ClockResult { ok?: boolean; clock_in_at?: string | null; clock_out_at?: string | null; total_minutes?: number | null; status?: string | null; error?: string }

export function useClock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { action: "in" | "out"; lat?: number; lng?: number }) => api.post<ClockResult>("/api/attendance/clock", v),
    // A 400 "You're already clocked in." means the screen was stale — refresh it either way.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["attendance"] });
      qc.invalidateQueries({ queryKey: ["command-center"] });
    },
  });
}

// ── helpers ──

/** Local YYYY-MM-DD (never toISOString — it shifts the day in IST). */
export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** The signed-in user's row for a given date, if any. */
export function findDay(rows: AttendanceRow[] | undefined, userId: string | undefined, date: string): AttendanceRow | undefined {
  if (!rows || !userId) return undefined;
  return rows.find((r) => r.employee_user_id === userId && String(r.attendance_date).slice(0, 10) === date);
}

/** Only this user's rows, newest first. */
export function myRows(rows: AttendanceRow[] | undefined, userId: string | undefined): AttendanceRow[] {
  if (!rows || !userId) return [];
  return rows.filter((r) => r.employee_user_id === userId);
}

/** "7h 24m" from minutes, or from a live clock-in when still running. */
export function durationLabel(row: AttendanceRow | undefined, now = Date.now()): string {
  if (!row) return "—";
  // Closed sessions, plus the one running now (from the last clock-in).
  let mins = row.total_minutes ?? 0;
  if (isClockedIn(row)) {
    const since = row.last_punch_kind === "in" && row.last_punch_at ? row.last_punch_at : row.clock_in_at;
    const started = since ? (parseDate(since)?.getTime() ?? NaN) : NaN;
    if (isFinite(started)) mins += Math.max(0, Math.round((now - started) / 60000));
  }
  if (!mins) return "—";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** India time (the attendance day is India's), "—" for none. */
export function timeLabel(iso?: string | null): string {
  return fmtTime(iso) || "—";
}

export const STATUS_TONE: Record<string, Tone> = {
  present: "success", absent: "danger", half_day: "warning",
  week_off: "neutral", holiday: "info", on_leave: "violet",
};

/** Sum of minutes across rows — for the "this month" total. */
export const totalMinutes = (rows: AttendanceRow[]) => rows.reduce((n, r) => n + (r.total_minutes ?? 0), 0);
