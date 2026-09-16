/**
 * Scheduled communications drain.
 *
 * Compose lets an RM schedule an email for later — that lands a
 * `communications` row with status='scheduled' + scheduled_at. This worker
 * ticks every minute, finds due rows across all tenants, and fires each one in
 * place via sendScheduledEmail() (which re-checks consent + compliance before
 * the adapter call — consent can be revoked between scheduling and sending).
 *
 * Each row is processed in its own system transaction so one failure can't roll
 * back the rest of the batch. The `comms_scheduled_idx` makes the due-scan cheap.
 */

import { sql } from "drizzle-orm";
import { withSystem, withTenant } from "@/db/client";
import { randomUUID } from "node:crypto";
import { communications } from "@/db/schema";
import { sendScheduledEmail } from "@/lib/comms/compose";
import { captureError } from "@/lib/observability/capture";

const BATCH = 1;

export async function runScheduledCommsDrain(): Promise<{ picked: number; sent: number; skipped: number; failed: number }> {
  // 1. Atomically CLAIM due rows: flip scheduled → queued in one statement,
  //    locking the candidate set with FOR UPDATE SKIP LOCKED so overlapping
  //    ticks (or a second worker process) can't both grab the same row and
  //    double-send. Only the ids we actually claimed are returned.
  const due = await withSystem(async (tx) => {
    await tx.execute(sql`UPDATE communications SET status = 'failed', status_reason = 'Scheduled delivery attempt limit reached', claim_until = NULL, failed_at = now()
      WHERE scheduled_at IS NOT NULL AND status IN ('scheduled','queued') AND send_attempts >= 5 AND (claim_until IS NULL OR claim_until <= now())`);
    const rows = await tx.execute(sql`
      UPDATE communications
      SET status = 'queued', queued_at = now(), updated_at = now(), claim_token = gen_random_uuid(), claim_until = now() + interval '5 minutes', send_attempts = send_attempts + 1
      WHERE id IN (
        SELECT id FROM communications
        WHERE scheduled_at IS NOT NULL AND send_attempts < 5 AND ((status = 'scheduled' AND scheduled_at <= now()) OR (status = 'queued' AND COALESCE(claim_until, queued_at + interval '5 minutes') <= now()))
        ORDER BY scheduled_at ASC
        LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, tenant_id, claim_token
    `);
    return rows.rows as Array<{ id: string; tenant_id: string; claim_token: string }>;
  });

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // 2. Fire each in its own transaction.
  for (const row of due) {
    const id = row.id;
    try {
      const res = await withTenant(row.tenant_id, async (tx) => {
        const result = await sendScheduledEmail(tx, id, row.claim_token);
        if (result.status === "failed") await recoverScheduledSend(tx, id, row.claim_token, result.reason ?? "Send failed");
        else await tx.execute(sql`UPDATE communications SET claim_until = NULL WHERE id = ${id}::uuid AND claim_token = ${row.claim_token}::uuid`);
        return result;
      });
      if (res.status === "sent" || res.status === "queued") sent++;
      else if (res.status === "skipped") skipped++;
      else failed++;
    } catch (err) {
      failed++;
      console.error(`[scheduled-comms] send failed for ${id}:`, (err as Error).message);
      await withTenant(row.tenant_id, (tx) => recoverScheduledSend(tx, id, row.claim_token, (err as Error).message));
    }
  }

  if (due.length) {
    console.log(`[scheduled-comms] drained ${due.length} due (sent=${sent} skipped=${skipped} failed=${failed})`);
  }
  return { picked: due.length, sent, skipped, failed };
}

async function recoverScheduledSend(tx: import("@/db/client").Tx, id: string, token: string, error: string) {
  await tx.execute(sql`UPDATE communications SET
    status = CASE WHEN send_attempts >= 5 OR EXISTS (SELECT 1 FROM communication_deliveries d WHERE d.tenant_id = communications.tenant_id AND d.delivery_key = ${`compose:${id}`} AND d.state IN ('unknown','failed')) THEN 'failed' ELSE 'scheduled' END,
    status_reason = ${error}, claim_until = NULL, scheduled_at = now() + interval '1 minute' * power(2, send_attempts), updated_at = now()
    WHERE id = ${id}::uuid AND claim_token = ${token}::uuid`);
}

/** Self-scheduled 60s tick. Returns a stop fn (matches the other workers). */
export function startScheduledCommsWorker(): () => void {
  const interval = setInterval(() => {
    void runScheduledCommsDrain().catch((err) =>
      captureError("[scheduled-comms] tick failed", err)
    );
  }, 60 * 1000);
  interval.unref?.();
  console.log("[scheduled-comms] armed — draining due scheduled sends every 60s");
  return () => clearInterval(interval);
}
