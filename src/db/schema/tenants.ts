import { boolean, date, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, timestamps } from "./_shared";

export const tenants = pgTable(
  "tenants",
  {
    id,
    legalName: text("legal_name").notNull(),
    displayName: text("display_name").notNull(),
    arn: text("arn").notNull(),
    arnExpiryAt: date("arn_expiry_at"),
    principalEuin: text("principal_euin"),
    gstNumber: text("gst_number"),
    panNumber: text("pan_number"),
    address: jsonb("address").$type<{
      line1?: string;
      line2?: string;
      city?: string;
      state?: string;
      pincode?: string;
      country?: string;
    }>(),
    phone: text("phone"),
    email: text("email"),
    website: text("website"),
    primaryColor: text("primary_color").default("#1f2937"),
    secondaryColor: text("secondary_color").default("#0ea5e9"),
    logoUrl: text("logo_url"),
    faviconUrl: text("favicon_url"),
    /** @deprecated — kept for back-compat. Active subscription is the source of truth now. */
    plan: text("plan", { enum: ["starter", "growth", "professional", "enterprise"] })
      .notNull()
      .default("starter"),
    planSeats: jsonb("plan_seats").$type<{ included: number; addOn: number }>().default({
      included: 1,
      addOn: 0,
    }),
    /** @deprecated — see subscriptions.status. */
    status: text("status", { enum: ["trial", "active", "past_due", "suspended", "churned"] })
      .notNull()
      .default("trial"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),

    /** Organisation profile (spec §6, Module 1) */
    aumRange: text("aum_range"), // matches master_values('aum_range') or free text
    sipBookRange: text("sip_book_range"),
    teamSize: text("team_size"),
    currentSoftwareUsed: text("current_software_used"),
    onboardingNotes: text("onboarding_notes"),

    /** Public-facing */
    publicWebsiteSlug: text("public_website_slug"), // for white-label landing page
    isWhiteLabel: boolean("is_white_label").default(false),
    dataProtectionOfficer: jsonb("dpo").$type<{ name?: string; email?: string; phone?: string }>(),
    riaRegistered: boolean("ria_registered").default(false),
    featureFlags: jsonb("feature_flags").$type<Record<string, boolean>>().default({}),
    ...timestamps,
  },
  (t) => ({
    arnUnique: uniqueIndex("tenants_arn_unique").on(t.arn),
  })
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
