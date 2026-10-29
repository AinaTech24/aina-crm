/**
 * Opportunities — an existing client who wants another product (migration
 * 0224). One row per (client, product) request; only one OPEN row per
 * product. Each runs the "opportunities" blueprint (blueprint_instances,
 * subject_type 'opportunity'). See src/lib/opportunities/.
 */

import { date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { investors } from "./investors";
import { users } from "./users";
import { leads } from "./leads";
import { expectedInflows } from "./expected_inflows";

export const clientOpportunities = pgTable(
  "client_opportunities",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    investorId: uuid("investor_id").notNull().references(() => investors.id),
    /** Cross-sell product key (lib/investors/cross-sell.ts) or 'other'. */
    product: text("product").notNull(),
    pipeline: text("pipeline", { enum: ["mf", "insurance", "general"] }).notNull(),
    status: text("status", { enum: ["open", "won", "lost"] }).notNull().default("open"),
    expectedValue: numeric("expected_value", { precision: 18, scale: 2 }),
    /** MF only: a SIP needs an active mandate, a lumpsum does not. */
    investmentMode: text("investment_mode", { enum: ["sip", "lumpsum"] }),
    source: text("source", { enum: ["manual", "cross_sell", "lead_match", "review", "automation"] })
      .notNull()
      .default("manual"),
    ownerId: uuid("owner_id").references(() => users.id),
    coOwnerId: uuid("co_owner_id").references(() => users.id),
    sourceLeadId: uuid("source_lead_id").references(() => leads.id),
    /** Insurance needs analysis — required before a quote. */
    needsAnalysis: jsonb("needs_analysis").$type<NeedsAnalysis>(),
    notes: text("notes"),
    lostReason: text("lost_reason"),
    /** Lost: when to look again. Open + parked ("Later"): when the client
     *  said they would go ahead (lib/opportunities/later.ts, migration 0231). */
    revisitOn: date("revisit_on"),
    /** Set while the client has put it off ("Later"); null when active. */
    parkedAt: timestamp("parked_at", { withTimezone: true }),
    /** What the client said: "after Diwali", "when the FD matures". */
    parkedReason: text("parked_reason"),
    /** Times it has been put off. */
    parkCount: integer("park_count").notNull().default(0),
    /** The money it waits for, when it waits for money. */
    expectedInflowId: uuid("expected_inflow_id").references(() => expectedInflows.id, { onDelete: "set null" }),
    /** The meeting scheduled from this opportunity (migration 0248). */
    meetingId: uuid("meeting_id"),
    /** What each step recorded, by stage key (lib/opportunities/steps.ts). */
    stepDetails: jsonb("step_details").$type<Record<string, Record<string, unknown>>>().notNull().default({}),
    wonAt: timestamp("won_at", { withTimezone: true }),
    lostAt: timestamp("lost_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    ...timestamps,
  },
  (t) => ({
    investorIdx: index("client_opps_investor_idx").on(t.tenantId, t.investorId),
    statusIdx: index("client_opps_status_idx").on(t.tenantId, t.status, t.pipeline),
    ownerIdx: index("client_opps_owner_idx").on(t.tenantId, t.ownerId, t.status),
    oneOpen: uniqueIndex("client_opps_one_open_per_product")
      .on(t.tenantId, t.investorId, t.product)
      .where(sql`status = 'open'`),
  })
);

export type NeedsAnalysis = {
  annualIncome?: number | null;
  dependants?: number | null;
  existingCover?: number | null;
  coverNeeded?: number | null;
  liabilities?: number | null;
  notes?: string | null;
  recordedAt?: string;
  recordedBy?: string;
};

export type ClientOpportunity = typeof clientOpportunities.$inferSelect;
