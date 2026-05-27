import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { investors } from "./investors";

export const serviceRequests = pgTable(
  "service_requests",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    ticketNo: text("ticket_no").notNull(),
    investorId: uuid("investor_id").references(() => investors.id),
    /**
     * Service Type — spec § Module 13 lists 13 canonical types:
     *   Nominee Update · Bank Update · Mobile Update · Email Update · KYC Update
     *   Minor to Major · Capital Gain Report · Statement Request · Redemption Request
     *   Switch Request · Transmission Case · Folio Correction · Other
     * Legacy values (complaint, redemption_help, switch_help, transaction_query)
     * are retained for back-compat with already-imported rows.
     */
    type: text("type", {
      enum: [
        // Spec-canonical (13)
        "nominee_update",
        "bank_update",
        "mobile_update",
        "email_update",
        "kyc_update",
        "minor_to_major",
        "capital_gain_report",
        "statement_request",
        "redemption_request",
        "switch_request",
        "transmission_case",
        "folio_correction",
        "other",
        // Legacy
        "complaint",
        "redemption_help",
        "switch_help",
        "transaction_query",
      ],
    }).notNull(),
    channel: text("channel", { enum: ["whatsapp", "email", "phone", "in_person", "form"] }),

    subject: text("subject").notNull(),
    description: text("description"),

    status: text("status", { enum: ["open", "in_progress", "waiting_customer", "resolved", "closed", "escalated"] })
      .notNull()
      .default("open"),
    priority: text("priority", { enum: ["low", "normal", "high", "urgent"] })
      .notNull()
      .default("normal"),

    assignedToUserId: uuid("assigned_to_user_id").references(() => users.id),

    /** SLA */
    slaResponseAt: timestamp("sla_response_at", { withTimezone: true }),
    slaResolutionAt: timestamp("sla_resolution_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),

    /** SEBI complaint register-specific fields */
    sebiCategory: text("sebi_category"),
    sebiSubCategory: text("sebi_sub_category"),

    attachments: jsonb("attachments").$type<Array<{ name: string; key: string; size: number }>>(),
    timeline: jsonb("timeline").$type<Array<{ at: string; by: string; event: string; note?: string }>>(),

    /** Free-text RM remarks — spec § Module 13. */
    remarks: text("remarks"),
    /** Resolution write-up — spec § Module 14 Complaint Register. */
    resolutionNotes: text("resolution_notes"),
    /** Set true once an escalation notification has been raised — idempotency for the recipe. */
    escalatedAt: timestamp("escalated_at", { withTimezone: true }),
    escalatedToUserId: uuid("escalated_to_user_id"),

    ...timestamps,
  },
  (t) => ({
    statusIdx: index("svc_status_idx").on(t.tenantId, t.status),
    slaIdx: index("svc_sla_idx").on(t.tenantId, t.slaResolutionAt),
    ticketIdx: index("svc_ticket_idx").on(t.tenantId, t.ticketNo),
  })
);

export type ServiceRequest = typeof serviceRequests.$inferSelect;
