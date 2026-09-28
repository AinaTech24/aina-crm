/**
 * `node scripts/dev-session.mjs` — mint a dev session cookie for the preview
 * server, WITHOUT a password and without a login form.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * `NO_AUTH=1` used to let scripts/preview-server.mjs render the authenticated
 * app for a UI review. It is dead, and src/middleware.ts explains at length
 * why it cannot be revived: middleware sets headers on the RESPONSE (a server
 * component reads the REQUEST), `readSession()` deliberately distrusts internal
 * identity headers, and Edge middleware has no DB access to mint a real
 * session. That comment ends by naming the correct fix:
 *
 *     "seed a `user_sessions` row for a fixed dev sid, or have
 *      scripts/preview-server.mjs POST /api/auth/login once at startup and
 *      reuse the cookie. Both belong in Node, not here."
 *
 * This is the first of those two, and it is the better one: it never touches a
 * password. It signs the same JWT the login route signs, writes the same
 * `user_sessions` row the revocation check requires, and prints the cookie.
 *
 * ── Safety ──────────────────────────────────────────────────────────────────
 *
 * It refuses to run unless NODE_ENV is development AND the database is a
 * localhost one. Both guards, not either: a developer with a production
 * DATABASE_URL in their shell should not be able to mint a session for a real
 * user by running a dev script. It also only ever accepts a user id that is
 * already in the local database, so it cannot invent an identity.
 *
 * Usage:
 *   node scripts/dev-session.mjs                 # uses DEMO_USER_ID
 *   node scripts/dev-session.mjs <user-uuid>
 */

import "dotenv/config";
import { randomUUID, createHmac } from "node:crypto";
import pg from "pg";

const DEV_ONLY = "[dev-session] refusing to run";

if (process.env.NODE_ENV === "production") {
  console.error(`${DEV_ONLY}: NODE_ENV is production.`);
  process.exit(1);
}

const dbUrl = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(dbUrl)) {
  console.error(`${DEV_ONLY}: DATABASE_URL is not a localhost database.`);
  process.exit(1);
}

const secret = process.env.NEXTAUTH_SECRET;
if (!secret) {
  console.error("[dev-session] NEXTAUTH_SECRET is not set — cannot sign a session.");
  process.exit(1);
}

const userId = process.argv[2] || process.env.DEMO_USER_ID;
if (!userId) {
  console.error("[dev-session] pass a user id, or set DEMO_USER_ID in .env.development.local");
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl });
await client.connect();

// Read the identity from the DATABASE. The script cannot invent a user, a
// tenant or a role — it can only wake up one that already exists locally.
const { rows } = await client.query(
  `SELECT u.id, u.tenant_id, u.branch_id, u.email, u.name, u.roles, u.permissions, u.status
     FROM users u WHERE u.id = $1::uuid`,
  [userId],
);
if (!rows.length) {
  console.error(`[dev-session] no user ${userId} in this database.`);
  await client.end();
  process.exit(1);
}
const u = rows[0];
if (u.status !== "active") {
  console.error(`[dev-session] user ${u.email} is ${u.status}, not active.`);
  await client.end();
  process.exit(1);
}

const b64url = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const sid = randomUUID();
const now = Math.floor(Date.now() / 1000);
// Same claim shape as src/lib/auth/issue-session.ts. If that file changes,
// this must follow — the JWT is verified against it, not against this comment.
const payload = {
  userId: u.id,
  tenantId: u.tenant_id,
  branchId: u.branch_id ?? undefined,
  roles: u.roles ?? [],
  email: u.email,
  name: u.name,
  permissions: u.permissions ?? [],
  sid,
  authTime: now,
  iat: now,
  exp: now + 60 * 60 * 24 * 7,
};

const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
const body = b64url(JSON.stringify(payload));
const sig = b64url(createHmac("sha256", secret).update(`${header}.${body}`).digest());
const token = `${header}.${body}.${sig}`;

// The revocation check treats a MISSING user_sessions row as revoked, so the
// row is not optional here the way it is on the login path.
await client.query(
  `INSERT INTO user_sessions (tenant_id, user_id, session_id, device_name, user_agent, ip_address)
   VALUES ($1::uuid, $2::uuid, $3, 'Preview (dev-session.mjs)', 'dev-session', NULL)
   ON CONFLICT DO NOTHING`,
  [u.tenant_id, u.id, sid],
);
await client.end();

console.log(`[dev-session] ${u.email} (${(u.roles ?? []).join(", ") || "no roles"})`);
console.log(`COOKIE mfd_session=${token}`);
