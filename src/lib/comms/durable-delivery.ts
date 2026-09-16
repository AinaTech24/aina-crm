import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { withTenant } from "@/db/client";

export type DeliveryState = "preparing" | "sending" | "retry" | "sent" | "unknown" | "failed";
export class DeliveryUnavailable extends Error {
  constructor(public readonly state: DeliveryState, message: string) { super(message); }
}

/** Only pre-provider failures may be retried automatically. A timed-out SMTP,
 * SMS or WhatsApp request might already have been accepted by the provider. */
export function recoveredDeliveryState(state: DeliveryState, attempts: number): DeliveryState {
  if (state === "sending" || state === "unknown") return "unknown";
  return attempts >= 5 ? "failed" : "retry";
}

/** This ledger deliberately commits independently of the caller's transaction:
 * rollback after provider acknowledgement must never erase evidence of delivery.
 * No FK to an uncommitted communications/step row is allowed here. */
export async function durableDelivery<T extends Record<string, unknown>>(
  tenantId: string,
  key: string,
  audit: Record<string, unknown>,
  send: (markSending: () => Promise<void>) => Promise<T>,
): Promise<T> {
  const token = randomUUID();
  const claimed = await withTenant(tenantId, async (tx) => {
    await tx.execute(sql`INSERT INTO communication_deliveries (tenant_id, delivery_key, state, audit)
      VALUES (${tenantId}::uuid, ${key}, 'retry', ${JSON.stringify(audit)}::jsonb)
      ON CONFLICT (tenant_id, delivery_key) DO NOTHING`);
    const rows = await tx.execute(sql`SELECT * FROM communication_deliveries WHERE tenant_id = ${tenantId}::uuid AND delivery_key = ${key} FOR UPDATE`);
    const row = rows.rows[0] as { state: DeliveryState; attempts: number; lease_until: Date | null; next_attempt_at: Date | null; result: T | null; error: string | null };
    if (row.state === "sent") return { result: row.result! };
    if (["unknown", "failed"].includes(row.state)) return { error: row.state, reason: row.error };
    if (row.lease_until && new Date(row.lease_until) > new Date()) return { error: row.state, reason: "Delivery is being processed" };
    if (row.state === "sending") {
      await tx.execute(sql`UPDATE communication_deliveries SET state = 'unknown', error = 'Provider acknowledgement unknown after worker interruption; reconcile before resending', lease_until = NULL, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND delivery_key = ${key}`);
      await tx.execute(sql`UPDATE communication_delivery_attempts SET state = 'unknown', error = 'Worker interrupted after provider call began', completed_at = now() WHERE tenant_id = ${tenantId}::uuid AND delivery_key = ${key} AND completed_at IS NULL`);
      return { error: "unknown" as const, reason: "Provider acknowledgement unknown; reconciliation required" };
    }
    if (row.attempts >= 5) {
      await tx.execute(sql`UPDATE communication_deliveries SET state = 'failed', lease_until = NULL, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND delivery_key = ${key}`);
      return { error: "failed" as const, reason: "Delivery attempt limit reached" };
    }
    if (row.next_attempt_at && new Date(row.next_attempt_at) > new Date()) return { error: "retry" as const, reason: "Delivery retry is deferred" };
    await tx.execute(sql`UPDATE communication_delivery_attempts SET state = 'retry', error = 'Worker interrupted before provider call', completed_at = now() WHERE tenant_id = ${tenantId}::uuid AND delivery_key = ${key} AND completed_at IS NULL`);
    await tx.execute(sql`UPDATE communication_deliveries SET state = 'preparing', lease_token = ${token}::uuid, lease_until = now() + interval '5 minutes', attempts = attempts + 1, audit = ${JSON.stringify(audit)}::jsonb, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND delivery_key = ${key}`);
    await tx.execute(sql`INSERT INTO communication_delivery_attempts (tenant_id, delivery_key, attempt, lease_token, state) VALUES (${tenantId}::uuid, ${key}, ${row.attempts + 1}, ${token}::uuid, 'preparing')`);
    return { acquired: true };
  });
  if ("result" in claimed) return claimed.result!;
  if ("error" in claimed) throw new DeliveryUnavailable(claimed.error!, claimed.reason ?? "Delivery unavailable");
  let sending = false;
  const markSending = async () => {
    await withTenant(tenantId, async (tx) => {
      const updated = await tx.execute(sql`UPDATE communication_deliveries SET state = 'sending', updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND delivery_key = ${key} AND lease_token = ${token}::uuid AND state = 'preparing' AND lease_until > now() RETURNING delivery_key`);
      if (!updated.rows.length) throw new DeliveryUnavailable("unknown", "Delivery lease lost before provider call");
      await tx.execute(sql`UPDATE communication_delivery_attempts SET state = 'sending' WHERE tenant_id = ${tenantId}::uuid AND lease_token = ${token}::uuid`);
    });
    sending = true;
  };
  try {
    const result = await send(markSending);
    await withTenant(tenantId, async (tx) => {
      await tx.execute(sql`UPDATE communication_deliveries SET state = 'sent', result = ${JSON.stringify(result)}::jsonb, lease_until = NULL, error = NULL, updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND delivery_key = ${key} AND lease_token = ${token}::uuid`);
      await tx.execute(sql`UPDATE communication_delivery_attempts SET state = 'sent', result = ${JSON.stringify(result)}::jsonb, completed_at = now() WHERE tenant_id = ${tenantId}::uuid AND lease_token = ${token}::uuid`);
    });
    return result;
  } catch (error) {
    const state: DeliveryState = sending ? "unknown" : "retry";
    const message = `${sending ? "Provider outcome unknown; reconciliation required. " : ""}${(error as Error).message}`;
    await withTenant(tenantId, async (tx) => {
      await tx.execute(sql`UPDATE communication_deliveries SET state = CASE WHEN ${state} = 'retry' AND attempts >= 5 THEN 'failed' ELSE ${state} END, error = ${message}, lease_until = NULL, next_attempt_at = now() + interval '1 minute' * power(2, attempts), updated_at = now() WHERE tenant_id = ${tenantId}::uuid AND delivery_key = ${key} AND lease_token = ${token}::uuid`);
      await tx.execute(sql`UPDATE communication_delivery_attempts SET state = ${state}, error = ${message}, completed_at = now() WHERE tenant_id = ${tenantId}::uuid AND lease_token = ${token}::uuid`);
    });
    throw new DeliveryUnavailable(state, message);
  }
}
