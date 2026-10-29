/**
 * The delivery ledger (lib/comms/durable-delivery.ts) is what stops a retried
 * workflow step from sending twice: it commits on its own, outside the step's
 * transaction, keyed by a key that is stable across retries.
 *
 * DB-backed (TEST_DATABASE_URL): a send whose caller then rolls back is
 * remembered as sent, and the retry returns it without calling the provider;
 * a send interrupted mid-call is never re-sent automatically; a failure before
 * the provider is called may be retried.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)("durableDelivery", () => {
  let withSystem: typeof import("@/db/client").withSystem;
  let durableDelivery: typeof import("@/lib/comms/durable-delivery").durableDelivery;
  let sql: typeof import("drizzle-orm").sql;
  const tenant = randomUUID();
  const q = (text: ReturnType<typeof import("drizzle-orm").sql>) => withSystem((tx) => tx.execute(text));
  const state = async (key: string) =>
    ((await q(sql`SELECT state FROM communication_deliveries WHERE tenant_id = ${tenant}::uuid AND delivery_key = ${key}`)).rows[0] as { state: string } | undefined)?.state;

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB!;
    process.env.APP_DATABASE_URL = "";
    process.env.ALLOW_SYSTEM_TX = "1";
    ({ withSystem } = await import("@/db/client"));
    ({ durableDelivery } = await import("@/lib/comms/durable-delivery"));
    ({ sql } = await import("drizzle-orm"));
    await q(sql`INSERT INTO tenants (id, legal_name, display_name, arn) VALUES (${tenant}::uuid, 'Ledger Test', 'Ledger Test', ${"ARN-DL-" + tenant.slice(0, 6)})`);
  });

  afterAll(async () => {
    if (!withSystem) return;
    await q(sql`DELETE FROM communication_delivery_attempts WHERE tenant_id = ${tenant}::uuid`);
    await q(sql`DELETE FROM communication_deliveries WHERE tenant_id = ${tenant}::uuid`);
    await q(sql`DELETE FROM tenants WHERE id = ${tenant}::uuid`);
  });

  it("a step that rolls back after the provider accepted it does not send again on retry", async () => {
    const key = `wf:${randomUUID()}:node:0`;
    let calls = 0;
    const send = async (markSending: () => Promise<void>) => {
      await markSending();
      calls++;
      return { externalId: "msg-1", status: "sent" as const };
    };
    // Attempt 1: the send succeeds, then the step's own transaction fails and rolls back.
    await expect(
      withSystem(async () => {
        await durableDelivery(tenant, key, {}, send);
        throw new Error("step failed after the send");
      }),
    ).rejects.toThrow("step failed after the send");
    expect(await state(key)).toBe("sent");
    // Attempt 2 (the retry): the ledger answers; the provider is not called again.
    const again = await durableDelivery(tenant, key, {}, send);
    expect(again).toEqual({ externalId: "msg-1", status: "sent" });
    expect(calls).toBe(1);
  });

  it("a send interrupted after the provider call began is never re-sent automatically", async () => {
    const key = `wf:${randomUUID()}:node:0`;
    let calls = 0;
    await expect(
      durableDelivery(tenant, key, {}, async (markSending) => {
        await markSending();
        calls++;
        throw new Error("socket timeout");
      }),
    ).rejects.toThrow(/outcome unknown/);
    expect(await state(key)).toBe("unknown");
    await expect(durableDelivery(tenant, key, {}, async () => { calls++; return { ok: true }; })).rejects.toThrow();
    expect(calls).toBe(1);
  });

  it("a failure before the provider call may be retried", async () => {
    const key = `wf:${randomUUID()}:node:0`;
    await expect(durableDelivery(tenant, key, {}, async () => { throw new Error("no mailbox"); })).rejects.toThrow("no mailbox");
    expect(await state(key)).toBe("retry");
    // The ledger defers the retry with backoff; clear it to retry now.
    await q(sql`UPDATE communication_deliveries SET next_attempt_at = NULL WHERE tenant_id = ${tenant}::uuid AND delivery_key = ${key}`);
    const ok = await durableDelivery(tenant, key, {}, async (markSending) => { await markSending(); return { externalId: "msg-2" }; });
    expect(ok).toEqual({ externalId: "msg-2" });
    expect(await state(key)).toBe("sent");
  });
});
