/**
 * The firm's public complaint form — /complaint/<token>.
 *
 * One link per firm (tenants.complaint_form_token, migration 0227) for the
 * firm to put on its own website. A complaint sent through it opens a service
 * request of type complaint, source "website", channel "form", through the
 * same openServiceRequest as the CRM's own form — the same ticket series, the
 * 21-day clock and the complaint.created event.
 *
 * Rules worth knowing before changing this:
 *   - The public side only ever sees the firm's display branding. Nothing
 *     about the firm's clients goes back to the browser.
 *   - A complaint is LINKED to a client only when the email or mobile typed
 *     matches exactly one live client. The client acknowledgement is sent only
 *     when it was the EMAIL that matched — it goes to the address the person
 *     typed — so the form can never make the firm write to a third party. A
 *     PAN or folio is recorded for staff to check, never used to link.
 *   - It is assigned to the firm's compliance officer, else the owner. A
 *     complaint may be about the client's own RM, so it never defaults to the
 *     RM; the RM still sees it through the client link.
 */

import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { withSystem, type Tx } from "@/db/client";
import { tenants } from "@/db/schema";
import { SEBI_COMPLAINT_CATEGORIES } from "@/db/schema/service_requests";
import { openServiceRequest } from "@/lib/service-requests/open";
import { createNotification } from "@/lib/notifications/create";
import type { ComplaintSubmission } from "./submission";

/** 18 random bytes → 24 URL-safe characters. */
export function newComplaintFormToken(): string {
  return randomBytes(18).toString("base64url");
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

export type PublicComplaintForm = {
  tenantId: string;
  firmName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  arn: string | null;
  enabled: boolean;
};

/**
 * The link's firm, or null. A system read: the caller is the public internet
 * and the token is the only credential.
 */
export async function resolveComplaintForm(token: string): Promise<PublicComplaintForm | null> {
  if (!TOKEN_RE.test(token)) return null;
  return withSystem(async (tx) => {
    const [t] = await tx
      .select({
        id: tenants.id,
        displayName: tenants.displayName,
        logoUrl: tenants.logoUrl,
        primaryColor: tenants.primaryColor,
        arn: tenants.arn,
        enabled: tenants.complaintFormEnabled,
        deletedAt: tenants.deletedAt,
      })
      .from(tenants)
      .where(eq(tenants.complaintFormToken, token))
      .limit(1);
    if (!t || t.deletedAt) return null;
    return {
      tenantId: t.id,
      firmName: t.displayName,
      logoUrl: t.logoUrl,
      primaryColor: t.primaryColor,
      arn: t.arn,
      enabled: t.enabled,
    };
  });
}

/** The firm's link, made the first time anyone asks for it. */
export async function ensureComplaintFormLink(tx: Tx, tenantId: string): Promise<{ token: string; enabled: boolean }> {
  // Only fills an empty token, so two people opening the page at once end up
  // with the same link rather than one silently replacing the other's.
  await tx.execute(sql`
    UPDATE tenants SET complaint_form_token = ${newComplaintFormToken()}
    WHERE id = ${tenantId}::uuid AND complaint_form_token IS NULL
  `);
  const [t] = await tx
    .select({ token: tenants.complaintFormToken, enabled: tenants.complaintFormEnabled })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!t?.token) throw new Error("complaint form link could not be created");
  return { token: t.token, enabled: t.enabled };
}

/** A new link; the old one stops working at once. */
export async function replaceComplaintFormToken(tx: Tx, tenantId: string): Promise<string> {
  const token = newComplaintFormToken();
  await tx
    .update(tenants)
    .set({ complaintFormToken: token, updatedAt: new Date() } as any)
    .where(eq(tenants.id, tenantId));
  return token;
}

export async function setComplaintFormEnabled(tx: Tx, tenantId: string, enabled: boolean): Promise<void> {
  await tx
    .update(tenants)
    .set({ complaintFormEnabled: enabled, updatedAt: new Date() } as any)
    .where(eq(tenants.id, tenantId));
}

/** Who a website complaint goes to: the compliance officer, else the owner. */
export async function complaintHandler(tx: Tx, tenantId: string): Promise<{ id: string; name: string } | null> {
  const r = await tx.execute(sql`
    SELECT id, name FROM users
    WHERE tenant_id = ${tenantId}::uuid
      AND deleted_at IS NULL
      AND status = 'active'
      AND ('compliance' = ANY(roles) OR 'owner' = ANY(roles))
    ORDER BY ('compliance' = ANY(roles)) DESC, created_at ASC
    LIMIT 1
  `);
  const row = r.rows[0] as { id: string; name: string } | undefined;
  return row ? { id: row.id, name: row.name } : null;
}

/** The ONE live client whose email or mobile is the one typed — none, or more than one, is no match. */
async function matchClient(
  tx: Tx,
  tenantId: string,
  s: Pick<ComplaintSubmission, "email" | "phoneLast10">,
): Promise<{ id: string; byEmail: boolean } | null> {
  if (!s.email && !s.phoneLast10) return null;
  const r = await tx.execute(sql`
    SELECT id,
           (${s.email}::text IS NOT NULL AND lower(trim(email)) = ${s.email}::text) AS by_email
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
  const row = r.rows[0] as { id: string; by_email: boolean };
  return { id: row.id, byEmail: row.by_email === true };
}

/** Open the service request for one website complaint, and tell its handler. */
export async function submitWebComplaint(
  tx: Tx,
  tenantId: string,
  s: ComplaintSubmission,
): Promise<{ id: string; ticketNo: string; respondBy: Date }> {
  const category = SEBI_COMPLAINT_CATEGORIES.find((c) => c.value === s.category) ?? { value: "other", label: "Other" };
  const client = await matchClient(tx, tenantId, s);
  const handler = await complaintHandler(tx, tenantId);

  const contact = [
    "— Sent through the website complaint form —",
    `Name: ${s.name}`,
    ...(s.phone ? [`Mobile: ${s.phone}`] : []),
    ...(s.email ? [`Email: ${s.email}`] : []),
    ...(s.pan ? [`PAN: ${s.pan}`] : []),
    ...(s.folio ? [`Folio / scheme: ${s.folio}`] : []),
  ];

  const sr = await openServiceRequest(tx, {
    tenantId,
    type: "complaint",
    channel: "form",
    complaintSource: "website",
    sebiCategory: category.value,
    subject: `Website complaint from ${s.name}: ${category.label}`.slice(0, 300),
    description: [s.details, "", ...contact].join("\n"),
    investorId: client?.id ?? null,
    assignedToUserId: handler?.id ?? null,
    createdBy: { by: "website", note: "Received through the firm's website complaint form." },
    eventMeta: { source: "public_complaint_form" },
    acknowledge: client?.byEmail === true,
  });

  if (handler) {
    await createNotification(tx, {
      tenantId,
      userId: handler.id,
      kind: "complaint.website",
      title: "New complaint from your website",
      body: `${sr.ticketNo} · ${s.name} · ${category.label}`,
      linkUrl: `/dashboard/service-requests/${sr.id}`,
      severity: "warning",
    });
  }

  return { id: sr.id, ticketNo: sr.ticketNo, respondBy: sr.slaResolutionAt };
}
