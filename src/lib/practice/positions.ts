/**
 * Positions — the firm organised by JOBS, not by people (The E-Myth Revisited).
 *
 * A position has a contract (purpose, the results it answers for, what it may
 * approve), one or more holders, the core processes it owns
 * (practice_process_settings.owner_position_id) and the SOPs linked to it
 * (sop_links target_kind 'position', target_key = the position id).
 *
 * SERVER-ONLY for the loaders (they take a Tx). The key helpers at the top are
 * pure and tested (tests/practice-positions.test.ts).
 */

import { sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { practicePositions, practicePositionHolders, practiceProcessSettings } from "@/db/schema";
import { DEFAULT_POSITIONS, PRACTICE_PROCESSES, PROCESS_BY_KEY } from "./catalog";

/* ───────────────────────────── pure helpers ───────────────────────────── */

/** A position's key from its title: lower snake case, ascii, at most 48 characters. */
export function positionKey(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)
    .replace(/_+$/g, "");
  return base || "position";
}

/** `base`, or `base_2`, `base_3` … — the first not already taken. */
export function uniqueKey(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let n = 2; ; n++) {
    const k = `${base}_${n}`;
    if (!set.has(k)) return k;
  }
}

/* ─────────────────────────────── API bodies ─────────────────────────────── */

const line = z.string().trim().min(1).max(300);

export const PositionCreateBody = z.object({
  title: z.string().trim().min(2, "Give the position a title").max(120),
  purpose: z.string().trim().max(1000).nullish(),
  results: z.array(line).max(30).optional(),
  approvals: z.array(line).max(30).optional(),
});

export const PositionPatchBody = z
  .object({
    title: z.string().trim().min(2, "Give the position a title").max(120).optional(),
    purpose: z.string().trim().max(1000).nullish(),
    results: z.array(line).max(30).optional(),
    approvals: z.array(line).max(30).optional(),
    sort: z.number().int().min(0).max(100000).optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "Nothing to change" });

export const PositionHoldersBody = z.object({
  userIds: z.array(z.string().uuid()).max(200),
});

/* ─────────────────────────────── loaders ─────────────────────────────── */

export type PositionHolder = { userId: string; name: string; avatarUrl: string | null; roles: string[] };
export type PositionProcess = { key: string; name: string };
export type PositionSop = { id: string; title: string };

export type PositionView = {
  id: string;
  key: string;
  title: string;
  purpose: string | null;
  results: string[];
  approvals: string[];
  sort: number;
  holders: PositionHolder[];
  processes: PositionProcess[];
  sops: PositionSop[];
};

/** Every position of the firm, ordered, with its active holders, processes and SOPs. */
export async function loadPositions(tx: Tx, tenantId: string): Promise<PositionView[]> {
  const positions = (await tx.execute(sql`
    SELECT id, key, title, purpose, results, approvals, sort
      FROM practice_positions
     WHERE tenant_id = ${tenantId}::uuid
     ORDER BY sort ASC, title ASC
  `)).rows as Array<{
    id: string; key: string; title: string; purpose: string | null;
    results: unknown; approvals: unknown; sort: number;
  }>;
  if (!positions.length) return [];

  const holders = (await tx.execute(sql`
    SELECT h.position_id, u.id AS user_id, u.name, u.avatar_url, u.roles
      FROM practice_position_holders h
      JOIN users u ON u.id = h.user_id AND u.tenant_id = h.tenant_id
     WHERE h.tenant_id = ${tenantId}::uuid AND u.status = 'active'
     ORDER BY u.name ASC
  `)).rows as Array<{ position_id: string; user_id: string; name: string; avatar_url: string | null; roles: string[] | null }>;

  const processes = (await tx.execute(sql`
    SELECT process_key, owner_position_id
      FROM practice_process_settings
     WHERE tenant_id = ${tenantId}::uuid AND owner_position_id IS NOT NULL
  `)).rows as Array<{ process_key: string; owner_position_id: string }>;

  const sops = (await tx.execute(sql`
    SELECT l.target_key, s.id, s.title
      FROM sop_links l
      JOIN sops s ON s.id = l.sop_id AND s.tenant_id = l.tenant_id
     WHERE l.tenant_id = ${tenantId}::uuid AND l.target_kind = 'position' AND s.deleted_at IS NULL
     ORDER BY s.title ASC
  `)).rows as Array<{ target_key: string; id: string; title: string }>;

  const asList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const processOrder = new Map(PRACTICE_PROCESSES.map((p, i) => [p.key, i]));

  return positions.map((p) => ({
    id: p.id,
    key: p.key,
    title: p.title,
    purpose: p.purpose,
    results: asList(p.results),
    approvals: asList(p.approvals),
    sort: Number(p.sort ?? 0),
    holders: holders
      .filter((h) => h.position_id === p.id)
      .map((h) => ({ userId: h.user_id, name: h.name, avatarUrl: h.avatar_url, roles: h.roles ?? [] })),
    processes: processes
      .filter((s) => s.owner_position_id === p.id)
      .map((s) => ({ key: s.process_key, name: PROCESS_BY_KEY.get(s.process_key)?.name ?? s.process_key }))
      .sort((a, b) => (processOrder.get(a.key) ?? 99) - (processOrder.get(b.key) ?? 99)),
    sops: sops.filter((s) => s.target_key === p.id).map((s) => ({ id: s.id, title: s.title })),
  }));
}

