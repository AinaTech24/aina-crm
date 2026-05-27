import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantId } from "./_shared";

/**
 * Transactional outbox — every domain mutation writes a row here in the same
 * transaction. The outbox poller worker reads, fans out to subscribed
 * workflows and other listeners, and marks `processed_at`.
 *
 * Partition by month in production (see drizzle/migrations/0001_outbox_partition.sql).
 */
export const eventsOutbox = pgTable(
  "events_outbox",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    tenantId,

    /** Event kind: 'investor.created', 'transaction.created.sip',
     *  'transaction.failed.mandate_failure', 'communication.delivered',
     *  'inbound_message.whatsapp', etc. Dotted hierarchy enables prefix matching. */
    kind: text("kind").notNull(),

    /** Source entity */
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),

    /** Diff: before/after for record_event triggers; full payload for others */
    before: jsonb("before"),
    after: jsonb("after"),

    /** Free-form context — e.g., the user who caused this, the workflow run that
     *  caused this (if cascading), or the original API request id. */
    meta: jsonb("meta"),

    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    /** When the poller picked it up — used to detect stuck claims. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    /** When the poller hands it to subscribers, this is set; on success processedAt is set */
    attempts: text("attempts").default("0"),
    lastError: text("last_error"),
  },
  (t) => ({
    unprocessedIdx: index("outbox_unprocessed_idx")
      .on(t.id)
      .where(sql`processed_at IS NULL`),
    tenantKindIdx: index("outbox_tenant_kind_idx").on(t.tenantId, t.kind, t.occurredAt),
  })
);

export type OutboxEvent = typeof eventsOutbox.$inferSelect;
export type NewOutboxEvent = typeof eventsOutbox.$inferInsert;
