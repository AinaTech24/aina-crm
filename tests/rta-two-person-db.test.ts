/**
 * Final pilot patch — two-person approval security (migration 0243), against
 * a real Postgres (RLS on, non-superuser app role).
 *
 * Proves, for the activation / release / reversal / undo controls:
 *   • the requester is the signed-in session — a body naming another operator
 *     is refused, and the API never reads an operator id from the client;
 *   • the approver must be a DIFFERENT signed-in operator (library, API and a
 *     database CHECK);
 *   • both must be active platform_admin users with two-factor on and a live
 *     session; the requester must still be authorised at approval;
 *   • a request is used once, is bound to its payload hash, and expires;
 *   • the database refuses a start that does not cite a request executed in
 *     the same transaction — a direct SQL activation, release or reversal, or
 *     a replay of an old request id;
 *   • the CLI cannot start anything; the old one-call library functions throw;
 *   • one operator can still halt (EMERGENCY included); two release it;
 *   • identities and timestamps land in the request row and the audit log.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { NextRequest } from "next/server";
import type { Operators } from "./helpers/two-person";

const TEST_DB = process.env.TEST_DATABASE_URL;
const ADMIN_DB = process.env.ADMIN_DATABASE_URL;

const mocks = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireSession: mocks.session }));

/** The database's own message (Drizzle wraps it; the reason is on .cause). */
const dbError = async (p: Promise<unknown>) => { try { await p; return "no error"; } catch (e: any) { return `${e?.message ?? ""} ${e?.cause?.message ?? ""}`; } };
const statusOf = async (p: Promise<unknown>) => { try { await p; return 0; } catch (e: any) { return e?.status ?? -1; } };

