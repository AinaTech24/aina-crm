/**
 * Who may post, and when (Phase 3G) — the production-capable controls over
 * validate-first posting. Built and tested outside production; nothing here
 * switches a firm on by itself.
 *
 * Two independent controls, both read INSIDE every posting transaction
 * (gate.ts) so a change takes effect for the very next batch:
 *
 *   Kill switch   rta_posting_controls, scope 'global' or a tenant id.
 *                 Halting needs one operator and a reason; releasing needs a
 *                 two-person control request (approvals.ts). Installed halted.
 *   Activation    rta_pipeline_activations, per firm, append-only. The
 *                 current row (latest effective, unexpired, unrevoked) is the
 *                 firm's mode: off · shadow · validate_first. Posting also
 *                 needs posting_enabled, which needs two people. No row = off.
 *
 * Every change is written to the append-only control history and, for a firm,
 * to its audit log. STARTS (any activation but a pause, any release) happen
 * only by executing an approved two-person control request (approvals.ts,
 * migration 0243): the requester and the approver are each a signed-in
 * platform session, and the database refuses a start that does not cite a
 * request executed in the same transaction. One operator may STOP (pause,
 * revoke, halt) at any time.
 */
import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";

type Tx = any;

export type PipelineModeName = "off" | "shadow" | "validate_first" | "paused";

export type Activation = {
  id: string; mode: PipelineModeName; postingEnabled: boolean; reason: string; approvalRef: string | null;
  requestedBy: string | null; approvedBy: string; effectiveFrom: string; expiresAt: string | null;
  /** The registrars this activation covers (migration 0242). Null only on rows written before it. */
  registrars: Registrar[] | null;
  /** The report types this activation covers (migration 0243). Null only on rows written before it. */
  reportCodes: string[] | null;
};

export type Registrar = "cams" | "kfintech";

/** The report types each registrar sends that the validate-first pipeline reads (staging/layouts.ts). */
export const REPORT_CODES: Record<Registrar, string[]> = {
  kfintech: ["MFSD211", "MFSD201", "MFSD203", "MFSD243", "MFSD230"],
  cams: ["R9", "WBR4", "R2", "WBR10", "WBR49"],
};

/** Is a file of this report type inside the activation? A null list (a pre-0243 row) covers every report type. */
export function reportCovered(a: { reportCodes: readonly string[] | null } | null, reportCode: string | null | undefined): boolean {
  if (!a || !a.reportCodes) return true;
  return !!reportCode && a.reportCodes.includes(reportCode);
}
export const REGISTRARS: Registrar[] = ["cams", "kfintech"];

/** Is a file / transaction of this registrar inside the activation? A null list (a pre-0242 row) covers every registrar. */
export function registrarCovered(a: { registrars: readonly string[] | null } | null, rta: string | null | undefined): boolean {
  if (!a || !a.registrars) return true;
  return !!rta && a.registrars.includes(rta);
}

