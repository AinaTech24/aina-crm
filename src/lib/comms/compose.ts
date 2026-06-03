/**
 * Ad-hoc Compose — free-form 1:1 client email that STILL goes through the
 * consent + compliance gate + lands an audited `communications` row, exactly
 * like a template/workflow send. This is the one place an RM can write an
 * arbitrary email (the Sanchay "Compose Mail" equivalent) without bypassing
 * the moat.
 *
 * Three entry points share one send core (`performEmailSend`):
 *   - composeAndSendEmail()  → send now
 *   - scheduleEmail()        → insert a status='scheduled' row for later
 *   - sendScheduledEmail()   → the worker fires a due scheduled row in place
 *
 * Compose is EMAIL-ONLY by design: free-form WhatsApp/SMS isn't permitted in
 * India without an approved template (Meta HSM / TRAI DLT), so those stay
 * template-driven through dispatch().
 */

import { and, eq } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { Tx } from "@/db/client";
import { communications } from "@/db/schema";
import { runComplianceChecks, type ComplianceResult } from "./compliance";
import { emailAdapter } from "./adapters/resend";
import { renderTemplateText } from "./tokens";
import { getConsent, loadTenant } from "./pipeline";
import { getTenantIntegration } from "./integrations";


const MF_DISCLAIMER =
  "Mutual fund investments are subject to market risks. Read all scheme related documents carefully.";

export interface ComposeEmailInput {
  tenantId: string;
  subject: string;
  body: string;
  category: "transactional" | "marketing";
  /** Resolved recipient email address. */
  recipient: string;
  recipientName?: string | null;
  investorId?: string | null;
  leadId?: string | null;
  actorUserId?: string | null;
}

export interface ComposeResult {
  communicationId: string;
  status: "sent" | "queued" | "scheduled" | "skipped" | "failed";
  reason?: string;
  findings?: ComplianceResult["findings"];
}

type RenderedEmail = { subject: string; text: string; html: string; tokens: Record<string, string> };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Build the final email — resolves {{name}}/{{arn_*}}, appends the mandatory
 *  MF disclaimer + the firm's ARN signature, and produces a safe HTML body. */
