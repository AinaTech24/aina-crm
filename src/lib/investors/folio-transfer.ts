/**
 * Move chosen folios from one client to another — the "I only want some of
 * this profile's holdings on the other one" half of fixing a duplicate.
 * SERVER-ONLY. (A whole-record merge is `mergeInvestors` in ./merge.ts.)
 *
 * A folio belongs to exactly one client (unique on tenant + AMC + folio
 * number), so the unit that moves is the FOLIO; the schemes inside it are
 * shown so the operator can see what is travelling. History follows the folio,
 * as in an RTA import (lib/rta/former-owners.ts): its transactions and SIPs are
 * re-pointed too, unless the caller asks to leave them.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { recomputeInvestorsAum } from "@/lib/finance/aum-persist";
import { MERGEABLE_FIELDS, blankSql, presentMergeFields } from "@/lib/investors/merge";

export type TransferFolio = {
  id: string;
  folioNumber: string;
  amcName: string;
  aum: number;
  schemes: Array<{ name: string; units: number | null; value: number | null }>;
  transactions: number;
  activeSips: number;
};

export type TransferClient = {
  id: string;
  name: string;
  pan: string | null;
  merged: boolean;
  /** The client's relationship manager, for the whole-record merge dialog. */
  rmName: string | null;
  folios: TransferFolio[];
};

export async function loadTransferClients(tx: Tx, tenantId: string, ids: string[]): Promise<TransferClient[]> {
  const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const people = (await tx.execute(sql`
    SELECT i.id::text AS id, i.name, upper(nullif(trim(i.pan), '')) AS pan, i.merged_into_id IS NOT NULL AS merged,
           u.name AS "rmName"
      FROM investors i LEFT JOIN users u ON u.id = i.rm_id
     WHERE i.tenant_id = ${tenantId}::uuid AND i.id IN (${list}) AND i.deleted_at IS NULL
  `)).rows as Array<{ id: string; name: string; pan: string | null; merged: boolean; rmName: string | null }>;
  const folios = (await tx.execute(sql`
    SELECT f.id::text AS id, f.investor_id::text AS investor_id, f.folio_number, f.amc_name,
           COALESCE(f.aum, 0)::float8 AS aum, f.schemes,
           (SELECT count(*) FROM transactions t WHERE t.tenant_id = f.tenant_id AND t.folio_id = f.id)::int AS txns,
           (SELECT count(*) FROM sips s WHERE s.tenant_id = f.tenant_id AND s.folio_id = f.id AND s.status = 'active')::int AS sips
      FROM folios f
     WHERE f.tenant_id = ${tenantId}::uuid AND f.investor_id IN (${list})
     ORDER BY f.amc_name, f.folio_number
  `)).rows as Array<{
    id: string; investor_id: string; folio_number: string; amc_name: string; aum: number;
    schemes: Array<{ schemeName?: string; schemeCode?: string; units?: number; value?: number }> | null;
    txns: number; sips: number;
  }>;
  return people.map((p) => ({
    ...p,
    folios: folios
      .filter((f) => f.investor_id === p.id)
      .map((f) => ({
        id: f.id,
        folioNumber: f.folio_number,
        amcName: f.amc_name,
        aum: Number(f.aum),
        schemes: (Array.isArray(f.schemes) ? f.schemes : []).map((s) => ({
          name: String(s?.schemeName ?? s?.schemeCode ?? "Scheme"),
          units: s?.units != null ? Number(s.units) : null,
          value: s?.value != null ? Number(s.value) : null,
        })),
        transactions: f.txns,
        activeSips: f.sips,
      })),
  }));
}

export type TransferResult =
  | { ok: true; folios: number; transactions: number; sips: number }
  | { error: string; code?: "pan_mismatch" };

