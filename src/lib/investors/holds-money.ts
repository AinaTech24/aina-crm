/**
 * A client who still holds money with the registrar is never in the Trash.
 *
 * "Holds money" = a folio with a value, or an active SIP. Such a client is a
 * live client whatever anyone clicked: in the Trash their AUM drops out of
 * every figure, every new registrar file keeps loading their transactions onto
 * a record nobody can see, and after the retention window (30 days) the
 * nightly purge would ERASE their folios and history for good.
 *
 * Measured on Nimesh C Shah Financial Services, 14 Oct 2026: "Thakor Rushin
 * Jitendrabhai" (13 folios, Rs 28.33 L, 944 transactions, 16 SIPs) was
 * bulk-deleted on 8 Oct together with his PAN-less registrar twin — the twin
 * was the one meant to go. Ahpal had three more such clients (Rs 43 L), and
 * Attitude one with a running SIP.
 *
 * So:
 *   - deleting (one, or in bulk) leaves a money-holding client where it is
 *     and says why: a duplicate is MERGED (which moves the folios), a client
 *     who has left is marked Closed or Exited;
 *   - purging (by hand, Empty Trash, or the nightly retention purge) skips
 *     them;
 *   - after every RTA import and in the nightly ops scan, a client in the
 *     Trash who holds money is restored, with an audit row saying why.
 */

import { sql, type SQL } from "drizzle-orm";
import { withTenant, type Tx } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { rtaWriteDenial } from "@/lib/rta/write-guard";

/** True when the client row `alias` holds money with the registrar. */
export function holdsMoneySql(alias = "i"): SQL {
  const a = sql.raw(alias);
  return sql`(EXISTS (SELECT 1 FROM folios hm_f WHERE hm_f.tenant_id = ${a}.tenant_id AND hm_f.investor_id = ${a}.id AND COALESCE(hm_f.aum, 0) > 0)
           OR EXISTS (SELECT 1 FROM sips hm_s WHERE hm_s.tenant_id = ${a}.tenant_id AND hm_s.investor_id = ${a}.id AND hm_s.status = 'active'))`;
}

export type MoneyHolder = { id: string; name: string; aum: number; folios: number; activeSips: number };

/** Which of `ids` hold money with the registrar. */
export async function clientsHoldingMoney(tx: Tx, tenantId: string, ids: string[]): Promise<MoneyHolder[]> {
  if (!ids.length) return [];
  const rows = (await tx.execute(sql`
    SELECT i.id::text AS id, i.name,
           (SELECT COALESCE(sum(f.aum), 0) FROM folios f WHERE f.tenant_id = i.tenant_id AND f.investor_id = i.id)::numeric AS aum,
           (SELECT count(*) FROM folios f WHERE f.tenant_id = i.tenant_id AND f.investor_id = i.id AND COALESCE(f.aum, 0) > 0)::int AS folios,
           (SELECT count(*) FROM sips s WHERE s.tenant_id = i.tenant_id AND s.investor_id = i.id AND s.status = 'active')::int AS active_sips
      FROM investors i
     WHERE i.tenant_id = ${tenantId}::uuid AND i.id = ANY(${`{${ids.join(",")}}`}::uuid[])
       AND ${holdsMoneySql("i")}
  `)).rows as Array<{ id: string; name: string; aum: string; folios: number; active_sips: number }>;
  return rows.map((r) => ({ id: r.id, name: r.name, aum: Number(r.aum), folios: r.folios, activeSips: r.active_sips }));
}

const lakh = (n: number) => `₹${(n / 1e5).toLocaleString("en-IN", { maximumFractionDigits: 2 })} L`;

/** What holds one of them, in words: "₹28.33 L in 13 folios and 16 active SIPs". */
function holding(h: MoneyHolder): string {
  const parts: string[] = [];
  if (h.aum > 0) parts.push(`${lakh(h.aum)} in ${h.folios} folio${h.folios === 1 ? "" : "s"}`);
  if (h.activeSips) parts.push(`${h.activeSips} active SIP${h.activeSips === 1 ? "" : "s"}`);
  return parts.join(" and ");
}

/** The refusal shown to a person who tried to delete money-holding clients. */
export function holdersMessage(list: MoneyHolder[]): string {
  const named = list.slice(0, 3).map((h) => `${h.name} (${holding(h)})`).join(", ");
  const more = list.length > 3 ? ` and ${list.length - 3} more` : "";
  const who = list.length === 1 ? "This client still holds" : "These clients still hold";
  return `${who} money with the registrar, so ${list.length === 1 ? "it was" : "they were"} not deleted: ${named}${more}. ` +
    `If it is a duplicate, merge it in Merge Clients (the folios move with it). If the client has left, set the status to Closed or Exited.`;
}

/** Bring every money-holding client of the firm back out of the Trash. Returns how many. */
export async function restoreTrashedHolders(tx: Tx, tenantId: string): Promise<number> {
  // With the RTA release this is a `derived` writer (it acts on registrar
  // holdings): a firm whose RTA writes are stopped — paused, halted, held — is
  // left exactly as it is, like the placeholder sweep and merges.
  if (await rtaWriteDenial(tx, tenantId, "derived")) return 0;
  const trashed = (await tx.execute(sql`
    SELECT i.id::text AS id FROM investors i
     WHERE i.tenant_id = ${tenantId}::uuid AND i.deleted_at IS NOT NULL AND i.merged_into_id IS NULL
       AND ${holdsMoneySql("i")}
  `)).rows as Array<{ id: string }>;
  if (!trashed.length) return 0;
  const holders = await clientsHoldingMoney(tx, tenantId, trashed.map((t) => t.id));
  const back = (await tx.execute(sql`
    UPDATE investors SET deleted_at = NULL, deleted_by = NULL, updated_at = now()
     WHERE tenant_id = ${tenantId}::uuid AND id = ANY(${`{${holders.map((h) => h.id).join(",")}}`}::uuid[])
       AND deleted_at IS NOT NULL AND merged_into_id IS NULL
    RETURNING id::text AS id
  `)).rows as Array<{ id: string }>;
  const byId = new Map(holders.map((h) => [h.id, h]));
  for (const { id } of back) {
    const h = byId.get(id)!;
    await recordAudit(tx, {
      tenantId,
      actorUserId: null,
      actorType: "system",
      action: "investor.restore",
      entityType: "investor",
      entityId: id,
      after: { reason: "holds_money_with_registrar", aum: h.aum, folios: h.folios, activeSips: h.activeSips },
    });
  }
  return back.length;
}

/** After an RTA import. Best effort — never fails the import. */
export async function restoreTrashedHoldersAfterImport(tenantId: string | null | undefined): Promise<void> {
  if (!tenantId) return;
  try {
    const n = await withTenant(tenantId, (tx) => restoreTrashedHolders(tx, tenantId), { roles: ["system"] });
    if (n) console.log(`[rta] restored ${n} client(s) from the Trash who hold money with the registrar, for ${tenantId}`);
  } catch (e) {
    console.warn(`[rta] restoring money-holding clients failed for ${tenantId}:`, (e as Error)?.message);
  }
}
