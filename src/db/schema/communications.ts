import { index, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { investors } from "./investors";
import { leads } from "./leads";
import { templateVersions } from "./templates";
import { workflowRuns, workflowRunSteps } from "./workflows";

/**
 * The unified outbound + inbound communication log. Every send, every
 * delivery webhook update, every inbound message lands here.
 */
export const communications = pgTable(
  "communications",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),

    investorId: uuid("investor_id").references(() => investors.id),
    leadId: uuid("lead_id").references(() => leads.id),
    userId: uuid("user_id").references(() => users.id),

    channel: text("channel", { enum: ["whatsapp", "email", "sms", "inapp", "call"] }).notNull(),
    direction: text("direction", { enum: ["outbound", "inbound"] }).notNull(),

    templateVersionId: uuid("template_version_id").references(() => templateVersions.id),
    templateKey: text("template_key"),

    /** Provider-side message id (AiSensy / Resend / MSG91) */
    externalId: text("external_id"),

    status: text("status", {
      enum: [
        "queued",
        "skipped_consent",
        "skipped_session",
        "skipped_compliance",
        "skipped_rate_limit",
        "sent",
        "delivered",
        "read",
        "replied",
        "failed",
        "bounced",
        "unsubscribed",
      ],
    })
      .notNull()
      .default("queued"),
    statusReason: text("status_reason"),

    /** The rendered content + variables that were sent. */
    payload: jsonb("payload"),
    /** Inbound message body for direction='inbound'. */
    inboundContent: jsonb("inbound_content"),

    /** Dispatch origin */
    workflowRunId: uuid("workflow_run_id").references(() => workflowRuns.id),
    workflowRunStepId: uuid("workflow_run_step_id").references(() => workflowRunSteps.id),
    campaignId: uuid("campaign_id"),

    /** Snapshot of consent at the moment of send (immutable audit) */
    consentSnapshot: jsonb("consent_snapshot"),
    /** Snapshot of compliance findings at the moment of send */
    complianceSnapshot: jsonb("compliance_snapshot"),
    complianceScore: numeric("compliance_score", { precision: 5, scale: 2 }),

    costPaise: text("cost_paise"),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),

    ...timestamps,
  },
  (t) => ({
    investorIdx: index("comms_investor_idx").on(t.tenantId, t.investorId, t.createdAt),
    statusIdx: index("comms_status_idx").on(t.tenantId, t.channel, t.status),
    externalIdx: uniqueIndex("comms_external_unique")
      .on(t.externalId, t.channel)
      .where(sql`external_id IS NOT NULL`),
    workflowIdx: index("comms_workflow_run_idx")
      .on(t.workflowRunId)
      .where(sql`workflow_run_id IS NOT NULL`),
    timelineIdx: index("comms_timeline_idx").on(t.tenantId, t.createdAt),
    leadIdx: index("comms_lead_idx").on(t.tenantId, t.leadId, t.createdAt),
  })
);

/**
 * Maps E.164 WhatsApp phone numbers to tenants (one tenant can have multiple
 * numbers — main HQ + branch numbers). Inbound webhooks use this to identify
 * the receiving tenant.
 */
export const whatsappNumbers = pgTable(
  "whatsapp_numbers",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    phoneE164: text("phone_e164").notNull(),
    displayName: text("display_name"),
    isDefault: text("is_default").default("false"),
    aisensyAppId: text("aisensy_app_id"),
    ...timestamps,
  },
  (t) => ({
    phoneUnique: uniqueIndex("wa_numbers_phone_unique").on(t.phoneE164),
  })
);

export type Communication = typeof communications.$inferSelect;
export type WhatsappNumber = typeof whatsappNumbers.$inferSelect;
