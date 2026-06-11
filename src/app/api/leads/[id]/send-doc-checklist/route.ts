import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/leads/[id]/send-doc-checklist
 *
 * One-click: mint a secure document-collection link for the lead's client and
 * send it via BOTH email (Resend) and WhatsApp (WAina) in a single action. Used
 * by the "Send Doc Checklist" guided stage action. Advances the blueprint to
 * documents_pending is handled by the caller's afterStage.
 *
 * Body: { clientType?: "individual" | "huf" | "nri" | "minor" | "company" | "trust" }
 * → { url, summary, email, whatsapp, waMeUrl }
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { leads } from "@/db/schema";
import { createShareToken } from "@/lib/share-tokens";
import { sendSystemEmail } from "@/lib/comms/system-email";
import { dispatch } from "@/lib/comms/pipeline";
import { getChecklist, type ClientType } from "@/lib/onboarding/doc-checklists";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DOCS_LINE = "PAN card, Aadhaar, passport-size photo, recent bank statement, cancelled cheque";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const session = await requireSession();
    requireCap(session.roles, "lead.edit.assigned");

    const body = await req.json().catch(() => ({}));
    const clientType = (["individual", "huf", "nri", "minor", "company", "trust"].includes(body?.clientType)
      ? body.clientType
      : "individual") as ClientType;

    const lead = await withTenant(session.tenantId, async (tx) =>
      (await tx.select().from(leads).where(and(eq(leads.id, id), eq(leads.tenantId, session.tenantId))).limit(1))[0] ?? null
    );
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    const name = (lead as any).name ?? "there";
    const email = (lead as any).email as string | null;
    const phone = (lead as any).phone as string | null;
    const investorId = (lead as any).convertedInvestorId as string | null;

    if (!email && !phone) {
      return NextResponse.json({ error: "This client has no email or phone on file — add a contact first." }, { status: 400 });
    }

    // 1. Mint the secure, single-use document-collection link.
    const requiredDocs = getChecklist(clientType);
    const token = await createShareToken({
      tenantId: session.tenantId,
      kind: "document_collection",
      subjectType: investorId ? "investor" : "lead",
      subjectId: investorId ?? id,
      payload: { requiredDocs, clientType },
      expiresInDays: 7,
      createdBy: session.userId,
    });
    const url = (token as any).url as string;

    const waText = `Hi ${name}, please upload your KYC documents to complete your account setup — secure, single-use link:\n\n${url}\n\nYou'll need: ${DOCS_LINE}.`;

    // 2. Email (Resend) — never throws.
    let email_: { sent: boolean; reason?: string } = { sent: false, reason: "no_email" };
    if (email) {
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;">
        <p>Hi ${escapeHtml(name)},</p>
        <p>To complete your account setup, please upload your KYC documents using this secure, single-use link:</p>
        <p style="margin:18px 0;"><a href="${escapeAttr(url)}" style="background:#0e2557;color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600;display:inline-block;">Upload documents</a></p>
        <p style="font-size:13px;color:#475569;">Required: ${DOCS_LINE}.</p>
        <p style="font-size:11px;color:#94a3b8;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:10px;">The link is single-use and expires in 7 days. Mutual fund investments are subject to market risks.</p>
      </div>`;
      email_ = await sendSystemEmail({
        tenantId: session.tenantId,
        to: email,
        subject: "Documents needed for your investment account",
        text: `Hi ${name}, please upload your KYC documents using this secure link: ${url}\n\nRequired: ${DOCS_LINE}.`,
        html,
        idempotencyKey: `doc-checklist:${id}:${String((token as any).token ?? "").slice(0, 8)}`,
      });
    }

    // 3. WhatsApp (WAina) via the comms pipeline.
    let waStatus = "no_phone";
    if (phone) {
      try {
        waStatus = await withTenant(session.tenantId, async (tx) => {
          const r = await dispatch(tx, {
            tenantId: session.tenantId,
            channel: "whatsapp",
            freeformText: waText,
            recipient: phone,
            category: "utility",
            investorId: investorId ?? undefined,
            leadId: investorId ? undefined : id,
          } as any);
          return String((r as any)?.status ?? "queued");
        });
      } catch (e: any) {
        waStatus = "failed";
      }
    }

    const emailed = email_.sent;
    const whatsapped = ["sent", "queued", "delivered"].includes(waStatus);
    const waMeUrl = phone ? `https://wa.me/${phone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(waText)}` : null;
    const summary = [
      emailed ? "📧 Email sent" : email ? "📧 Email failed" : "📧 no email on file",
      whatsapped ? "💬 WhatsApp sent" : phone ? `💬 WhatsApp ${waStatus.replace(/_/g, " ")}` : "💬 no phone on file",
    ].join("  ·  ");

    return NextResponse.json({ url, summary, email: email_, whatsapp: { status: waStatus }, waMeUrl });
  } catch (err: any) {
    return handleApiError(err);
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return String(s).replace(/"/g, "&quot;");
}
