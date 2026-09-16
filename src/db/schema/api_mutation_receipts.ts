import { pgTable, uuid, text, jsonb, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";
export const apiMutationReceipts = pgTable("api_mutation_receipts", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  requestKey: text("request_key").notNull(), fingerprint: text("fingerprint").notNull(), result: jsonb("result"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.tenantId, t.userId, t.requestKey] })]);
