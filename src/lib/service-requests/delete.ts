/**
 * Permanently delete service requests (the firm's request, 2026-10-17) — one
 * place for the single and the bulk route.
 *
 * - Needs `service_request.delete` (owner; grantable per user). Closing stays
 *   `service_request.manage` and is still what DELETE without ?permanent does.
 * - A COMPLAINT is never deleted: it belongs to the complaint register the
 *   firm must keep (SEBI) — it can be closed, not erased. Complaints in a
 *   selection are skipped and reported.
 * - Only tickets the caller can see (`serviceRequestScopeSql`).
 * - Its still-open tasks are cancelled (they only exist to work the ticket).
 * - Each deleted row is written whole to the audit log ("service_request.delete",
 *   `before`), so a deletion can be traced and, if ever needed, rebuilt by hand.
 *   The table has no soft delete: 80-odd screens read it, and a hidden row any
 *   of them forgot to filter would still be counted.
 */

import { sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth/session";
import { recordAudit } from "@/lib/audit";
import { serviceRequestScopeSql } from "./access";

type Tx = any;

export type DeleteResult = { deleted: string[]; complaints: string[] };

export async function deleteServiceRequests(
  tx: Tx,
  session: SessionUser,
  ids: string[],
  clientMeta: Record<string, unknown> = {},
): Promise<DeleteResult> {
  if (!ids.length) return { deleted: [], complaints: [] };
  const scope = await serviceRequestScopeSql(tx, session, "service_requests");
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = (await tx.execute(sql`
    SELECT * FROM service_requests
     WHERE tenant_id = ${session.tenantId}::uuid AND id IN (${idList}) AND ${scope}
  `)).rows as Array<Record<string, any>>;

  const complaints = rows.filter((r) => r.type === "complaint").map((r) => String(r.id));
  const doomed = rows.filter((r) => r.type !== "complaint");
  if (!doomed.length) return { deleted: [], complaints };

  const doomedIds = sql.join(doomed.map((r) => sql`${String(r.id)}::uuid`), sql`, `);
  await tx.execute(sql`
    UPDATE tasks SET status = 'cancelled', updated_at = now()
     WHERE tenant_id = ${session.tenantId}::uuid
       AND status IN ('open', 'in_progress', 'blocked')
       AND (related_service_request_id IN (${doomedIds})
            OR (subject_type = 'service_request' AND subject_id IN (${doomedIds})))
  `);
  await tx.execute(sql`
    DELETE FROM service_requests WHERE tenant_id = ${session.tenantId}::uuid AND id IN (${doomedIds})
  `);
  for (const r of doomed) {
    await recordAudit(tx, {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      action: "service_request.delete",
      entityType: "service_request",
      entityId: String(r.id),
      before: r as any,
      ...clientMeta,
    });
  }
  return { deleted: doomed.map((r) => String(r.id)), complaints };
}