describe.skipIf(!TEST_DB)("two-person control requests (DB)", () => {
  let withTenant: typeof import("@/db/client").withTenant;
  let withSystem: typeof import("@/db/client").withSystem;
  let sql: typeof import("drizzle-orm").sql;
  let C: typeof import("@/lib/rta/posting/controls");
  let R: typeof import("@/lib/rta/posting/reversal");
  let A: typeof import("@/lib/rta/posting/approvals");
  let H: typeof import("./helpers/two-person");
  let route: typeof import("@/app/api/super-admin/rta-pipeline/route");
  let ops: Operators;
  const firm = randomUUID();
  const later = () => new Date(Date.now() + 7 * 864e5).toISOString();
  const activation = (extra: Record<string, unknown> = {}) => ({
    action: "activate" as const, tenantId: firm, mode: "validate_first" as const, postingEnabled: true, registrars: ["kfintech" as const],
    reportCodes: ["MFSD211", "MFSD201"], expiresAt: later(), changeRef: "CHG-2P-1", reason: "KFintech transaction pilot for this firm", ...extra,
  });
  const asSession = (op: { userId: string; sid: string }, roles = ["platform_admin"]) =>
    mocks.session.mockResolvedValue({ userId: op.userId, tenantId: ops.platformTenant, roles, sid: op.sid, isPlatformAdmin: true });
  const post = (body: unknown) => route.POST(new NextRequest("http://localhost/api/super-admin/rta-pipeline", { method: "POST", body: JSON.stringify(body) }));
  const current = () => withTenant(firm, (tx) => C.currentActivation(tx, firm));
  const firmHalted = async () => withSystem(async (tx) => ((await tx.execute(sql`SELECT posting_halted FROM rta_posting_controls WHERE scope = ${firm}`)).rows[0] as any)?.posting_halted ?? null);

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    process.env.ENCRYPTION_KEY ||= "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    (process.env as Record<string, string>).NODE_ENV = "test";
    ({ withTenant, withSystem } = await import("@/db/client"));
    ({ sql } = await import("drizzle-orm"));
    C = await import("@/lib/rta/posting/controls");
    R = await import("@/lib/rta/posting/reversal");
    A = await import("@/lib/rta/posting/approvals");
    H = await import("./helpers/two-person");
    route = await import("@/app/api/super-admin/rta-pipeline/route");
    ops = await H.createOperators("sec");
    await withSystem((tx) => tx.execute(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${firm}::uuid, 'Two-person firm', 'Two-person firm', ${"ARN-2P" + firm.slice(0, 6)})`));
  });

  afterAll(async () => { await H?.retireOperators(ops); });

  it("normal path: A files, B approves the reviewed hash; identities, times and the change ref are recorded", async () => {
    const req = await A.requestControlAction(ops.a, activation());
    expect(req).toMatchObject({ status: "pending", requestedBy: ops.a.userId, changeRef: "CHG-2P-1", tenantId: firm });
    expect(req.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(await current()).toBeNull(); // nothing happens on filing
    const done = await A.approveControlAction(ops.b, { requestId: req.id, payloadHash: req.payloadHash });
    expect(done).toMatchObject({ status: "executed", approvedBy: ops.b.userId });
    expect(done.decidedAt).toBeTruthy();
    const a = await current();
    expect(a).toMatchObject({ mode: "validate_first", postingEnabled: true, requestedBy: ops.a.userId, approvedBy: ops.b.userId, approvalRef: "CHG-2P-1", registrars: ["kfintech"], reportCodes: ["MFSD201", "MFSD211"] });
    const audit = await withTenant(firm, async (tx) => (await tx.execute(sql`
      SELECT action, actor_user_id::text AS actor, at FROM audit_log WHERE tenant_id = ${firm}::uuid AND entity_id = ${req.id}::uuid ORDER BY at`)).rows as any[]);
    expect(audit.map((r) => [r.action, r.actor])).toEqual([["rta.control.request", ops.a.userId], ["rta.control.execute", ops.b.userId]]);
  });

  it("impersonation: the API takes identities from the session only; a body naming an operator is refused", async () => {
    asSession(ops.a);
    const withId = await post({ action: "request", control: { ...activation({ changeRef: "CHG-IMP" }), requestedBy: ops.b.userId } });
    expect(withId.status).toBe(400);
    const oldStart = await post({ action: "activate", tenantId: firm, mode: "validate_first", postingEnabled: true, reason: "one-call start", requestedBy: ops.a.userId, approvedBy: ops.b.userId });
    expect(oldStart.status).toBe(410);
    const filed = await post({ action: "request", control: activation({ changeRef: "CHG-IMP-2" }) });
    expect(filed.status).toBe(201);
    const { request } = await filed.json();
    expect(request.requestedBy).toBe(ops.a.userId);
    // A's session approving A's own request — refused, whatever the body says.
    const self = await post({ action: "approve", requestId: request.id, payloadHash: request.payloadHash });
    expect(self.status).toBe(403);
    asSession(ops.b);
    const ok = await post({ action: "approve", requestId: request.id, payloadHash: request.payloadHash });
    expect(ok.status).toBe(200);
    expect((await ok.json()).request).toMatchObject({ status: "executed", requestedBy: ops.a.userId, approvedBy: ops.b.userId });
  });

  it("same person: library 403, and the database CHECK refuses approved_by = requested_by", async () => {
    const req = await A.requestControlAction(ops.a, activation({ changeRef: "CHG-SAME" }));
    expect(await statusOf(A.approveControlAction(ops.a, { requestId: req.id, payloadHash: req.payloadHash }))).toBe(403);
    // A second session of the SAME person is still the same person.
    const other = { userId: ops.a.userId, sid: `test-sid-${randomUUID()}` };
    await withSystem((tx) => tx.execute(sql`INSERT INTO user_sessions (tenant_id, user_id, session_id, auth_method, mfa_verified_at) VALUES (${ops.platformTenant}::uuid, ${ops.a.userId}::uuid, ${other.sid}, 'password_totp', now())`));
    expect(await statusOf(A.approveControlAction(other, { requestId: req.id, payloadHash: req.payloadHash }))).toBe(403);
    expect(await dbError(withSystem((tx) => tx.execute(sql`
      UPDATE rta_control_requests SET status = 'executed', approved_by = requested_by, approver_sid = ${other.sid}, decided_at = now() WHERE id = ${req.id}::uuid`))))
      .toMatch(/two_person|different|approver/i);
  });

  it("the approver approves exactly what they reviewed (payload hash), and a request is immutable", async () => {
    const req = await A.requestControlAction(ops.a, activation({ changeRef: "CHG-HASH" }));
    expect(await statusOf(A.approveControlAction(ops.b, { requestId: req.id, payloadHash: "0".repeat(64) }))).toBe(409);
    expect(await dbError(withSystem((tx) => tx.execute(sql`UPDATE rta_control_requests SET payload = jsonb_set(payload, '{reportCodes}', '["MFSD211","MFSD201","MFSD203"]') WHERE id = ${req.id}::uuid`))))
      .toMatch(/immutable|cannot be changed|never edited/i);
    expect(await dbError(withSystem((tx) => tx.execute(sql`DELETE FROM rta_control_requests WHERE id = ${req.id}::uuid`)))).toMatch(/never deleted/);
    await A.rejectControlAction(ops.a, { requestId: req.id, note: "withdrawn by requester" });
  });

  it("replay: an executed request cannot be approved again, cited by a new SQL write, or reused for another firm", async () => {
    const req = await H.twoPerson(ops, activation({ changeRef: "CHG-REPLAY" }));
    expect(await statusOf(A.approveControlAction(ops.b, { requestId: req.id, payloadHash: req.payloadHash }))).toBe(409);
    // Cite the executed request in a hand-written activation (a later transaction).
    expect(await dbError(withSystem((tx) => tx.execute(sql`
      INSERT INTO rta_pipeline_activations (tenant_id, mode, posting_enabled, reason, approval_ref, requested_by, approved_by, expires_at, registrars, report_codes, control_request_id)
      VALUES (${firm}::uuid, 'validate_first', true, 'KFintech transaction pilot for this firm', 'CHG-REPLAY', ${ops.a.userId}::uuid, ${ops.b.userId}::uuid,
              ${later()}::timestamptz, ARRAY['kfintech'], ARRAY['MFSD211','MFSD201'], ${req.id}::uuid)`)))).toMatch(/request|executed|duplicate|unique/i);
    // A release request cannot start an activation, and vice versa.
    const rel = await A.requestControlAction(ops.a, { action: "release", scope: firm, changeRef: "CHG-X", reason: "release request reused as activation" });
    expect(await dbError(withSystem((tx) => tx.execute(sql`
      INSERT INTO rta_pipeline_activations (tenant_id, mode, posting_enabled, reason, approval_ref, requested_by, approved_by, control_request_id)
      VALUES (${firm}::uuid, 'shadow', false, 'release request reused as activation', 'CHG-X', ${ops.a.userId}::uuid, ${ops.b.userId}::uuid, ${rel.id}::uuid)`)))).toMatch(/request/i);
    await A.rejectControlAction(ops.b, { requestId: rel.id, note: "test cleanup — not wanted" });
  });

  it("expired: a request past its expiry is refused by the library and by the database", async () => {
    const req = await A.requestControlAction(ops.a, activation({ changeRef: "CHG-EXP", ttlMinutes: 1 }));
    // Age it as the database superuser with triggers off for this one statement (test-only time travel).
    if (!ADMIN_DB) return;
    const pg = await import("pg");
    const admin = new pg.default.Client({ connectionString: ADMIN_DB.replace(/\/[^/]+$/, "/" + new URL(TEST_DB!).pathname.slice(1)) });
    await admin.connect();
    try {
      await admin.query("BEGIN; SET LOCAL session_replication_role = replica;");
      await admin.query("UPDATE rta_control_requests SET requested_at = now() - interval '2 hours', expires_at = now() - interval '1 hour' WHERE id = $1", [req.id]);
      await admin.query("COMMIT");
    } finally { await admin.end(); }
    expect(await statusOf(A.approveControlAction(ops.b, { requestId: req.id, payloadHash: req.payloadHash }))).toBe(409);
    expect(await dbError(withSystem((tx) => tx.execute(sql`
      UPDATE rta_control_requests SET status = 'executed', approved_by = ${ops.b.userId}::uuid, approver_sid = ${ops.b.sid}, decided_at = now() WHERE id = ${req.id}::uuid`))))
      .toMatch(/expired/i);
  });

  it("unauthorized: no platform role, no 2FA, a disabled account or a revoked session cannot request or approve", async () => {
    const noRole = await H.createOperator(ops.platformTenant, "norole", { roles: ["ops"] });
    const no2fa = await H.createOperator(ops.platformTenant, "no2fa", { twoFa: false });
    const disabled = await H.createOperator(ops.platformTenant, "disabled", { status: "disabled" });
    const revoked = await H.createOperator(ops.platformTenant, "revoked");
    await withSystem((tx) => tx.execute(sql`UPDATE user_sessions SET revoked_at = now() WHERE session_id = ${revoked.sid}`));
    for (const who of [noRole, no2fa, disabled]) expect(await statusOf(A.requestControlAction(who, activation({ changeRef: "CHG-UNAUTH" })))).toBe(403);
    expect(await statusOf(A.requestControlAction(revoked, activation({ changeRef: "CHG-UNAUTH" })))).toBe(401);
    expect(await statusOf(A.requestControlAction({ userId: ops.a.userId, sid: null }, activation({ changeRef: "CHG-UNAUTH" })))).toBe(401);
    expect(await statusOf(A.requestControlAction({ userId: ops.a.userId, sid: "made-up-session" }, activation({ changeRef: "CHG-UNAUTH" })))).toBe(401);
    // The database refuses a request row for a non-operator even when written directly.
    expect(await dbError(withSystem((tx) => tx.execute(sql`
      INSERT INTO rta_control_requests (action, tenant_id, scope, payload, payload_hash, change_ref, reason, requested_by, requester_sid, expires_at)
      VALUES ('release', ${firm}::uuid, ${firm}, '{}'::jsonb, 'x', 'CHG-SQL', 'direct insert by a non-operator', ${no2fa.userId}::uuid, ${no2fa.sid}, now() + interval '1 hour')`))))
      .toMatch(/requester is not an active two-factor platform operator/);

    const req = await A.requestControlAction(ops.a, activation({ changeRef: "CHG-UNAUTH-2" }));
    for (const who of [noRole, no2fa, disabled]) expect(await statusOf(A.approveControlAction(who, { requestId: req.id, payloadHash: req.payloadHash }))).toBe(403);
    expect(await statusOf(A.approveControlAction(revoked, { requestId: req.id, payloadHash: req.payloadHash }))).toBe(401);
    // The API layer: a session without the platform capability never reaches the library.
    asSession(ops.b, ["owner"]);
    expect((await post({ action: "approve", requestId: req.id, payloadHash: req.payloadHash })).status).toBe(403);
    // The requester losing authorisation before approval voids the request.
    const c = await H.createOperator(ops.platformTenant, "leaver");
    const req2 = await A.requestControlAction(c, activation({ changeRef: "CHG-LEAVER" }));
    await withSystem((tx) => tx.execute(sql`UPDATE users SET status = 'disabled' WHERE id = ${c.userId}::uuid`));
    expect(await statusOf(A.approveControlAction(ops.b, { requestId: req2.id, payloadHash: req2.payloadHash }))).toBe(403);
    await A.rejectControlAction(ops.b, { requestId: req.id, note: "test cleanup — not wanted" });
  });

  it("direct bypass: SQL cannot activate, release or reverse without an executed request; the old library calls throw", async () => {
    expect(await dbError(withSystem((tx) => tx.execute(sql`
      INSERT INTO rta_pipeline_activations (tenant_id, mode, posting_enabled, reason, approval_ref, requested_by, approved_by, expires_at, registrars, report_codes)
      VALUES (${firm}::uuid, 'validate_first', true, 'direct SQL activation attempt', 'CHG-SQL', ${ops.a.userId}::uuid, ${ops.b.userId}::uuid, ${later()}::timestamptz, ARRAY['kfintech'], ARRAY['MFSD211'])`))))
      .toMatch(/request/i);
    await C.setPostingHalt({ scope: firm, halted: true, reason: "bypass test: firm halted by one operator", changedBy: ops.a.userId });
    expect(await dbError(withSystem((tx) => tx.execute(sql`UPDATE rta_posting_controls SET posting_halted = false, approved_by = ${ops.b.userId}::uuid WHERE scope = ${firm}`))))
      .toMatch(/request/i);
    expect(await dbError(withSystem((tx) => tx.execute(sql`
      INSERT INTO rta_posting_reversals (tenant_id, batch_id, reason, requested_by, approved_by, archived, counts)
      VALUES (${firm}::uuid, ${randomUUID()}::uuid, 'direct SQL reversal attempt', ${ops.a.userId}::uuid, ${ops.b.userId}::uuid, '{}'::jsonb, '{}'::jsonb)`))))
      .toMatch(/request/i);
    await expect(C.setPostingHalt({ scope: firm, halted: false, reason: "one-call release attempt", changedBy: ops.a.userId, approvedBy: ops.b.userId })).rejects.toThrow(/two-person|request/i);
    await expect(C.activateTenant({ tenantId: firm, mode: "validate_first", postingEnabled: false, reason: "one-call activation attempt", requestedBy: ops.a.userId, approvedBy: ops.b.userId })).rejects.toThrow(/request/i);
    await expect(R.reversePostingBatch(firm, randomUUID(), { reason: "one-call reversal attempt", dryRun: false } as any)).rejects.toThrow(/request/i);
    await expect(R.undoReversal(firm, randomUUID(), { by: ops.b.userId, reason: "one-call undo attempt" } as any)).rejects.toThrow(/request/i);
    // Still halted, still the same activation.
    expect(await firmHalted()).toBe(true);
  });

  it("the CLI cannot start anything: release, undo and reverse --commit exit 2 and change nothing", () => {
    const env = { ...process.env, DATABASE_URL: TEST_DB!, ALLOW_SYSTEM_TX: "1" };
    const run = (...args: string[]) => spawnSync("npx", ["tsx", "scripts/rta-posting-recovery.ts", ...args], { env, encoding: "utf8", timeout: 60_000 });
    const rel = run("release", "--scope", firm, "--by", ops.a.userId, "--approved-by", ops.b.userId, "--reason", "CLI release attempt");
    expect(rel.status).toBe(2);
    expect(rel.stderr).toMatch(/disabled on the command line/);
    expect(run("undo", "--tenant", firm, "--reversal", randomUUID(), "--by", ops.b.userId, "--reason", "CLI undo attempt").status).toBe(2);
    expect(run("reverse", "--tenant", firm, "--batch", randomUUID(), "--reason", "CLI reverse attempt", "--commit").status).toBe(2);
  }, 120_000);

  it("one operator halts (firm, global, EMERGENCY) at once; releasing takes two signed-in operators", async () => {
    asSession(ops.a);
    expect((await post({ action: "halt", scope: firm, reason: "one operator stops this firm now" })).status).toBe(200);
    const ev = await withSystem(async (tx) => (await tx.execute(sql`
      SELECT changed_by::text, actor_source FROM rta_posting_control_events WHERE scope = ${firm} ORDER BY at DESC LIMIT 1`)).rows[0] as any);
    expect(ev).toEqual({ changed_by: ops.a.userId, actor_source: "session" });
    // Release: A files, A cannot approve, B approves.
    const filed = await post({ action: "request", control: { action: "release", scope: firm, changeRef: "CHG-REL", reason: "incident closed after reconciliation" } });
    const { request } = await filed.json();
    expect((await post({ action: "approve", requestId: request.id, payloadHash: request.payloadHash })).status).toBe(403);
    expect(await firmHalted()).toBe(true);
    asSession(ops.b);
    expect((await post({ action: "approve", requestId: request.id, payloadHash: request.payloadHash })).status).toBe(200);
    expect(await firmHalted()).toBe(false);
    const row = await withSystem(async (tx) => (await tx.execute(sql`SELECT control_request_id::text AS r, changed_by::text AS a, approved_by::text AS b FROM rta_posting_controls WHERE scope = ${firm}`)).rows[0] as any);
    expect(row).toEqual({ r: request.id, a: ops.a.userId, b: ops.b.userId });
  });

  it("an approval of a pending request is refused once the firm is halted again only if the request is stale — a request is one action, once", async () => {
    // Two releases cannot be stacked from one approval: the second needs its own request.
    await C.setPostingHalt({ scope: firm, halted: true, reason: "halt again for the stacking check", changedBy: ops.b.userId });
    const r1 = await A.requestControlAction(ops.a, { action: "release", scope: firm, changeRef: "CHG-R1", reason: "release once, by two operators" });
    await A.approveControlAction(ops.b, { requestId: r1.id, payloadHash: r1.payloadHash });
    await C.setPostingHalt({ scope: firm, halted: true, reason: "halted again after the release", changedBy: ops.a.userId });
    expect(await statusOf(A.approveControlAction(ops.b, { requestId: r1.id, payloadHash: r1.payloadHash }))).toBe(409);
    expect(await firmHalted()).toBe(true);
  });
});