function buildEmailContent(
  tenantRow: any,
  recipientName: string | null | undefined,
  subjectRaw: string,
  bodyRaw: string
): RenderedEmail {
  const tokens: Record<string, string> = {
    name: recipientName ?? "",
    arn_no: tenantRow?.arn ?? "",
    arn_name: tenantRow?.legalName ?? "",
    firm: tenantRow?.legalName ?? "",
  };
  const subject = renderTemplateText(subjectRaw, tokens);
  const bodyText = renderTemplateText(bodyRaw, tokens);

  const sigParts = [
    tenantRow?.legalName ? `— ${tenantRow.legalName}` : "",
    tenantRow?.arn ? `ARN-${tenantRow.arn}` : "",
  ].filter(Boolean);
  const signature = sigParts.join(", ");

  const text = [bodyText, "", MF_DISCLAIMER, signature].filter((l) => l !== undefined).join("\n");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1a1a1a;line-height:1.55">
  <p style="white-space:pre-wrap;margin:0 0 16px">${escapeHtml(bodyText)}</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0"/>
  <p style="font-size:12px;color:#6b7280;margin:0 0 4px">${escapeHtml(MF_DISCLAIMER)}</p>
  ${signature ? `<p style="font-size:12px;color:#6b7280;margin:0">${escapeHtml(signature)}</p>` : ""}
</div>`;

  return { subject, text, html, tokens };
}

/** The send core, operating on an already-inserted communications row.
 *  Runs consent → compliance → adapter and updates the row in place. */
async function performEmailSend(
  tx: Tx,
  args: {
    commId: string;
    tenantId: string;
    recipient: string;
    category: "transactional" | "marketing";
    investorId?: string | null;
    rendered: RenderedEmail;
  }
): Promise<ComposeResult> {
  // 1. Consent (only when we know the client; raw-address sends skip it).
  let consentSnapshot: any = null;
  if (args.investorId) {
    const c = await getConsent(
      tx,
      args.tenantId,
      args.investorId,
      "email",
      args.category === "marketing" ? "marketing" : "transactional"
    );
    if (!c || c.status !== "granted") {
      await tx
        .update(communications)
        .set({ status: "skipped_consent", statusReason: `no email ${args.category} consent` })
        .where(eq(communications.id, args.commId));
      return { communicationId: args.commId, status: "skipped", reason: "skipped_consent" };
    }
    consentSnapshot = c;
  }

  // 2. Compliance gate (the same 11 deterministic rules every send passes).
  const tenantRow = await loadTenant(tx, args.tenantId);
  const compliance = runComplianceChecks({
    channel: "email",
    category: args.category,
    tenant: {
      legalName: tenantRow?.legalName,
      arn: tenantRow?.arn,
      principalEuin: tenantRow?.principalEuin ?? undefined,
      riaRegistered: tenantRow?.riaRegistered ?? false,
    },
    text: args.rendered.text,
    subject: args.rendered.subject,
    whatsappSessionActive: false,
    hasMarketingConsent: args.category === "marketing" ? !!consentSnapshot : true,
  });
  if (compliance.blocked) {
    await tx
      .update(communications)
      .set({
        status: "skipped_compliance",
        statusReason: JSON.stringify(compliance.findings),
        complianceSnapshot: compliance.findings as any,
        complianceScore: String(compliance.score) as any,
      })
      .where(eq(communications.id, args.commId));
    return { communicationId: args.commId, status: "skipped", reason: "skipped_compliance", findings: compliance.findings };
  }

  // Record the audit snapshots BEFORE the adapter call so they survive a
  // failed/crashed send (audit is the moat — it must not depend on success).
  await tx
    .update(communications)
    .set({
      consentSnapshot: consentSnapshot as any,
      complianceSnapshot: compliance.findings as any,
      complianceScore: String(compliance.score) as any,
    })
    .where(eq(communications.id, args.commId));

  // 3. Adapter (Resend), then stamp the outcome.
  try {
    const integration = await getTenantIntegration(tx, args.tenantId, "resend");
    const r = await emailAdapter.send({
      tenantId: args.tenantId,
      tokens: args.rendered.tokens,
      rendered: args.rendered,
      recipient: args.recipient,
      category: args.category,
      inlineHtml: args.rendered.html,
      apiKey: integration?.config?.apiKey,
      fromOverride: integration?.senderConfig?.fromEmail,
      fromNameOverride: integration?.senderConfig?.fromName,
      // Stable per-row key → Resend dedupes a re-fired send (retry / scheduled
      // race) provider-side instead of delivering a duplicate.
      idempotencyKey: args.commId,
    });
    await tx
      .update(communications)
      .set({ externalId: r.externalId, status: r.status, sentAt: new Date() })
      .where(eq(communications.id, args.commId));
    return { communicationId: args.commId, status: r.status };
  } catch (err) {
    await tx
      .update(communications)
      .set({ status: "failed", statusReason: (err as Error).message, failedAt: new Date() })
      .where(eq(communications.id, args.commId));
    return { communicationId: args.commId, status: "failed", reason: (err as Error).message };
  }
}

/** Insert a row + send immediately. */
export async function composeAndSendEmail(tx: Tx, input: ComposeEmailInput): Promise<ComposeResult> {
  const tenantRow = await loadTenant(tx, input.tenantId);
  const rendered = buildEmailContent(tenantRow, input.recipientName, input.subject, input.body);
  const commId = uuid();

  await tx.insert(communications).values({
    id: commId,
    tenantId: input.tenantId,
    investorId: input.investorId ?? null,
    leadId: input.leadId ?? null,
    userId: input.actorUserId ?? null,
    channel: "email",
    direction: "outbound",
    status: "queued",
    payload: { rendered, recipient: input.recipient, category: input.category, compose: true } as any,
    queuedAt: new Date(),
  } as any);

  return performEmailSend(tx, {
    commId,
    tenantId: input.tenantId,
    recipient: input.recipient,
    category: input.category,
    investorId: input.investorId,
    rendered,
  });
}

/** Insert a status='scheduled' row to be drained later. Runs the compliance
 *  gate up-front so the RM gets immediate feedback; consent is re-checked at
 *  fire time (it can be revoked between scheduling and sending). */
export async function scheduleEmail(
  tx: Tx,
  input: ComposeEmailInput,
  scheduledAt: Date
): Promise<ComposeResult> {
  const tenantRow = await loadTenant(tx, input.tenantId);
  const rendered = buildEmailContent(tenantRow, input.recipientName, input.subject, input.body);

  const compliance = runComplianceChecks({
    channel: "email",
    category: input.category,
    tenant: {
      legalName: tenantRow?.legalName,
      arn: tenantRow?.arn,
      principalEuin: tenantRow?.principalEuin ?? undefined,
      riaRegistered: tenantRow?.riaRegistered ?? false,
    },
    text: rendered.text,
    subject: rendered.subject,
    whatsappSessionActive: false,
    hasMarketingConsent: true,
  });
  if (compliance.blocked) {
    return { communicationId: "", status: "skipped", reason: "skipped_compliance", findings: compliance.findings };
  }

  const commId = uuid();
  await tx.insert(communications).values({
    id: commId,
    tenantId: input.tenantId,
    investorId: input.investorId ?? null,
    leadId: input.leadId ?? null,
    userId: input.actorUserId ?? null,
    channel: "email",
    direction: "outbound",
    status: "scheduled",
    scheduledAt,
    payload: { rendered, recipient: input.recipient, category: input.category, compose: true } as any,
    complianceSnapshot: compliance.findings as any,
    complianceScore: String(compliance.score) as any,
  } as any);

  return { communicationId: commId, status: "scheduled" };
}

/** Re-send a previously failed Compose email (e.g. transient adapter error).
 *  Reconstructs from the stored payload and re-runs the full gate.
 *  Tenant-scoped: a foreign commId resolves to "row not found". */
export async function retryEmail(tx: Tx, commId: string, tenantId?: string): Promise<ComposeResult> {
  const [row] = await tx
    .select()
    .from(communications)
    .where(tenantId ? and(eq(communications.id, commId), eq(communications.tenantId, tenantId)) : eq(communications.id, commId))
    .limit(1);
  if (!row) return { communicationId: commId, status: "failed", reason: "row not found" };
  if (row.status !== "failed") {
    return { communicationId: commId, status: "skipped", reason: `not failed (${row.status})` };
  }
  const payload = (row.payload ?? {}) as any;
  const rendered = payload.rendered as RenderedEmail | undefined;
  const recipient = payload.recipient as string | undefined;
  if (!rendered || !recipient) {
    return { communicationId: commId, status: "failed", reason: "not a compose row (no payload)" };
  }
  await tx
    .update(communications)
    .set({ status: "queued", statusReason: null, queuedAt: new Date() })
    .where(eq(communications.id, commId));
  return performEmailSend(tx, {
    commId,
    tenantId: row.tenantId,
    recipient,
    category: (payload.category as "transactional" | "marketing") ?? "transactional",
    investorId: row.investorId,
    rendered,
  });
}

/** Fire a due scheduled row (called by the worker). Reconstructs from payload
 *  and re-runs the full gate before sending. */
export async function sendScheduledEmail(tx: Tx, commId: string): Promise<ComposeResult> {
  const [row] = await tx.select().from(communications).where(eq(communications.id, commId)).limit(1);
  if (!row) return { communicationId: commId, status: "failed", reason: "row not found" };
  // Accept 'scheduled' (legacy path) OR 'queued' (already atomically claimed by
  // the drain). Anything else (sent/cancelled/…) means another worker handled it.
  if (row.status !== "scheduled" && row.status !== "queued") {
    return { communicationId: commId, status: "skipped", reason: `not scheduled (${row.status})` };
  }
  const payload = (row.payload ?? {}) as any;
  const rendered = payload.rendered as RenderedEmail | undefined;
  const recipient = payload.recipient as string | undefined;
  if (!rendered || !recipient) {
    await tx
      .update(communications)
      .set({ status: "failed", statusReason: "scheduled row missing payload", failedAt: new Date() })
      .where(eq(communications.id, commId));
    return { communicationId: commId, status: "failed", reason: "missing payload" };
  }
  // Ensure we're in 'queued' before the adapter call so a crash mid-send doesn't
  // re-fire on the next tick (no-op if the drain already claimed it).
  if (row.status === "scheduled") {
    await tx.update(communications).set({ status: "queued", queuedAt: new Date() }).where(eq(communications.id, commId));
  }

  return performEmailSend(tx, {
    commId,
    tenantId: row.tenantId,
    recipient,
    category: (payload.category as "transactional" | "marketing") ?? "transactional",
    investorId: row.investorId,
    rendered,
  });
}
