import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/proposals/[id]/send
 *
 *   body: { channel: 'email' | 'whatsapp' | 'link', preview?: true }
 *
 * Sends the proposal to the recipient through the chosen channel:
 *
 *   - email      → uses Resend directly with an auto-generated HTML body
 *                  that contains the proposal summary + ARN tagline.
 *                  Returns { ok: true, externalId }.
 *   - whatsapp   → returns a wa.me URL with a pre-filled message. The
 *                  client (RM) opens it in a new tab and the message goes
 *                  through the RM's own WhatsApp. No template approval
 *                  required. Returns { ok: true, waUrl }.
 *
 *   - link       → the client's proposal page link, to paste anywhere.
 *                  Returns { ok: true, url }. Nothing is sent from the CRM.
 *
 * In every case the proposal status flips to 'sent' (status_at = now); email
 * and WhatsApp also write a `communications` row for the audit trail.
 *
 * `preview: true` returns the message the channel would carry — { subject?,
 * text?, html? } with a placeholder for the link — and changes nothing: no
 * token, no status, no send. The gates still run, so a preview says early
 * what would stop the send.
 *
 * A mutual fund line needs the client's CONFIRMED risk profile, signed in the
 * last 12 months (lib/proposals/snapshot — a provisional, stale or missing one
 * stops it), like an opportunity's proposal step. No override.
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { Resend } from "resend";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { createShareToken } from "@/lib/share-tokens";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { gateClientSend } from "@/lib/comms/guarded-send";
import { advanceJourneyForProposal } from "@/lib/proposals/journey";
import { proposals, tenants, communications, investors } from "@/db/schema";
import { checkAlignment } from "@/lib/proposal/risk-alignment";
import { loadProposalSnapshot } from "@/lib/proposals/snapshot";
import { resolveEmailSender } from "@/lib/comms/sender";
import { emailAdapter } from "@/lib/comms/adapters/resend";
import { renderProposalPdf } from "@/lib/proposal/proposal-pdf";
import { loadProposalPdfPeople, proposalBrand } from "@/lib/proposal/pdf-context";
import { formatDate, formatINR } from "@/lib/utils";

export const dynamic = "force-dynamic";

const Body = z.object({
  channel: z.enum(["email", "whatsapp", "link"]),
  preview: z.boolean().optional(),
});

let resendClient: Resend | null = null;
function getResend(): Resend | null {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  resendClient = new Resend(key);
  return resendClient;
}

const KIND_TITLE: Record<string, string> = {
  mf: "Mutual Funds",
  insurance: "Insurance",
  pms: "Portfolio Management Services",
  aif: "Alternative Investment Funds",
};

