import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { branches } from "./branches";
import { families } from "./families";
import { users } from "./users";

export const investors = pgTable(
  "investors",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    branchId: uuid("branch_id").references(() => branches.id),
    familyId: uuid("family_id").references(() => families.id),
    familyRole: text("family_role"),

    pan: text("pan").notNull(),
    name: text("name").notNull(),
    dob: date("dob"),
    gender: text("gender", { enum: ["M", "F", "O"] }),
    email: text("email"),
    phone: text("phone"),
    alternatePhone: text("alternate_phone"),
    whatsappPhone: text("whatsapp_phone"),

    /** Profile (used in client master + risk profile prefill). */
    occupation: text("occupation"), // matches master_values('occupation')
    incomeRange: text("income_range"), // matches master_values('income_range')
    employerName: text("employer_name"),
    address: jsonb("address").$type<{
      line1?: string;
      city?: string;
      state?: string;
      pincode?: string;
      country?: string;
    }>(),

    /**
     * Classification — per spec § 6 Module 4 Client Categories:
     *   Individual · HUF · NRI · Company · Trust · Minor
     * "company" is the spec label; "corporate" is the legacy DB value (kept).
     */
    investorCategory: text("investor_category", {
      enum: ["individual", "huf", "corporate", "company", "trust", "nri", "minor", "other"],
    })
      .notNull()
      .default("individual"),
    segmentTag: text("segment_tag", { enum: ["HNI", "Affluent", "Retail", "NRI", "Corporate"] }),

    /** Exchange-level identifiers (BSE Star MF UCC + NSE NMF II CAN) — read on
     *  every order placement; cached here for UI display without joining feeds. */
    bseUccCode: text("bse_ucc_code"),
    nseCanCode: text("nse_can_code"),
    mandateStatus: text("mandate_status", {
      enum: ["none", "pending", "active", "expired", "rejected", "cancelled"],
    }).default("none"),
    mandateRefNo: text("mandate_ref_no"),

    /**
     * Service tier — drives review cadence + RM workload allocation.
     *   A = top 20% by AUM/revenue, quarterly reviews, RM dedicated
     *   B = mid 30%, half-yearly reviews
     *   C = long tail 50%, annual review + automated touchpoints only
     * Auto-computed nightly by tier-recomputer worker, manually overridable.
     */
    serviceTier: text("service_tier", { enum: ["A", "B", "C"] }),
    serviceTierLockedAt: timestamp("service_tier_locked_at", { withTimezone: true }),
    serviceTierManualOverride: boolean("service_tier_manual_override").default(false),

    /** Multi-tag client type used by RM dashboards.
     *  e.g. ['sip_investor', 'high_aum', 'review_due']. */
    clientTypes: jsonb("client_types").$type<string[]>().default([]),

    /** KYC */
    kycStatus: text("kyc_status", { enum: ["pending", "verified", "rejected", "expired"] })
      .notNull()
      .default("pending"),
    ckycNumber: text("ckyc_number"),
    ckycExpiryAt: date("ckyc_expiry_at"),
    kraName: text("kra_name"),
    fatcaStatus: text("fatca_status", { enum: ["pending", "verified", "expired"] }),
    fatcaExpiryAt: date("fatca_expiry_at"),

    /** Nominees */
    nomineeName: text("nominee_name"),
    nomineeRelation: text("nominee_relation"),
    nomineeDob: date("nominee_dob"),

    /** Bank (mandate) */
    bankName: text("bank_name"),
    bankAccountNumberMasked: text("bank_account_masked"),
    bankIfsc: text("bank_ifsc"),

    /** Risk profile */
    riskProfileScore: integer("risk_profile_score"),
    riskProfile: text("risk_profile", {
      enum: ["conservative", "moderate", "aggressive", "very_aggressive"],
    }),
    riskProfileSignedAt: timestamp("risk_profile_signed_at", { withTimezone: true }),
    riskProfileVersion: integer("risk_profile_version"),

    /** Computed/cached metrics — refreshed nightly */
    aum: numeric("aum", { precision: 18, scale: 2 }).default("0"),
    activeSipAmount: numeric("active_sip_amount", { precision: 18, scale: 2 }).default("0"),
    lifetimeInflow: numeric("lifetime_inflow", { precision: 18, scale: 2 }).default("0"),
    lifetimeOutflow: numeric("lifetime_outflow", { precision: 18, scale: 2 }).default("0"),

    /** Relationship */
    rmId: uuid("rm_id").references(() => users.id),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    lastTransactionAt: timestamp("last_transaction_at", { withTimezone: true }),
    lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
    lastReviewAt: timestamp("last_review_at", { withTimezone: true }),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }),

    /** Lifecycle */
    isMinor: boolean("is_minor").default(false),
    guardianInvestorId: uuid("guardian_investor_id"),

    /**
     * Client lifecycle status — per spec § 6 Module 4:
     *   Active · Dormant · Inactive · Redemption Risk · Closed
     * Legacy `exited` retained as alias for `closed` so existing rows keep working.
     */
    status: text("status", {
      enum: ["active", "dormant", "inactive", "redemption_risk", "closed", "exited"],
    })
      .notNull()
      .default("active"),
    dormantSince: timestamp("dormant_since", { withTimezone: true }),
    exitedAt: timestamp("exited_at", { withTimezone: true }),
    /** When `redemption_risk` was flagged (auto by workflow or manual). */
    redemptionRiskFlaggedAt: timestamp("redemption_risk_flagged_at", { withTimezone: true }),
    redemptionRiskReason: text("redemption_risk_reason"),

    tags: jsonb("tags").$type<string[]>().default([]),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => ({
    panUnique: uniqueIndex("investors_tenant_pan_unique").on(t.tenantId, t.pan),
    rmIdx: index("investors_rm_idx").on(t.tenantId, t.rmId),
    segmentIdx: index("investors_segment_idx").on(t.tenantId, t.segmentTag),
    lastReviewIdx: index("investors_last_review_idx").on(t.tenantId, t.lastReviewAt),
    lastTransactionIdx: index("investors_last_tx_idx").on(t.tenantId, t.lastTransactionAt),
  })
);

export type Investor = typeof investors.$inferSelect;
export type NewInvestor = typeof investors.$inferInsert;
