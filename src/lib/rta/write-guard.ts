/**
 * One rule for every path that can write RTA-derived financial records
 * OUTSIDE the validate-first pipeline (Phase 3H): the existing importer, the
 * generic transaction import, reconciliation "sync to CRM", post-import
 * business matching, the nightly scanners and the operator scripts.
 *
 * Called INSIDE the writer's own transaction, so the decision and the writes
 * are one unit: the control rows are read FOR SHARE, which makes an operator's
 * halt (setPostingHalt takes the 'global' row FOR UPDATE first) wait for this
 * transaction and stop the next one.
 *
 *   stopped  — an EMERGENCY shutdown, the firm's own halt, a paused firm, or a
 *              firm whose activation ended: nothing RTA-derived is written.
 *   bypass   — additionally refused while the firm is activated for
 *              validate-first: a second, unvalidated way into the same tables
 *              (generic CSV of registrar rows, opening-balance sync) would
 *              defeat the pipeline, the ledger and reversal.
 *
 * The pipeline itself is guarded by lib/rta/posting/gate.ts; this file never
 * permits what the gate would refuse.
 */
import { sql } from "drizzle-orm";

type Tx = any;

export class RtaWritesStoppedError extends Error {
  status = 409;
  constructor(public reason: string, public code: "stopped" | "pipeline_only") {
    super(reason);
    this.name = "RtaWritesStoppedError";
  }
}

export type WriteKind =
  /** The existing importer, derived-state jobs (matching, scanners): stop only when the firm is stopped. */
  | "derived"
  /** A second way into RTA-derived tables: also refused for a validate-first firm. */
  | "bypass";

/** Why RTA-derived writes are not allowed for this firm right now, or null. */
export async function rtaWriteDenial(tx: Tx, tenantId: string, kind: WriteKind): Promise<{ reason: string; code: "stopped" | "pipeline_only" } | null> {
  const controls = (await tx.execute(sql`
    SELECT scope, posting_halted, reason FROM rta_posting_controls
     WHERE scope IN ('global', 'emergency', ${tenantId}) FOR SHARE`)).rows as Array<{ scope: string; posting_halted: boolean; reason: string }>;
  const emergency = controls.find((c) => c.scope === "emergency" && c.posting_halted);
  if (emergency) return { code: "stopped", reason: `EMERGENCY SHUTDOWN of all RTA imports: ${emergency.reason}` };
  const firm = controls.find((c) => c.scope === tenantId && c.posting_halted);
  if (firm) return { code: "stopped", reason: `RTA imports are halted for this firm: ${firm.reason}` };

  const act = (await tx.execute(sql`
    SELECT
      (SELECT mode FROM rta_pipeline_activations
        WHERE tenant_id = ${tenantId}::uuid AND revoked_at IS NULL AND effective_from <= now()
          AND (expires_at IS NULL OR expires_at > now())
        ORDER BY created_at DESC, id DESC LIMIT 1) AS current_mode,
      EXISTS (SELECT 1 FROM rta_pipeline_activations WHERE tenant_id = ${tenantId}::uuid AND effective_from <= now()) AS ever`)).rows[0] as { current_mode: string | null; ever: boolean };
  if (act.current_mode === "paused") return { code: "stopped", reason: "RTA imports are paused for this firm" };
  if (!act.current_mode && act.ever) return { code: "stopped", reason: "this firm's RTA activation ended; it stays paused until an operator records the next mode" };
  if (kind === "bypass" && act.current_mode === "validate_first") {
    return { code: "pipeline_only", reason: "this firm imports registrar data validate-first only — upload the RTA file at RTA File Imports instead" };
  }
  return null;
}

/** Throwing form; the API error handler turns the 409 into JSON. */
export async function assertRtaWritesAllowed(tx: Tx, tenantId: string, kind: WriteKind): Promise<void> {
  const d = await rtaWriteDenial(tx, tenantId, kind);
  if (d) throw new RtaWritesStoppedError(d.reason, d.code);
}
