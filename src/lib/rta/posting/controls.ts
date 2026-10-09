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
 *                 requester and a DIFFERENT approver. Installed halted.
 *   Activation    rta_pipeline_activations, per firm, append-only. The
 *                 current row (latest effective, unexpired, unrevoked) is the
 *                 firm's mode: off · shadow · validate_first. Posting also
 *                 needs posting_enabled, which needs two people. No row = off.
 *
 * Every change is written to the append-only control history and, for a firm,
 * to its audit log. Callers are platform operators (super-admin API) or the
 * operator CLI; tenant users cannot reach these functions.
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
};

export type Registrar = "cams" | "kfintech";
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
           effective_from::text, expires_at::text, registrars
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
 * Halt (one operator) or release (requester + a different approver) posting
 * for every firm ('global') or one firm. Halting waits for in-flight posting
 * batches (they hold the row FOR SHARE) and stops every later one.
 */
export async function setPostingHalt(input: {
  scope: "global" | string; halted: boolean; reason: string; changedBy: string; approvedBy?: string | null;
}): Promise<void> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 10) throw new ControlError("a reason of at least 10 characters is required");
  if (input.scope !== "global" && input.scope !== "emergency" && !UUID.test(input.scope)) throw new ControlError("scope must be 'global', 'emergency' or a firm id");
  if (!input.halted && (!input.approvedBy || input.approvedBy === input.changedBy)) {
    throw new ControlError("releasing posting needs a second operator to approve (approver must differ from the requester)");
  }
  await withSystem(async (tx: Tx) => {
    // Every posting holds the global row FOR SHARE; taking it FOR UPDATE waits
    // for in-flight batches (of any firm) even when this scope's row does not
    // exist yet — a row lock cannot protect a row that is about to be inserted.
    await tx.execute(sql`SELECT 1 FROM rta_posting_controls WHERE scope = 'global' FOR UPDATE`);
    await tx.execute(sql`
      INSERT INTO rta_posting_controls (scope, posting_halted, reason, changed_by, approved_by, changed_at)
      VALUES (${input.scope}, ${input.halted}, ${reason}, ${input.changedBy}::uuid, ${input.approvedBy ?? null}::uuid, now())
      ON CONFLICT (scope) DO UPDATE SET posting_halted = EXCLUDED.posting_halted, reason = EXCLUDED.reason,
        changed_by = EXCLUDED.changed_by, approved_by = EXCLUDED.approved_by, changed_at = now()`);
    await tx.execute(sql`
      INSERT INTO rta_posting_control_events (scope, posting_halted, reason, changed_by, approved_by)
      VALUES (${input.scope}, ${input.halted}, ${reason}, ${input.changedBy}::uuid, ${input.approvedBy ?? null}::uuid)`);
    if (UUID.test(input.scope)) {
      await tx.execute(sql`
        INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, after, reason)
        VALUES (${input.scope}::uuid, ${input.changedBy}::uuid, 'user', ${input.halted ? "rta.posting.halt" : "rta.posting.release"}, 'rta_posting_control',
                ${JSON.stringify({ halted: input.halted, approvedBy: input.approvedBy ?? null })}::jsonb, ${reason})`);
    }
  });
}

/**
 * Record a firm's activation. Turning posting on needs mode validate_first,
 * a requester and a different approver, a reason and a change reference. The
 * previous current row is NOT edited: the newest effective row wins.
 */
export async function activateTenant(input: {
  tenantId: string; mode: PipelineModeName; postingEnabled: boolean; reason: string; approvalRef?: string | null;
  requestedBy?: string | null; approvedBy: string; effectiveFrom?: string | null; expiresAt?: string | null;
  /** Which registrars' files this activation covers. Required when posting is enabled (a KFintech-only pilot names only 'kfintech'). */
  registrars?: Registrar[] | null;
}): Promise<Activation> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 10) throw new ControlError("a reason of at least 10 characters is required");
  if (input.mode === "paused") {
    if (input.postingEnabled) throw new ControlError("a paused firm cannot have posting enabled");
  } else if (!input.requestedBy || input.requestedBy === input.approvedBy) {
    // One person may stop things; starting (or returning to the existing importer) takes two.
    throw new ControlError("starting a mode other than paused needs a requester and a DIFFERENT approver");
  }
  if (input.postingEnabled) {
    if (input.mode !== "validate_first") throw new ControlError("posting can only be enabled in validate_first mode");
    if (!input.requestedBy || input.requestedBy === input.approvedBy) throw new ControlError("enabling posting needs a requester and a DIFFERENT approver");
    if (!input.approvalRef?.trim()) throw new ControlError("enabling posting needs a change / approval reference");
    if (!input.registrars?.length) throw new ControlError("enabling posting needs the registrars it covers (e.g. ['kfintech'] for a KFintech-only pilot)");
  }
  const registrars = input.registrars?.length ? [...new Set(input.registrars)] : null;
  if (registrars?.some((r) => !REGISTRARS.includes(r))) throw new ControlError(`registrars must be among ${REGISTRARS.join(", ")}`);
  return withTenant(input.tenantId, async (tx: Tx) => {
    const exists = (await tx.execute(sql`SELECT 1 FROM tenants WHERE id = ${input.tenantId}::uuid`)).rows.length;
    if (!exists) throw Object.assign(new ControlError("firm not found"), { status: 404 });
    const row = (await tx.execute(sql`
      INSERT INTO rta_pipeline_activations (tenant_id, mode, posting_enabled, reason, approval_ref, requested_by, approved_by, effective_from, expires_at, registrars)
      VALUES (${input.tenantId}::uuid, ${input.mode}, ${input.postingEnabled}, ${reason}, ${input.approvalRef?.trim() || null},
              ${input.requestedBy ?? null}::uuid, ${input.approvedBy}::uuid, COALESCE(${input.effectiveFrom ?? null}::timestamptz, now()), ${input.expiresAt ?? null}::timestamptz,
              ${registrars ? sql`ARRAY[${sql.join(registrars.map((r) => sql`${r}`), sql`, `)}]::text[]` : sql`NULL`})
      RETURNING id::text`)).rows[0] as { id: string };
    await tx.execute(sql`
      INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, after, reason)
      VALUES (${input.tenantId}::uuid, ${input.approvedBy}::uuid, 'user', 'rta.pipeline.activate', 'rta_pipeline_activation', ${row.id}::uuid,
              ${JSON.stringify({ mode: input.mode, postingEnabled: input.postingEnabled, requestedBy: input.requestedBy ?? null, approvalRef: input.approvalRef ?? null, expiresAt: input.expiresAt ?? null, registrars })}::jsonb, ${reason})`);
    const cur = await currentActivation(tx, input.tenantId);
    if (!cur) throw new ControlError("the activation is recorded but not yet effective");
    return cur;
  });
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
      SELECT id::text, mode, posting_enabled, registrars, reason, approval_ref, requested_by::text, approved_by::text, effective_from, expires_at, revoked_at, revoked_by::text, revoke_reason, created_at
        FROM rta_pipeline_activations WHERE tenant_id = ${tenantId}::uuid ORDER BY created_at DESC LIMIT 50`)).rows;
    return { activation, halt, history };
  });
}
