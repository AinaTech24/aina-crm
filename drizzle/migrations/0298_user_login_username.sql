-- 0298 — A team member's username keeps working after an email is added (2026-11-27).
--
-- A login created without an email address signs in with a username, stored in
-- users.email as <username>@login.invalid. When an admin later adds a real email,
-- users.email becomes that address and the username moves here, so the person can
-- sign in with either. Unique across the platform, like the sign-in itself.
-- Column and index only.

ALTER TABLE users ADD COLUMN IF NOT EXISTS login_username text;

CREATE UNIQUE INDEX IF NOT EXISTS users_login_username_unique
  ON users (lower(login_username))
  WHERE login_username IS NOT NULL;
