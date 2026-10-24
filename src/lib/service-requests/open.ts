/**
 * Opening a service request — ONE definition for every way a ticket starts:
 * the CRM's own form (POST /api/service-requests) and the firm's public
 * complaint form (POST /api/public/complaints/[token]).
 *
 * It owns the ticket number, both SLA clocks, the complaint.created /
 * service_request.created event the workflow engine listens for, and the
 * client's instant acknowledgement. A second copy of any of these is how a
 * website complaint would end up with a different ticket series or no clock.
 */

import { v4 as uuid } from "uuid";
import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { eventsOutbox, serviceRequests } from "@/db/schema";
import { acknowledgeServiceRequest } from "@/lib/service/acknowledge";

/**
 * Default SLAs in hours per service type — spec § Module 13.
 * Tunable later via masters; AINA-recommended starting points below.
 */
export const SLA_HOURS_BY_TYPE: Record<string, number> = {
  // Spec-canonical 13
  nominee_update: 24 * 14,
  bank_update: 24 * 7,
  mobile_update: 24 * 2,
  email_update: 24 * 2,
  kyc_update: 24 * 7,
  minor_to_major: 24 * 30,
  capital_gain_report: 24 * 3,
  statement_request: 24 * 2,
  redemption_request: 24,
  switch_request: 24 * 3,
  transmission_case: 24 * 45,
  folio_correction: 24 * 7,
  other: 24 * 7,
  // Legacy
  complaint: 24 * 21, // SEBI requires 21 days max for resolution
  redemption_help: 24,
  switch_help: 24 * 3,
  transaction_query: 24 * 3,
};

export type OpenServiceRequest = {
  tenantId: string;
  type: (typeof serviceRequests.$inferInsert)["type"];
  subject: string;
  description?: string | null;
  priority?: "low" | "normal" | "high" | "urgent";
  channel?: "whatsapp" | "email" | "phone" | "in_person" | "form" | null;
  investorId?: string | null;
  assignedToUserId?: string | null;
  sebiCategory?: string | null;
  sebiSubCategory?: string | null;
  /** Complaints only — defaults to "direct". */
  complaintSource?: string | null;
  scoresRefNo?: string | null;
  remarks?: string | null;
  /** Who asked, when there is no client record to show (public form). */
  requesterName?: string | null;
  /** The first timeline entry: who opened it (a user id, or a label the
   *  timeline shows as "system") and a sentence about how. */
  createdBy: { by: string; note: string };
  /** Extra context on the outbox event (e.g. which form it came from). */
  eventMeta?: Record<string, unknown>;
  /** Send the linked client the instant acknowledgement (default true). The
   *  public form turns it off unless the complainant typed that client's own
   *  email, so it can never make the firm write to a third party. */
  acknowledge?: boolean;
};

export async function openServiceRequest(
  tx: Tx,
  input: OpenServiceRequest,
): Promise<{ id: string; ticketNo: string; slaResolutionAt: Date }> {
  const id = uuid();
  const priority = input.priority ?? "normal";
  const slaHours = SLA_HOURS_BY_TYPE[input.type] ?? 24 * 7;
  const slaResolutionAt = new Date(Date.now() + slaHours * 60 * 60 * 1000);
  // First-response SLA is 25% of resolution time (rule of thumb)
  const slaResponseAt = new Date(Date.now() + slaHours * 60 * 60 * 1000 * 0.25);

  // Ticket number: per-tenant per-year counter
  const seqRes = await tx.execute(sql`
    SELECT COUNT(*)::int + 1 AS n FROM service_requests
    WHERE tenant_id = ${input.tenantId}::uuid AND created_at >= date_trunc('year', now())
  `);
  const n = Number((seqRes.rows[0] as any)?.n ?? 1);
  const ticketNo = `SR-${new Date().getFullYear()}-${String(n).padStart(5, "0")}`;

  await tx.insert(serviceRequests).values({
    id,
    tenantId: input.tenantId,
    ticketNo,
    investorId: input.investorId ?? null,
    assignedToUserId: input.assignedToUserId ?? null,
    type: input.type,
    channel: input.channel ?? undefined,
    subject: input.subject,
    description: input.description ?? undefined,
    priority,
    status: "open",
    slaResponseAt,
    slaResolutionAt,
    sebiCategory: input.sebiCategory ?? undefined,
    sebiSubCategory: input.sebiSubCategory ?? undefined,
    complaintSource: input.type === "complaint" ? (input.complaintSource ?? "direct") : null,
    scoresRefNo: input.scoresRefNo ?? null,
    remarks: input.remarks ?? null,
    requesterName: input.requesterName ?? null,
    timeline: [
      {
        at: new Date().toISOString(),
        by: input.createdBy.by,
        event: "created",
        note: input.createdBy.note,
      },
    ],
  } as any);

  await tx.insert(eventsOutbox).values({
    tenantId: input.tenantId,
    kind: input.type === "complaint" ? "complaint.created" : "service_request.created",
    entityType: "service_request",
    entityId: id,
    after: { ticketNo, type: input.type, priority } as any,
    meta: (input.eventMeta ?? {}) as any,
  } as any);

  // Instant client acknowledgement with a promised resolution ETA.
  if (input.acknowledge !== false) {
    await acknowledgeServiceRequest(tx, {
      tenantId: input.tenantId,
      srId: id,
      ticketNo,
      type: input.type,
      slaResolutionAt,
      investorId: input.investorId ?? null,
    });
  }

  return { id, ticketNo, slaResolutionAt };
}
