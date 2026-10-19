/**
 * The firm's public service request form — /service-request/<token>.
 *
 * One link per firm (tenants.service_form_token, migration 0238) that the firm
 * sends a client or puts on its website. The client chooses the services they
 * want and gives their details; EACH service opens its own service request,
 * channel "form", through the same openServiceRequest as the CRM's own form —
 * the same ticket series (the service ID, SR-YYYY-NNNNN), the same SLA clock and
 * the same service_request.created event. The client is shown the service IDs
 * on the page.
 *
 * This replaces opening tickets from incoming email: a person asks on purpose
 * here, so the firm's own reminder mail can never become a ticket.
 *
 * Rules worth knowing before changing this:
 *   - The public side only ever sees the firm's display branding. Nothing
 *     about the firm's clients goes back to the browser.
 *   - A request is LINKED to a client only when the email or mobile typed
 *     matches exactly one live client. The acknowledgement is sent only when
 *     it was the EMAIL that matched — it goes to the address the person typed —
 *     so the form can never make the firm write to a third party.
 *   - It goes to the linked client's relationship manager, else the firm's
 *     owner, who gets a notification.
 *   - Pressing Submit twice does not open two tickets: a linked client's open
 *     request of the same type from the last day is returned instead.
 */

import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { withSystem, type Tx } from "@/db/client";
import { tenants } from "@/db/schema";
import { openServiceRequest } from "@/lib/service-requests/open";
import { createNotification } from "@/lib/notifications/create";
import { serviceLabel, type ServiceSubmission } from "./web-submission";

/** 18 random bytes → 24 URL-safe characters. */
export function newServiceFormToken(): string {
  return randomBytes(18).toString("base64url");
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export type PublicServiceForm = {
  tenantId: string;
  firmName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  arn: string | null;
  enabled: boolean;
};

/** The link's firm, or null. A system read: the token is the only credential. */
export async function resolveServiceForm(token: string): Promise<PublicServiceForm | null> {
  if (!TOKEN_RE.test(token)) return null;
  return withSystem(async (tx) => {
    const [t] = await tx
      .select({
        id: tenants.id,
        displayName: tenants.displayName,
        logoUrl: tenants.logoUrl,
        primaryColor: tenants.primaryColor,
        arn: tenants.arn,
        enabled: tenants.serviceFormEnabled,
        deletedAt: tenants.deletedAt,
      })
      .from(tenants)
      .where(eq(tenants.serviceFormToken, token))
      .limit(1);
    if (!t || t.deletedAt) return null;
    return { tenantId: t.id, firmName: t.displayName, logoUrl: t.logoUrl, primaryColor: t.primaryColor, arn: t.arn, enabled: t.enabled };
  });
}

/** The firm's link, made the first time anyone asks for it. */
export async function ensureServiceFormLink(tx: Tx, tenantId: string): Promise<{ token: string; enabled: boolean }> {
  // Only fills an empty token, so two people opening the page at once end up
  // with the same link rather than one silently replacing the other's.
  await tx.execute(sql`
    UPDATE tenants SET service_form_token = ${newServiceFormToken()}
    WHERE id = ${tenantId}::uuid AND service_form_token IS NULL
  `);
  const [t] = await tx
    .select({ token: tenants.serviceFormToken, enabled: tenants.serviceFormEnabled })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!t?.token) throw new Error("service form link could not be created");
  return { token: t.token, enabled: t.enabled };
}

/** A new link; the old one stops working at once. */
export async function replaceServiceFormToken(tx: Tx, tenantId: string): Promise<string> {
  const token = newServiceFormToken();
  await tx.update(tenants).set({ serviceFormToken: token, updatedAt: new Date() } as any).where(eq(tenants.id, tenantId));
  return token;
}

export async function setServiceFormEnabled(tx: Tx, tenantId: string, enabled: boolean): Promise<void> {
  await tx.update(tenants).set({ serviceFormEnabled: enabled, updatedAt: new Date() } as any).where(eq(tenants.id, tenantId));
}

type Client = { id: string; rmId: string | null; byEmail: boolean };

