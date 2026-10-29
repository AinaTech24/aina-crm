/**
 * Service requests an email once opened.
 *
 * An email no longer opens a service request (the firm's decision of
 * 2026-10-16; see workers/imap-poller.ts), but the tickets it opened before
 * that are still in the register, escalating because nobody asked for them.
 * "Close email requests" on Service Requests clears them in one go.
 *
 * Only tickets that nobody has touched: no owner, no reply, and every timeline
 * entry the system's. Closing is a status change with a resolution note and a
 * timeline event — nothing is deleted. The same rule as
 * scripts/close-auto-email-tickets.ts, without its sort into "automated" and
 * "for review": here the firm closes them all.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { recordAudit } from "@/lib/audit";

const OPEN = sql`s.status IN ('open', 'escalated', 'in_progress', 'waiting_customer')`;

/** Opened by the email intake and still untouched by a person. */
const UNTOUCHED_EMAIL_INTAKE = sql`
  s.channel = 'email'
  AND COALESCE(s.timeline->0->>'note', '') ILIKE '%Email intake%'
  AND s.assigned_to_user_id IS NULL
  AND s.responded_at IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(s.timeline, '[]'::jsonb)) e
     WHERE COALESCE(e->>'by', 'system') NOT IN ('system', 'Email intake')
  )
`;

export async function countEmailIntakeTickets(tx: Tx, tenantId: string): Promise<number> {
  const r = await tx.execute(sql`
    SELECT count(*)::int AS n FROM service_requests s
     WHERE s.tenant_id = ${tenantId}::uuid AND ${OPEN} AND ${UNTOUCHED_EMAIL_INTAKE}
  `);
  return Number((r.rows[0] as { n: number } | undefined)?.n ?? 0);
}

export async function closeEmailIntakeTickets(
  tx: Tx,
  args: { tenantId: string; actorUserId: string | null; actorName?: string | null }
): Promise<number> {
  const note =
    "Closed: opened automatically from an email. Email no longer opens service requests; " +
    "a client asks through the service request form.";
  const event = JSON.stringify([
    { at: new Date().toISOString(), by: args.actorName ?? "system", event: "closed", note },
  ]);
  const r = await tx.execute(sql`
    UPDATE service_requests s
       SET status = 'closed',
           resolved_at = now(),
           resolution_notes = ${note},
           timeline = COALESCE(s.timeline, '[]'::jsonb) || ${event}::jsonb,
           updated_at = now()
     WHERE s.tenant_id = ${args.tenantId}::uuid AND ${OPEN} AND ${UNTOUCHED_EMAIL_INTAKE}
    RETURNING s.id::text AS id
  `);
  const ids = (r.rows as Array<{ id: string }>).map((x) => x.id);
  if (ids.length) {
    await recordAudit(tx, {
      tenantId: args.tenantId,
      actorUserId: args.actorUserId,
      action: "service_request.bulk_close",
      entityType: "service_request",
      entityId: args.tenantId,
      after: { source: "email_intake_cleanup", count: ids.length, ids } as any,
    });
  }
  return ids.length;
}
