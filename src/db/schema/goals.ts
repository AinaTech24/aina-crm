import { date, index, jsonb, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";
import { tenants } from "./tenants";
import { investors } from "./investors";

/**
 * Goal Planning — spec § 6 Module 8.
 *
 * The 9 spec categories (Retirement, Child Education, Child Marriage, House,
 * Car, Vacation, Emergency Fund, Wealth Creation, Other) are the new canonical
 * enum values; legacy slugs (education, vehicle, emergency, wedding, wealth)
 * are kept for back-compat with rows seeded before this revision.
 *
 * Status enum tracks lifecycle + progress:
 *   - lifecycle: on_hold · abandoned · achieved
 *   - progress (auto-computed nightly): not_started · on_track · behind_track
 *   - legacy: "active" (≈ not_started/on_track) retained for older rows.
 *
 * The 3 spec-only fields (Required Monthly SIP, Existing Monthly SIP, Gap
 * Amount) are cached here for fast list rendering; the calculator helper in
 * src/lib/goal-planning/calc.ts recomputes them when the goal is saved.
 */
export const goals = pgTable("goals", {
  id,
  tenantId: tenantId.references(() => tenants.id),
  investorId: uuid("investor_id")
    .notNull()
    .references(() => investors.id),

  name: text("name").notNull(),

  /** Spec-canonical category + legacy aliases. */
  category: text("category", {
    enum: [
      // Spec-canonical (9)
      "retirement",
      "child_education",
      "child_marriage",
      "house",
      "car",
      "vacation",
      "emergency_fund",
      "wealth_creation",
      "other",
      // Legacy aliases — kept for already-seeded rows
      "education",
      "vehicle",
      "emergency",
      "wedding",
      "wealth",
    ],
  }).notNull(),

  targetAmount: numeric("target_amount", { precision: 18, scale: 2 }).notNull(),
  targetDate: date("target_date").notNull(),
  startedOn: date("started_on"),
  monthlyContribution: numeric("monthly_contribution", { precision: 18, scale: 2 }),
  expectedReturn: numeric("expected_return", { precision: 5, scale: 2 }),
  currentValue: numeric("current_value", { precision: 18, scale: 2 }).default("0"),
  progressPct: numeric("progress_pct", { precision: 5, scale: 2 }).default("0"),
  linkedFolios: jsonb("linked_folios").$type<string[]>().default([]),
  /** Investor SIP ids whose monthly amount counts toward this goal. */
  linkedSips: jsonb("linked_sips").$type<string[]>().default([]),

  /**
   * Per-folio allocation % to this goal (0..100). Lets one folio split
   * its AUM across multiple goals — e.g. ₹10L folio → 60 % retirement,
   * 40 % child education. Default 100 for any folio in `linkedFolios`
   * that has no row here.
   */
  folioAllocations: jsonb("folio_allocations")
    .$type<{ folioId: string; allocationPct: number }[]>()
    .default([]),
  /** Same idea for SIPs. allocationPct of the monthly amount counts here. */
  sipAllocations: jsonb("sip_allocations")
    .$type<{ sipId: string; allocationPct: number }[]>()
    .default([]),

  /** Spec § Module 8 — derived but cached for fast reads. */
  requiredMonthlySip: numeric("required_monthly_sip", { precision: 18, scale: 2 }),
  existingMonthlySip: numeric("existing_monthly_sip", { precision: 18, scale: 2 }),
  gapAmount: numeric("gap_amount", { precision: 18, scale: 2 }),

  nextReviewAt: timestamp("next_review_at", { withTimezone: true }),
  remarks: text("remarks"),

  /** Progress + lifecycle in one enum. Spec calls out 4 buckets. */
  status: text("status", {
    enum: [
      // Spec-canonical (4)
      "not_started",
      "on_track",
      "behind_track",
      "achieved",
      // Lifecycle / legacy
      "active",
      "on_hold",
      "abandoned",
    ],
  })
    .notNull()
    .default("not_started"),

  ...timestamps,
}, (t) => ({
  investorIdx: index("goals_investor_idx").on(t.tenantId, t.investorId),
}));

export type Goal = typeof goals.$inferSelect;
export type NewGoal = typeof goals.$inferInsert;
