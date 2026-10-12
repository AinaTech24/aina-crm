/**
 * Cancelling a parked or queued RTA import (final pilot patch, P2).
 *
 * A file that is not on the approved inventory must never post when a firm
 * resumes. One authenticated platform operator (a stop, like a halt) cancels
 * it: the import row becomes 'cancelled' with who, when and why (migration
 * 0243) and an audit-log row; the queued job is removed; the stored file and
 * the row's provenance are KEPT. The worker refuses a cancelled import at run
 * time, so a job that survives (a delayed retry, a re-queue script, a Redis
 * hiccup during removal) can never run it. A cancelled import is not
 * re-importable — an approved file is uploaded again, through every intake
 * check.
 */
import { sql } from "drizzle-orm";
import { withPlatformAdmin } from "@/db/client";
import { ControlError } from "./controls";

type Tx = any;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const err = (message: string, status: number) => Object.assign(new ControlError(message), { status });

export type CancelledImport = { importId: string; status: "cancelled"; cancelledAt: string; jobsRemoved: number; queueChecked: boolean };

export async function cancelParkedImport(session: { userId: string; sid?: string | null }, input: { tenantId: string; importId: string; reason: string }): Promise<CancelledImport> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length < 10) throw err("a reason of at least 10 characters is required", 400);
  if (!UUID.test(input.tenantId ?? "") || !UUID.test(input.importId ?? "")) throw err("a firm id and an import id are required", 400);
  const row = await withPlatformAdmin(session.userId, async (tx: Tx) => {
    // One signed-in operator, with an MFA-verified session (migration 0244):
    // a cancellation is final, so it is not a stop that must never be blocked.
    const { verifyOperator } = await import("./approvals");
    await verifyOperator(tx, session.userId, session.sid, { live: true, who: "operator" });
    const r = (await tx.execute(sql`
      SELECT id::text, status, file_name FROM rta_file_imports WHERE tenant_id = ${input.tenantId}::uuid AND id = ${input.importId}::uuid FOR UPDATE`)).rows[0] as { id: string; status: string; file_name: string } | undefined;
    if (!r) throw err("import not found for this firm", 404);
    if (r.status === "cancelled") throw err("this import is already cancelled", 409);
    if (r.status === "parsing") throw err("this import is running now — halt the firm (it parks at the next check) and cancel it once it shows as parked", 409);
    if (r.status !== "uploaded") throw err(`only a queued or parked import can be cancelled; this one is ${r.status}`, 409);
    const done = (await tx.execute(sql`
      UPDATE rta_file_imports
         SET status = 'cancelled', cancelled_at = now(), cancelled_by = ${session.userId}::uuid, cancel_reason = ${reason},
             remarks = ${`Cancelled by a platform operator — nothing was imported; the file is kept. Reason: ${reason}`.slice(0, 500)}
       WHERE id = ${input.importId}::uuid
       RETURNING cancelled_at::text`)).rows[0] as { cancelled_at: string };
    await tx.execute(sql`
      INSERT INTO audit_log (tenant_id, actor_user_id, actor_type, action, entity_type, entity_id, before, after, reason)
      VALUES (${input.tenantId}::uuid, ${session.userId}::uuid, 'user', 'rta.import.cancel', 'rta_file_import', ${input.importId}::uuid,
              ${JSON.stringify({ status: r.status })}::jsonb, ${JSON.stringify({ status: "cancelled", fileName: r.file_name })}::jsonb, ${reason})`);
    return done;
  });
  // Remove the queued job(s) for this import. The row is already cancelled, so
  // a job this misses is refused by the worker; nothing depends on this step.
  let jobsRemoved = 0;
  let queueChecked = false;
  try {
    const { Q, producerReady } = await import("@/workers/queues");
    // The producer connection has no offline buffer, and the sweep starts only
    // once it is READY (bounded): with Redis down nothing is sent now and
    // nothing is replayed later, behind the operator's back, when Redis
    // returns (FS-8). Jobs it could not reach stay queued and the worker
    // refuses them.
    const timeoutMs = Number(process.env.RTA_CANCEL_QUEUE_TIMEOUT_MS ?? 5000);
    if (await producerReady(timeoutMs)) {
      const q = Q.rtaImportProducer();
      // Bounded: Redis failing mid-sweep must not hang the operator — the row is already final.
      const sweep = (async () => {
        const jobs = await q.getJobs(["delayed", "wait", "waiting", "paused", "prioritized"] as any);
        for (const j of jobs) {
          if (j && (j.data as { importId?: string } | undefined)?.importId === input.importId) { await j.remove(); jobsRemoved++; }
        }
        return true;
      })().catch(() => false);
      queueChecked = await Promise.race([sweep, new Promise<boolean>((r) => setTimeout(() => r(false), timeoutMs))]);
    }
  } catch {
    queueChecked = false;
  }
  return { importId: input.importId, status: "cancelled", cancelledAt: row.cancelled_at, jobsRemoved, queueChecked };
}

/** Thrown by a worker path that finds its import cancelled when it tries to claim it; the job ends quietly. */
export class ImportCancelledError extends Error {
  name = "ImportCancelledError";
  constructor(importId: string) { super(`import ${importId} was cancelled by a platform operator — not run`); }
}

/** The worker's guard: true when an operator cancelled this import (the job does nothing, the file is kept). */
export async function importCancelled(tx: Tx, importId: string | undefined | null): Promise<boolean> {
  if (!importId || !UUID.test(importId)) return false;
  const r = (await tx.execute(sql`SELECT status FROM rta_file_imports WHERE id = ${importId}::uuid`)).rows[0] as { status: string } | undefined;
  return r?.status === "cancelled";
}