export class ControlError extends Error {
  status = 400;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The firm's current activation, or null (= off). Reads under the caller's transaction (RLS: the firm's own rows). */
export async function currentActivation(tx: Tx, tenantId: string, opts: { lock?: boolean } = {}): Promise<Activation | null> {
  const r = (await tx.execute(sql`
    SELECT id::text, mode, posting_enabled, reason, approval_ref, requested_by::text, approved_by::text,
           effective_from::text, expires_at::text, registrars, report_codes
      FROM rta_pipeline_activations
     WHERE tenant_id = ${tenantId}::uuid AND revoked_at IS NULL AND effective_from <= now()
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY created_at DESC, id DESC
     LIMIT 1
     ${opts.lock ? sql`FOR SHARE` : sql``}
  `)).rows[0] as any;
  if (!r) return null;
  return {
    id: r.id, mode: r.mode, postingEnabled: !!r.posting_enabled, reason: r.reason, approvalRef: r.approval_ref,
    requestedBy: r.requested_by, approvedBy: r.approved_by, effectiveFrom: r.effective_from, expiresAt: r.expires_at,
    registrars: Array.isArray(r.registrars) ? r.registrars : null,
    reportCodes: Array.isArray(r.report_codes) ? r.report_codes : null,
  };
}

/**
 * Is posting halted for this firm? The 'global' posting switch (a missing row
 * counts as halted), an 'emergency' shutdown, or the firm's own row.
 */
export async function haltState(tx: Tx, tenantId: string | null, opts: { lock?: boolean } = {}): Promise<{ halted: boolean; reasons: string[] }> {
  const scopes = tenantId ? ["global", "emergency", tenantId] : ["global", "emergency"];
  const rows = (await tx.execute(sql`
    SELECT scope, posting_halted, reason FROM rta_posting_controls
     WHERE scope IN (${sql.join(scopes.map((s) => sql`${s}`), sql`, `)})
     ${opts.lock ? sql`FOR SHARE` : sql``}
  `)).rows as Array<{ scope: string; posting_halted: boolean; reason: string }>;
  const reasons: string[] = [];
  const global = rows.find((r) => r.scope === "global");
  if (!global) reasons.push("the global posting control is missing (treated as halted)");
  for (const r of rows) if (r.posting_halted) reasons.push(`posting is halted (${r.scope === "global" ? "all firms" : r.scope === "emergency" ? "EMERGENCY SHUTDOWN" : "this firm"}): ${r.reason}`);
  return { halted: reasons.length > 0, reasons };
}

export type ControlFacts = {
  /** The firm's current activation (latest effective, unexpired, unrevoked), or null. */
  current: Activation | null;
  /** The firm has had an activation row at some time. */
  everActivated: boolean;
  emergency: { halted: boolean; reason: string } | null;
  /** The new pipeline's posting switch; null = the row is missing (treated as halted). */
  global: { halted: boolean; reason: string } | null;
  firm: { halted: boolean; reason: string } | null;
};

/** Everything the regime decision reads, in one round trip (the caller's transaction). */
export async function controlFacts(tx: Tx, tenantId: string): Promise<ControlFacts> {
  const current = await currentActivation(tx, tenantId);
  const ever = (await tx.execute(sql`SELECT EXISTS (SELECT 1 FROM rta_pipeline_activations WHERE tenant_id = ${tenantId}::uuid AND effective_from <= now()) AS e`)).rows[0] as { e: boolean };
  const rows = (await tx.execute(sql`
    SELECT scope, posting_halted, reason FROM rta_posting_controls WHERE scope IN ('global', 'emergency', ${tenantId})`)).rows as Array<{ scope: string; posting_halted: boolean; reason: string }>;
  const pick = (scope: string) => { const r = rows.find((x) => x.scope === scope); return r ? { halted: !!r.posting_halted, reason: r.reason } : null; };
  return { current, everActivated: !!ever.e, emergency: pick("emergency"), global: pick("global"), firm: pick(tenantId) };
}

/**
 * Halt posting for every firm ('global'), EMERGENCY (every RTA write) or one
 * firm — ONE operator, at any time. Halting waits for in-flight posting
 * batches (they hold the row FOR SHARE) and stops every later one.
 *
 * RELEASING is not done here: it needs a two-person control request
 * (approvals.ts, action "release"); the database refuses a release that does
 * not cite one executed in the same transaction.
 */
export async function setPostingHalt(input: {
  scope: "global" | string; halted: boolean; reason: string; changedBy: string; approvedBy?: string | null;
  /** How the server knows who halted: a signed-in session, or only a name on a command line. */
  actorSource?: "session" | "cli";
}): Promise<void> {
  if (!input.halted) {
    throw new ControlError("releasing posting needs a two-person control request: one operator requests it, a DIFFERENT signed-in operator approves it (POST /api/super-admin/rta-pipeline)");
  }
  await withSystem((tx: Tx) => writeHaltTx(tx, { ...input, halted: true }));
}

/** Write a halt or (from an executed control request only) a release, inside the caller's transaction. */
export async function writeHaltTx(tx: Tx, input: {
  scope: "global" | string; halted: boolean; reason: string; changedBy: string; approvedBy?: string | null;
  controlRequestId?: string | null; actorSource?: "session" | "cli";
}): Promise<void> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 10) throw new ControlError("a reason of at least 10 characters is required");
  if (input.scope !== "global" && input.scope !== "emergency" && !UUID.test(input.scope)) throw new ControlError("scope must be 'global', 'emergency' or a firm id");
  if (!input.halted && (!input.approvedBy || input.approvedBy === input.changedBy || !input.controlRequestId)) {
    throw new ControlError("releasing posting needs an executed two-person control request (approver must differ from the requester)");
  }
  // Every posting holds the global row FOR SHARE; taking it FOR UPDATE waits
  // for in-flight batches (of any firm) even when this scope's row does not
  // exist yet — a row lock cannot protect a row that is about to be inserted.
  await tx.execute(sql`SELECT 1 FROM rta_posting_controls WHERE scope = 'global' FOR UPDATE`);
  await tx.execute(sql`
    INSERT INTO rta_posting_controls (scope, posting_halted, reason, changed_by, approved_by, changed_at, control_request_id)
    VALUES (${input.scope}, ${input.halted}, ${reason}, ${input.changedBy}::uuid, ${input.approvedBy ?? null}::uuid, now(), ${input.controlRequestId ?? null}::uuid)
    ON CONFLICT (scope) DO UPDATE SET posting_halted = EXCLUDED.posting_halted, reason = EXCLUDED.reason,
      changed_by = EXCLUDED.changed_by, approved_by = EXCLUDED.approved_by, changed_at = now(), control_request_id = EXCLUDED.control_request_id`);
  await tx.execute(sql`
    INSERT INTO rta_posting_control_events (scope, posting_halted, reason, changed_by, approved_by, control_request_id, actor_source)
    VALUES (${input.scope}, ${input.halted}, ${reason}, ${input.changedBy}::uuid, ${input.approvedBy ?? null}::uuid, ${input.controlRequestId ?? null}::uuid, ${input.actorSource ?? "session"})`);
  if (UUID.test(input.scope)) {
    await tx.execute(sql`
      INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, after, reason)
      VALUES (${input.scope}::uuid, ${input.changedBy}::uuid, 'user', ${input.halted ? "rta.posting.halt" : "rta.posting.release"}, 'rta_posting_control',
              ${JSON.stringify({ halted: input.halted, approvedBy: input.approvedBy ?? null, controlRequestId: input.controlRequestId ?? null, actorSource: input.actorSource ?? "session" })}::jsonb, ${reason})`);
  }
}

