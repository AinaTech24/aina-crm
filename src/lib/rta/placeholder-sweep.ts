/**
 * Retire the registrar placeholders nothing needs any more.
 *
 * A report with no PAN column (CAMS WBR22, the monthly AUM statement) stands
 * up a PAN-less PLACEHOLDER client (`rta_nopan_key` 'NOPAN:…') for a folio the
 * book does not hold yet. When the folio master later hands that folio to the
 * real, PAN-keyed client, lib/rta/former-owners.ts merges the emptied
 * placeholder into it. Anything that empties a placeholder another way — the
 * imports that ran before that fix, a folio moved by hand, a repair script —
 * leaves the client list showing the person twice: once with a PAN, once
 * without, the second spelt the way the AUM statement spelt it.
 *
 * Measured on Nimesh C Shah Financial Services, 14 Oct 2026: 130 such twins,
 * all made in one second by the AUM statement of 6 Oct, ahead of the master.
 * They had survived the 8 Oct repair because only an EXACT name could choose
 * the client to merge into ("Behnaz Porus Dastur" beside "BEHNAZ PORAS
 * DASTUR").
 *
 * An empty placeholder needs no merge target: there is nothing on it to keep.
 * So a placeholder is moved to the Trash (restorable, like any deleted
 * client) when ALL of these hold:
 *   - no PAN, an importer's 'NOPAN:' key, live, older than an hour (an import
 *     still running is never raced);
 *   - no row anywhere refers to it — every column named investor_id,
 *     related_investor_id, guardian_investor_id, primary_investor_id,
 *     merged_into_id, survivor_id, loser_id, subject_id or entity_id, found
 *     from the schema itself, so a table added later is covered without a
 *     change here;
 *   - no person ever edited it (audit_log by a user);
 *   - and if it sits in a family, that family also holds a live client with a
 *     PAN whose name is the same person's (lib/investors/duplicate-clusters
 *     similarNames) — so retiring it never takes someone out of their family.
 * A placeholder that holds anything at all is left alone: choosing the client
 * it belongs to is a person's call (Merge Clients suggests the likely one).
 *
 * What does NOT count as a person's work (15 Oct 2026, Nimesh C Shah's
 * "Dilip Manilal Modi Huf (Huf)", beside "Dilip Manilal Modi Huf", both in the
 * Modi family): the family's own bookkeeping — changing the head's address
 * wrote `investor.details_from_family` on every member, in the user's
 * request, and a queued notification (events_outbox) named the record. Both
 * made the sweep read an empty twin as "someone's work" and keep it.
 *
 * The retired row loses its NOPAN key, so a later file for that name cannot
 * attach a folio to a client in the Trash; it stands up a fresh placeholder
 * instead, and the folio master settles that one as usual.
 */

import { sql } from "drizzle-orm";
import { withTenant, type Tx } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { similarNames } from "@/lib/investors/duplicate-clusters";

/** Tables whose rows only NOTIFY about a client; trashing the client loses nothing they hold. */
const NOTIFICATION_TABLES = new Set(["events_outbox"]);

/** Audit actions the system writes on its own when a family changes — not a person editing the client. */
const AUTOMATIC_AUDIT_ACTIONS = ["investor.details_from_family", "investor.rm_from_family_head"];

/** Columns that point at a client, wherever they appear. */
const REF_COLUMNS = [
  "investor_id", "related_investor_id", "guardian_investor_id", "primary_investor_id",
  "merged_into_id", "survivor_id", "loser_id", "subject_id", "entity_id",
];

export type EmptyPlaceholder = { id: string; name: string; rta_nopan_key: string };

const uuidArray = (ids: string[]) => `{${ids.join(",")}}`;

/**
 * The placeholders of one firm that hold nothing and that nothing refers to.
 * Returns [] when any referencing table cannot be read — emptiness that can't
 * be proven is not assumed.
 */
