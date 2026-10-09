/**
 * Two-person control requests (final pilot patch, migration 0243).
 *
 * Every START — an activation other than a pause, a kill-switch release, the
 * reversal of a posting batch, the undo of a reversal, and the two platform
 * scheme approvals — happens in two steps, each by a SEPARATELY AUTHENTICATED
 * platform operator:
 *
 *   1. requestControlAction(session, …)   the requester's own signed-in
 *      session files an immutable request: action, firm, scope, payload,
 *      change reference, reason and expiry (≤ 24 h). The database computes
 *      payload_hash over all of it.
 *   2. approveControlAction(session, { requestId, payloadHash })   a DIFFERENT
 *      signed-in operator approves exactly what they reviewed (the hash) and,
 *      in the same transaction, the action runs from the stored payload.
 *
 * Identity comes only from the verified server session (user id + live
 * session id), never from a request body or a command line. Both people must
 * be active platform_admin users with two-factor authentication on; the
 * approver's session must be live, and the requester must still be authorised
 * when the approval runs. A request is decided once (executed, rejected or
 * cancelled), cannot be edited, and expires.
 *
 * The database enforces the same (0243): a start activation, a release, a
 * reversal and an undo are refused unless they cite a request of that action
 * executed in the same transaction, whose people and payload match — so a
 * script or a direct SQL write cannot start anything, and an approval cannot
 * be replayed into another action, firm, scope or transaction.
 *
 * STOPS stay one-person and immediate: pause, revoke, halt (incl. EMERGENCY).
 */
import { sql } from "drizzle-orm";
import { withPlatformAdmin } from "@/db/client";
import { ControlError, checkActivationTerms, insertActivationTx, writeHaltTx, type PipelineModeName, type Registrar } from "./controls";
import { reverseBatchTx, undoReversalTx } from "./reversal";

type Tx = any;

/** The verified server session of a platform operator (from requireSession — never built from client input). */
export type OperatorSession = { userId: string; sid?: string | null };

export type ControlAction = "activate" | "release" | "reverse" | "undo" | "approve_scheme_mapping" | "approve_amc_identity";

export type ControlRequestInput =
  | { action: "activate"; tenantId: string; mode: Exclude<PipelineModeName, "paused">; postingEnabled: boolean; registrars?: Registrar[] | null; reportCodes?: string[] | null; expiresAt?: string | null; changeRef: string; reason: string; ttlMinutes?: number }
  | { action: "release"; scope: "global" | "emergency" | string; changeRef: string; reason: string; ttlMinutes?: number }
  | { action: "reverse"; tenantId: string; batchId: string; changeRef: string; reason: string; ttlMinutes?: number }
  | { action: "undo"; tenantId: string; reversalId: string; changeRef: string; reason: string; ttlMinutes?: number }
  | { action: "approve_scheme_mapping"; rta: "cams" | "kfintech"; amcCode: string; schemeCode: string; amfiSchemeCode: string; note: string; changeRef: string; reason: string; ttlMinutes?: number }
  | { action: "approve_amc_identity"; rta: "cams" | "kfintech"; amcCode: string; amfiAmc: string; role: "primary" | "successor"; note: string; changeRef: string; reason: string; ttlMinutes?: number };