/**
 * Pause a firm (ONE operator — a stop). Every other mode is a START and is
 * recorded only by executing an approved two-person control request
 * (approvals.ts, action "activate"); the database refuses a start activation
 * that does not cite one.
 */
export async function activateTenant(input: {
  tenantId: string; mode: PipelineModeName; postingEnabled: boolean; reason: string; approvalRef?: string | null;
  requestedBy?: string | null; approvedBy: string; effectiveFrom?: string | null; expiresAt?: string | null;
  registrars?: Registrar[] | null; reportCodes?: string[] | null;
}): Promise<Activation> {
  if (input.mode !== "paused") {
    throw new ControlError("starting a mode (or enabling posting) needs a two-person control request: one operator requests it, a DIFFERENT signed-in operator approves it (POST /api/super-admin/rta-pipeline)");
  }
  return withTenant(input.tenantId, (tx: Tx) => insertActivationTx(tx, input));
}

/** Checks an activation's terms; shared by the request (approvals.ts) and the insert. */
export function checkActivationTerms(input: {
  mode: PipelineModeName; postingEnabled: boolean; reason: string; approvalRef?: string | null;
  expiresAt?: string | null; registrars?: string[] | null; reportCodes?: string[] | null;
}): { registrars: Registrar[] | null; reportCodes: string[] | null } {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 10) throw new ControlError("a reason of at least 10 characters is required");
  if (input.mode === "paused" && input.postingEnabled) throw new ControlError("a paused firm cannot have posting enabled");
  const registrars = input.registrars?.length ? [...new Set(input.registrars)].sort() as Registrar[] : null;
  if (registrars?.some((r) => !REGISTRARS.includes(r))) throw new ControlError(`registrars must be among ${REGISTRARS.join(", ")}`);
  const reportCodes = input.reportCodes?.length ? [...new Set(input.reportCodes.map((c) => c.trim().toUpperCase()))].sort() : null;
  if (reportCodes && !registrars) throw new ControlError("report types need the registrars they belong to");
  for (const c of reportCodes ?? []) {
    if (!registrars!.some((r) => REPORT_CODES[r].includes(c))) throw new ControlError(`report type ${c} is not one the named registrars (${registrars!.join(", ")}) send`);
  }
  if (input.postingEnabled) {
    if (input.mode !== "validate_first") throw new ControlError("posting can only be enabled in validate_first mode");
    if (!input.approvalRef?.trim()) throw new ControlError("enabling posting needs a change / approval reference");
    if (!registrars) throw new ControlError("enabling posting needs the registrars it covers (e.g. ['kfintech'] for a KFintech-only pilot)");
    if (!reportCodes) throw new ControlError("enabling posting needs the report types it covers (e.g. ['MFSD211', 'MFSD201'] for the KFintech transaction pilot)");
    if (!input.expiresAt) throw new ControlError("enabling posting needs an expiry (a time-limited pilot)");
    const exp = Date.parse(input.expiresAt);
    if (!Number.isFinite(exp) || exp <= Date.now()) throw new ControlError("the expiry must be in the future");
    const maxDays = Number(process.env.RTA_ACTIVATION_MAX_DAYS ?? 14);
    if (exp > Date.now() + maxDays * 864e5 + 60_000) throw new ControlError(`an activation with posting lasts at most ${maxDays} days`);
  }
  return { registrars, reportCodes };
}

