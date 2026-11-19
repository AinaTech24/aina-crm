/**
 * AUM-priced billing (migration 0265): quotes, GST tax invoices and the
 * renewal re-pricing record. See lib/billing/.
 */

import { boolean, date, decimal, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId } from "./_shared";

/** Platform-level (no tenant_id): the person asking is not a firm yet. Platform-admin only under RLS. */
export const pricingQuotes = pgTable("pricing_quotes", {
  id,
  contactName: text("contact_name").notNull(),
  firmName: text("firm_name").notNull(),
  email: text("email").notNull(),
  mobile: text("mobile").notNull(),
  arn: text("arn"),
  aumCrore: decimal("aum_crore", { precision: 12, scale: 2 }).notNull(),
  users: integer("users").notNull(),
  quote: jsonb("quote").$type<Record<string, unknown>>().notNull(),
  chosenCycle: text("chosen_cycle"),
  chosenAt: timestamp("chosen_at", { withTimezone: true }),
  convertedTenantId: uuid("converted_tenant_id"),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  claimTokenHash: text("claim_token_hash").notNull(),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  source: text("source").notNull().default("pricing"),
  /** The one "continue where you left off" email (lib/onboarding/quote-followup.ts, 0269). */
  followupSentAt: timestamp("followup_sent_at", { withTimezone: true }),
  /** SHA-256 of the follow-up email's resume token (the claim token keeps working too). */
  resumeTokenHash: text("resume_token_hash"),
  /** SMS code at the account step (lib/onboarding/mobile-otp.ts). null = not verified. */
  mobileVerifiedAt: timestamp("mobile_verified_at", { withTimezone: true }),
  mobileOtpHash: text("mobile_otp_hash"),
  mobileOtpExpiresAt: timestamp("mobile_otp_expires_at", { withTimezone: true }),
  mobileOtpAttempts: integer("mobile_otp_attempts").notNull().default(0),
  mobileOtpSentAt: timestamp("mobile_otp_sent_at", { withTimezone: true }),
  mobileOtpSends: integer("mobile_otp_sends").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type InvoiceLine = {
  key: "maintenance" | "users" | "discount" | "late_fee";
  description: string;
  /** Service period, ISO dates. */
  periodStart?: string | null;
  periodEnd?: string | null;
  quantity?: number | null;
  ratePaise?: number | null;
  /** Negative for the discount. */
  amountPaise: number;
};

/** One immutable GST tax invoice per Razorpay payment (trigger-enforced). */
export const billingInvoices = pgTable("billing_invoices", {
  id,
  /** NULL once the firm is purged — the invoice itself is kept (GST retention, 0267). */
  tenantId: uuid("tenant_id"),
  subscriptionId: uuid("subscription_id"),
  invoiceNo: text("invoice_no").notNull(),
  financialYear: text("financial_year").notNull(),
  seq: integer("seq").notNull(),
  razorpayPaymentId: text("razorpay_payment_id").notNull(),
  kind: text("kind", { enum: ["first", "renewal", "late_renewal"] }).notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  supplier: jsonb("supplier").$type<Record<string, unknown>>().notNull(),
  recipient: jsonb("recipient").$type<Record<string, unknown>>().notNull(),
  placeOfSupply: text("place_of_supply").notNull(),
  sac: text("sac").notNull(),
  lines: jsonb("lines").$type<InvoiceLine[]>().notNull(),
  taxablePaise: integer("taxable_paise").notNull(),
  cgstPaise: integer("cgst_paise").notNull().default(0),
  sgstPaise: integer("sgst_paise").notNull().default(0),
  igstPaise: integer("igst_paise").notNull().default(0),
  roundOffPaise: integer("round_off_paise").notNull().default(0),
  totalPaise: integer("total_paise").notNull(),
  amountInWords: text("amount_in_words").notNull(),
  status: text("status").notNull().default("paid"),
  emailStatus: text("email_status", { enum: ["pending", "sent", "failed"] }).notNull().default("pending"),
  emailAttempts: integer("email_attempts").notNull().default(0),
  emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
  emailLastError: text("email_last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Gap-free invoice numbering, one counter per financial year (platform-level). */
export const billingInvoiceCounters = pgTable("billing_invoice_counters", {
  financialYear: text("financial_year").primaryKey(),
  lastSeq: integer("last_seq").notNull().default(0),
});

/** The AUM re-check 7 days before each renewal — one row per firm per renewal date. */
export const billingRenewalReviews = pgTable("billing_renewal_reviews", {
  id,
  tenantId,
  subscriptionId: uuid("subscription_id").notNull(),
  renewalOn: date("renewal_on").notNull(),
  aumCroreUsed: decimal("aum_crore_used", { precision: 12, scale: 2 }).notNull(),
  aumSource: text("aum_source", { enum: ["crm_snapshot", "crm_live", "declared"] }).notNull(),
  aumAsOf: date("aum_as_of"),
  fromTier: text("from_tier"),
  toTier: text("to_tier").notNull(),
  changed: boolean("changed").notNull(),
  cycle: text("cycle").notNull(),
  users: integer("users").notNull(),
  nextTotalPaise: integer("next_total_paise").notNull(),
  razorpayAction: text("razorpay_action").notNull().default("none"),
  razorpayPlanId: text("razorpay_plan_id"),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type PricingQuote = typeof pricingQuotes.$inferSelect;
export type BillingInvoice = typeof billingInvoices.$inferSelect;
export type BillingRenewalReview = typeof billingRenewalReviews.$inferSelect;