export type ControlRequest = {
  id: string; action: ControlAction; tenantId: string | null; scope: string; payload: Record<string, unknown>; payloadHash: string;
  changeRef: string; reason: string; requestedBy: string; requestedAt: string; expiresAt: string; status: string;
  approvedBy: string | null; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; result: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (message: string, status: number) => Object.assign(new ControlError(message), { status });

/**
 * The operator behind a session, as the database knows them now. Throws 401
 * for a missing / revoked session and 403 for anyone who is not an active
 * platform_admin with two-factor authentication on.
 */
async function verifyOperator(tx: Tx, userId: string, sid: string | null | undefined, opts: { live: boolean; who: string }) {
  if (!userId || !UUID.test(userId)) throw err(`${opts.who}: a signed-in platform session is required`, 401);
  const u = (await tx.execute(sql`SELECT status, roles, coalesce(two_fa_enabled, false) AS two_fa FROM users WHERE id = ${userId}::uuid`)).rows[0] as { status: string; roles: string[]; two_fa: boolean } | undefined;
  if (!u) throw err(`${opts.who}: not a platform operator`, 403);
  if (u.status !== "active") throw err(`${opts.who}: this operator account is not active`, 403);
  if (!(u.roles ?? []).includes("platform_admin")) throw err(`${opts.who}: needs the platform_admin role`, 403);
  if (!u.two_fa) throw err(`${opts.who}: two-factor authentication must be on for this operator`, 403);
  if (!sid) throw err(`${opts.who}: a signed-in platform session is required`, 401);
  const s = (await tx.execute(sql`SELECT revoked_at FROM user_sessions WHERE session_id = ${sid} AND user_id = ${userId}::uuid LIMIT 1`)).rows[0] as { revoked_at: string | null } | undefined;
  if (!s || (opts.live && s.revoked_at)) throw err(`${opts.who}: this session is not live (signed out or revoked)`, 401);
}

const rowOf = (r: any): ControlRequest => ({
  id: r.id, action: r.action, tenantId: r.tenant_id, scope: r.scope, payload: r.payload, payloadHash: r.payload_hash, changeRef: r.change_ref, reason: r.reason,
  requestedBy: r.requested_by, requestedAt: r.requested_at, expiresAt: r.expires_at, status: r.status, approvedBy: r.approved_by, decidedBy: r.decided_by,
  decidedAt: r.decided_at, decisionNote: r.decision_note, result: r.result,
});
const SELECT = sql`SELECT id::text, action, tenant_id::text, scope, payload, payload_hash, change_ref, reason, requested_by::text, requested_at::text, expires_at::text,
  status, approved_by::text, decided_by::text, decided_at::text, decision_note, result FROM rta_control_requests`;

/** Validate a request and give the stored form of its target and payload. */
async function shapeRequest(tx: Tx, input: ControlRequestInput): Promise<{ tenantId: string | null; scope: string; payload: Record<string, unknown> }> {
  const firm = async (tenantId: string) => {
    if (!UUID.test(tenantId ?? "")) throw err("a firm id is required", 400);
    if (!(await tx.execute(sql`SELECT 1 FROM tenants WHERE id = ${tenantId}::uuid`)).rows.length) throw err("firm not found", 404);
  };
  switch (input.action) {
    case "activate": {
      await firm(input.tenantId);
      if ((input.mode as string) === "paused") throw err("a pause is a stop — one operator records it directly", 400);
      const t = checkActivationTerms({ mode: input.mode, postingEnabled: input.postingEnabled, reason: input.reason, approvalRef: input.changeRef, expiresAt: input.expiresAt, registrars: input.registrars, reportCodes: input.reportCodes });
      const expiresAt = input.expiresAt ? new Date(input.expiresAt).toISOString() : null;
      return { tenantId: input.tenantId, scope: input.tenantId, payload: { mode: input.mode, postingEnabled: input.postingEnabled, registrars: t.registrars, reportCodes: t.reportCodes, expiresAt } };
    }
    case "release": {
      if (input.scope !== "global" && input.scope !== "emergency" && !UUID.test(input.scope)) throw err("scope must be 'global', 'emergency' or a firm id", 400);
      if (UUID.test(input.scope)) await firm(input.scope);
      return { tenantId: UUID.test(input.scope) ? input.scope : null, scope: input.scope, payload: { scope: input.scope } };
    }
    case "reverse": {
      await firm(input.tenantId);
      if (!UUID.test(input.batchId ?? "")) throw err("a batch id is required", 400);
      const b = (await tx.execute(sql`SELECT record_kind FROM rta_staging_batches WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.batchId}::uuid`)).rows[0] as { record_kind: string } | undefined;
      if (!b) throw err("batch not found for this firm", 404);
      return { tenantId: input.tenantId, scope: input.tenantId, payload: { batchId: input.batchId } };
    }
    case "undo": {
      await firm(input.tenantId);
      if (!UUID.test(input.reversalId ?? "")) throw err("a reversal id is required", 400);
      const r = (await tx.execute(sql`SELECT undone_at FROM rta_posting_reversals WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.reversalId}::uuid`)).rows[0] as { undone_at: string | null } | undefined;
      if (!r) throw err("reversal not found for this firm", 404);
      if (r.undone_at) throw err("this reversal has already been undone", 409);
      return { tenantId: input.tenantId, scope: input.tenantId, payload: { reversalId: input.reversalId } };
    }
    case "approve_scheme_mapping": {
      if ((input.note ?? "").trim().length < 10) throw err("say what evidence was read (at least 10 characters)", 400);
      return { tenantId: null, scope: "platform", payload: { rta: input.rta, amcCode: input.amcCode.trim(), schemeCode: input.schemeCode.trim(), amfiSchemeCode: input.amfiSchemeCode.trim(), note: input.note.trim() } };
    }
    case "approve_amc_identity": {
      if ((input.note ?? "").trim().length < 10) throw err("say what evidence was read (at least 10 characters)", 400);
      return { tenantId: null, scope: "platform", payload: { rta: input.rta, amcCode: input.amcCode.trim(), amfiAmc: input.amfiAmc.trim(), role: input.role, note: input.note.trim() } };
    }
    default:
      throw err("unknown control action", 400);
  }
}

/** Step 1 — the requester's own session files the request. Nothing changes yet. */
export async function requestControlAction(session: OperatorSession, input: ControlRequestInput): Promise<ControlRequest> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 10) throw err("a reason of at least 10 characters is required", 400);
  if ((input.changeRef ?? "").trim().length < 3) throw err("a change / approval reference is required", 400);
  const ttl = Math.min(Math.max(Number(input.ttlMinutes ?? process.env.RTA_CONTROL_REQUEST_TTL_MIN ?? 120), 1), 24 * 60);
  return withPlatformAdmin(session.userId, async (tx: Tx) => {
    await verifyOperator(tx, session.userId, session.sid, { live: true, who: "requester" });
    const shaped = await shapeRequest(tx, input);
    const row = (await tx.execute(sql`
      INSERT INTO rta_control_requests (action, tenant_id, scope, payload, payload_hash, change_ref, reason, requested_by, requester_sid, expires_at)
      VALUES (${input.action}, ${shaped.tenantId}::uuid, ${shaped.scope}, ${JSON.stringify(shaped.payload)}::jsonb, 'computed-by-the-database',
              ${input.changeRef.trim()}, ${reason}, ${session.userId}::uuid, ${session.sid}, now() + make_interval(mins => ${ttl}::int))
      RETURNING id::text`)).rows[0] as { id: string };
    if (shaped.tenantId) {
      await tx.execute(sql`
        INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, after, reason)
        VALUES (${shaped.tenantId}::uuid, ${session.userId}::uuid, 'user', 'rta.control.request', 'rta_control_request', ${row.id}::uuid,
                ${JSON.stringify({ action: input.action, scope: shaped.scope, payload: shaped.payload, changeRef: input.changeRef.trim() })}::jsonb, ${reason})`);
    }
    return rowOf((await tx.execute(sql`${SELECT} WHERE id = ${row.id}::uuid`)).rows[0]);
  });
}