/** Insert an activation row inside the caller's transaction (a pause, or a start from an executed control request). */
export async function insertActivationTx(tx: Tx, input: {
  tenantId: string; mode: PipelineModeName; postingEnabled: boolean; reason: string; approvalRef?: string | null;
  requestedBy?: string | null; approvedBy: string; effectiveFrom?: string | null; expiresAt?: string | null;
  registrars?: Registrar[] | null; reportCodes?: string[] | null; controlRequestId?: string | null;
}): Promise<Activation> {
  const { registrars, reportCodes } = checkActivationTerms(input);
  if (input.mode !== "paused" && (!input.requestedBy || input.requestedBy === input.approvedBy || !input.controlRequestId)) {
    throw new ControlError("starting a mode needs an executed two-person control request");
  }
  const reason = input.reason.trim();
  const exists = (await tx.execute(sql`SELECT 1 FROM tenants WHERE id = ${input.tenantId}::uuid`)).rows.length;
  if (!exists) throw Object.assign(new ControlError("firm not found"), { status: 404 });
  const arr = (v: string[] | null) => (v ? sql`ARRAY[${sql.join(v.map((r) => sql`${r}`), sql`, `)}]::text[]` : sql`NULL`);
  const row = (await tx.execute(sql`
    INSERT INTO rta_pipeline_activations (tenant_id, mode, posting_enabled, reason, approval_ref, requested_by, approved_by, effective_from, expires_at, registrars, report_codes, control_request_id)
    VALUES (${input.tenantId}::uuid, ${input.mode}, ${input.postingEnabled}, ${reason}, ${input.approvalRef?.trim() || null},
            ${input.requestedBy ?? null}::uuid, ${input.approvedBy}::uuid, COALESCE(${input.effectiveFrom ?? null}::timestamptz, now()), ${input.expiresAt ?? null}::timestamptz,
            ${arr(registrars)}, ${arr(reportCodes)}, ${input.controlRequestId ?? null}::uuid)
    RETURNING id::text`)).rows[0] as { id: string };
  await tx.execute(sql`
    INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, after, reason)
    VALUES (${input.tenantId}::uuid, ${input.approvedBy}::uuid, 'user', 'rta.pipeline.activate', 'rta_pipeline_activation', ${row.id}::uuid,
            ${JSON.stringify({ mode: input.mode, postingEnabled: input.postingEnabled, requestedBy: input.requestedBy ?? null, approvalRef: input.approvalRef ?? null, expiresAt: input.expiresAt ?? null, registrars, reportCodes, controlRequestId: input.controlRequestId ?? null })}::jsonb, ${reason})`);
  const cur = await currentActivation(tx, input.tenantId);
  if (!cur) throw new ControlError("the activation is recorded but not yet effective");
  return cur;
}

/**
 * Revoke the firm's current activation (one operator, with a reason). The firm
 * falls back to an earlier still-effective row if there is one; with none it is
 * PAUSED (resolvePipelineMode) — never the existing importer by itself.
 */
export async function revokeActivation(input: { tenantId: string; revokedBy: string; reason: string }): Promise<Activation | null> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 5) throw new ControlError("a reason is required");
  return withTenant(input.tenantId, async (tx: Tx) => {
    const cur = await currentActivation(tx, input.tenantId);
    if (!cur) throw Object.assign(new ControlError("this firm has no current activation"), { status: 404 });
    // Waits for in-flight posting (which holds the row FOR SHARE).
    await tx.execute(sql`UPDATE rta_pipeline_activations SET revoked_at = now(), revoked_by = ${input.revokedBy}::uuid, revoke_reason = ${reason} WHERE id = ${cur.id}::uuid`);
    await tx.execute(sql`
      INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, before, reason)
      VALUES (${input.tenantId}::uuid, ${input.revokedBy}::uuid, 'user', 'rta.pipeline.revoke', 'rta_pipeline_activation', ${cur.id}::uuid,
              ${JSON.stringify({ mode: cur.mode, postingEnabled: cur.postingEnabled })}::jsonb, ${reason})`);
    return currentActivation(tx, input.tenantId);
  });
}

/** Everything an operator needs to see about one firm's controls. */
export async function controlState(tenantId: string) {
  return withTenant(tenantId, async (tx: Tx) => {
    const activation = await currentActivation(tx, tenantId);
    const halt = await haltState(tx, tenantId);
    const history = (await tx.execute(sql`
      SELECT id::text, mode, posting_enabled, registrars, report_codes, control_request_id::text, reason, approval_ref, requested_by::text, approved_by::text, effective_from, expires_at, revoked_at, revoked_by::text, revoke_reason, created_at
        FROM rta_pipeline_activations WHERE tenant_id = ${tenantId}::uuid ORDER BY created_at DESC LIMIT 50`)).rows;
    return { activation, halt, history };
  });
}
