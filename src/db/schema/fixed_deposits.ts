/**
 * Fixed deposits a client has placed through the firm (migration 0226).
 * One row per deposit receipt. Maturity maths and the vocabulary live in
 * src/lib/fixed-deposits/; the automations (maturity inflow + reminder,
 * Cross-sell, opportunities) in src/lib/fixed-deposits/hooks.ts.
 */

import { boolean, date, index, integer, numeric, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { investors } from "./investors";
import { users } from "./users";
import { expectedInflows } from "./expected_inflows";

export const FD_ISSUER_TYPES = ["bank", "small_finance_bank", "corporate", "nbfc", "post_office", "other"] as const;
export const FD_PAYOUTS = ["cumulative", "monthly", "quarterly", "half_yearly", "yearly"] as const;
export const FD_COMPOUNDING = ["monthly", "quarterly", "half_yearly", "yearly"] as const;
export const FD_HOLDINGS = ["single", "joint", "either_or_survivor"] as const;
export const FD_TAX_FORMS = ["none", "15g", "15h"] as const;
export const FD_STATUSES = ["applied", "active", "matured", "renewed", "closed_early", "cancelled"] as const;

export type FdIssuerType = (typeof FD_ISSUER_TYPES)[number];
export type FdPayout = (typeof FD_PAYOUTS)[number];
export type FdCompounding = (typeof FD_COMPOUNDING)[number];
export type FdStatus = (typeof FD_STATUSES)[number];

export const fixedDeposits = pgTable(
  "fixed_deposits",
  {
    id,
    tenantId: tenantId.references(() => tenants.id),
    investorId: uuid("investor_id").notNull().references(() => investors.id),
    rmId: uuid("rm_id").references(() => users.id),
    issuer: text("issuer").notNull(),
    issuerType: text("issuer_type", { enum: FD_ISSUER_TYPES }).notNull().default("bank"),
    schemeName: text("scheme_name"),
    fdNumber: text("fd_number"),
    depositDate: date("deposit_date").notNull(),
    maturityDate: date("maturity_date").notNull(),
    tenureMonths: integer("tenure_months"),
    tenureDays: integer("tenure_days"),
    principal: numeric("principal", { precision: 18, scale: 2 }).notNull(),
    interestRate: numeric("interest_rate", { precision: 6, scale: 3 }).notNull(),
    payout: text("payout", { enum: FD_PAYOUTS }).notNull().default("cumulative"),
    compounding: text("compounding", { enum: FD_COMPOUNDING }).notNull().default("quarterly"),
    maturityAmount: numeric("maturity_amount", { precision: 18, scale: 2 }),
    /** True when the amount was typed from the receipt rather than computed. */
    maturityAmountEntered: boolean("maturity_amount_entered").notNull().default(false),
    holding: text("holding", { enum: FD_HOLDINGS }).notNull().default("single"),
    jointHolders: text("joint_holders"),
    nomineeName: text("nominee_name"),
    seniorCitizen: boolean("senior_citizen").notNull().default(false),
    taxForm: text("tax_form", { enum: FD_TAX_FORMS }).notNull().default("none"),
    autoRenew: boolean("auto_renew").notNull().default(false),
    status: text("status", { enum: FD_STATUSES }).notNull().default("active"),
    closedOn: date("closed_on"),
    renewedFromId: uuid("renewed_from_id").references((): AnyPgColumn => fixedDeposits.id),
    commissionRate: numeric("commission_rate", { precision: 6, scale: 3 }),
    commissionAmount: numeric("commission_amount", { precision: 18, scale: 2 }),
    remarks: text("remarks"),
    /** The fd_maturity expected inflow this deposit keeps in step. */
    inflowId: uuid("inflow_id").references(() => expectedInflows.id),
    createdBy: uuid("created_by").references(() => users.id),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    investorIdx: index("fixed_deposits_investor_idx").on(t.tenantId, t.investorId).where(sql`deleted_at IS NULL`),
    maturityIdx: index("fixed_deposits_maturity_idx").on(t.tenantId, t.status, t.maturityDate).where(sql`deleted_at IS NULL`),
    rmIdx: index("fixed_deposits_rm_idx").on(t.tenantId, t.rmId).where(sql`deleted_at IS NULL`),
  })
);

export type FixedDeposit = typeof fixedDeposits.$inferSelect;
