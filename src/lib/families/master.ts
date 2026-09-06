/**
 * Family Master helpers — relationship types and per-firm household defaults.
 *
 * Copy-on-write: a firm with no rows in family_relationship_types uses the
 * shipped defaults, so nothing changed for anyone when the table appeared. The
 * first edit materialises the defaults as real rows and the firm owns them.
 */

import { asc, eq, sql } from "drizzle-orm";
import {
  DEFAULT_RELATIONSHIP_TYPES,
  FAMILY_SETTINGS_DEFAULTS,
  familyRelationshipTypes,
  tenants,
  type FamilySettings,
} from "@/db/schema";

export type RelationshipOption = {
  id: string | null;
  key: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
  isSystem: boolean;
  /** False when this row is a shipped default that isn't stored yet. */
  stored: boolean;
};

/** The firm's relationship list — its own rows, or the shipped defaults. */
export async function loadRelationshipTypes(
  tx: any,
  tenantId: string,
  opts: { includeInactive?: boolean } = {}
): Promise<RelationshipOption[]> {
  const rows = await tx
    .select()
    .from(familyRelationshipTypes)
    .where(eq(familyRelationshipTypes.tenantId, tenantId))
    .orderBy(asc(familyRelationshipTypes.sortOrder));

  if (!rows.length) {
    return DEFAULT_RELATIONSHIP_TYPES.map((d) => ({
      id: null,
      key: d.key,
      label: d.label,
      sortOrder: d.sortOrder,
      isActive: true,
      isSystem: true,
      stored: false,
    }));
  }

  return (rows as Array<typeof familyRelationshipTypes.$inferSelect>)
    .filter((r) => opts.includeInactive || r.isActive)
    .map((r) => ({
      id: r.id,
      key: r.key,
      label: r.label,
      sortOrder: r.sortOrder,
      isActive: r.isActive,
      isSystem: r.isSystem,
      stored: true,
    }));
}

/**
 * Turn the shipped defaults into real rows so they can be edited. No-op once a
 * firm has any row of its own.
 */
export async function materializeRelationshipDefaults(tx: any, tenantId: string): Promise<void> {
  const existing = await tx
    .select({ c: sql<number>`count(*)::int` })
    .from(familyRelationshipTypes)
    .where(eq(familyRelationshipTypes.tenantId, tenantId));
  if (Number(existing[0]?.c ?? 0) > 0) return;

  await tx.insert(familyRelationshipTypes).values(
    DEFAULT_RELATIONSHIP_TYPES.map((d) => ({
      tenantId,
      key: d.key,
      label: d.label,
      sortOrder: d.sortOrder,
      isActive: true,
      isSystem: true,
    }))
  );
}

/** Household defaults, with anything the firm hasn't set filled from ours. */
export async function loadFamilySettings(tx: any, tenantId: string): Promise<Required<FamilySettings>> {
  const row = (
    await tx.select({ s: tenants.familySettings }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  )[0];
  const stored = (row?.s ?? {}) as FamilySettings;
  return {
    defaultReviewFrequency:
      stored.defaultReviewFrequency !== undefined
        ? stored.defaultReviewFrequency
        : FAMILY_SETTINGS_DEFAULTS.defaultReviewFrequency,
    familyNamePattern: stored.familyNamePattern || FAMILY_SETTINGS_DEFAULTS.familyNamePattern,
    requirePrimaryMember:
      stored.requirePrimaryMember ?? FAMILY_SETTINGS_DEFAULTS.requirePrimaryMember,
  };
}

/** Apply the firm's naming pattern to a head name. */
export function applyFamilyNamePattern(pattern: string, headName: string): string {
  const name = (pattern || FAMILY_SETTINGS_DEFAULTS.familyNamePattern).replace(
    /\{head\}/gi,
    headName.trim()
  );
  return name.trim().slice(0, 120) || `${headName.trim()} Family`;
}

/** Label for a stored family_role, falling back to a readable form of the key. */
export function relationshipLabel(options: RelationshipOption[], key: string | null | undefined): string {
  if (!key) return "—";
  const hit = options.find((o) => o.key === key);
  if (hit) return hit.label;
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

