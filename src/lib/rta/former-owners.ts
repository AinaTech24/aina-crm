/**
 * What happens to a client when an import hands their folios to someone else.
 *
 * A report with no PAN column (CAMS WBR22, the monthly AUM statement) cannot
 * match a folio the book does not hold yet, so it stands up a PLACEHOLDER
 * client keyed on the investor's name (`rta_nopan_key` 'NOPAN:…') and values
 * the folio under it. When the folio master arrives it adopts that folio for
 * the real, PAN-keyed client — and until now the placeholder was simply left
 * behind with the AUM it had been given, because nothing ever revalued a
 * client who LOST folios, and the AUM recompute deliberately keeps a cached
 * figure for anyone with no holdings at all.
 *
 * Measured on Nimesh C Shah Financial Services, 6 Oct 2026: the AUM statement
 * ran four minutes before the CAMS master (both re-queued when the mailback
 * password was saved), leaving 645 empty placeholders — 513 of them still
 * carrying Rs 52.87 Cr — so the dashboard showed Rs 190.84 Cr against the
 * Rs 138 Cr the folios add up to, and 645 clients too many.
 *
 * So, after the folio upsert:
 *   - a placeholder left with no folio and no transaction is MERGED into the
 *     client who took most of its folios (the ordinary, logged and reversible
 *     merge — its AUM is zeroed and anything still pointing at it moves);
 *   - any other former owner is revalued from what it still holds, and zeroed
 *     when it holds nothing, since every rupee of its cached AUM came from the
 *     folios it just gave up.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { mergeInvestors } from "@/lib/investors/merge";
import { recomputeInvestorAum } from "@/lib/finance/aum-persist";

/** investor id → the folio numbers it owns among `folioNumbers`. */
export type FolioOwners = Map<string, Set<string>>;

const chunk = <T,>(arr: T[], n: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/** Who owns these folio numbers right now. Call it BEFORE the folio upsert. */
export async function ownersOfFolios(tx: Tx, tenantId: string, folioNumbers: string[]): Promise<FolioOwners> {
  const owners: FolioOwners = new Map();
  const unique = [...new Set(folioNumbers.filter(Boolean))];
  for (const part of chunk(unique, 500)) {
    const rows = (await tx.execute(sql`
      SELECT folio_number, investor_id FROM folios
       WHERE tenant_id = ${tenantId}::uuid AND investor_id IS NOT NULL
         AND folio_number IN (${sql.join(part.map((f) => sql`${f}`), sql`, `)})
    `)).rows as Array<{ folio_number: string; investor_id: string }>;
    for (const r of rows) {
      const id = String(r.investor_id);
      if (!owners.has(id)) owners.set(id, new Set());
      owners.get(id)!.add(String(r.folio_number));
    }
  }
  return owners;
}

export type ReleaseSummary = { merged: number; revalued: number };

/**
 * After the upsert: settle every former owner that no longer holds one of the
 * folios it held before (`before` from {@link ownersOfFolios}).
 */
export async function releaseFormerOwners(
  tx: Tx,
  tenantId: string,
  before: FolioOwners,
  byUserId: string | null = null,
): Promise<ReleaseSummary> {
  const summary: ReleaseSummary = { merged: 0, revalued: 0 };
  if (!before.size) return summary;

  const allFolios = [...new Set([...before.values()].flatMap((s) => [...s]))];
  const now = await ownersOfFolios(tx, tenantId, allFolios);
  // folio number → its owners after the upsert
  const ownersByFolio = new Map<string, string[]>();
  for (const [id, set] of now) for (const f of set) ownersByFolio.set(f, [...(ownersByFolio.get(f) ?? []), id]);

  const losers = [...before.entries()]
    .map(([id, folios]) => ({ id, gone: [...folios].filter((f) => !(now.get(id)?.has(f))) }))
    .filter((l) => l.gone.length > 0);
  if (!losers.length) return summary;

  const state = (await tx.execute(sql`
    SELECT i.id, i.pan, i.rta_nopan_key, i.merged_into_id, i.deleted_at,
           EXISTS (SELECT 1 FROM folios f WHERE f.investor_id = i.id) AS has_folio,
           EXISTS (SELECT 1 FROM transactions x WHERE x.investor_id = i.id) AS has_txn
      FROM investors i
     WHERE i.tenant_id = ${tenantId}::uuid
       AND i.id IN (${sql.join(losers.map((l) => sql`${l.id}::uuid`), sql`, `)})
  `)).rows as Array<{
    id: string; pan: string | null; rta_nopan_key: string | null; merged_into_id: string | null;
    deleted_at: string | null; has_folio: boolean; has_txn: boolean;
  }>;
  const byId = new Map(state.map((s) => [String(s.id), s]));

  for (const loser of losers) {
    const s = byId.get(loser.id);
    if (!s || s.merged_into_id || s.deleted_at) continue;
    const empty = !s.has_folio && !s.has_txn;
    const placeholder = !s.pan && (s.rta_nopan_key ?? "").startsWith("NOPAN:");

    if (empty && placeholder) {
      // The client who took most of its folios.
      const tally = new Map<string, number>();
      for (const f of loser.gone) for (const o of ownersByFolio.get(f) ?? []) if (o !== loser.id) tally.set(o, (tally.get(o) ?? 0) + 1);
      const survivorId = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (survivorId) {
        const res = await mergeInvestors(tx, {
          tenantId,
          survivorId,
          loserId: loser.id,
          byUserId,
          source: "import",
          reason: "Placeholder from a registrar report with no PAN; the folio master matched its folios to this client",
        });
        if ("ok" in res) {
          summary.merged++;
          continue;
        }
      }
    }

    if (empty) {
      // Everything it was worth sat in the folios it just gave up.
      await tx.execute(sql`
        UPDATE investors SET aum = 0, updated_at = now()
         WHERE id = ${loser.id}::uuid AND tenant_id = ${tenantId}::uuid AND COALESCE(aum, 0) <> 0
      `);
    } else {
      await recomputeInvestorAum(tx, loser.id);
    }
    summary.revalued++;
  }
  return summary;
}
