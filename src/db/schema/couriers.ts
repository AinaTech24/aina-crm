/**
 * Couriers (migration 0294): one row per incoming or outgoing courier. Only a
 * firm with the `courierRegister` feature flag can reach it
 * (lib/couriers/access.ts).
 */

import { date, index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";

export const courierEntries = pgTable(
  "courier_entries",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    /** "inward" | "outward" (lib/couriers/entry.ts holds every list of values). */
    courierType: text("courier_type").notNull(),
    courierCompany: text("courier_company"),
    trackingNumber: text("tracking_number"),
    courierDate: date("courier_date").notNull(),
    status: text("status").notNull(),
    category: text("category"),
    /** What it is, when the category is "other". */
    categoryOther: text("category_other"),
    description: text("description"),
    remarks: text("remarks"),
    // Inward only.
    senderName: text("sender_name"),
    senderCompany: text("sender_company"),
    senderMobile: text("sender_mobile"),
    senderEmail: text("sender_email"),
    senderAddress: text("sender_address"),
    receivedDate: date("received_date"),
    // Outward only.
    recipientName: text("recipient_name"),
    recipientCompany: text("recipient_company"),
    recipientMobile: text("recipient_mobile"),
    recipientEmail: text("recipient_email"),
    recipientAddress: text("recipient_address"),
    dispatchDate: date("dispatch_date"),
    courierCharges: numeric("courier_charges", { precision: 12, scale: 2 }),
    paymentMode: text("payment_mode"),
    deliveredDate: date("delivered_date"),
    createdBy: uuid("created_by").references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    dateIdx: index("courier_entries_date_idx").on(t.tenantId, t.courierDate).where(sql`deleted_at IS NULL`),
  })
);

export type CourierEntry = typeof courierEntries.$inferSelect;