export async function findEmptyPlaceholders(
  tx: Tx,
  tenantId: string,
  opts: { minAgeMinutes?: number } = {},
): Promise<EmptyPlaceholder[]> {
  const minAge = opts.minAgeMinutes ?? 60;
  const cands = (await tx.execute(sql`
    SELECT id::text AS id, name, rta_nopan_key, family_id::text AS family_id FROM investors
     WHERE tenant_id = ${tenantId}::uuid AND pan IS NULL AND rta_nopan_key LIKE 'NOPAN:%'
       AND deleted_at IS NULL AND merged_into_id IS NULL
       AND created_at < now() - make_interval(mins => ${minAge}::int)
  `)).rows as Array<EmptyPlaceholder & { family_id: string | null }>;
  if (!cands.length) return [];

  const cols = (await tx.execute(sql`
    SELECT c.table_name, c.column_name, c.data_type,
           EXISTS (SELECT 1 FROM information_schema.columns t
                    WHERE t.table_schema = 'public' AND t.table_name = c.table_name AND t.column_name = 'tenant_id') AS has_tenant
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public'
       AND c.column_name IN (${sql.join(REF_COLUMNS.map((k) => sql`${k}`), sql`, `)})
       AND c.data_type IN ('uuid', 'text', 'character varying')
     ORDER BY c.table_name, c.column_name
  `)).rows as Array<{ table_name: string; column_name: string; data_type: string; has_tenant: boolean }>;

  const left = new Set(cands.map((c) => c.id));
  for (const col of cols) {
    if (!left.size) break;
    // The audit trail is read below: only a PERSON's edit keeps a placeholder.
    if (col.table_name === "audit_log" || NOTIFICATION_TABLES.has(col.table_name)) continue;
    const ids = [...left];
    const column = sql.raw(`"${col.column_name}"`);
    const match = col.data_type === "uuid"
      ? sql`${column} = ANY(${uuidArray(ids)}::uuid[])`
      : sql`${column} = ANY(${uuidArray(ids)}::text[])`;
    await tx.execute(sql`SAVEPOINT placeholder_refs`);
    try {
      const rows = (await tx.execute(sql`
        SELECT DISTINCT ${column}::text AS id FROM ${sql.raw(`"${col.table_name}"`)}
         WHERE ${match} ${col.has_tenant ? sql`AND tenant_id = ${tenantId}::uuid` : sql``}
      `)).rows as Array<{ id: string }>;
      await tx.execute(sql`RELEASE SAVEPOINT placeholder_refs`);
      for (const r of rows) left.delete(r.id);
    } catch {
      await tx.execute(sql`ROLLBACK TO SAVEPOINT placeholder_refs`);
      return [];
    }
  }
  if (left.size) {
    const touched = (await tx.execute(sql`
      SELECT DISTINCT entity_id::text AS id FROM audit_log
       WHERE tenant_id = ${tenantId}::uuid AND entity_type = 'investor'
         AND entity_id = ANY(${uuidArray([...left])}::uuid[])
         AND actor_user_id IS NOT NULL
         AND action <> ALL(${uuidArray(AUTOMATIC_AUDIT_ACTIONS)}::text[])
    `)).rows as Array<{ id: string }>;
    for (const r of touched) left.delete(r.id);
  }

  // A placeholder in a family leaves only if the family still holds that
  // person under their PAN — otherwise they would silently drop out of it.
  const inFamily = cands.filter((c) => left.has(c.id) && c.family_id);
  if (inFamily.length) {
    const twins = (await tx.execute(sql`
      SELECT family_id::text AS family_id, name FROM investors
       WHERE tenant_id = ${tenantId}::uuid AND family_id = ANY(${uuidArray([...new Set(inFamily.map((c) => c.family_id!))])}::uuid[])
         AND pan IS NOT NULL AND deleted_at IS NULL AND merged_into_id IS NULL
    `)).rows as Array<{ family_id: string; name: string }>;
    for (const c of inFamily) {
      if (!twins.some((t) => t.family_id === c.family_id && similarNames(c.name, t.name))) left.delete(c.id);
    }
  }
  return cands.filter((c) => left.has(c.id)).map(({ id, name, rta_nopan_key }) => ({ id, name, rta_nopan_key }));
}

/** Move these placeholders to the Trash, one audit row each. Returns how many moved. */
export async function retirePlaceholders(tx: Tx, tenantId: string, list: EmptyPlaceholder[]): Promise<number> {
  let moved = 0;
  for (let i = 0; i < list.length; i += 200) {
    const part = list.slice(i, i + 200);
    const done = (await tx.execute(sql`
      UPDATE investors
         SET deleted_at = now(), deleted_by = NULL, rta_nopan_key = NULL, updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${uuidArray(part.map((p) => p.id))}::uuid[])
         AND pan IS NULL AND deleted_at IS NULL AND merged_into_id IS NULL
      RETURNING id::text AS id
    `)).rows as Array<{ id: string }>;
    const byId = new Map(part.map((p) => [p.id, p]));
    for (const { id } of done) {
      const p = byId.get(id)!;
      await recordAudit(tx, {
        tenantId,
        actorUserId: null,
        actorType: "system",
        action: "investor.trash",
        entityType: "investor",
        entityId: id,
        before: { name: p.name, rtaNopanKey: p.rta_nopan_key },
        after: { reason: "empty_registrar_placeholder" },
      });
    }
    moved += done.length;
  }
  return moved;
}

/** Find and retire in one go — what the import worker and the nightly scan call. */
export async function retireEmptyPlaceholders(tx: Tx, tenantId: string): Promise<number> {
  const list = await findEmptyPlaceholders(tx, tenantId);
  return list.length ? retirePlaceholders(tx, tenantId, list) : 0;
}

/** After an RTA import. Best effort — never fails the import. */
export async function retireEmptyPlaceholdersAfterImport(tenantId: string | null | undefined): Promise<void> {
  if (!tenantId) return;
  try {
    const n = await withTenant(tenantId, (tx) => retireEmptyPlaceholders(tx, tenantId), { roles: ["system"] });
    if (n) console.log(`[rta] moved ${n} empty registrar placeholder(s) to the Trash for ${tenantId}`);
  } catch (e) {
    console.warn(`[rta] retiring empty placeholders failed for ${tenantId}:`, (e as Error)?.message);
  }
}
