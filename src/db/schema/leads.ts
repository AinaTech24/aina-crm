import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { branches } from "./branches";

export const leads = pgTable(
  "leads",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    branchId: uuid("branch_id").references(() => branches.id),

    name: text("name").notNull(),
    email: text("email"),
    phone: text("phone"),
    city: text("city"),
    pincode: text("pincode"),

    /**
     * Lead source — per spec §6 Module 3:
     *   Referral · Website · Social Media · Webinar · Seminar · Walk-in
     *   Existing Client Reference · Google · Cold Call · Other
     * Legacy values (meta_ads, google_ads, linkedin, youtube, event, manual)
     * are kept for backward compatibility with already-imported leads.
     */
    source: text("source", {
      enum: [
        // Spec-canonical
        "referral",
        "website",
        "social_media",
        "webinar",
        "seminar",
        "walk_in",
        "existing_client",
        "google",
        "cold_call",
        "other",
        // Legacy / sub-source — kept for back-compat
        "meta_ads",
        "google_ads",
        "linkedin",
        "youtube",
        "event",
        "manual",
      ],
    })
      .notNull()
      .default("manual"),
    sourceCampaign: text("source_campaign"),
    utmParams: jsonb("utm_params").$type<{
      source?: string;
      medium?: string;
      campaign?: string;
      term?: string;
      content?: string;
    }>(),

    /**
     * Lead stage — per spec §6 Module 3:
     *   New · Contacted · Meeting Scheduled · Proposal Shared · Follow-Up
     *   Converted · Lost · Not Interested
     * Legacy values (qualified ≈ Meeting Scheduled, proposal_sent ≈ Proposal Shared,
     * cold ≈ Not Interested) are kept for back-compat with already-stored leads.
     */
    stage: text("stage", {
      enum: [
        // Spec-canonical
        "new",
        "contacted",
        "meeting_scheduled",
        "meeting_done",
        "risk_profile_sent",
        "risk_profiled",
        "proposal_drafted",
        "proposal_shared",
        "proposal_approved",
        "docs_requested",
        "docs_received",
        "follow_up",
        "converted",
        "lost",
        "not_interested",
        // Legacy aliases
        "qualified",
        "proposal_sent",
        "cold",
      ],
    })
      .notNull()
      .default("new"),
    stageChangedAt: timestamp("stage_changed_at", { withTimezone: true }),
    score: text("score").default("0"),

    interestProducts: jsonb("interest_products").$type<string[]>().default([]),
    intendedAmount: text("intended_amount"),

    /** Optional referral chain — populated when source = 'existing_client' or 'referral' */
    referredByInvestorId: uuid("referred_by_investor_id"),
    referredByName: text("referred_by_name"),

    ownerId: uuid("owner_id").references(() => users.id),
    lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
    lastFollowUpAt: timestamp("last_follow_up_at", { withTimezone: true }),
    nextFollowUpAt: timestamp("next_follow_up_at", { withTimezone: true }),
    convertedInvestorId: uuid("converted_investor_id"),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    lostReason: text("lost_reason"),
    lostAt: timestamp("lost_at", { withTimezone: true }),

    /** Free-text follow-up notes (latest goes to top). For the full history we
     *  rely on the communications table; this is the quick "what's the state". */
    followUpNotes: text("follow_up_notes"),

    notes: text("notes"),
    tags: jsonb("tags").$type<string[]>().default([]),
    ...timestamps,
  },
  (t) => ({
    stageIdx: index("leads_stage_idx").on(t.tenantId, t.stage),
    ownerIdx: index("leads_owner_idx").on(t.tenantId, t.ownerId),
    nextFollowUpIdx: index("leads_next_fu_idx").on(t.tenantId, t.nextFollowUpAt),
  })
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
