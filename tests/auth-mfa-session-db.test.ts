/**
 * Final security patch, P0 — MFA is enforced on the ACTUAL session (migration
 * 0244), against a real Postgres, through the real sign-in, two-factor,
 * password-reset and step-up routes (only next/headers is stubbed to carry
 * the cookie and client headers).
 *
 * Before / after: for each bypass the test first evaluates the 0243 rule —
 * "active platform_admin, two-factor flag on, session not revoked" — on the
 * very session, and shows it ACCEPTED; then shows the 0244 rule (the database's
 * rta_operator_ok and the approvals library) REFUSES it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import { NextRequest } from "next/server";

const TEST_DB = process.env.TEST_DATABASE_URL;
const ADMIN_DB = process.env.ADMIN_DATABASE_URL;

const h = vi.hoisted(() => ({ cookies: new Map<string, string>(), headers: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers([...h.headers.entries()]),
  cookies: async () => ({ get: (n: string) => (h.cookies.has(n) ? { name: n, value: h.cookies.get(n)! } : undefined) }),
}));

const statusOf = async (p: Promise<unknown>) => { try { await p; return 0; } catch (e: any) { return e?.status ?? -1; } };
const messageOf = async (p: Promise<unknown>) => { try { await p; return ""; } catch (e: any) { return String(e?.message ?? ""); } };
const dbError = async (p: Promise<unknown>) => { try { await p; return "no error"; } catch (e: any) { return `${e?.message ?? ""} ${e?.cause?.message ?? ""}`; } };

describe.skipIf(!TEST_DB)("MFA on the authenticated session (DB)", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let withPlatformAdmin: typeof import("@/db/client").withPlatformAdmin;
  let sql: typeof import("drizzle-orm").sql;
  let A: typeof import("@/lib/rta/posting/approvals");
  let T: typeof import("@/lib/auth/totp");
  let J: typeof import("@/lib/auth/jwt");
  const platform = randomUUID();
  const firm = randomUUID();
  const PASSWORD = `pw-${randomBytes(6).toString("hex")}`;
  const BACKUP = "bk-12345678";
  type Op = { id: string; email: string; secret: string | null };
  const ops: Record<"a" | "b" | "c" | "d", Op> = {} as any;
  let ip = 0;
  const req = (path: string, body: unknown) => {
    h.headers = new Map([["x-forwarded-for", `198.51.100.${++ip % 250}`], ["user-agent", "vitest"], ["x-pathname", path]]);
    return new NextRequest(`http://localhost${path}`, { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": `198.51.100.${ip % 250}` } });
  };
  /** The signed-in session a cookie carries: { userId, sid }. */
  const sessionOf = async (res: Response) => {
    const raw = res.headers.get("set-cookie") ?? "";
    const m = raw.match(/aina_session=([^;]+)/);
    if (!m) throw new Error(`no platform session cookie (status ${res.status}): ${await res.clone().text()}`);
    const s = await J.verifySession(m[1]);
    return { userId: s!.userId, sid: s!.sid!, token: m[1] };
  };
  const signIn = async (op: Op, code?: string) => {
    const login = await (await import("@/app/api/auth/login/route")).POST(req("/api/auth/login", { email: op.email, password: PASSWORD }));
    if (!op.secret) return sessionOf(login);
    const { challenge } = await login.json();
    const verify = await (await import("@/app/api/auth/2fa/verify/route")).POST(req("/api/auth/2fa/verify", { challenge, code: code ?? T.totp(op.secret) }));
    return sessionOf(verify);
  };
  const resetSession = async (op: Op) => {
    const token = randomBytes(24).toString("hex");
    await withSystem((tx) => tx.execute(sql`INSERT INTO password_resets (user_id, tenant_id, email, token_hash, expires_at)
      VALUES (${op.id}::uuid, ${platform}::uuid, ${op.email}, ${createHash("sha256").update(token).digest("hex")}, now() + interval '30 minutes')`));
    const res = await (await import("@/app/api/auth/reset/route")).POST(req("/api/auth/reset", { token, password: PASSWORD }));
    return sessionOf(res);
  };
  /** The 0243 rule, verbatim: what the database accepted before this patch. */
  const oldRule = async (userId: string, sid: string) => withPlatformAdmin(userId, async (tx) => ((await tx.execute(sql`
    SELECT EXISTS (SELECT 1 FROM users u WHERE u.id = ${userId}::uuid AND u.status = 'active' AND u.roles && ARRAY['platform_admin']::text[] AND coalesce(u.two_fa_enabled, false))
       AND EXISTS (SELECT 1 FROM user_sessions s WHERE s.session_id = ${sid} AND s.user_id = ${userId}::uuid AND s.revoked_at IS NULL) AS ok`)).rows[0] as any).ok as boolean);
  const newRule = async (userId: string, sid: string) => withPlatformAdmin(userId, async (tx) =>
    ((await tx.execute(sql`SELECT rta_operator_ok(${userId}::uuid, ${sid}, true) AS ok`)).rows[0] as any).ok as boolean);
  const sessionRow = async (sid: string) => withSystem(async (tx) => (await tx.execute(sql`
    SELECT auth_method, mfa_verified_at IS NOT NULL AS mfa, revoked_at IS NOT NULL AS revoked FROM user_sessions WHERE session_id = ${sid}`)).rows[0] as any);
  const activation = (changeRef: string) => ({
    action: "activate" as const, tenantId: firm, mode: "validate_first" as const, postingEnabled: true, registrars: ["kfintech" as const],
    reportCodes: ["MFSD211", "MFSD201"], expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(), changeRef, reason: "MFA patch test: KFintech pilot activation",
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    process.env.NEXTAUTH_SECRET ||= "test-secret-0123456789abcdef0123456789abcdef";
    process.env.ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    (process.env as Record<string, string>).NODE_ENV = "test";
    ({ withSystem, withPlatformAdmin } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    A = await import("@/lib/rta/posting/approvals");
    T = await import("@/lib/auth/totp");
    J = await import("@/lib/auth/jwt");
    const bcrypt = (await import("bcryptjs")).default;
    const hash = await bcrypt.hash(PASSWORD, 4);
    const backup = await bcrypt.hash(BACKUP, 4);
    await withSystem(async (tx) => {
      await tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${platform}::uuid, 'MFA platform', 'MFA platform', ${"ARN-MFA" + platform.slice(0, 6)}),
        (${firm}::uuid, 'MFA firm', 'MFA firm', ${"ARN-MFF" + firm.slice(0, 6)})`);
      for (const k of ["a", "b", "c", "d"] as const) {
        const id = randomUUID();
        const secret = k === "c" ? null : T.generateSecret();
        ops[k] = { id, email: `mfa-${k}-${id.slice(0, 8)}@ops.test.invalid`, secret };
        await tx.execute(sql`INSERT INTO users (id, tenant_id, email, name, roles, status, password_hash, two_fa_enabled, two_fa_secret, two_fa_backup_codes)
          VALUES (${id}::uuid, ${platform}::uuid, ${ops[k].email}, ${"MFA operator " + k}, ARRAY['platform_admin']::text[], 'active', ${hash},
                  ${!!secret}, ${secret ? T.encryptSecret(secret) : null}, ${JSON.stringify(k === "d" ? [backup] : [])}::jsonb)`);
      }
      // Posting released globally so an activation can execute (a test DB; the release itself is a request).
    });
  });

  afterAll(async () => {
    await withSystem(async (tx) => {
      const ids = Object.values(ops).map((o) => o.id);
      await tx.execute(sql`UPDATE user_sessions SET revoked_at = coalesce(revoked_at, now()) WHERE user_id = ANY(${ids}::uuid[])`);
      await tx.execute(sql`UPDATE users SET status = 'disabled' WHERE id = ANY(${ids}::uuid[])`);
    }).catch(() => {});
  });

  it("a fresh password + TOTP sign-in is MFA-verified; two different such operators can request and approve", async () => {
    const a = await signIn(ops.a);
    const b = await signIn(ops.b);
    expect(await sessionRow(a.sid)).toMatchObject({ auth_method: "password_totp", mfa: true, revoked: false });
    expect(await newRule(a.userId, a.sid)).toBe(true);
    const r = await A.requestControlAction(a, { action: "release", scope: firm, changeRef: "CHG-MFA-1", reason: "MFA test: release by two verified operators" });
    const done = await A.approveControlAction(b, { requestId: r.id, payloadHash: r.payloadHash });
    expect(done.status).toBe("executed");
    // The audit records each side's verification time and method — not a code, token or session id.
    const audit = await withSystem(async (tx) => (await tx.execute(sql`SELECT action, after FROM audit_log WHERE entity_id = ${r.id}::uuid ORDER BY at`)).rows as any[]);
    expect(audit.find((x) => x.action === "rta.control.request")?.after).toMatchObject({ requesterAuthMethod: "password_totp", requesterMfaVerifiedAt: expect.any(String) });
    expect(audit.find((x) => x.action === "rta.control.execute")?.after).toMatchObject({ approverAuthMethod: "password_totp", approverMfaVerifiedAt: expect.any(String) });
    // Same person, second verified session: still refused (two DISTINCT operators).
    const a2 = await signIn(ops.a);
    const r2 = await A.requestControlAction(a, { action: "release", scope: firm, changeRef: "CHG-MFA-2", reason: "MFA test: same person twice" });
    expect(await statusOf(A.approveControlAction(a2, { requestId: r2.id, payloadHash: r2.payloadHash }))).toBe(403);
  });

  it("BYPASS 1 — password reset: the 0243 rule accepted the reset session; it is refused now, until a TOTP step-up", async () => {
    const r = await resetSession(ops.a);
    expect(await sessionRow(r.sid)).toMatchObject({ auth_method: "password_reset", mfa: false });
    expect(await oldRule(r.userId, r.sid)).toBe(true); // BEFORE: accepted
    expect(await newRule(r.userId, r.sid)).toBe(false); // AFTER: refused by the database
    expect(await messageOf(A.requestControlAction(r, activation("CHG-MFA-RESET")))).toMatch(/did not complete a two-factor challenge \(it came from a password reset/);
    // The database itself refuses it too (a direct insert citing the reset session).
    expect(await dbError(withPlatformAdmin(r.userId, (tx) => tx.execute(sql`
      INSERT INTO rta_control_requests (action, tenant_id, scope, payload, payload_hash, change_ref, reason, requested_by, requester_sid, expires_at)
      VALUES ('release', ${firm}::uuid, ${firm}, '{}'::jsonb, 'x', 'CHG-SQL', 'direct insert from a reset session', ${r.userId}::uuid, ${r.sid}, now() + interval '1 hour')`))))
      .toMatch(/requester is not an active two-factor platform operator with a live session/);
    // Step-up: a TOTP code on the reset session revokes it and issues a NEW, MFA-verified one.
    h.cookies = new Map([["aina_session", r.token]]);
    const res = await (await import("@/app/api/super-admin/step-up/route")).POST(req("/api/super-admin/step-up", { code: T.totp(ops.a.secret!) }));
    expect(res.status).toBe(200);
    const s = await sessionOf(res);
    expect(await sessionRow(r.sid)).toMatchObject({ revoked: true });
    expect(await sessionRow(s.sid)).toMatchObject({ auth_method: "step_up_totp", mfa: true });
    const ok = await A.requestControlAction(s, activation("CHG-MFA-STEPUP"));
    expect(ok.status).toBe("pending");
    await A.rejectControlAction(s, { requestId: ok.id, note: "test only" });
    // A wrong step-up code is refused and audited without the code.
    const t2 = await resetSession(ops.a);
    h.cookies = new Map([["aina_session", t2.token]]);
    const bad = await (await import("@/app/api/super-admin/step-up/route")).POST(req("/api/super-admin/step-up", { code: "000000" }));
    expect(bad.status).toBe(401);
    const failed = await withSystem(async (tx) => (await tx.execute(sql`SELECT after FROM audit_log WHERE entity_id = ${ops.a.id}::uuid AND action = 'auth.2fa.failed' ORDER BY at DESC LIMIT 1`)).rows[0] as any);
    expect(JSON.stringify(failed.after)).not.toMatch(/000000/);
  });

  it("BYPASS 2 — a session from before two-factor enrolment: accepted by the 0243 rule, refused now", async () => {
    const pre = await signIn(ops.c); // no two-factor yet: a password sign-in
    expect(await sessionRow(pre.sid)).toMatchObject({ auth_method: "password", mfa: false });
    const secret = T.generateSecret();
    await withSystem((tx) => tx.execute(sql`UPDATE users SET two_fa_enabled = true, two_fa_secret = ${T.encryptSecret(secret)} WHERE id = ${ops.c.id}::uuid`));
    ops.c.secret = secret;
    expect(await oldRule(pre.userId, pre.sid)).toBe(true); // BEFORE: accepted (flag on, session live)
    expect(await newRule(pre.userId, pre.sid)).toBe(false); // AFTER
    expect(await statusOf(A.requestControlAction(pre, activation("CHG-MFA-PRE")))).toBe(403);
    // Signing in again, now with TOTP, works.
    const fresh = await signIn(ops.c);
    expect(await newRule(fresh.userId, fresh.sid)).toBe(true);
  });

  it("security changes downgrade every session; revoked and stale sessions are refused", async () => {
    const a = await signIn(ops.a);
    expect(await newRule(a.userId, a.sid)).toBe(true);
    // A password change downgrades the verified session (and is audited).
    await withSystem((tx) => tx.execute(sql`UPDATE users SET password_hash = password_hash || '' WHERE id = ${ops.a.id}::uuid`)); // no-op value: not a change
    expect(await newRule(a.userId, a.sid)).toBe(true);
    const bcrypt = (await import("bcryptjs")).default;
    await withSystem(async (tx) => tx.execute(sql`UPDATE users SET password_hash = ${await bcrypt.hash(PASSWORD, 4)} WHERE id = ${ops.a.id}::uuid`));
    expect(await sessionRow(a.sid)).toMatchObject({ mfa: false });
    expect(await newRule(a.userId, a.sid)).toBe(false);
    expect(await messageOf(A.requestControlAction(a, activation("CHG-MFA-PW")))).toMatch(/did not complete a two-factor challenge/);
    const downgraded = await withSystem(async (tx) => (await tx.execute(sql`SELECT after FROM audit_log WHERE entity_id = ${ops.a.id}::uuid AND action = 'auth.mfa.sessions_downgraded' ORDER BY at DESC LIMIT 1`)).rows[0] as any);
    expect(downgraded.after).toMatchObject({ passwordChanged: true, sessionsDowngraded: expect.any(Number) });
    // Two-factor re-enrolment (a new secret) downgrades too.
    const b = await signIn(ops.b);
    const newSecret = T.generateSecret();
    await withSystem((tx) => tx.execute(sql`UPDATE users SET two_fa_secret = ${T.encryptSecret(newSecret)} WHERE id = ${ops.b.id}::uuid`));
    ops.b.secret = newSecret;
    expect(await newRule(b.userId, b.sid)).toBe(false);
    // Sign out everywhere: revoked → 401.
    const b2 = await signIn(ops.b);
    await withSystem((tx) => tx.execute(sql`UPDATE user_sessions SET revoked_at = now() WHERE user_id = ${ops.b.id}::uuid AND revoked_at IS NULL`));
    expect(await statusOf(A.requestControlAction(b2, activation("CHG-MFA-REV")))).toBe(401);
    expect(await newRule(b2.userId, b2.sid)).toBe(false);
    // Stale: verified 13 hours ago (aged as the database superuser, test-only).
    const b3 = await signIn(ops.b);
    if (ADMIN_DB) {
      const pg = await import("pg");
      const admin = new pg.default.Client({ connectionString: ADMIN_DB.replace(/\/[^/]+$/, "/" + new URL(TEST_DB!).pathname.slice(1)) });
      await admin.connect();
      try {
        await admin.query("BEGIN; SET LOCAL session_replication_role = replica;");
        await admin.query("UPDATE user_sessions SET mfa_verified_at = now() - interval '13 hours', created_at = now() - interval '13 hours' WHERE session_id = $1", [b3.sid]);
        // Isolate staleness: the operator's last security change predates the aged verification.
        await admin.query("UPDATE users SET mfa_changed_at = now() - interval '14 hours' WHERE id = $1", [b3.userId]);
        await admin.query("COMMIT");
      } finally { await admin.end(); }
      expect(await newRule(b3.userId, b3.sid)).toBe(false);
      expect(await messageOf(A.requestControlAction(b3, activation("CHG-MFA-STALE")))).toMatch(/older than 720 minutes/);
    }
  });

  it("a one-time backup code is a second factor (recorded as such) and is consumed", async () => {
    const s = await signIn(ops.d, BACKUP);
    expect(await sessionRow(s.sid)).toMatchObject({ auth_method: "password_backup_code", mfa: true });
    const left = await withSystem(async (tx) => (await tx.execute(sql`SELECT jsonb_array_length(two_fa_backup_codes) AS n FROM users WHERE id = ${ops.d.id}::uuid`)).rows[0] as any);
    expect(left.n).toBe(0);
  });

  it("the database refuses a forged or raised MFA on a session", async () => {
    const sid = `forged-${randomUUID()}`;
    // A user without two-factor cannot hold an MFA session.
    const noTwoFa = randomUUID();
    await withSystem((tx) => tx.execute(sql`INSERT INTO users (id, tenant_id, email, name, roles, status) VALUES (${noTwoFa}::uuid, ${platform}::uuid, ${`no2fa-${noTwoFa.slice(0, 8)}@ops.test.invalid`}, 'No 2FA', ARRAY['platform_admin']::text[], 'active')`));
    expect(await dbError(withSystem((tx) => tx.execute(sql`INSERT INTO user_sessions (tenant_id, user_id, session_id, auth_method, mfa_verified_at) VALUES (${platform}::uuid, ${noTwoFa}::uuid, ${sid}, 'password_totp', now())`))))
      .toMatch(/without two-factor/);
    // A password-reset session cannot claim MFA, nor be back-dated, nor be raised later.
    expect(await dbError(withSystem((tx) => tx.execute(sql`INSERT INTO user_sessions (tenant_id, user_id, session_id, auth_method, mfa_verified_at) VALUES (${platform}::uuid, ${ops.a.id}::uuid, ${sid}, 'password_reset', now())`))))
      .toMatch(/completed second-factor challenge/);
    expect(await dbError(withSystem((tx) => tx.execute(sql`INSERT INTO user_sessions (tenant_id, user_id, session_id, auth_method, mfa_verified_at) VALUES (${platform}::uuid, ${ops.a.id}::uuid, ${sid}, 'password_totp', now() - interval '2 hours')`))))
      .toMatch(/time it was verified/);
    const r = await resetSession(ops.a);
    expect(await dbError(withSystem((tx) => tx.execute(sql`UPDATE user_sessions SET mfa_verified_at = now() WHERE session_id = ${r.sid}`)))).toMatch(/cleared, never raised/);
    expect(await dbError(withSystem((tx) => tx.execute(sql`UPDATE user_sessions SET auth_method = 'password_totp' WHERE session_id = ${r.sid}`)))).toMatch(/never changes/);
  });

  it("every session creation is audited with its method — never the token, session id, password or code", async () => {
    const s = await signIn(ops.a);
    const rows = await withSystem(async (tx) => (await tx.execute(sql`
      SELECT a.after FROM audit_log a JOIN user_sessions u ON u.id = a.entity_id WHERE a.action = 'auth.session.created' AND u.session_id = ${s.sid}`)).rows as any[]);
    expect(rows).toHaveLength(1);
    expect(rows[0].after).toEqual({ method: "password_totp", mfaVerified: true });
    const text = JSON.stringify(rows[0].after);
    for (const secret of [s.sid, s.token, PASSWORD]) expect(text).not.toContain(secret);
  });
});
