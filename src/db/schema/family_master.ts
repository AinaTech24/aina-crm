/**
 * Family Master configuration.
 *
 * Relationship types are per-firm and copy-on-write: a firm with no rows uses
 * DEFAULT_RELATIONSHIP_TYPES below, so the picker behaves exactly as it did
 * before this table existed. The moment a firm edits anything, the defaults are
 * materialised as rows and become theirs to change.
 */

import { boolean, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { id, tenantId, timestamps } from "./_shared";

export const familyRelationshipTypes = pgTable(
  "family_relationship_types",
  {
    id,
    tenantId,
    /** Written verbatim to investors.family_role — never change one in use. */
    key: text("key").notNull(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(100),
    isActive: boolean("is_active").notNull().default(true),
    /** Shipped default: key is fixed, only label / order / active are editable. */
    isSystem: boolean("is_system").notNull().default(false),
    ...timestamps,
  },
  (t) => ({
    tenantKeyIdx: uniqueIndex("family_relationship_types_tenant_key_idx").on(t.tenantId, t.key),
    tenantOrderIdx: index("family_relationship_types_tenant_order_idx").on(t.tenantId, t.sortOrder),
  })
);

export type FamilyRelationshipType = typeof familyRelationshipTypes.$inferSelect;

/**
 * What every firm gets until it customises. Keys match the values already
 * written to investors.family_role by the old hardcoded pickers, so existing
 * members keep resolving to a label.
 */
export const DEFAULT_RELATIONSHIP_TYPES: Array<{ key: string; label: string; sortOrder: number }> = [
  { key: "self", label: "Self / Head", sortOrder: 10 },
  { key: "spouse", label: "Spouse", sortOrder: 20 },
  { key: "son", label: "Son", sortOrder: 30 },
  { key: "daughter", label: "Daughter", sortOrder: 40 },
  { key: "father", label: "Father", sortOrder: 50 },
  { key: "mother", label: "Mother", sortOrder: 60 },
  { key: "sibling", label: "Sibling", sortOrder: 70 },
  { key: "huf_karta", label: "HUF Karta", sortOrder: 80 },
  { key: "huf_coparcener", label: "HUF Co-parcener", sortOrder: 90 },
  { key: "huf", label: "HUF Member", sortOrder: 100 },
  { key: "other", label: "Other", sortOrder: 110 },
];

/** Per-firm household defaults stored on tenants.family_settings. */
export type FamilySettings = {
  /** Cadence applied to a new household when none is chosen. */
  defaultReviewFrequency?: "monthly" | "quarterly" | "half_yearly" | "annual" | null;
  /** How a household is named from its head. {head} is substituted. */
  familyNamePattern?: string;
  /** Refuse to create a household without a primary member. */
  requirePrimaryMember?: boolean;
};

export const FAMILY_SETTINGS_DEFAULTS: Required<FamilySettings> = {
  defaultReviewFrequency: "annual",
  familyNamePattern: "{head} Family",
  requirePrimaryMember: false,
};
