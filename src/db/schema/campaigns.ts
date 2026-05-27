import { index, integer, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { templates, templateVersions } from "./templates";
import { segments } from "./segments";

export const campaigns = pgTable(
  "campaigns",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    name: text("name").notNull(),
    description: text("description"),
    /**
     * Campaign kind (Module 16 spec) — high-level marketing type. Used by the
     * Marketing Campaigns module. When kind ∈ {whatsapp,email,sms} the campaign
     * is also a broadcast and uses `channel` + `templateId` + `segmentId`.
     */
    kind: text("kind", {
      enum: [
        "social_media",
        "whatsapp",
        "email",
        "webinar",
        "seminar",
        "referral",
        "google_business",
        "paid_ads",
        "sms",
        "content",
        "other",
      ],
    }),
    /** Theme / hook — Tax Saving · SIP Power · NFO Launch · Diwali · etc. */
    theme: text("theme"),
    channel: text("channel", { enum: ["email", "whatsapp", "sms"] }).notNull(),
    templateId: uuid("template_id").references(() => templates.id),
    templateVersionId: uuid("template_version_id").references(() => templateVersions.id),
    segmentId: uuid("segment_id").references(() => segments.id),
    /** Free-text audience description (when no formal segment is used). */
    targetAudience: text("target_audience"),

    status: text("status", {
      enum: ["draft", "scheduled", "sending", "sent", "paused", "cancelled"],
    })
      .notNull()
      .default("draft"),
    /** Campaign-wide start / end dates (Module 16 spec). */
    startDate: timestamp("start_date", { withTimezone: true }),
    endDate: timestamp("end_date", { withTimezone: true }),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    /** Content production lifecycle (spec). */
    contentStatus: text("content_status", {
      enum: ["not_started", "drafting", "ready", "published"],
    }).default("not_started"),
    /** Compliance check (separate from per-send compliance gate — campaign-level pre-approval). */
    complianceCheckStatus: text("compliance_check_status", {
      enum: ["pending", "cleared", "blocked", "not_required"],
    }).default("pending"),
    /** Owner / compliance approval gate. */
    approvalStatus: text("approval_status", {
      enum: ["pending", "approved", "rejected", "not_required"],
    }).default("pending"),
    approvedByUserId: uuid("approved_by_user_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),

    /** ROI tracking (spec). */
    leadsGenerated: integer("leads_generated").default(0),
    meetingsBooked: integer("meetings_booked").default(0),
    clientsConverted: integer("clients_converted").default(0),
    campaignCost: numeric("campaign_cost", { precision: 14, scale: 2 }),
    remarks: text("remarks"),

    /** Throttling */
    throttlePerMinute: integer("throttle_per_minute").default(60),

    totalRecipients: integer("total_recipients").default(0),
    queuedCount: integer("queued_count").default(0),
    sentCount: integer("sent_count").default(0),
    deliveredCount: integer("delivered_count").default(0),
    readCount: integer("read_count").default(0),
    repliedCount: integer("replied_count").default(0),
    clickedCount: integer("clicked_count").default(0),
    failedCount: integer("failed_count").default(0),
    bouncedCount: integer("bounced_count").default(0),
    unsubscribedCount: integer("unsubscribed_count").default(0),

    /** Per-recipient variable overrides — keyed by investor_id */
    variableOverrides: jsonb("variable_overrides"),

    createdByUserId: uuid("created_by_user_id"),
    ...timestamps,
  },
  (t) => ({
    statusIdx: index("campaigns_status_idx").on(t.tenantId, t.status),
    kindIdx: index("campaigns_kind_idx").on(t.tenantId, t.kind),
  })
);

export type Campaign = typeof campaigns.$inferSelect;
export type NewCampaign = typeof campaigns.$inferInsert;
