/**
 * Mint a secure document-collection link and send it to a lead by email and
 * WhatsApp.
 *
 * This was the body of POST /api/leads/[id]/send-doc-checklist (the "Send Doc
 * Checklist" button on the Won stage). It moved here so the SAME flow can run
 * when a client accepts a proposal: the acceptance is the client saying "go
 * ahead", and the next thing they need is the upload link. Two copies of a
 * send flow drift; one function cannot.
 *
 * It needs no session — only the tenant, the lead, and the user the send is on
 * behalf of (whose mailbox is used, and who is recorded as creating the link).
 * The button passes the signed-in RM; acceptance passes whoever prepared the
 * proposal.
 *
 * Throws an Error with `status` for the two refusals the button has always
 * shown (lead not found, no contact on file), so a route can hand it straight
 * to handleApiError and get the same response as before.
 */

import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { leads, tenants, templates, templateVersions } from "@/db/schema";
import { createShareToken } from "@/lib/share-tokens";
import { emailAdapter } from "@/lib/comms/adapters/resend";
import { resolveEmailSender } from "@/lib/comms/sender";
import { emailLogoHeaderHtml } from "@/lib/comms/email-logo";
import { dispatch } from "@/lib/comms/pipeline";
import { getChecklist, type ClientType } from "@/lib/onboarding/doc-checklists";
import { getFieldChecklist } from "@/lib/onboarding/kyc-fields";
import { ensureDocCollectionTemplate } from "@/lib/onboarding/doc-template";

const DOCS_LINE = "PAN card, Aadhaar, passport-size photo, recent bank statement, cancelled cheque";

export const CLIENT_TYPES = ["individual", "huf", "nri", "minor", "company", "trust"] as const;

export type SendDocChecklistResult = {
  ok: boolean;
  url: string;
  summary: string;
  emailed: boolean;
  emailError?: string;
  whatsapp: { status: string; sent: boolean };
  templateNote: string | null;
  waMeUrl: string | null;
};

const refuse = (message: string, status: number) => Object.assign(new Error(message), { status });