export async function transferFolios(
  tx: Tx,
  a: {
    tenantId: string;
    fromId: string;
    toId: string;
    folioIds: string[];
    moveHistory: boolean;
    allowPanMismatch?: boolean;
    /**
     * Client fields (MERGEABLE_FIELDS keys) whose value the receiving profile takes
     * from the one the folios leave — the operator's picks in the dialog. Only these
     * are written, and a blank on the source never blanks the receiver.
     */
    fieldPicks?: string[];
    byUserId: string;
  },
): Promise<TransferResult> {
  const { tenantId, fromId, toId } = a;
  const folioIds = [...new Set(a.folioIds)];
  if (fromId === toId) return { error: "choose two different clients" };
  if (!folioIds.length && !(a.fieldPicks ?? []).length) return { error: "choose at least one folio to move, or a field value to take" };

  const people = (await tx.execute(sql`
    SELECT id::text AS id, upper(nullif(trim(pan), '')) AS pan, merged_into_id IS NOT NULL AS merged
      FROM investors
     WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND id IN (${fromId}::uuid, ${toId}::uuid)
  `)).rows as Array<{ id: string; pan: string | null; merged: boolean }>;
  if (people.length !== 2) return { error: "client not found" };
  if (people.some((p) => p.merged)) return { error: "a selected client is already merged" };
  const fromPan = people.find((p) => p.id === fromId)?.pan;
  const toPan = people.find((p) => p.id === toId)?.pan;
  if (fromPan && toPan && fromPan !== toPan && !a.allowPanMismatch) {
    return { error: `These clients have different PANs (${fromPan} and ${toPan}), so they may be different people.`, code: "pan_mismatch" };
  }

  const fl = sql.join(folioIds.map((i) => sql`${i}::uuid`), sql`, `);
  // No folio ticked is allowed when the operator only picked field values to take.
  const moved = folioIds.length
    ? ((await tx.execute(sql`
        UPDATE folios SET investor_id = ${toId}::uuid, updated_at = now()
         WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${fromId}::uuid AND id IN (${fl})
        RETURNING id::text AS id
      `)).rows as Array<{ id: string }>)
    : [];
  if (moved.length !== folioIds.length) return { error: "a chosen folio no longer belongs to the first client — reload and try again" };

  let transactions = 0;
  let sips = 0;
  if (a.moveHistory && folioIds.length) {
    transactions = ((await tx.execute(sql`
      UPDATE transactions SET investor_id = ${toId}::uuid, updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${fromId}::uuid AND folio_id IN (${fl}) RETURNING id
    `)).rows).length;
    sips = ((await tx.execute(sql`
      UPDATE sips SET investor_id = ${toId}::uuid, updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${fromId}::uuid AND folio_id IN (${fl}) RETURNING id
    `)).rows).length;
  }

  // The operator's per-field picks: the receiving profile takes THESE values from the other one.
  let fieldsTaken: string[] = [];
  let fieldsBefore: Record<string, unknown> | null = null;
  const wanted = new Set((a.fieldPicks ?? []).filter((k) => (MERGEABLE_FIELDS as readonly string[]).includes(k)));
  if (wanted.size) {
    const present = (await presentMergeFields(tx)).filter((f) => wanted.has(f.key));
    if (present.length) {
      const keyList = sql.join(present.map((f) => sql`${f.key}`), sql`, `);
      fieldsBefore =
        ((await tx.execute(sql`
          SELECT (SELECT jsonb_object_agg(k, v) FROM jsonb_each(to_jsonb(i)) AS e(k, v) WHERE k IN (${keyList})) AS before
            FROM investors i WHERE i.id = ${toId}::uuid
        `)).rows[0] as { before: Record<string, unknown> | null } | undefined)?.before ?? null;
      const assignments = present.map((f) => {
        const col = sql.raw(`"${f.key}"`);
        return sql`${col} = CASE WHEN ${blankSql("l", f)} THEN s.${col} ELSE l.${col} END`;
      });
      await tx.execute(sql`
        UPDATE investors s SET ${sql.join(assignments, sql`, `)}, updated_at = now()
          FROM investors l
         WHERE s.tenant_id = ${tenantId}::uuid AND s.id = ${toId}::uuid AND l.tenant_id = ${tenantId}::uuid AND l.id = ${fromId}::uuid
      `);
      fieldsTaken = present.map((f) => f.key);
    }
  }

  await recomputeInvestorsAum(tx, [fromId, toId]);
  await recordAudit(tx, {
    tenantId,
    actorUserId: a.byUserId,
    action: "investor.folio_transfer",
    entityType: "investor",
    entityId: toId,
    ...(fieldsBefore ? { before: { fieldsBefore } } : {}),
    after: { fromId, toId, folioIds, moveHistory: a.moveHistory, transactions, sips, ...(fieldsTaken.length ? { fieldsTaken } : {}) },
  } as any);
  return { ok: true, folios: moved.length, transactions, sips };
}
