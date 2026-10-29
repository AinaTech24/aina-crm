/**
 * Installs the starter operations manual (lib/practice/starter-manual.ts) into
 * a firm's SOP library.
 *
 * Idempotent, matched on `sops.key`:
 *   - a key the firm already has is skipped — the firm's own version wins;
 *   - a key the firm DELETED is skipped too: deleting a starter SOP is a
 *     decision, and a second click must not resurrect it;
 *   - each new SOP gets version 1.0, published now and effective today (IST),
 *     with the body shape the SOP API writes (`{ markdown }`).
 *
 * Links (sop_links) are added with ON CONFLICT DO NOTHING. A position link
 * stores the firm's practice_positions ID, so it can only be made once the
 * position exists; positions are seeded separately, and
 * `relinkStarterPositions` fills those links in afterwards (the install also
 * runs it, so a later click repairs anything missing).
 *
 * `required_roles` (who must sign the SOP off) are the CRM roles of the
 * positions it applies to, plus any extra roles the entry names; an SOP with
 * no position applies to everyone.
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { withTenant } from "@/db/client";
import { practicePositions, sopLinks, sops, sopVersions } from "@/db/schema";
import { DEFAULT_POSITIONS } from "./catalog";
import { STARTER_MANUAL, STARTER_MANUAL_KEYS, type StarterSop } from "./starter-manual";

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

export type StarterManualStatus = {
  total: number;
  /** Starter keys present and live in the library. */
  installed: number;
  /** Starter keys the firm installed and then deleted — never re-added. */
  deleted: number;
  /** What an install would add now. */
  missing: number;
};

export type InstallResult = { installed: number; skipped: number; linksAdded: number };

const POSITION_ROLES = new Map(DEFAULT_POSITIONS.map((p) => [p.key, p.roles]));

/** Roles that must acknowledge a starter SOP. */
export function starterRequiredRoles(entry: StarterSop): string[] {
  const roles = new Set<string>();
  for (const l of entry.appliesTo) {
    if (l.kind !== "position") continue;
    for (const r of POSITION_ROLES.get(l.key) ?? []) roles.add(r);
  }
  for (const r of entry.extraRoles ?? []) roles.add(r);
  return [...roles];
}

function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

async function existingStarterKeys(tx: Tx, tenantId: string) {
  const rows = await tx
    .select({ id: sops.id, key: sops.key, deletedAt: sops.deletedAt })
    .from(sops)
    .where(and(eq(sops.tenantId, tenantId), inArray(sops.key, STARTER_MANUAL_KEYS)));
  return rows;
}

export async function starterManualStatus(tx: Tx, tenantId: string): Promise<StarterManualStatus> {
  const rows = await existingStarterKeys(tx, tenantId);
  const installed = rows.filter((r) => !r.deletedAt).length;
  const deleted = rows.length - installed;
  const total = STARTER_MANUAL.length;
  return { total, installed, deleted, missing: Math.max(0, total - rows.length) };
}

async function positionIdsByKey(tx: Tx, tenantId: string): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: practicePositions.id, key: practicePositions.key })
    .from(practicePositions)
    .where(eq(practicePositions.tenantId, tenantId));
  return new Map(rows.map((r) => [r.key, r.id]));
}

/** The sop_links rows for one entry; position links only where the position exists. */
function linkRows(tenantId: string, sopId: string, entry: StarterSop, positions: Map<string, string>) {
  const out: Array<typeof sopLinks.$inferInsert> = [];
  for (const l of entry.appliesTo) {
    if (l.kind === "position") {
      const pid = positions.get(l.key);
      if (!pid) continue;
      out.push({ tenantId, sopId, targetKind: "position", targetKey: pid });
    } else {
      out.push({ tenantId, sopId, targetKind: l.kind, targetKey: l.key });
    }
  }
  return out;
}

async function insertLinks(tx: Tx, rows: Array<typeof sopLinks.$inferInsert>): Promise<number> {
  if (rows.length === 0) return 0;
  const added = await tx.insert(sopLinks).values(rows).onConflictDoNothing().returning({ id: sopLinks.id });
  return added.length;
}

export async function installStarterManual(tx: Tx, tenantId: string, userId: string): Promise<InstallResult> {
  const present = new Set((await existingStarterKeys(tx, tenantId)).map((r) => r.key));
  const positions = await positionIdsByKey(tx, tenantId);
  const effectiveFrom = istToday();
  const now = new Date();

  let installed = 0;
  let linksAdded = 0;
  for (const entry of STARTER_MANUAL) {
    if (present.has(entry.key)) continue;
    const sopId = uuid();
    const versionId = uuid();
    // ON CONFLICT on (tenant, key): a concurrent install of the same key loses
    // quietly instead of aborting the whole transaction.
    const created = await tx
      .insert(sops)
      .values({
        id: sopId,
        tenantId,
        key: entry.key,
        title: entry.title,
        category: entry.category,
        currentVersionId: versionId,
        requiredRoles: starterRequiredRoles(entry),
      })
      .onConflictDoNothing()
      .returning({ id: sops.id });
    if (created.length === 0) continue;
    await tx.insert(sopVersions).values({
      id: versionId,
      sopId,
      tenantId,
      versionNumber: "1.0",
      body: { markdown: entry.markdown },
      effectiveFrom,
      publishedAt: now,
      publishedByUserId: userId,
    });
    linksAdded += await insertLinks(tx, linkRows(tenantId, sopId, entry, positions));
    installed++;
  }

  // Position links for starter SOPs installed earlier, before the positions existed.
  linksAdded += await relinkStarterPositions(tx, tenantId, positions);

  return { installed, skipped: STARTER_MANUAL.length - installed, linksAdded };
}

/**
 * (Re)adds the position links of every live starter SOP, for positions that
 * exist now. Idempotent; returns how many links it added. Call it after the
 * firm's positions are seeded.
 */
export async function relinkStarterPositions(
  tx: Tx,
  tenantId: string,
  positionsByKey?: Map<string, string>,
): Promise<number> {
  const positions = positionsByKey ?? (await positionIdsByKey(tx, tenantId));
  if (positions.size === 0) return 0;
  const live = await tx
    .select({ id: sops.id, key: sops.key })
    .from(sops)
    .where(and(eq(sops.tenantId, tenantId), inArray(sops.key, STARTER_MANUAL_KEYS), isNull(sops.deletedAt)));
  const byKey = new Map(STARTER_MANUAL.map((e) => [e.key, e]));
  const rows: Array<typeof sopLinks.$inferInsert> = [];
  for (const s of live) {
    const entry = byKey.get(s.key);
    if (!entry) continue;
    for (const l of entry.appliesTo) {
      if (l.kind !== "position") continue;
      const pid = positions.get(l.key);
      if (pid) rows.push({ tenantId, sopId: s.id, targetKind: "position", targetKey: pid });
    }
  }
  return insertLinks(tx, rows);
}
