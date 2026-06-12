/**
 * POST /api/calculators/share
 *
 * Share a branded calculator illustration:
 *   { channel: "email", to: <email>, calcName, clientName?, blocks }
 *     → generates the PDF and emails it to the client (Resend, with the firm's
 *       sender + letterhead).
 *   { channel: "whatsapp", to?: <phone>, calcName, clientName?, blocks }
 *     → generates the PDF, hosts it (presigned S3 URL) and returns a wa.me link
 *       the advisor opens to send it from their own WhatsApp.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { tenants } from "@/db/schema";
import { renderCalcPdf, type PdfBlock } from "@/lib/calculators/calc-pdf";
import { fetchBrandLogoBytes, normalizeWaPhone } from "@/lib/calculators/share-helpers";
import { pickLogo } from "@/lib/branding/logo";
import { emailAdapter } from "@/lib/comms/adapters/resend";
import { resolveEmailSender } from "@/lib/comms/sender";
import { emailLogoHeaderHtml } from "@/lib/comms/email-logo";
import { isS3Configured, putObject, presignedGetUrl } from "@/lib/storage/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const esc = (s: string) => (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const Body = z.object({
  channel: z.enum(["email", "whatsapp"]),
  to: z.string().max(120).optional(),
  calcName: z.string().min(1).max(120),
  clientName: z.string().max(120).optional().nullable(),
  blocks: z.array(z.any()).max(300),
});

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    const { channel, to, calcName, clientName, blocks } = parsed.data;

    const ctx = await withTenant(session.tenantId, async (tx) => {
      const tenant = (await tx.select().from(tenants).where(eq(tenants.id, session.tenantId)).limit(1))[0] ?? null;
      let sender;
      try { sender = await resolveEmailSender(tx, session.tenantId, session.userId); } catch { sender = { source: "resend" } as any; }
      return { tenant, sender };
    });
    const tenant = ctx.tenant as any;
    const firmName = tenant?.displayName ?? tenant?.legalName ?? "Your advisor";

    const proto = req.headers.get("x-forwarded-proto") ?? "https";
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
    const origin = host ? `${proto}://${host}` : null;
    const logoBytes = await fetchBrandLogoBytes(pickLogo(tenant, "full"), origin);
    const pdf = await renderCalcPdf({
      firmName: tenant?.legalName ?? tenant?.displayName ?? "Your firm",
      arn: tenant?.arn ?? null,
      preparedBy: session.name,
      clientName: clientName ?? null,
      calcName,
      blocks: blocks as PdfBlock[],
      logoBytes,
      primaryHex: tenant?.primaryColor ?? null,
    });
    const fname = `${clientName || "Client"}-${calcName}`.replace(/[^A-Za-z0-9_-]+/g, "_").slice(0, 60) + ".pdf";

    if (channel === "email") {
      const email = (to ?? "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return NextResponse.json({ error: "Enter a valid client email." }, { status: 400 });
      }
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#0f172a;">
        ${emailLogoHeaderHtml(tenant?.logoUrl, firmName)}
        <p>Dear ${esc(clientName || "Investor")},</p>
        <p>Please find your <strong>${esc(calcName)}</strong> illustration attached as a PDF. It's based on the assumptions we discussed and is for illustration only.</p>
        <p>Happy to walk you through it on a call.</p>
        <p style="margin-top:20px;">Warm regards,<br/><strong>${esc(firmName)}</strong></p>
        <p style="font-size:11px;color:#64748b;margin-top:20px;border-top:1px solid #e2e8f0;padding-top:10px;">Mutual fund investments are subject to market risks. Read all scheme related documents carefully.</p>
      </div>`;
      try {
        const res = await emailAdapter.send({
          tenantId: session.tenantId,
          tokens: {},
          rendered: { subject: `Your ${calcName} illustration`, text: `Please find your ${calcName} illustration attached.`, tokens: {} },
          recipient: email,
          category: "transactional",
          inlineHtml: html,
          idempotencyKey: `calc:${session.userId}:${Date.now()}`,
          smtp: (ctx.sender as any).smtp,
          apiKey: (ctx.sender as any).apiKey,
          fromOverride: (ctx.sender as any).fromEmail || undefined,
          fromNameOverride: (ctx.sender as any).fromName || firmName,
          replyTo: (ctx.sender as any).replyTo || undefined,
          attachments: [{ filename: fname, content: pdf }],
        } as any);
        return NextResponse.json({ ok: true, externalId: (res as any)?.externalId ?? null });
      } catch (e: any) {
        const m = String(e?.message ?? "");
        const friendly = /RESEND_API_KEY|EAUTH|invalid login|535|ECONNREFUSED|getaddrinfo|certificate|authentication/i.test(m)
          ? "Couldn't send — check your firm's email connection under Settings → Email."
          : (m || "Could not send email");
        return NextResponse.json({ error: friendly }, { status: 502 });
      }
    }

    // WhatsApp — host the PDF, return a wa.me link the advisor opens.
    let pdfUrl: string | null = null;
    if (isS3Configured()) {
      try {
        const key = `calculators/${session.tenantId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`;
        await putObject(key, pdf, "application/pdf");
        pdfUrl = await presignedGetUrl(key, 7 * 24 * 3600, fname);
      } catch { pdfUrl = null; }
    }
    const phone = to ? normalizeWaPhone(to) : null;
    const text = `Hi${clientName ? " " + clientName : ""}, here's your ${calcName} illustration from ${firmName}.${pdfUrl ? "\n\n" + pdfUrl : ""}`;
    const waLink = `https://wa.me/${phone ?? ""}?text=${encodeURIComponent(text)}`;
    return NextResponse.json({ ok: true, waLink, pdfUrl, hosted: !!pdfUrl });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Could not share" }, { status: err?.status ?? 500 });
  }
}
