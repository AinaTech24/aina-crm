import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { branches } from "./branches";

/**
 * Family group — per spec § 6 Module 5.
 *
 * `headName` is kept for back-compat (legacy display label) but the spec-
 * canonical fields are:
 *   - familyName              — display name like "Mehta Family"
 *   - primaryInvestorId       — pointer to the primary / head investor
 *   - rmId                    — family-level RM (often the primary's RM)
 *   - lastReviewAt / nextReviewAt — family review cadence
 *
 * The member list + relationships live on `investors.familyId` + `familyRole`.
 */
export const families = pgTable("families", {
  id,
  tenantId: tenantId.references(() => tenants.id),
  branchId: uuid("branch_id").references(() => branches.id),

  /** Legacy display label — still the source-of-truth for old rows. */
  headName: text("head_name").notNull(),
  /** Spec-canonical family name. Falls back to headName when null. */
  familyName: text("family_name"),

  /** Head of the family (primary client). NULL until linked. */
  primaryInvestorId: uuid("primary_investor_id"),

  /** Family-level RM — defaults to primary client's RM but can be overridden. */
  rmId: uuid("rm_id"),

  /** Family review cadence. Used by "Family review due" report + dashboards. */
  lastReviewAt: timestamp("last_review_at", { withTimezone: true }),
  nextReviewAt: timestamp("next_review_at", { withTimezone: true }),

  notes: text("notes"),
  tags: jsonb("tags").$type<string[]>().default([]),
  ...timestamps,
});

export type Family = typeof families.$inferSelect;
export type NewFamily = typeof families.$inferInsert;