function buildHtmlEmail(args: {
  tenant: any;
  proposal: any;
  publicUrl: string;
}) {
  const { tenant, proposal, publicUrl } = args;
  const primary = tenant?.primaryColor || "#0e2557";
  const secondary = tenant?.secondaryColor || "#0ea5e9";
  const products = (proposal.products ?? []) as any[];
  const groups: Record<string, any[]> = {};
  for (const p of products) {
    if (!groups[p.kind]) groups[p.kind] = [];
    groups[p.kind].push(p);
  }
  const productLines = Object.entries(groups)
    .map(([kind, items]) => {
      const rows = items
        .map((it) => {
          const name = it.schemeName ?? it.policyName ?? it.strategyName ?? it.fundName;
          return `<li style="margin:6px 0">${name}${it.amcName ? ` — ${it.amcName}` : ""}${
            it.insurer ? ` — ${it.insurer}` : ""
          }${it.manager ? ` — ${it.manager}` : ""}</li>`;
        })
        .join("");
      return `<div style="margin:12px 0 8px"><strong style="color:${primary};font-size:13px;letter-spacing:0.04em;text-transform:uppercase">${
        KIND_TITLE[kind] ?? kind
      }</strong><ul style="padding-left:18px;margin:6px 0 0;color:#334155">${rows}</ul></div>`;
    })
    .join("");
  const totalInv = proposal.totalInvestment
    ? `<tr><td style="padding:6px 0;color:#64748b;font-size:12px">Total investment</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:14px">${formatINR(
        Number(proposal.totalInvestment)
      )}</td></tr>`
    : "";
  const corpus = proposal.expectedCorpus
    ? `<tr><td style="padding:6px 0;color:#64748b;font-size:12px">Illustrative value (at assumed returns, not guaranteed)</td><td style="padding:6px 0;text-align:right;font-weight:700;font-size:14px;color:#0f172a">${formatINR(
        Number(proposal.expectedCorpus)
      )}</td></tr>`
    : "";
  const validUntil = proposal.validUntil
    ? `<p style="color:#64748b;font-size:12px;margin:12px 0 0">This proposal is valid till <strong>${formatDate(new Date(
        proposal.validUntil
      ))}</strong>.</p>`
    : "";

  const arnLine = `${tenant?.legalName ?? tenant?.displayName ?? ""} · ARN ${
    tenant?.arn ?? "—"
  } · Mutual Fund investments are subject to market risks. Read all scheme-related documents carefully.`;

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a">
  <div style="max-width:620px;margin:0 auto;background:white;padding:0;border-radius:12px;overflow:hidden">
    <div style="background:${primary};padding:20px 24px;color:white">
      <div style="font-size:11px;opacity:0.75;letter-spacing:0.12em;text-transform:uppercase;font-weight:700">${
        tenant?.legalName ?? tenant?.displayName ?? ""
      }</div>
      <div style="font-size:11px;opacity:0.6;font-family:ui-monospace,monospace;margin-top:2px">ARN ${
        tenant?.arn ?? "—"
      } · ${proposal.proposalNumber}</div>
    </div>
    <div style="height:5px;background:${primary};background:linear-gradient(to right, ${primary}, ${secondary});"></div>
    <div style="padding:24px">
      <p style="margin:0 0 6px;color:#64748b;font-size:13px">Dear ${proposal.recipientName},</p>
      <h2 style="margin:8px 0 6px;font-size:18px;letter-spacing:-0.01em">${proposal.title}</h2>
      ${
        proposal.coverLetter
          ? `<p style="margin:0 0 12px;color:#334155;font-size:13px;line-height:1.6;white-space:pre-line">${proposal.coverLetter}</p>`
          : `<p style="margin:0 0 12px;color:#334155;font-size:13px;line-height:1.6">Please find your proposal attached as a PDF, summarised below.</p>`
      }
      <table style="width:100%;border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;margin:12px 0">${totalInv}${corpus}</table>
      ${productLines}
      ${validUntil}
    </div>
    <div style="background:#f1f5f9;padding:14px 24px;color:#64748b;font-size:10px;line-height:1.5;border-top:1px solid #e2e8f0">
      ${arnLine}
    </div>
  </div>
</body></html>`;
}

function buildWhatsAppText(args: { tenant: any; proposal: any; publicUrl: string }) {
  const { tenant, proposal, publicUrl } = args;
  const lines: string[] = [];
  lines.push(`Hi ${proposal.recipientName},`);
  lines.push("");
  lines.push(`Sharing the *${proposal.title}* we discussed (${proposal.proposalNumber}).`);
  lines.push("");
  if (proposal.totalInvestment) {
    lines.push(`💰 Total investment: ₹${Number(proposal.totalInvestment).toLocaleString("en-IN")}`);
  }
  if (proposal.expectedCorpus) {
    // An illustration at assumed returns — never a "corpus" (see the PDF).
    lines.push(`📈 Illustrative value: ₹${Number(proposal.expectedCorpus).toLocaleString("en-IN")} (at assumed returns, not guaranteed)`);
  }
  if (proposal.riskRating) {
    lines.push(`📊 Risk: ${proposal.riskRating}`);
  }
  const products = (proposal.products ?? []) as any[];
  if (products.length) {
    lines.push("");
    lines.push("*Products:*");
    for (const p of products.slice(0, 6)) {
      const name = p.schemeName ?? p.policyName ?? p.strategyName ?? p.fundName;
      lines.push(`• ${name}`);
    }
    if (products.length > 6) lines.push(`…and ${products.length - 6} more.`);
  }
  lines.push("");
  lines.push(`Full proposal: ${publicUrl}`);
  lines.push("");
  lines.push(`— ${tenant?.legalName ?? tenant?.displayName ?? ""}`);
  lines.push(`ARN ${tenant?.arn ?? "—"}`);
  lines.push(
    "_Mutual Fund investments are subject to market risks. Read all scheme-related documents carefully._"
  );
  return lines.join("\n");
}

/** Normalize +91XXXXXXXXXX or 9XXXXXXXXX to a wa.me-friendly digits-only string. */
function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, "");
  if (!digits) return null;
  // If 10 digits and starts with 6-9, assume India and prepend 91
  if (digits.length === 10 && /^[6-9]/.test(digits)) return `91${digits}`;
  return digits;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "proposal.send", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    const { channel, preview } = parse.data;
    const clientMeta = clientMetaFromHeaders(req.headers);
    // Managers send any proposal; everyone else only their own (mirrors the
    // collection GET scope).
    const seesAll = can(session.roles, "investor.view.all", session.permissions) || can(session.roles, "compliance.view", session.permissions);

    return await withTenant(session.tenantId, async (tx) => {
      const p = (await tx.select().from(proposals).where(and(eq(proposals.id, id), eq(proposals.tenantId, session.tenantId))).limit(1))[0];
      if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
      if (!seesAll && p.preparedByUserId !== session.userId) {
        return NextResponse.json({ error: "you can only send proposals you prepared" }, { status: 403 });
      }
      if (p.status === "superseded") {
        return NextResponse.json({ error: "A newer version replaced this proposal — send the latest version instead." }, { status: 409 });
      }
      if (["accepted", "partially_approved", "executed", "rejected"].includes(p.status as string)) {
        return NextResponse.json(
          { error: `cannot send a ${String(p.status).replace(/_/g, " ")} proposal` },
          { status: 409 }
        );
      }
      // The client's page refuses a proposal past its validity, so don't send
      // them a link that can only say "expired". Extending the date is allowed.
      if (p.validUntil && new Date(p.validUntil as any) < new Date()) {
        return NextResponse.json({ error: "This proposal's validity date has passed — set a new date before sending, or revise it." }, { status: 409 });
      }

      const hasNote = !!((p as any).suitabilityNote ?? "").toString().trim();
      const hasOverride = !!((p as any).suitabilityOverrideReason ?? "").toString().trim();
      const isOwner = session.roles.includes("owner");

      // ── HARD suitability gate (server-side, authoritative) ────────────
      // Don't trust the UI banner: recompute risk-alignment here from the
      // proposal's MF lines against the client's persisted risk profile. A
      // `block` verdict (a scheme ≥2 riskometer notches above the client's
      // appetite) cannot be sent unless an OWNER supplies an override reason.
      // This closes the gap where any free-text suitability note satisfied
      // the old check even for a clearly-unsuitable recommendation.
      const mfLines = ((p.products ?? []) as any[])
        .filter((it) => it?.kind === "mf")
        .map((it) => ({ name: it.schemeName ?? "Scheme", riskRating: it.riskRating ?? null }));
      // ── Risk profile gate: no mutual fund recommendation without the
      //    client's confirmed profile (signed, not provisional, < 12 months).
      if (mfLines.length) {
        const snap = await loadProposalSnapshot(tx, session.tenantId, {
          investorId: p.investorId, familyId: (p as any).familyId ?? null, leadId: p.leadId,
        });
        if (snap?.risk.status !== "Completed") {
          const why = snap?.risk.status === "Provisional" ? "is only provisional (not confirmed by the client)"
            : snap?.risk.status === "Due for review" ? "is more than a year old"
            : "is not on record";
          return NextResponse.json(
            { error: `A mutual fund proposal needs the client's confirmed risk profile, and theirs ${why}. Send them the risk profile link first.`, field: "riskProfile" },
            { status: 412 }
          );
        }
      }

      let clientProfile: any = null;
      if (p.recipientType === "investor" && p.investorId) {
        const inv = (
          await tx
            .select({ rp: investors.riskProfile })
            .from(investors)
            .where(and(eq(investors.id, p.investorId), eq(investors.tenantId, session.tenantId)))
            .limit(1)
        )[0];
        clientProfile = inv?.rp ?? null;
      }
      const alignment = mfLines.length ? checkAlignment(clientProfile, mfLines) : null;
      if (alignment?.overall === "block" && !(isOwner && hasOverride)) {
        return NextResponse.json(
          {
            error: `Suitability block — ${alignment.summary} This recommendation cannot be sent: re-assess the client's risk appetite or pick lower-risk funds. An owner may override with a documented reason.`,
            field: "suitabilityOverrideReason",
            alignment: {
              overall: alignment.overall,
              summary: alignment.summary,
              findings: alignment.findings.filter((f) => f.severity !== "ok"),
            },
          },
          { status: 412 }
        );
      }

      // ── Suitability note gate — every send needs a documented rationale
      //    (or an owner override). Kept on top of the hard block above.
      if (!hasNote && !hasOverride) {
        return NextResponse.json(
          {
            error:
              "Suitability note is required before sending. Capture why this proposal aligns with the client's risk profile, or have the owner add an override with reason.",
            field: "suitabilityNote",
          },
          { status: 412 }
        );
      }
      const tenant = (
        await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1)
      )[0];

      // What the channel would carry — nothing is minted, sent or changed.
      if (preview) {
        const link = "[link to the proposal]";
        if (channel === "email") {
          if (!p.recipientEmail) return NextResponse.json({ error: "recipient has no email on file" }, { status: 400 });
          return NextResponse.json({
            ok: true, channel, to: p.recipientEmail,
            subject: `${p.title} — ${tenant?.displayName ?? "Investment proposal"} (${p.proposalNumber})`,
            html: buildHtmlEmail({ tenant, proposal: p, publicUrl: link }),
            attachment: `Proposal-${String(p.proposalNumber ?? id).replace(/[^A-Za-z0-9_-]+/g, "_")}.pdf`,
          });
        }
        if (channel === "whatsapp") {
          const phone = normalizePhone(p.recipientPhone);
          if (!phone) return NextResponse.json({ error: "recipient has no phone number on file" }, { status: 400 });
          return NextResponse.json({ ok: true, channel, to: `+${phone}`, text: buildWhatsAppText({ tenant, proposal: p, publicUrl: link }) });
        }
        return NextResponse.json({ ok: true, channel, text: "A link to the client's proposal page, to paste into any message. They can read it, accept all or part of it, or ask for a change." });
      }

      // The client-facing link must be a PUBLIC proposal page, not an auth-gated
      // /dashboard URL (the old link redirected clients to login — and WhatsApp
      // carries no PDF attachment, so the link was the client's only access).
      // Mint a single-use proposal-approval token → /p/<token>.
      const share = await createShareToken({
        tenantId: session.tenantId,
        kind: "proposal_approval",
        subjectType: "proposal",
        subjectId: id,
        expiresInDays: 30,
        createdBy: session.userId,
      });
      const publicUrl = share.url;

      let externalId: string | null = null;
      let waUrl: string | null = null;
      let recipientUsed: string | null = null;
      let bodyText: string | null = null;
      let gate: Awaited<ReturnType<typeof gateClientSend>> | null = null;
      const proposalInvestorId = p.recipientType === "investor" ? p.investorId : null;

      if (channel === "email") {
        if (!p.recipientEmail) {
          return NextResponse.json(
            { error: "recipient has no email on file" },
            { status: 400 }
          );
        }
        recipientUsed = p.recipientEmail;
        const html = buildHtmlEmail({ tenant, proposal: p, publicUrl });
        bodyText = html;
        // Compliance + consent gate — a proposal is a regulated client document
        // (scheme recommendations / projected corpus). Scans for assured-return
        // & adviser-term language; respects channel opt-outs.
        gate = await gateClientSend(tx, {
          tenantId: session.tenantId, channel: "email", category: "transactional",
          text: html, subject: `${p.title} — ${tenant?.displayName ?? "Investment proposal"}`,
          investorId: proposalInvestorId,
        });
        if (!gate.allowed) {
          return NextResponse.json({ error: `Proposal blocked by compliance/consent: ${gate.detail}`, findings: (gate as any).findings }, { status: 422 });
        }
        // Generate the proposal PDF and attach it, and send through the firm's
        // OWN mailbox (RM → firm SMTP/OAuth → Resend). The old path sent via
        // Resend directly from an unverified "no-reply@…" From, which bounced.
        let pdf: Buffer | null = null;
        try {
          const people = await loadProposalPdfPeople(tx, p);
          pdf = await renderProposalPdf({ proposal: p as any, brand: proposalBrand(tenant), ...people });
        } catch (e) {
          console.warn("[proposal.send] PDF generation failed; sending without attachment:", (e as Error)?.message);
        }
        let sender: Awaited<ReturnType<typeof resolveEmailSender>>;
        try {
          sender = await resolveEmailSender(tx, session.tenantId, session.userId);
        } catch {
          sender = { source: "resend" };
        }
        if (!(sender.smtp?.host || sender.apiKey || process.env.RESEND_API_KEY)) {
          return NextResponse.json(
            { error: "No email sender connected. Connect your firm's mailbox under Settings → Email (SMTP/IMAP) to send proposals." },
            { status: 400 }
          );
        }
        try {
          const res = await emailAdapter.send({
            tenantId: session.tenantId,
            tokens: {},
            rendered: {
              subject: `${p.title} — ${tenant?.displayName ?? "Investment proposal"} (${p.proposalNumber})`,
              text: `Please find your proposal "${p.title}" (${p.proposalNumber}) attached. View it online: ${publicUrl}`,
              tokens: {},
            },
            recipient: p.recipientEmail,
            category: "transactional",
            inlineHtml: html,
            idempotencyKey: `proposal:${id}`,
            smtp: sender.smtp,
            apiKey: sender.apiKey,
            fromOverride: sender.fromEmail || undefined,
            fromNameOverride: sender.fromName || tenant?.displayName || tenant?.legalName || undefined,
            replyTo: sender.replyTo || undefined,
            attachments: pdf
              ? [{ filename: `Proposal-${String(p.proposalNumber ?? id).replace(/[^A-Za-z0-9_-]+/g, "_")}.pdf`, content: pdf }]
              : undefined,
          });
          externalId = res.externalId;
        } catch (e: any) {
          const m = String(e?.message ?? "");
          const friendly = /RESEND_API_KEY|EAUTH|invalid login|535|ECONNREFUSED|getaddrinfo|ETIMEDOUT|certificate|authentication/i.test(m)
            ? "Couldn't send — check your firm's email connection under Settings → Email (SMTP/IMAP)."
            : (m || "Could not send email");
          return NextResponse.json({ error: friendly }, { status: 502 });
        }
      } else if (channel === "whatsapp") {
        // whatsapp — generate wa.me link, client opens in new tab
        const phone = normalizePhone(p.recipientPhone);
        if (!phone) {
          return NextResponse.json(
            { error: "recipient has no phone number on file" },
            { status: 400 }
          );
        }
        recipientUsed = phone;
        const text = buildWhatsAppText({ tenant, proposal: p, publicUrl });
        bodyText = text;
        gate = await gateClientSend(tx, {
          tenantId: session.tenantId, channel: "whatsapp", category: "transactional",
          text, investorId: proposalInvestorId,
        });
        if (!gate.allowed) {
          return NextResponse.json({ error: `Proposal blocked by compliance/consent: ${gate.detail}`, findings: (gate as any).findings }, { status: 422 });
        }
        waUrl = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
      }

      // Log to communications (a copied link is not a message) + flip proposal status
      if (channel !== "link") await tx.insert(communications).values({
        tenantId: session.tenantId,
        investorId: p.recipientType === "investor" ? p.investorId : null,
        leadId: p.recipientType === "lead" ? p.leadId : null,
        userId: session.userId,
        channel,
        direction: "outbound",
        status: "sent",
        externalId,
        consentSnapshot: (gate?.allowed ? gate.consentSnapshot : null) as any,
        complianceSnapshot: (gate?.allowed ? gate.complianceFindings : null) as any,
        complianceScore: gate?.allowed ? String(gate.complianceScore) : null,
        payload: {
          kind: "proposal",
          proposalId: id,
          proposalNumber: p.proposalNumber,
          recipient: recipientUsed,
          body: bodyText?.slice(0, 4000) ?? null,
        } as any,
        sentAt: new Date(),
      } as any);

      await tx
        .update(proposals)
        .set({
          status: "sent",
          sentAt: p.sentAt ?? new Date(),
          updatedAt: new Date(),
        } as any)
        .where(and(eq(proposals.id, id), eq(proposals.tenantId, session.tenantId)));

      // Same follow-up as the manual status change (spec 13). Idempotent, and
      // non-fatal: the proposal has already gone to the client by this point,
      // so a task failure must not turn a successful send into an error.
      try {
        const { createProposalSharedTask } = await import("@/lib/proposals/shared-task");
        await createProposalSharedTask(tx, {
          tenantId: session.tenantId,
          proposalId: id,
          proposalNumber: p.proposalNumber,
          investorId: p.recipientType === "investor" ? p.investorId : null,
          leadId: p.recipientType === "lead" ? p.leadId : null,
          preparedByUserId: (p as any).preparedByUserId,
          actorUserId: session.userId,
          proposalCreatedAt: (p as any).createdAt,
        });
      } catch (e) {
        console.warn("[proposals] shared follow-up task skipped:", (e as Error)?.message);
      }

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "proposal.send",
        entityType: "proposal",
        entityId: id,
        after: {
          channel,
          recipient: recipientUsed,
          externalId,
        },
        ...clientMeta,
      });

      // ─── Journey: Proposal Sent (forward only) ─────────────────────
      // A fresh proposal to a client already in onboarding or fully active
      // must not pull their journey back — see lib/proposals/journey.ts.
      await advanceJourneyForProposal(tx, p as any, "proposal.sent", `Auto: proposal ${p.proposalNumber} sent via ${channel}.`, session.userId);

      return NextResponse.json({
        ok: true,
        channel,
        externalId,
        waUrl,
        url: channel === "link" ? publicUrl : undefined,
      });
    });
  } catch (err: any) {
    return handleApiError(err);
  }
}
