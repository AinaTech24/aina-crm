/**
 * Attendance — team HR (Sanchay-parity, minus GPS accuracy).
 *
 * One row per employee per day. Statuses cover the working calendar; clock-in/
 * out + total minutes capture worked time. Rows are created by the clock
 * widget, the manager upsert, or the daily auto-seed worker.
 */

import { date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const ATTENDANCE_STATUSES = [
  "present",
  "absent",
  "half_day",
  "week_off",
  "holiday",
  "on_leave",
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const attendance = pgTable(
  "attendance",
  {
    id,
    tenantId,
    employeeUserId: uuid("employee_user_id").notNull(),
    attendanceDate: date("attendance_date").notNull(),
    status: text("status", { enum: ATTENDANCE_STATUSES }).notNull().default("absent"),
    clockInAt: timestamp("clock_in_at", { withTimezone: true }),
    clockOutAt: timestamp("clock_out_at", { withTimezone: true }),
    totalMinutes: integer("total_minutes"),
    note: text("note"),
    /** manual | clock | auto (daily seed). */
    source: text("source").notNull().default("manual"),
    /** Geolocation + IP captured at punch time (field-attendance proof). */
    clockInLat: numeric("clock_in_lat"),
    clockInLng: numeric("clock_in_lng"),
    clockInIp: text("clock_in_ip"),
    clockOutLat: numeric("clock_out_lat"),
    clockOutLng: numeric("clock_out_lng"),
    clockOutIp: text("clock_out_ip"),
    ...timestamps,
  },
  (t) => ({
    unique: uniqueIndex("attendance_unique").on(t.tenantId, t.employeeUserId, t.attendanceDate),
    dateIdx: index("attendance_date_idx").on(t.tenantId, t.attendanceDate, t.status),
    employeeIdx: index("attendance_employee_idx").on(t.tenantId, t.employeeUserId, t.attendanceDate),
  })
);

export type Attendance = typeof attendance.$inferSelect;
export type NewAttendance = typeof attendance.$inferInsert;

/**
 * Every clock-in and clock-out (migration 0230). `attendance` keeps the day's
 * summary — first in, last out, total worked — and this is the log under it,
 * so someone can clock out and back in as often as the day needs.
 */
export const attendancePunches = pgTable(
  "attendance_punches",
  {
    id,
    tenantId,
    employeeUserId: uuid("employee_user_id").notNull(),
    attendanceDate: date("attendance_date").notNull(),
    /** "in" | "out" */
    kind: text("kind", { enum: ["in", "out"] }).notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    lat: numeric("lat"),
    lng: numeric("lng"),
    ip: text("ip"),
    /** Set when a manager punched for the employee. */
    recordedBy: uuid("recorded_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dayIdx: index("attendance_punches_day_idx").on(t.tenantId, t.employeeUserId, t.attendanceDate, t.at),
  })
);

export type AttendancePunch = typeof attendancePunches.$inferSelect;