/**
 * Step 2 — a DIFFERENT signed-in operator approves exactly the request they
 * reviewed (its payloadHash), and the action runs from the stored payload in
 * the same transaction. Returns the request with its result.
 */
export async function approveControlAction(session: OperatorSession, input: { requestId: string; payloadHash: string; note?: string | null }): Promise<ControlRequest> {
  if (!UUID.test(input.requestId ?? "")) throw err("a request id is required", 400);
  return withPlatformAdmin(session.userId, async (tx: Tx) => {
    const r = (await tx.execute(sql`${SELECT} WHERE id = ${input.requestId}::uuid FOR UPDATE`)).rows[0] as any;
    if (!r) throw err("control request not found", 404);
    const req = rowOf(r);
    if (req.status !== "pending") throw err(`this request is already ${req.status} — a request is used once`, 409);
    if (Date.parse(req.expiresAt) <= Date.now()) throw err(`this request expired at ${req.expiresAt} — file a new one`, 409);
    if (req.requestedBy === session.userId) throw err("you cannot approve your own request — a DIFFERENT operator must approve it", 403);
    await verifyOperator(tx, session.userId, session.sid, { live: true, who: "approver" });
    const reqSid = (await tx.execute(sql`SELECT requester_sid FROM rta_control_requests WHERE id = ${req.id}::uuid`)).rows[0] as { requester_sid: string };
    await verifyOperator(tx, req.requestedBy, reqSid.requester_sid, { live: false, who: "requester" });
    if (!input.payloadHash || input.payloadHash !== req.payloadHash) throw err("this is not the request you reviewed (the payload hash differs) — review it again", 409);

    await tx.execute(sql`
      UPDATE rta_control_requests SET status = 'executed', approved_by = ${session.userId}::uuid, approver_sid = ${session.sid ?? null},
             decided_at = now(), decision_note = ${input.note?.trim() || null}
       WHERE id = ${req.id}::uuid`);
    const p = req.payload as any;
    const people = { requestedBy: req.requestedBy, approvedBy: session.userId };
    let result: unknown;
    switch (req.action) {
      case "activate":
        result = await insertActivationTx(tx, {
          tenantId: req.tenantId!, mode: p.mode, postingEnabled: !!p.postingEnabled, reason: req.reason, approvalRef: req.changeRef,
          ...people, expiresAt: p.expiresAt ?? null, registrars: p.registrars ?? null, reportCodes: p.reportCodes ?? null, controlRequestId: req.id,
        });
        break;
      case "release":
        await writeHaltTx(tx, { scope: req.scope, halted: false, reason: req.reason, changedBy: req.requestedBy, approvedBy: session.userId, controlRequestId: req.id, actorSource: "session" });
        result = { released: req.scope };
        break;
      case "reverse":
        result = await reverseBatchTx(tx, req.tenantId!, p.batchId, { reason: req.reason, dryRun: false, ...people, controlRequestId: req.id });
        break;
      case "undo":
        result = await undoReversalTx(tx, req.tenantId!, p.reversalId, { by: session.userId, requestedBy: req.requestedBy, reason: req.reason, undoRequestId: req.id });
        break;
      case "approve_scheme_mapping": {
        const { approvePlatformMapping } = await import("@/lib/rta/scheme-resolution");
        result = await approvePlatformMapping(tx, { rta: p.rta, amcCode: p.amcCode, schemeCode: p.schemeCode, amfiSchemeCode: p.amfiSchemeCode, note: p.note, ...people });
        break;
      }
      case "approve_amc_identity": {
        const { approveAmcIdentity } = await import("@/lib/rta/scheme-resolution");
        result = await approveAmcIdentity(tx, { rta: p.rta, amcCode: p.amcCode, amfiAmc: p.amfiAmc, role: p.role, note: p.note, ...people });
        break;
      }
    }
    await tx.execute(sql`UPDATE rta_control_requests SET result = ${JSON.stringify(result ?? null)}::jsonb WHERE id = ${req.id}::uuid`);
    if (req.tenantId) {
      await tx.execute(sql`
        INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, after, reason)
        VALUES (${req.tenantId}::uuid, ${session.userId}::uuid, 'user', 'rta.control.execute', 'rta_control_request', ${req.id}::uuid,
                ${JSON.stringify({ action: req.action, scope: req.scope, requestedBy: req.requestedBy, approvedBy: session.userId, changeRef: req.changeRef, payloadHash: req.payloadHash })}::jsonb, ${req.reason})`);
    }
    return rowOf((await tx.execute(sql`${SELECT} WHERE id = ${req.id}::uuid`)).rows[0]);
  });
}

