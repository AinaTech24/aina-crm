/**
 * Writing the DPDP consent record (privacy_consents, migration 0255). Callers
 * are inside withTenant, so RLS scopes every row to the firm.
 */

import { sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { privacyConsents } from "@/db/schema";
import { CONSENT_PURPOSE, readPrivacyNotice, type ConsentSource } from "./notice";

type Subject = { type: "lead" | "investor"; id: string } | null;

/** The notice version in force for the firm right now. */
export async function currentNoticeVersion(tx: Tx, tenantId: string): Promise<number> {
  const r = await tx.execute(sql`SELECT privacy_notice FROM tenants WHERE id = ${tenantId}::uuid`);
  return readPrivacyNotice((r.rows[0] as { privacy_notice?: unknown } | undefined)?.privacy_notice).version;
}

/** Who sent the form — kept as evidence of the consent. */
export function requestEvidence(headers: Headers): { ip: string | null; userAgent: string | null } {
  const fwd = headers.get("x-forwarded-for");
  const ip = (fwd ? fwd.split(",")[0] : headers.get("x-real-ip"))?.trim() || null;
  return { ip, userAgent: headers.get("user-agent")?.slice(0, 400) ?? null };
}

/** A consent ticked on a public form. */
export async function recordFormConsent(
  tx: Tx,
  args: { tenantId: string; subject: Subject; source: keyof typeof CONSENT_PURPOSE; headers: Headers }
): Promise<void> {
  const version = await currentNoticeVersion(tx, args.tenantId);
  const ev = requestEvidence(args.headers);
  await tx.insert(privacyConsents).values({
    tenantId: args.tenantId,
    subjectType: args.subject?.type ?? null,
    subjectId: args.subject?.id ?? null,
    kind: "consent",
    source: args.source,
    purpose: CONSENT_PURPOSE[args.source],
    noticeVersion: version,
    ip: ev.ip,
    userAgent: ev.userAgent,
  });
}

/**
 * The first email to a client or lead carries the notice (every email footer
 * links it). Recorded once per person, so a lead an RM typed in from a call has
 * proof that they were told.
 */
export async function recordNoticeSentOnce(tx: Tx, args: { tenantId: string; subject: NonNullable<Subject>; source?: ConsentSource }): Promise<void> {
  const have = await tx.execute(sql`
    SELECT 1 FROM privacy_consents
     WHERE tenant_id = ${args.tenantId}::uuid AND subject_type = ${args.subject.type}
       AND subject_id = ${args.subject.id}::uuid AND kind = 'notice'
     LIMIT 1`);
  if (have.rows.length) return;
  const version = await currentNoticeVersion(tx, args.tenantId);
  await tx.insert(privacyConsents).values({
    tenantId: args.tenantId,
    subjectType: args.subject.type,
    subjectId: args.subject.id,
    kind: "notice",
    source: args.source ?? "email_notice",
    noticeVersion: version,
  });
}

/** The message a form API answers when the tick is missing. */
export const CONSENT_REQUIRED_ERROR = "Please read the privacy notice and tick the box to continue.";
