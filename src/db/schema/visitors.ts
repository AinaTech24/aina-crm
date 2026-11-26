/**
 * Visitor Register (migration 0293): one row per visit to the firm's office.
 * Only a firm with the `visitorRegister` feature flag can reach it
 * (lib/visitors/access.ts).
 */

import { date, index, pgTable, text, time, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

export const visitorEntries = pgTable(
  "visitor_entries",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    visitorName: text("visitor_name").notNull(),
    email: text("email"),
    mobile: text("mobile"),
    companyName: text("company_name"),
    visitDate: date("visit_date").notNull(),
    /** Wall-clock times at the office (India), no time zone. */
    entryTime: time("entry_time"),
    exitTime: time("exit_time"),
    purpose: text("purpose"),
    /** The team member the visitor came to meet. */
    meetingWithUserId: uuid("meeting_with_user_id").references(() => users.id),
    remarks: text("remarks"),
    createdBy: uuid("created_by").references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    dateIdx: index("visitor_entries_date_idx").on(t.tenantId, t.visitDate).where(sql`deleted_at IS NULL`),
  })
);

export type VisitorEntry = typeof visitorEntries.$inferSelect;
