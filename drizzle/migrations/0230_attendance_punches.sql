-- 0230 — Every clock-in and clock-out, not just the first pair of the day.
--
-- `attendance` stays one row per employee per day (status, first in, last
-- out, total worked) — every report, the monthly grid and the payroll export
-- read it. This table is the log under it: one row per punch, so someone who
-- steps out for a client meeting and comes back clocks out and in again, and
-- the day's worked time is the sum of its sessions (src/app/api/attendance/clock).
-- Additive only.

CREATE TABLE IF NOT EXISTS attendance_punches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  employee_user_id uuid NOT NULL,
  attendance_date date NOT NULL,
  -- 'in' | 'out'
  kind text NOT NULL CHECK (kind IN ('in', 'out')),
  at timestamptz NOT NULL DEFAULT now(),
  lat numeric,
  lng numeric,
  ip text,
  -- who recorded it when it was not the employee (a manager punching for them)
  recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attendance_punches_day_idx
  ON attendance_punches (tenant_id, employee_user_id, attendance_date, at);

ALTER TABLE attendance_punches ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_punches FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON attendance_punches;
CREATE POLICY tenant_isolation ON attendance_punches
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true')
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.is_platform_admin', true) = 'true');
