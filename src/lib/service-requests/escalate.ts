/**
 * Telling people a service request has escalated. The nightly SLA scan
 * (workers/daily-ops-scanner.ts) escalates a breached ticket; a person can
 * also choose "Escalated" on the ticket. Either way the same people hear of it
 * the same way: the owner / branch heads and the assignee get a critical
 * notification, and service_request.escalated goes on the outbox so any
 * subscribed workflow can react.
 *
 * The caller flips the status, stamps escalated_at and writes the timeline
 * entry — only when escalated_at was empty, so a ticket is announced once.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { eventsOutbox } from "@/db/schema";

export async function announceServiceRequestEscalation(
  tx: Tx,
  input: {
    tenantId: string;
    sr: { id: string; ticketNo: string; type: string; assignedToUserId: string | null; investorId: string | null };
    why: string;
    eventMeta?: Record<string, unknown>;
  },
): Promise<void> {
  const { tenantId, sr, why } = input;
  const leads = await tx.execute(sql`
    SELECT id FROM users WHERE tenant_id = ${tenantId}::uuid AND roles && ARRAY['owner','branch_head']::text[]
  `);
  const recipients = new Set<string>((leads.rows as Array<{ id: string }>).map((u) => u.id));
  if (sr.assignedToUserId) recipients.add(sr.assignedToUserId);

  let investorName: string | null = null;
  if (sr.investorId) {
    const inv = await tx.execute(sql`
      SELECT name FROM investors WHERE id = ${sr.investorId}::uuid AND tenant_id = ${tenantId}::uuid LIMIT 1
    `);
    investorName = (inv.rows[0] as { name?: string } | undefined)?.name ?? null;
  }

  for (const userId of recipients) {
    await tx.execute(sql`
      INSERT INTO notifications (tenant_id, user_id, kind, title, body, link_url, severity, meta)
      VALUES (
        ${tenantId}::uuid, ${userId}::uuid, 'service_request.escalated',
        ${`SR escalated — ${sr.ticketNo}`},
        ${`${why} · ${investorName ?? "client"} · ${String(sr.type).replace(/_/g, " ")}`},
        ${`/dashboard/service-requests/${sr.id}`}, 'critical',
        ${JSON.stringify({ service_request_id: sr.id, why })}::jsonb
      )
    `);
  }

  await tx
    .insert(eventsOutbox)
    .values({
      tenantId,
      kind: "service_request.escalated",
      entityType: "service_request",
      entityId: sr.id,
      after: { ticketNo: sr.ticketNo, type: sr.type, why } as any,
      meta: (input.eventMeta ?? {}) as any,
    } as any)
    .onConflictDoNothing();
}
