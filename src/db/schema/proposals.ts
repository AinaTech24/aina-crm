import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { branches } from "./branches";
import { investors } from "./investors";
import { leads } from "./leads";
import { families } from "./families";
import { users } from "./users";

/**
 * Investment proposals — branded PDFs that an RM/owner generates and sends to
 * a prospect or existing client. Supports Mutual Fund, Insurance, PMS, AIF,
 * or a mix of these as line-items.
 *
 * A proposal can be sent to either an existing investor (recipientType='investor',
 * investorId set) or a lead (recipientType='lead', leadId set) — never both
 * simultaneously. Recipient contact info is also snapshot at creation time
 * because the underlying record may change later.
 */
export const proposals = pgTable(
  "proposals",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    branchId: uuid("branch_id").references(() => branches.id),

    /** Auto-generated human-friendly identifier, e.g. PROP-2026-0001 */
    proposalNumber: text("proposal_number").notNull(),

    /**
     * Recipient — investor (single client), lead (prospect), or family (entire
     * family group; contact resolves to the family's primary investor).
     */
    recipientType: text("recipient_type", { enum: ["investor", "lead", "family"] }).notNull(),
    investorId: uuid("investor_id").references(() => investors.id),
    /** The opportunity this proposal answers (migration 0224) — sending or
     *  accepting it moves that journey: lib/opportunities/journey.ts. */
    opportunityId: uuid("opportunity_id"),
    leadId: uuid("lead_id").references(() => leads.id),
    familyId: uuid("family_id").references(() => families.id),
    /** Snapshot of recipient details at creation (so doc is immutable). */
    recipientName: text("recipient_name").notNull(),
    recipientEmail: text("recipient_email"),
    recipientPhone: text("recipient_phone"),

    /** What kind of products the proposal covers. 'mixed' = multiple kinds. */
    type: text("type", {
      enum: ["comprehensive", "mutual_fund", "insurance", "pms", "aif", "mixed"],
    })
      .notNull()
      .default("mutual_fund"),

    title: text("title").notNull(),
    summary: text("summary"),
    coverLetter: text("cover_letter"),
    disclaimer: text("disclaimer"),

    /**
     * Line items — array of products inside the proposal. Each item has a
     * `kind` discriminator and product-specific fields:
     *
     *   - kind='mf':         schemeName, amcName, schemeCode, category,
     *                        monthlyAmount, lumpsum, sipTermYears,
     *                        expectedReturn, riskRating, projectedCorpus
     *   - kind='insurance':  policyName, insurer, policyType
     *                        (term/ulip/endowment/health), sumAssured,
     *                        annualPremium, termYears, riderNotes
     *   - kind='pms':        strategyName, manager, minInvestment,
     *                        proposedAmount, expectedReturn, exitLoad
     *   - kind='aif':        fundName, manager, category (cat1/2/3),
     *                        minInvestment, proposedAmount, lockInYears,
     *                        targetIrr
     *
     * Free-form `notes` allowed on every item.
     */
    products: jsonb("products").$type<ProposalLineItem[]>().notNull().default([]),

    /** Totals across all line items (computed at save time). */
    totalInvestment: numeric("total_investment", { precision: 16, scale: 2 }),
    expectedCorpus: numeric("expected_corpus", { precision: 16, scale: 2 }),
    riskRating: text("risk_rating", { enum: ["conservative", "moderate", "aggressive", "mixed"] }),

    /** Status workflow. */
    status: text("status", {
      // `partially_approved` = the client took SOME of the recommended schemes;
      // `executed` = the approved items were actually transacted. Without these
      // two, a half-accepted proposal had to be logged as fully accepted and a
      // transacted one stayed "accepted" forever, so conversion reporting could
      // not tell intent from money actually invested.
      // `changes_requested` = the client asked for a change instead of
      // deciding; `superseded` = a newer version of this proposal exists
      // (migration 0225). Neither counts as open, won or lost.
      enum: [
        "draft", "ready", "sent", "viewed", "accepted", "partially_approved", "rejected", "expired", "executed",
        "changes_requested", "superseded",
      ],
    })
      .notNull()
      .default("draft"),
    validUntil: timestamp("valid_until", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    viewedAt: timestamp("viewed_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    rejectedAt: timestamp("rejected_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),

    preparedByUserId: uuid("prepared_by_user_id").references(() => users.id),
    preparedAt: timestamp("prepared_at", { withTimezone: true }).defaultNow(),

    /** Attachments — uploaded supporting docs (factsheets, brochures). */
    attachments: jsonb("attachments").$type<{ name: string; url: string }[]>().default([]),

    /** Suitability & Compliance */
    suitabilityNote: text("suitability_note"),
    suitabilityOverrideReason: text("suitability_override_reason"),

    // ── Journey (migration 0225) ─────────────────────────────────────────
    /** Once sent, a proposal is revised as a new version, never edited in
     *  place — the sent version is the record of what the client saw. */
    version: integer("version").notNull().default(1),
    parentProposalId: uuid("parent_proposal_id"),
    supersededById: uuid("superseded_by_id"),
    /** Indices into `products` the client accepted; null until they decide. */
    acceptedItems: jsonb("accepted_items").$type<number[]>(),
    changeRequestNote: text("change_request_note"),
    changeRequestedAt: timestamp("change_requested_at", { withTimezone: true }),
    /** viewedAt (above) is the FIRST open; these track the rest. */
    viewCount: integer("view_count").notNull().default(0),
    lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),
    /** Filled by matching RTA transactions after acceptance. */
    executedAt: timestamp("executed_at", { withTimezone: true }),
    executedAmount: numeric("executed_amount", { precision: 16, scale: 2 }),
    execution: jsonb("execution").$type<ProposalExecution>(),

    ...timestamps,
  },
  (t) => ({
    statusIdx: index("proposals_status_idx").on(t.tenantId, t.status),
    investorIdx: index("proposals_investor_idx").on(t.tenantId, t.investorId),
    leadIdx: index("proposals_lead_idx").on(t.tenantId, t.leadId),
    familyIdx: index("proposals_family_idx").on(t.tenantId, t.familyId),
    numberIdx: index("proposals_number_idx").on(t.tenantId, t.proposalNumber),
  })
);

