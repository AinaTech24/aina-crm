import { NextRequest, NextResponse } from "next/server";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { renderEmailHtml } from "@/lib/email-designer/render";
import { emailAdapter } from "@/lib/comms/adapters/resend";
import { resolveEmailSender } from "@/lib/comms/sender";
import type { EmailDesignerBody } from "@/lib/email-designer/types";
import { loadPreviewContext, resolveSubjectSample } from "@/lib/email-designer/preview-context";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

/**
 * POST /api/email-designer/test-send  { body, to? }
 *
 * Renders the in-progress designer body with sample merge values and emails it
 * to the requester (or `to`) so they can see the real inbox look before saving.
 * Sample-data send — never touches a real client or the consent pipeline.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "template.edit", session.permissions);
    const { body, to } = await req.json().catch(() => ({ body: null }));
    if (!body) return NextResponse.json({ error: "missing body" }, { status: 400 });

    const recipient = String(to ?? session.email ?? "").trim();
    if (!recipient || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
      return NextResponse.json({ error: "No valid email address to send the test to." }, { status: 400 });
    }

    // Resolve BOTH the tenant record and the tenant's email sender (their own
    // mailbox / OAuth / Resend key) in one tenant-scoped tx — the same resolver
    // the real send pipeline uses. Sending via the shared platform Resend key
    // fails in production (RESEND_API_KEY is intentionally unset; every firm
    // sends from its own connected mailbox).
    const sender = await withTenant(session.tenantId, async (tx) =>
      resolveEmailSender(tx, session.tenantId, session.userId)
    );

    // No firm mailbox connected AND no platform Resend key → give a clear,
    // actionable message instead of a generic "internal" error.
    if (!sender.smtp && !sender.apiKey && !process.env.RESEND_API_KEY) {
      return NextResponse.json(
        { error: "No email account is connected for your firm. Connect your mailbox in Settings → Email, then try the test send again." },
        { status: 400 }
      );
    }

    // Same context as the on-screen preview: real firm branding, sample client
    // data, signed off as the sender. The previous inline mapping read columns
    // that do not exist on `tenants` (addressLine1 / websiteUrl / brandingConfig),
    // so test mail silently lost the firm's address and brand colour.
    const ctx = await loadPreviewContext(session.tenantId, session.userId);

    const html = renderEmailHtml(body as EmailDesignerBody, {
      variables: ctx.variables,
      tenant: ctx.tenant,
      unsubscribeUrl: "#test",
    });

    const subject = `[TEST] ${resolveSubjectSample((body as EmailDesignerBody).subject ?? "", ctx.variables)}`;

    await emailAdapter.send({
      tenantId: session.tenantId,
      inlineHtml: html,
      tokens: {},
      rendered: { subject, text: "This is a test render of your email template.", tokens: {} },
      recipient,
      category: "transactional",
      // Send from the firm's own mailbox / Resend key (falls back to platform
      // Resend only if a key is set) — mirrors the real send pipeline.
      apiKey: sender.apiKey,
      smtp: sender.smtp,
      fromOverride: sender.fromEmail ?? (sender.smtp ? sender.smtp.user : undefined),
      fromNameOverride: sender.fromName,
      replyTo: sender.replyTo,
    });

    return NextResponse.json({ ok: true, sentTo: recipient });
  } catch (err: any) {
    return handleApiError(err);
  }
}