export type SeedResult = { positionsCreated: number; holdersAdded: number; processesAssigned: number };

/**
 * Start the firm on the standard MFD positions. Idempotent:
 *   - inserts the DEFAULT_POSITIONS whose key the firm does not have;
 *   - suggests holders for a default position that has none — every active
 *     user holding one of the position's CRM roles (owner → Owner / Director);
 *   - gives each core process with no settings row yet to the position its
 *     catalog names as default owner.
 * Nothing the firm has already set is changed.
 */
export async function seedDefaultPositions(tx: Tx, tenantId: string): Promise<SeedResult> {
  const existing = (await tx.execute(sql`
    SELECT id, key FROM practice_positions WHERE tenant_id = ${tenantId}::uuid
  `)).rows as Array<{ id: string; key: string }>;
  const idByKey = new Map(existing.map((r) => [r.key, r.id]));

  let positionsCreated = 0;
  for (const [i, d] of DEFAULT_POSITIONS.entries()) {
    if (idByKey.has(d.key)) continue;
    const [row] = await tx
      .insert(practicePositions)
      .values({
        tenantId, key: d.key, title: d.title, purpose: d.purpose,
        results: d.results, approvals: d.approvals, sort: (i + 1) * 10,
      })
      .onConflictDoNothing()
      .returning({ id: practicePositions.id });
    if (row) { idByKey.set(d.key, row.id); positionsCreated++; }
  }

  const held = new Set(((await tx.execute(sql`
    SELECT DISTINCT position_id FROM practice_position_holders WHERE tenant_id = ${tenantId}::uuid
  `)).rows as Array<{ position_id: string }>).map((r) => r.position_id));

  const team = (await tx.execute(sql`
    SELECT id, roles FROM users WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
  `)).rows as Array<{ id: string; roles: string[] | null }>;

  let holdersAdded = 0;
  for (const d of DEFAULT_POSITIONS) {
    const positionId = idByKey.get(d.key);
    if (!positionId || held.has(positionId)) continue;
    const userIds = team.filter((u) => (u.roles ?? []).some((r) => d.roles.includes(r))).map((u) => u.id);
    if (!userIds.length) continue;
    const added = await tx
      .insert(practicePositionHolders)
      .values(userIds.map((userId) => ({ tenantId, positionId, userId })))
      .onConflictDoNothing()
      .returning({ id: practicePositionHolders.id });
    holdersAdded += added.length;
  }

  const configured = new Set(((await tx.execute(sql`
    SELECT process_key FROM practice_process_settings WHERE tenant_id = ${tenantId}::uuid
  `)).rows as Array<{ process_key: string }>).map((r) => r.process_key));

  let processesAssigned = 0;
  for (const p of PRACTICE_PROCESSES) {
    if (configured.has(p.key)) continue;
    const ownerPositionId = idByKey.get(p.defaultOwner);
    if (!ownerPositionId) continue;
    const added = await tx
      .insert(practiceProcessSettings)
      .values({ tenantId, processKey: p.key, ownerPositionId })
      .onConflictDoNothing()
      .returning({ id: practiceProcessSettings.id });
    processesAssigned += added.length;
  }

  return { positionsCreated, holdersAdded, processesAssigned };
}

/** The tenant's position keys, for picking a unique key for a new one. */
export async function takenPositionKeys(tx: Tx, tenantId: string): Promise<string[]> {
  return ((await tx.execute(sql`
    SELECT key FROM practice_positions WHERE tenant_id = ${tenantId}::uuid
  `)).rows as Array<{ key: string }>).map((r) => r.key);
}

/** Of `userIds`, those that are active users of the tenant. */
export async function activeTenantUsers(tx: Tx, tenantId: string, userIds: string[]): Promise<string[]> {
  if (!userIds.length) return [];
  const rows = (await tx.execute(sql`
    SELECT id FROM users
     WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
       AND id IN (${sql.join(userIds.map((u) => sql`${u}::uuid`), sql`, `)})
  `)).rows as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** Replace a position's holders. The caller has checked the ids are active users. */
export async function replaceHolders(tx: Tx, tenantId: string, positionId: string, userIds: string[]): Promise<void> {
  await tx.execute(sql`
    DELETE FROM practice_position_holders
     WHERE tenant_id = ${tenantId}::uuid AND position_id = ${positionId}::uuid
  `);
  if (!userIds.length) return;
  await tx
    .insert(practicePositionHolders)
    .values(userIds.map((userId) => ({ tenantId, positionId, userId })))
    .onConflictDoNothing();
}

/** Active team members, for the holder picker. */
export async function loadTeamForPositions(tx: Tx, tenantId: string): Promise<PositionHolder[]> {
  const rows = (await tx.execute(sql`
    SELECT id, name, avatar_url, roles FROM users
     WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
       AND NOT ('platform_admin' = ANY(roles)) AND NOT ('platform_support' = ANY(roles)) AND NOT ('investor' = ANY(roles))
     ORDER BY name ASC
  `)).rows as Array<{ id: string; name: string; avatar_url: string | null; roles: string[] | null }>;
  return rows.map((r) => ({ userId: r.id, name: r.name, avatarUrl: r.avatar_url, roles: r.roles ?? [] }));
}