export type Proposal = typeof proposals.$inferSelect;

/** What the execution matcher found: per accepted line, the money that landed. */
export type ProposalExecution = {
  matchedAt: string;
  lines: Array<{
    index: number;
    schemeName: string;
    proposed: number;
    invested: number;
    transactionIds: string[];
  }>;
};

/** How an MF recommendation is to be invested — the old worksheet's four kinds. */
export type RecommendationType = "sip" | "lumpsum" | "swp" | "stp";
export type NewProposal = typeof proposals.$inferInsert;

/**
 * Line-item discriminated union — what goes into `proposals.products`.
 * The Zod schema in the API mirrors this shape.
 */
export type ProposalLineItem =
  | {
      kind: "mf";
      schemeName: string;
      amcName?: string;
      schemeCode?: string;
      category?: string;
      /** SIP (default) / lumpsum / SWP / STP — the worksheet's four kinds,
       *  now part of the one recommendation list the client sees. */
      recommendationType?: RecommendationType;
      planType?: "regular" | "direct";
      monthlyAmount?: number;
      lumpsum?: number;
      sipTermYears?: number;
      stepUpPct?: number;
      expectedReturn?: number;
      riskRating?: "low" | "low_to_moderate" | "moderate" | "moderately_high" | "high" | "very_high";
      projectedCorpus?: number;
      goal?: string;
      // SWP
      corpusRequired?: number;
      monthlyWithdrawal?: number;
      swpPeriodMonths?: number;
      // STP — transfers FROM schemeName TO toSchemeName
      toSchemeName?: string;
      toSchemeCode?: string;
      monthlyTransfer?: number;
      numInstallments?: number;
      /** Why the RM kept a scheme above the client's risk band. */
      suitabilityReason?: string;
      notes?: string;
    }
  | {
      kind: "insurance";
      policyName: string;
      insurer?: string;
      policyType?: "term" | "ulip" | "endowment" | "health" | "money_back" | "other";
      sumAssured?: number;
      annualPremium?: number;
      termYears?: number;
      riderNotes?: string;
      notes?: string;
    }
  | {
      kind: "pms";
      strategyName: string;
      manager?: string;
      minInvestment?: number;
      proposedAmount?: number;
      expectedReturn?: number;
      termYears?: number;
      exitLoad?: string;
      notes?: string;
    }
  | {
      kind: "aif";
      fundName: string;
      manager?: string;
      category?: "cat1" | "cat2" | "cat3";
      minInvestment?: number;
      proposedAmount?: number;
      lockInYears?: number;
      targetIrr?: number;
      notes?: string;
    }
  | {
      // Non-MF / non-market products — bank FD, bonds, NPS, post-office, etc.
      kind: "other";
      productName: string;
      company?: string;
      amount?: number;
      expectedReturn?: number;
      termYears?: number;
      remarks?: string;
      notes?: string;
    };