/** The ONE live client whose email or mobile is the one typed — none, or more than one, is no match. */
async function matchClient(tx: Tx, tenantId: string, s: Pick<ServiceSubmission, "email" | "phoneLast10">): Promise<Client | null> {
  if (!s.email && !s.phoneLast10) return null;
  const r = await tx.execute(sql`
    SELECT id, rm_id AS "rmId",
           (${s.email}::text IS NOT NULL AND lower(trim(email)) = ${s.email}::text) AS "byEmail"
    FROM investors
    WHERE tenant_id = ${tenantId}::uuid
      AND deleted_at IS NULL
      AND merged_into_id IS NULL
      AND (
        (${s.email}::text IS NOT NULL AND lower(trim(email)) = ${s.email}::text)
        OR (${s.phoneLast10}::text IS NOT NULL
            AND right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${s.phoneLast10}::text)
      )
    LIMIT 2
  `);
  if (r.rows.length !== 1) return null;
  const row = r.rows[0] as { id: string; rmId: string | null; byEmail: boolean };
  return { id: row.id, rmId: row.rmId, byEmail: row.byEmail === true };
}

/** The firm's owner — who hears about a request nobody owns yet. */
async function firmOwner(tx: Tx, tenantId: string): Promise<string | null> {
  const r = await tx.execute(sql`
    SELECT id FROM users
    WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND status = 'active' AND 'owner' = ANY(roles)
    ORDER BY created_at ASC LIMIT 1
  `);
  return (r.rows[0] as { id: string } | undefined)?.id ?? null;
}

export type OpenedService = { type: string; label: string; id: string; ticketNo: string; respondBy: Date; alreadyOpen: boolean };

/** Open one service request per service chosen, and tell whoever owns them. */
export async function submitWebServiceRequest(tx: Tx, tenantId: string, s: ServiceSubmission): Promise<OpenedService[]> {
  const client = await matchClient(tx, tenantId, s);
  const ownerId = client?.rmId ?? (await firmOwner(tx, tenantId));

  const contact = [
    "— Sent through the firm's service request form —",
    `Name: ${s.name}`,
    ...(s.phone ? [`Mobile: ${s.phone}`] : []),
    ...(s.email ? [`Email: ${s.email}`] : []),
  ];

  const opened: OpenedService[] = [];
  for (const type of s.services) {
    const label = serviceLabel(type);
    const typed = type === "other" ? s.otherText : null;

    if (client) {
      const dup = (
        await tx.execute(sql`
          SELECT id::text AS id, ticket_no AS "ticketNo", sla_resolution_at AS "respondBy" FROM service_requests
          WHERE tenant_id = ${tenantId}::uuid AND investor_id = ${client.id}::uuid AND type = ${type}
            AND channel = 'form' AND status IN ('open', 'in_progress', 'waiting_customer', 'escalated')
            AND created_at > now() - interval '1 day'
          ORDER BY created_at DESC LIMIT 1
        `)
      ).rows[0] as { id: string; ticketNo: string; respondBy: string | Date } | undefined;
      if (dup) {
        opened.push({ type, label, id: dup.id, ticketNo: dup.ticketNo, respondBy: new Date(dup.respondBy), alreadyOpen: true });
        continue;
      }
    }

    const sr = await openServiceRequest(tx, {
      tenantId,
      type: type as any,
      channel: "form",
      subject: (typed ? `Other: ${typed} — ${s.name}` : `${label} — ${s.name}`).slice(0, 300),
      description: [typed ? `Request: ${typed}` : `${label} requested.`, ...(s.details ? ["", s.details] : []), "", ...contact].join(
        "\n",
      ),
      investorId: client?.id ?? null,
      requesterName: s.name,
      assignedToUserId: client?.rmId ?? null,
      createdBy: { by: "website", note: "Received through the firm's service request form." },
      eventMeta: { source: "public_service_form" },
      acknowledge: client?.byEmail === true,
    });
    opened.push({ type, label, id: sr.id, ticketNo: sr.ticketNo, respondBy: sr.slaResolutionAt, alreadyOpen: false });

    if (ownerId) {
      await createNotification(tx, {
        tenantId,
        userId: ownerId,
        kind: "service_request.form",
        title: "New service request from your form",
        body: `${sr.ticketNo} · ${s.name} · ${label}`,
        linkUrl: `/dashboard/service-requests/${sr.id}`,
        severity: "info",
      });
    }
  }
  return opened;
}
