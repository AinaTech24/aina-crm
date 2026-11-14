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
import { leads, templates, templateVersions } from "@/db/schema";
import { createShareToken } from "@/lib/share-tokens";
import { dispatch } from "@/lib/comms/pipeline";
import { ensureStarterTemplate } from "@/lib/templates/ensure";
import { nameAndLinkVariables, pickTemplateRow } from "@/lib/comms/template-variables";
import { getChecklist, type ClientType } from "@/lib/onboarding/doc-checklists";
import { getFieldChecklist } from "@/lib/onboarding/kyc-fields";
import { ensureDocCollectionTemplate } from "@/lib/onboarding/doc-template";

/** The vendor starter email (lib/templates/starters.ts) that carries the link. */
const DOC_CHECKLIST_EMAIL = "doc_checklist";

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
    return { lead };
  });

  if (!ctx.lead) throw refuse("Lead not found", 404);

  const name = (ctx.lead as any).name ?? "there";
  const email = (ctx.lead as any).email as string | null;
  const phone = (ctx.lead as any).phone as string | null;
  const investorId = (ctx.lead as any).convertedInvestorId as string | null;

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
    // The email template promises 14 days.
    expiresInDays: 14,
    createdBy: actorUserId,
  });
  const url = (token as any).url as string;
  const tokenId = String((token as any).token ?? "").slice(0, 8);

  const waText = `Hi ${name}, please upload your KYC documents to complete your account setup — secure, single-use link:\n\n${url}\n\nYou'll need: ${DOCS_LINE}.`;

  // 2. Email — through dispatch() like every other outbound (audit L17), so
  //    an opt-out, missing consent or a compliance block stops it and leaves
  //    the usual skipped_* record. The firm's "doc_checklist" email template
  //    (a vendor starter, provisioned on first use) carries the link; the
  //    sending RM's mailbox is used when they connected one.
  let emailed = false;
  let emailError: string | undefined;
  if (!email) {
    emailError = "no email on file";
  } else {
    try {
      const r = await withTenant(tenantId, async (tx) => {
        await ensureStarterTemplate(tx, tenantId, actorUserId, DOC_CHECKLIST_EMAIL);
        return dispatch(tx, {
          tenantId,
          channel: "email",
          templateKey: DOC_CHECKLIST_EMAIL,
          recipient: email,
          variables: { name, document_collection_link: url },
          category: "transactional",
          investorId: investorId ?? undefined,
          leadId: investorId ? undefined : id,
          actorUserId,
          idempotencyKey: `doc-checklist:${id}:${tokenId}`,
        });
      });
      emailed = r.status === "sent" || r.status === "queued";
      if (!emailed) {
        emailError = r.skipped
          ? `not sent — ${String(r.skipped.detail ?? r.skipped.reason).replace(/_/g, " ")}`
          : (r.error ? String(r.error).slice(0, 120) : "send failed");
      }
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
        .select({ key: templates.key, name: templates.name, locale: templates.locale, vars: templateVersions.variables })
        .from(templates)
        .innerJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
        .where(and(
          eq(templates.tenantId, tenantId),
          eq(templates.channel as any, "whatsapp" as any),
          eq(templates.status, "approved"),
        ));
      // The copy dispatch() will look up (its locale), not just the first that matches.
      return pickTemplateRow(rows.filter((r) => /doc|kyc|onboard|document|collect|upload|checklist/i.test(`${r.key} ${r.name}`)));
    });

    try {
      waStatus = await withTenant(tenantId, async (tx) => {
        if (tmpl) {
          waUsedTemplate = true;
          const variables = nameAndLinkVariables(tmpl.vars as any[], { name, link: url });
          const r = await dispatch(tx, {
            tenantId, channel: "whatsapp", templateKey: tmpl.key, locale: tmpl.locale,
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