export async function sendDocChecklist(opts: {
  tenantId: string;
  leadId: string;
  /** Whose mailbox sends it, and who is recorded as creating the link. */
  actorUserId: string;
  clientType?: ClientType;
}): Promise<SendDocChecklistResult> {
  const { tenantId, leadId: id, actorUserId } = opts;
  const clientType: ClientType = opts.clientType ?? "individual";

  const ctx = await withTenant(tenantId, async (tx) => {
    const lead = (await tx.select().from(leads).where(and(eq(leads.id, id), eq(leads.tenantId, tenantId))).limit(1))[0] ?? null;
    const tenant = (await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1))[0] ?? null;
    let sender: Awaited<ReturnType<typeof resolveEmailSender>>;
    try {
      sender = await resolveEmailSender(tx, tenantId, actorUserId);
    } catch {
      sender = { source: "resend" };
    }
    return { lead, tenant, sender };
  });

  if (!ctx.lead) throw refuse("Lead not found", 404);

  const name = (ctx.lead as any).name ?? "there";
  const email = (ctx.lead as any).email as string | null;
  const phone = (ctx.lead as any).phone as string | null;
  const investorId = (ctx.lead as any).convertedInvestorId as string | null;
  // The firm is a distributor; the fallback must not call it an adviser.
  const firmName = (ctx.tenant as any)?.displayName ?? (ctx.tenant as any)?.legalName ?? "Your mutual fund distributor";
  const logoUrl = (ctx.tenant as any)?.logoUrl as string | null;
  const arn = (ctx.tenant as any)?.arn as string | null;

  if (!email && !phone) {
    throw refuse("This client has no email or phone on file — add a contact first.", 400);
  }

  // 1. Mint the secure, single-use document-collection link.
  const requiredDocs = getChecklist(clientType);
  const requiredFields = getFieldChecklist(clientType);
  const token = await createShareToken({
    tenantId,
    kind: "document_collection",
    subjectType: investorId ? "investor" : "lead",
    subjectId: investorId ?? id,
    payload: { requiredDocs, requiredFields, clientType },
    expiresInDays: 7,
    createdBy: actorUserId,
  });
  const url = (token as any).url as string;
  const tokenId = String((token as any).token ?? "").slice(0, 8);

  const waText = `Hi ${name}, please upload your KYC documents to complete your account setup — secure, single-use link:\n\n${url}\n\nYou'll need: ${DOCS_LINE}.`;

  // 2. Email via the firm's connected sender (mailbox / Resend).
  let emailed = false;
  let emailError: string | undefined;
  const canEmail = !!email && !!(ctx.sender.smtp?.host || ctx.sender.apiKey || process.env.RESEND_API_KEY);
  if (!email) {
    emailError = "no email on file";
  } else if (!canEmail) {
    emailError = "no mailbox connected (Settings → Email)";
  } else {
    try {
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;">
          ${emailLogoHeaderHtml(logoUrl, firmName)}
          <div style="padding:4px 4px 0;">
            <p>Hi ${escapeHtml(name)},</p>
            <p>To complete your account setup, please upload your KYC documents using this secure, single-use link:</p>
            <p style="margin:18px 0;"><a href="${escapeAttr(url)}" style="background:#0e2557;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block;">Upload documents</a></p>
            <p style="font-size:13px;color:#475569;">Required: ${DOCS_LINE}.</p>
            <p style="margin-top:18px;">Warm regards,<br/><strong>${escapeHtml(firmName)}</strong></p>
          </div>
          <div style="margin-top:22px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;line-height:1.6;">
            <div><strong style="color:#64748b;">${escapeHtml(firmName)}</strong>${arn ? ` &middot; ${escapeHtml(arn)}` : ""}</div>
            <div>The link is single-use and expires in 7 days. Mutual fund investments are subject to market risks; read all scheme-related documents carefully.</div>
          </div>
        </div>`;
      await emailAdapter.send({
        tenantId,
        recipient: email,
        category: "transactional",
        tokens: {},
        rendered: { subject: "Documents needed for your investment account", text: `Hi ${name}, please upload your KYC documents using this secure link: ${url}\n\nRequired: ${DOCS_LINE}.`, tokens: {} },
        inlineHtml: html,
        smtp: ctx.sender.smtp,
        apiKey: ctx.sender.apiKey,
        fromOverride: ctx.sender.fromEmail || undefined,
        fromNameOverride: ctx.sender.fromName || firmName,
        replyTo: ctx.sender.replyTo || undefined,
        idempotencyKey: `doc-checklist:${id}:${tokenId}`,
      });
      emailed = true;
    } catch (e: any) {
      const m = String(e?.message ?? "");
      emailError = /RESEND_API_KEY|EAUTH|invalid login|535|ECONNREFUSED|getaddrinfo|ETIMEDOUT|certificate|authentication|domain/i.test(m)
        ? "mailbox rejected the send (check Settings → Email)"
        : (m.slice(0, 120) || "send failed");
    }
  }

  // 3. WhatsApp. A Meta-APPROVED template is the only way to message a client
  //    outside the 24h window safely, so prefer a document/KYC template; only
  //    fall back to free-form (which delivers only inside the window) when none
  //    exists. Either way the wa.me fallback covers non-delivery.
  let waStatus = "no phone on file";
  let whatsapped = false;
  let waUsedTemplate = false;
  if (phone) {
    const tmpl = await withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select({ key: templates.key, name: templates.name, vars: templateVersions.variables })
        .from(templates)
        .innerJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
        .where(and(
          eq(templates.tenantId, tenantId),
          eq(templates.channel as any, "whatsapp" as any),
          eq(templates.status, "approved"),
        ));
      return rows.find((r) => /doc|kyc|onboard|document|collect|upload|checklist/i.test(`${r.key} ${r.name}`)) ?? null;
    });

    try {
      waStatus = await withTenant(tenantId, async (tx) => {
        if (tmpl) {
          waUsedTemplate = true;
          const varKeys = ((tmpl.vars as any[]) ?? []).map((v) => v?.key).filter(Boolean);
          const linkKey = varKeys.find((k: string) => /url|link|doc|upload/i.test(k)) ?? varKeys[0];
          const nameKey = varKeys.find((k: string) => /name|client|investor/i.test(k));
          const variables: Record<string, string> = {};
          if (linkKey) variables[linkKey] = url;
          if (nameKey) variables[nameKey] = name;
          const r = await dispatch(tx, {
            tenantId, channel: "whatsapp", templateKey: tmpl.key,
            recipient: phone, variables, category: "utility",
            investorId: investorId ?? undefined, leadId: investorId ? undefined : id,
          } as any);
          return String((r as any)?.status ?? "queued");
        }
        const r = await dispatch(tx, {
          tenantId, channel: "whatsapp", freeformText: waText,
          recipient: phone, category: "utility",
          investorId: investorId ?? undefined, leadId: investorId ? undefined : id,
        } as any);
        return String((r as any)?.status ?? "queued");
      });
      whatsapped = ["sent", "delivered", "queued"].includes(waStatus);
    } catch {
      waStatus = "failed";
    }
  }

  // If WhatsApp couldn't go via an approved template, self-provision one and
  // submit it to Meta so future sends deliver automatically (best-effort).
  let templateNote: string | null = null;
  if (!waUsedTemplate) {
    const prov = await ensureDocCollectionTemplate(tenantId, actorUserId);
    if (prov.submitted || prov.status === "pending_approval") templateNote = "WhatsApp template submitted to Meta — auto-sends once approved (1–24h)";
    else if (prov.status === "approved") templateNote = null;
  }

  const waMeUrl = phone ? `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(waText)}` : null;
  const ok = emailed || whatsapped;
  const summary = [
    emailed ? "📧 Email sent" : `📧 Email — ${emailError ?? "not sent"}`,
    whatsapped ? "💬 WhatsApp sent" : phone ? `💬 WhatsApp — ${waStatus.replace(/_/g, " ")} (use the link below)` : "💬 no phone on file",
    templateNote ? `⏳ ${templateNote}` : "",
  ].filter(Boolean).join("  ·  ");

  return { ok, url, summary, emailed, emailError, whatsapp: { status: waStatus, sent: whatsapped }, templateNote, waMeUrl };
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return String(s).replace(/"/g, "&quot;");
}
