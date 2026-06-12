/**
 * Zoho sync engine (one-way: our CRM → Zoho).
 *
 * Self-contained poller: for each tenant with an active Zoho connection, it
 * reads the slice of `events_outbox` it hasn't pushed yet (its own cursor in
 * `zoho_sync_state`), maps each record, and upserts it to Zoho by external id.
 * It does NOT touch the shared outbox poller's `processed_at` — it tracks its
 * own position — so the two consumers never interfere.
 */
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { withSystem } from "@/db/client";
import { eventsOutbox, tenantIntegrations, zohoSyncLinks, zohoSyncState } from "@/db/schema";
import { getZohoConnection } from "./credentials";
import { mappingFor, SYNCED_ENTITY_TYPES } from "./mapping";
import { upsertRecords, type ZohoUpsertResult } from "./client";

const BATCH = 200;

export async function runZohoSyncOnce(): Promise<{ tenants: number; pushed: number; failed: number }> {
  const tenantIds = await withSystem(async (tx) => {
    const rows = await tx
      .selectDistinct({ tenantId: tenantIntegrations.tenantId })
      .from(tenantIntegrations)
      .where(and(eq(tenantIntegrations.provider, "zoho"), eq(tenantIntegrations.isActive, true)));
    return rows.map((r) => r.tenantId);
  });

  let pushed = 0;
  let failed = 0;
  let active = 0;
  for (const tenantId of tenantIds) {
    try {
      const res = await syncTenant(tenantId);
      pushed += res.pushed;
      failed += res.failed;
      if (res.pushed || res.failed) active++;
    } catch (err) {
      console.error(`[zoho-sync] tenant ${tenantId} failed:`, (err as Error).message);
    }
  }
  return { tenants: active, pushed, failed };
}

async function syncTenant(tenantId: string): Promise<{ pushed: number; failed: number }> {
  return withSystem(async (tx) => {
    const conn = await getZohoConnection(tx, tenantId);
    if (!conn) return { pushed: 0, failed: 0 };

    const cursor = await loadCursor(tx, tenantId);

    const events = await tx
      .select()
      .from(eventsOutbox)
      .where(
        and(
          eq(eventsOutbox.tenantId, tenantId),
          gt(eventsOutbox.id, BigInt(cursor)),
          inArray(eventsOutbox.entityType, SYNCED_ENTITY_TYPES),
          sql`${eventsOutbox.kind} NOT LIKE '%.deleted'`
        )
      )
      .orderBy(eventsOutbox.id)
      .limit(BATCH);

    if (events.length === 0) return { pushed: 0, failed: 0 };

    // Collapse to the latest event per record so a rapidly-edited record is
    // pushed once per tick, not once per edit.
    const latest = new Map<string, (typeof events)[number]>();
    for (const ev of events) latest.set(`${ev.entityType}:${ev.entityId}`, ev);

    let pushed = 0;
    let failed = 0;
    for (const ev of latest.values()) {
      const mapping = mappingFor(ev.entityType);
      const after = ev.after as Record<string, any> | null;
      if (!mapping || !after) continue;
      const entityId = String(ev.entityId);
      try {
        const [result] = await upsertRecords(conn, mapping.zohoModule, [mapping.toZoho(after)], mapping.externalIdField);
        await recordLink(tx, tenantId, ev.entityType, entityId, mapping.zohoModule, result);
        if (result?.ok) pushed++;
        else failed++;
      } catch (err) {
        failed++;
        await recordLink(tx, tenantId, ev.entityType, entityId, mapping.zohoModule, {
          externalIdValue: entityId,
          ok: false,
          error: (err as Error).message,
        });
      }
    }

    // Advance past the whole slice. Failures are recorded on the link rows
    // (status "error") for visibility + a future retry pass.
    const maxId = Number(events[events.length - 1].id);
    await tx.update(zohoSyncState).set({ lastOutboxId: maxId, updatedAt: new Date() }).where(eq(zohoSyncState.tenantId, tenantId));

    if (pushed || failed) console.log(`[zoho-sync] tenant ${tenantId}: pushed=${pushed} failed=${failed}`);
    return { pushed, failed };
  });
}

/**
 * Load (or seed) the per-tenant cursor. On first connect we seed it to the
 * CURRENT max outbox id so we sync changes going forward — a full backfill of
 * existing records is a separate, deliberate action (Phase 2).
 */
async function loadCursor(tx: Tx, tenantId: string): Promise<number> {
  const [state] = await tx.select().from(zohoSyncState).where(eq(zohoSyncState.tenantId, tenantId)).limit(1);
  if (state) return Number(state.lastOutboxId ?? 0);
  const [{ maxId } = { maxId: 0 }] = await tx
    .select({ maxId: sql<number>`COALESCE(MAX(${eventsOutbox.id}), 0)` })
    .from(eventsOutbox)
    .where(eq(eventsOutbox.tenantId, tenantId));
  const start = Number(maxId) || 0;
  await tx.insert(zohoSyncState).values({ tenantId, lastOutboxId: start } as any).onConflictDoNothing();
  return start;
}

async function recordLink(
  tx: Tx,
  tenantId: string,
  entityType: string,
  entityId: string,
  zohoModule: string,
  result: ZohoUpsertResult
): Promise<void> {
  const set = {
    status: result.ok ? ("synced" as const) : ("error" as const),
    zohoId: result.zohoId ?? undefined,
    lastError: result.ok ? null : result.error ?? "unknown",
    lastSyncedAt: result.ok ? new Date() : undefined,
    updatedAt: new Date(),
  };
  const [existing] = await tx
    .select({ id: zohoSyncLinks.id })
    .from(zohoSyncLinks)
    .where(and(eq(zohoSyncLinks.tenantId, tenantId), eq(zohoSyncLinks.entityType, entityType), eq(zohoSyncLinks.entityId, entityId)))
    .limit(1);
  if (existing) {
    await tx.update(zohoSyncLinks).set(set).where(eq(zohoSyncLinks.id, existing.id));
  } else {
    await tx.insert(zohoSyncLinks).values({ tenantId, entityType, entityId, zohoModule, ...set } as any);
  }
}