/** Reject (another operator) or cancel (the requester) a pending request. Nothing runs. */
export async function rejectControlAction(session: OperatorSession, input: { requestId: string; note: string }): Promise<ControlRequest> {
  if ((input.note ?? "").trim().length < 5) throw err("say why (at least 5 characters)", 400);
  return withPlatformAdmin(session.userId, async (tx: Tx) => {
    await verifyOperator(tx, session.userId, session.sid, { live: true, who: "operator" });
    const r = (await tx.execute(sql`${SELECT} WHERE id = ${input.requestId}::uuid FOR UPDATE`)).rows[0] as any;
    if (!r) throw err("control request not found", 404);
    if (r.status !== "pending") throw err(`this request is already ${r.status}`, 409);
    const status = r.requested_by === session.userId ? "cancelled" : "rejected";
    await tx.execute(sql`UPDATE rta_control_requests SET status = ${status}, decided_by = ${session.userId}::uuid, decided_at = now(), decision_note = ${input.note.trim()} WHERE id = ${input.requestId}::uuid`);
    return rowOf((await tx.execute(sql`${SELECT} WHERE id = ${input.requestId}::uuid`)).rows[0]);
  });
}

/** Requests for review (pending first). */
export async function listControlRequests(session: OperatorSession, opts: { status?: string; tenantId?: string; limit?: number } = {}): Promise<ControlRequest[]> {
  return withPlatformAdmin(session.userId, async (tx: Tx) => {
    const where = [sql`true`];
    if (opts.status) where.push(sql`status = ${opts.status}`);
    if (opts.tenantId) where.push(sql`tenant_id = ${opts.tenantId}::uuid`);
    const rows = (await tx.execute(sql`${SELECT} WHERE ${sql.join(where, sql` AND `)} ORDER BY (status = 'pending') DESC, requested_at DESC LIMIT ${Math.min(opts.limit ?? 50, 200)}`)).rows;
    return rows.map(rowOf);
  });
}
