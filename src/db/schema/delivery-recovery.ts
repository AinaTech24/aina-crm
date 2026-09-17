import { pgTable, uuid, text, integer, timestamp, jsonb, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { campaigns } from "./campaigns";
import { id, timestamps } from "./_shared";

export const communicationDeliveries = pgTable("communication_deliveries", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id), deliveryKey: text("delivery_key").notNull(),
  state: text("state").notNull(), attempts: integer("attempts").notNull().default(0),
  leaseToken: uuid("lease_token"), leaseUntil: timestamp("lease_until", { withTimezone: true }),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }), audit: jsonb("audit").notNull().default({}),
  result: jsonb("result"), error: text("error"), ...timestamps,
}, (t) => ({ pk: primaryKey({ columns: [t.tenantId, t.deliveryKey] }) }));

export const communicationDeliveryAttempts = pgTable("communication_delivery_attempts", {
  id, tenantId: uuid("tenant_id").notNull().references(() => tenants.id), deliveryKey: text("delivery_key").notNull(),
  attempt: integer("attempt").notNull(), leaseToken: uuid("lease_token").notNull(), state: text("state").notNull(),
  result: jsonb("result"), error: text("error"), startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => ({ attemptUnique: uniqueIndex("communication_delivery_attempts_key_unique").on(t.tenantId, t.deliveryKey, t.attempt) }));

export const campaignRecipients = pgTable("campaign_recipients", {
  id, tenantId: uuid("tenant_id").notNull().references(() => tenants.id), campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
  subjectId: uuid("subject_id").notNull(), subjectType: text("subject_type").notNull(), status: text("status").notNull().default("pending"),
  claimToken: uuid("claim_token"), claimUntil: timestamp("claim_until", { withTimezone: true }), attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(), communicationId: uuid("communication_id"),
  lastError: text("last_error"), payload: jsonb("payload").notNull(), ...timestamps,
}, (t) => ({ recipientUnique: uniqueIndex("campaign_recipients_key_unique").on(t.tenantId, t.campaignId, t.subjectType, t.subjectId) }));
