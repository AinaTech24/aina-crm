-- Whether the firm's owners are expected to mark attendance.
--
-- The daily seed pre-marks every active user "absent" until they clock in, so
-- an owner who never clocks in showed as Absent every day. Most firms don't
-- track the owner's attendance; the ones that do switch this on in
-- Attendance → Settings. Off by default: owners are left out of the daily
-- seed and the attendance list unless a firm asks for them.
--
-- Additive and defaulted, so the colour still serving during a deploy is
-- unaffected.
ALTER TABLE attendance_settings
  ADD COLUMN IF NOT EXISTS track_owners boolean NOT NULL DEFAULT false;
