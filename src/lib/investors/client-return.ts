/**
 * A client who left comes back on their own (the firm's request, 2026-10-15).
 *
 * A client with no business today is marked Exited (or Closed) instead of
 * being deleted: the record keeps its history, family, RM, notes and
 * documents, and drops out of the client list and every dashboard count. A
 * client with no transaction for a year turns Dormant by itself (the nightly
 * ops scan). When that client invests again, nobody should have to notice and
 * re-add anything:
 *
 *   after every RTA import, a dormant / closed / exited client with new money
 *   from the registrar — an inflow transaction (purchase, SIP instalment)
 *   in the last 45 days, dated on or after the day they left — is set back
 *   to Active, the change is audited (`investor.reactivated`), and their RM
 *   is told ("… is back").
 *
 * Redemptions and rejected or cancelled transactions do not count as coming
 * back. `exited_at` / `dormant_since` are written by a trigger (migration
 * 0235) on every status change.
 */

import { sql, type SQL } from "drizzle-orm";
import { withTenant, type Tx } from "@/db/client";
import { recordAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";
import { formatDate } from "@/lib/format";

export type ReturnedClient = { id: string; name: string; rmId: string | null; was: string; investedOn: string };

const LABEL: Record<string, string> = { dormant: "Dormant", closed: "Closed", exited: "Exited" };

/** Set returning clients back to Active, audit it and tell their RM. */
export async function reactivateReturningClients(tx: Tx, tenantId: string): Promise<ReturnedClient[]> {
  const rows = (await tx.execute(sql`
    WITH back AS (
      SELECT i.id, i.name, i.rm_id, i.status AS was,
             (SELECT max(t.order_date) FROM transactions t
               WHERE t.tenant_id = i.tenant_id AND t.investor_id = i.id
                 AND t.direction = 'inflow'
                 AND COALESCE(t.status, '') NOT IN ('rejected', 'cancelled')
                 AND t.order_date >= current_date - 45
                 AND t.order_date >= COALESCE(i.exited_at, i.dormant_since, i.updated_at)::date) AS invested_on
        FROM investors i
       WHERE i.tenant_id = ${tenantId}::uuid
         AND i.deleted_at IS NULL AND i.merged_into_id IS NULL
         AND i.status IN ('dormant', 'closed', 'exited')
    )
    UPDATE investors SET status = 'active', updated_at = now()
      FROM back
     WHERE investors.id = back.id AND investors.tenant_id = ${tenantId}::uuid
       AND back.invested_on IS NOT NULL
    RETURNING investors.id::text AS id, back.name, back.rm_id::text AS rm_id, back.was, back.invested_on::text AS invested_on
  `)).rows as Array<{ id: string; name: string; rm_id: string | null; was: string; invested_on: string }>;

  for (const r of rows) {
    await recordAudit(tx, {
      tenantId,
      actorUserId: null,
      actorType: "system",
      action: "investor.reactivated",
      entityType: "investor",
      entityId: r.id,
      before: { status: r.was },
      after: { status: "active", reason: "new_investment", investedOn: r.invested_on },
    });
    if (r.rm_id) {
      await createNotification(tx, {
        tenantId,
        userId: r.rm_id,
        kind: "client.returned",
        title: `${r.name} is back`,
        body: `New investment on ${formatDate(r.invested_on)} — moved from ${LABEL[r.was] ?? r.was} to Active.`,
        linkUrl: `/dashboard/investors/${r.id}`,
        severity: "success",
      });
    }
  }
  return rows.map((r) => ({ id: r.id, name: r.name, rmId: r.rm_id, was: r.was, investedOn: r.invested_on }));
}

/** After an RTA import. Best effort — never fails the import. */
export async function reactivateReturningClientsAfterImport(tenantId: string | null | undefined): Promise<void> {
  if (!tenantId) return;
  try {
    const back = await withTenant(tenantId, (tx) => reactivateReturningClients(tx, tenantId), { roles: ["system"] });
    if (back.length) console.log(`[rta] ${back.length} client(s) back to Active after new money, for ${tenantId}`);
  } catch (e) {
    console.warn(`[rta] reactivating returning clients failed for ${tenantId}:`, (e as Error)?.message);
  }
}

export type ExistingClient = {
  /** Only when the person adding may see that client — otherwise just the state. */
  id: string | null;
  name: string | null;
  /** trash: deleted, restorable · exited: closed / exited · active: any other status. */
  state: "trash" | "exited" | "active";
};

/**
 * The client a PAN already belongs to — so "Add client" for someone who left
 * offers Reactivate (or Restore, from the Trash) instead of a second record.
 * Merges are followed to the surviving record. `visibleSql` is the viewer's
 * client scope over alias `i` (investorScopeSql); a client outside it is
 * reported only as existing, without a name. Build `visibleSql` over alias
 * "i2": investorScopeSql(tx, session, "i2").
 */
export async function existingClientForPan(tx: Tx, tenantId: string, pan: string, visibleSql: SQL): Promise<ExistingClient | null> {
  const p = pan.trim().toUpperCase();
  if (!p) return null;
  const row = (await tx.execute(sql`
    WITH RECURSIVE hit AS (
      SELECT i.id, i.merged_into_id, 0 AS depth FROM investors i
       WHERE i.tenant_id = ${tenantId}::uuid AND upper(i.pan) = ${p}
      UNION ALL
      SELECT s.id, s.merged_into_id, hit.depth + 1 FROM investors s JOIN hit ON s.id = hit.merged_into_id
       WHERE s.tenant_id = ${tenantId}::uuid AND hit.depth < 10
    )
    SELECT i.id::text AS id, i.name, i.status, (i.deleted_at IS NOT NULL) AS trashed,
           EXISTS (SELECT 1 FROM investors i2 WHERE i2.id = i.id AND ${visibleSql}) AS visible
      FROM hit JOIN investors i ON i.id = hit.id
     WHERE hit.merged_into_id IS NULL
     ORDER BY (i.deleted_at IS NULL) DESC, i.created_at
     LIMIT 1
  `)).rows[0] as { id: string; name: string; status: string | null; trashed: boolean; visible: boolean } | undefined;
  if (!row) return null;
  const state = row.trashed ? "trash" : row.status === "exited" || row.status === "closed" ? "exited" : "active";
  return { id: row.visible ? row.id : null, name: row.visible ? row.name : null, state };
}
