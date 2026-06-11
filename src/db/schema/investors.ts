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

    /** Client photo — storage key (S3 general/ kind) or external URL; served
     *  via /api/investors/[id]/avatar. Optional. */
    avatarUrl: text("avatar_url"),

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

    /**
     * Client Category — a manually-assigned A/B/C/D classification the firm uses
     * to grade clients (e.g. A = key/premium … D = low-touch). Distinct from the
     * auto-computed `serviceTier` (A/B/C, review cadence) and `investorCategory`
     * (entity type). NULL = not yet categorised. Assigned in the client master
     * editor or in bulk from the client list.
     */
    clientCategory: text("client_category", { enum: ["A", "B", "C", "D"] }),

    /** Multi-tag client type used by RM dashboards.
     *  e.g. ['sip_investor', 'high_aum', 'review_due']. */
    clientTypes: jsonb("client_types").$type<string[]>().default([]),

    /** KYC */
    kycStatus: text("kyc_status", {
      enum: [
        "pending",
        "registered", // CERSAI-registered but not validated
        "verified", // CERSAI-validated
        "hold", // flagged for manual review
        "rejected",
        "expired",
        "re_kyc_required",
      ],
    })
      .notNull()
      .default("pending"),
    /** Name exactly as on PAN card — distinct from `name` (display). */
    nameAsPerPan: text("name_as_per_pan"),
    /** PAN-Aadhaar link status — SEBI mandate; without 'linked', new
     *  investments are blocked AMC-side. */
    panAadhaarLinkStatus: text("pan_aadhaar_link_status", {
      enum: ["linked", "not_linked", "pending", "not_applicable"],
    }),
    /** Granular residency status (more specific than investor_category's
     *  nri flag — distinguishes OCI / PIO / foreign nationals). */
    residencyStatus: text("residency_status", {
      enum: ["indian_resident", "nri", "oci", "pio", "foreign_national"],
    }),
    /** Last 4 digits of Aadhaar only — never store the full number. */
    aadhaarLast4: text("aadhaar_last4"),
    /** When CERSAI validation completed. */
    kycValidatedAt: date("kyc_validated_at"),
    /** User who last updated KYC fields — audit-friendly source. */
    kycLastUpdatedBy: uuid("kyc_last_updated_by").references(() => users.id),
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

    /** Persisted client-health scorecard (src/lib/investors/health.ts) —
     *  written on create/update + refreshed nightly. Sortable/filterable so
     *  the worst-health clients surface across the whole book. */
    healthScore: integer("health_score").notNull().default(100),
    healthBand: text("health_band", { enum: ["green", "amber", "red"] }).notNull().default("green"),
    healthScoredAt: timestamp("health_scored_at", { withTimezone: true }),

    /** Client-service preferences */
    statementCadence: text("statement_cadence", { enum: ["off", "monthly", "quarterly"] })
      .notNull()
      .default("off"),
    lastStatementSentAt: timestamp("last_statement_sent_at", { withTimezone: true }),
    languagePref: text("language_pref").notNull().default("en"),
    aumMilestoneBand: integer("aum_milestone_band").notNull().default(0),

    /** Relationship */
    rmId: uuid("rm_id").references(() => users.id),
    onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
    lastTransactionAt: timestamp("last_transaction_at", { withTimezone: true }),
    lastContactAt: timestamp("last_contact_at", { withTimezone: true }),
    lastReviewAt: timestamp("last_review_at", { withTimezone: true }),
    nextReviewAt: timestamp("next_review_at", { withTimezone: true }),
    /** Explicit review cadence for this client. When null, cadence is derived
     *  from serviceTier (A=quarterly, B=half-yearly, C=annual). Drives nextReviewAt. */
    reviewFrequency: text("review_frequency", { enum: ["monthly", "quarterly", "half_yearly", "annual"] }),

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

    /**
     * Duplicate-merge bookkeeping (Sanchay "Find Duplicate Records" parity).
     * When two records for the same person are merged, the loser keeps a
     * pointer to the survivor + the merge timestamp and is set status=inactive.
     */
    mergedIntoId: uuid("merged_into_id"),
    mergedAt: timestamp("merged_at", { withTimezone: true }),

    /**
     * Contact-verification stamps (Sanchay "Verified At" parity). Set when an
     * RM confirms the email / phone is correct — drives a verification-due
     * worklist + deliverability hygiene.
     */
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
    contactVerifiedBy: uuid("contact_verified_by"),

    tags: jsonb("tags").$type<string[]>().default([]),
    notes: text("notes"),

    /**
     * Cross-sell / product-holdings matrix (Sanchay "Cross Selling" parity).
     * Map of product key -> status, e.g. { mutual_funds: "held_with_us",
     * life_insurance: "held_elsewhere", health_insurance: "not_held" }.
     * "held_elsewhere" / "interested" / "not_held" are wallet-share
     * opportunities. See src/lib/investors/cross-sell.ts.
     */
    crossSell: jsonb("cross_sell").$type<Record<string, string>>(),
    ...timestamps,
  },
  (t) => ({
    panUnique: uniqueIndex("investors_tenant_pan_unique").on(t.tenantId, t.pan),
    rmIdx: index("investors_rm_idx").on(t.tenantId, t.rmId),
    segmentIdx: index("investors_segment_idx").on(t.tenantId, t.segmentTag),
    lastReviewIdx: index("investors_last_review_idx").on(t.tenantId, t.lastReviewAt),
    lastTransactionIdx: index("investors_last_tx_idx").on(t.tenantId, t.lastTransactionAt),
    healthIdx: index("investors_health_idx").on(t.tenantId, t.healthScore),
    familyIdx: index("investors_family_idx").on(t.tenantId, t.familyId),
    // Hot list sort/filter columns (migration 0057).
    aumIdx: index("investors_aum_idx").on(t.tenantId, t.aum),
    sipIdx: index("investors_sip_idx").on(t.tenantId, t.activeSipAmount),
    nextReviewIdx: index("investors_next_review_idx").on(t.tenantId, t.nextReviewAt),
    statusIdx: index("investors_status_idx").on(t.tenantId, t.status),
    kycIdx: index("investors_kyc_idx").on(t.tenantId, t.kycStatus),
    tierIdx: index("investors_tier_idx").on(t.tenantId, t.serviceTier),
    clientCategoryIdx: index("investors_client_category_idx").on(t.tenantId, t.clientCategory),
  })
);

export type Investor = typeof investors.$inferSelect;
export type NewInvestor = typeof investors.$inferInsert;
