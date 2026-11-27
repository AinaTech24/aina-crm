/**
 * Export — Couriers (/dashboard/couriers), only for a firm with the
 * `courierRegister` switch. The file holds what the list shows under its search
 * and filters, and its headings and choice words are the import's, so it can be
 * imported again.
 */

import { sql, type SQL } from "drizzle-orm";
import { couriersEnabled } from "@/lib/couriers/access";
import {
  ALL_COURIER_STATUSES, COURIER_CATEGORIES, COURIER_LABELS, COURIER_TYPES, PAYMENT_MODES,
  parseCourierFilter, type CourierField, type Option,
} from "@/lib/couriers/entry";
import { courierConditions } from "@/lib/couriers/service";
import { d, dt, userName } from "../helpers";
import type { ExportColumn, ExportModule, PiiClass } from "../types";

const L = COURIER_LABELS;

/** A stored choice as the word the screens show. */
const word = (expr: SQL, options: Option[]) =>
  sql`CASE ${expr} ${sql.join(options.map((o) => sql`WHEN ${o.value} THEN ${o.label}::text`), sql` `)} ELSE ${expr} END`;

const col = (key: CourierField, group: string, value: SQL, extra: Partial<ExportColumn> = {}): ExportColumn =>
  ({ key, label: L[key], group, sql: value, default: true, ...extra });

const day = (key: CourierField, group: string, value: SQL) => col(key, group, d(value), { kind: "date" });
const pii = (key: CourierField, group: string, value: SQL, kind: PiiClass) => col(key, group, value, { pii: kind });

const COURIER = "Courier";
const SENDER = "Sender (inward)";
const RECIPIENT = "Recipient (outward)";

export const couriersExport: ExportModule = {
  key: "couriers",
  label: "Couriers",
  fileName: "couriers",
  enabled: couriersEnabled,
  // The list is the whole team's to read; exporting it needs "Export data" (checked by the engine).
  canView: () => true,
  // A sender or recipient is not a client or a lead, whose fields the licence can hide.
  piiGated: false,
  from: sql`courier_entries`,
  async where(_tx, session, params) {
    return courierConditions(session.tenantId, parseCourierFilter(Object.fromEntries(params)));
  },
  orderBy: sql`courier_entries.courier_date DESC, courier_entries.created_at DESC`,
  columns: [
    col("courierType", COURIER, word(sql`courier_entries.courier_type`, COURIER_TYPES)),
    day("courierDate", COURIER, sql`courier_entries.courier_date`),
    col("courierCompany", COURIER, sql`courier_entries.courier_company`),
    col("trackingNumber", COURIER, sql`courier_entries.tracking_number`),
    col("status", COURIER, word(sql`courier_entries.status`, ALL_COURIER_STATUSES)),
    col("category", COURIER, word(sql`courier_entries.category`, COURIER_CATEGORIES)),
    col("categoryOther", COURIER, sql`courier_entries.category_other`),
    col("description", COURIER, sql`courier_entries.description`),
    col("remarks", COURIER, sql`courier_entries.remarks`),
    col("senderName", SENDER, sql`courier_entries.sender_name`),
    col("senderCompany", SENDER, sql`courier_entries.sender_company`),
    pii("senderMobile", SENDER, sql`courier_entries.sender_mobile`, "phone"),
    pii("senderEmail", SENDER, sql`courier_entries.sender_email`, "email"),
    pii("senderAddress", SENDER, sql`courier_entries.sender_address`, "address"),
    day("receivedDate", SENDER, sql`courier_entries.received_date`),
    col("recipientName", RECIPIENT, sql`courier_entries.recipient_name`),
    col("recipientCompany", RECIPIENT, sql`courier_entries.recipient_company`),
    pii("recipientMobile", RECIPIENT, sql`courier_entries.recipient_mobile`, "phone"),
    pii("recipientEmail", RECIPIENT, sql`courier_entries.recipient_email`, "email"),
    pii("recipientAddress", RECIPIENT, sql`courier_entries.recipient_address`, "address"),
    day("dispatchDate", RECIPIENT, sql`courier_entries.dispatch_date`),
    col("courierCharges", RECIPIENT, sql`courier_entries.courier_charges`, { kind: "number" }),
    col("paymentMode", RECIPIENT, word(sql`courier_entries.payment_mode`, PAYMENT_MODES)),
    day("deliveredDate", RECIPIENT, sql`courier_entries.delivered_date`),
    { key: "recordedBy", label: "Recorded by", group: "Record", sql: userName(sql`courier_entries.created_by`) },
    { key: "recordedOn", label: "Recorded on", group: "Record", sql: dt(sql`courier_entries.created_at`), kind: "datetime" },
  ],
};
