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
  folios: TransferFolio[];
};

export async function loadTransferClients(tx: Tx, tenantId: string, ids: string[]): Promise<TransferClient[]> {
  const list = sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `);
  const people = (await tx.execute(sql`
    SELECT id::text AS id, name, upper(nullif(trim(pan), '')) AS pan, merged_into_id IS NOT NULL AS merged
      FROM investors WHERE tenant_id = ${tenantId}::uuid AND id IN (${list}) AND deleted_at IS NULL
  `)).rows as Array<{ id: string; name: string; pan: string | null; merged: boolean }>;
  const folios = (await tx.execute(sql`
    SELECT f.id::text AS id, f.investor_id::text AS investor_id, f.folio_number, f.amc_name,
           COALESCE(f.aum, 0)::float8 AS aum, f.schemes,
           (SELECT count(*) FROM transactions t WHERE t.tenant_id = f.tenant_id AND t.folio_id = f.id)::int AS txns,
           (SELECT count(*) FROM sips s WHERE s.tenant_id = f.tenant_id AND s.folio_id = f.id AND s.status = 'active')::int AS sips
      FROM folios f
     WHERE f.tenant_id = ${tenantId}::uuid AND f.investor_id IN (${list})
     ORDER BY f.amc_name, f.folio_number
  `)).rows as any[];
  return people.map((p) => ({
    ...p,
    folios: folios
      .filter((f) => f.investor_id === p.id)
      .map((f) => ({
        id: f.id,
        folioNumber: f.folio_number,
        amcName: f.amc_name,
        aum: Number(f.aum),
        schemes: (Array.isArray(f.schemes) ? f.schemes : []).map((s: any) => ({
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
    byUserId: string;
  },
): Promise<TransferResult> {
  const { tenantId, fromId, toId } = a;
  const folioIds = [...new Set(a.folioIds)];
  if (fromId === toId) return { error: "choose two different clients" };
  if (!folioIds.length) return { error: "choose at least one folio to move" };

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
  const moved = (await tx.execute(sql`
    UPDATE folios SET investor_id = ${toId}::uuid, updated_at = now()
     WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${fromId}::uuid AND id IN (${fl})
    RETURNING id::text AS id
  `)).rows as Array<{ id: string }>;
  if (moved.length !== folioIds.length) return { error: "a chosen folio no longer belongs to the first client — reload and try again" };

  let transactions = 0;
  let sips = 0;
  if (a.moveHistory) {
    transactions = ((await tx.execute(sql`
      UPDATE transactions SET investor_id = ${toId}::uuid, updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${fromId}::uuid AND folio_id IN (${fl}) RETURNING id
    `)).rows).length;
    sips = ((await tx.execute(sql`
      UPDATE sips SET investor_id = ${toId}::uuid, updated_at = now()
       WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${fromId}::uuid AND folio_id IN (${fl}) RETURNING id
    `)).rows).length;
  }

  await recomputeInvestorsAum(tx, [fromId, toId]);
  await recordAudit(tx, {
    tenantId,
    actorUserId: a.byUserId,
    action: "investor.folio_transfer",
    entityType: "investor",
    entityId: toId,
    after: { fromId, toId, folioIds, moveHistory: a.moveHistory, transactions, sips },
  } as any);
  return { ok: true, folios: moved.length, transactions, sips };
}
