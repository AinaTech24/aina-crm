import { assertInvestorAccess } from "@/lib/investors/access";
/**
 * POST /api/investors/[id]/send-link-email   { kind: "risk_profile" | "feedback" }
 *
 * Actually SENDS the client-facing link by email from the CRM — the popover's
 * Email option used to be a `mailto:` link, which only opens the RM's own mail
 * app and sends nothing when none is set up (a browser-only desktop, a phone
 * without a default mail app).
 *
 * Mints a fresh share token server-side (the link is never taken from the
 * request, so this cannot be used to mail an arbitrary URL), then goes through
 * composeAndSendEmail: suppression list, consent, the compliance gate, the RM's
 * own mailbox → the firm mailbox → Resend, and a `communications` row either way.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { investors } from "@/db/schema";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, requireAny } from "@/lib/auth/rbac";
import { createShareToken } from "@/lib/share-tokens";
import { composeAndSendEmail } from "@/lib/comms/compose";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { handleApiError } from "@/lib/api/error-handler";

export const dynamic = "force-dynamic";

const Body = z.object({ kind: z.enum(["risk_profile", "feedback"]) });

const COPY = {
  risk_profile: {
    subject: "Your risk profile assessment",
    days: 14,
    body: (url: string) =>
      `Hi {{name}},\n\nPlease complete your risk profile assessment using the secure link below - it only takes a couple of minutes and needs no login:\n${url}\n\nThe link is valid for 14 days.`,
  },
  feedback: {
    subject: "How are we doing?",
    days: 30,
    body: (url: string) =>
      `Hi {{name}},\n\nWe would value your feedback. It is one question and takes about a minute - no login needed:\n${url}`,
  },
} as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await requireSession();
    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
    const kind = parsed.data.kind;
    await assertInvestorAccess(session, id);
    if (kind === "risk_profile") requireCap(session.roles, "risk_profile.manage", session.permissions);
    else requireAny(session.roles, ["investor.view.all", "investor.view.assigned"], session.permissions);

    const clientMeta = clientMetaFromHeaders(req.headers);
    const copy = COPY[kind];

    const inv = await withTenant(session.tenantId, async (tx) => {
      const [row] = await tx
        .select({ id: investors.id, name: investors.name, email: investors.email })
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .limit(1);
      return row ?? null;
    });
    if (!inv) return NextResponse.json({ error: "investor not found" }, { status: 404 });
    const email = inv.email?.trim();
    if (!email) return NextResponse.json({ error: "This client has no email address on file." }, { status: 400 });

    const { url } = await createShareToken({
      tenantId: session.tenantId,
      kind,
      subjectType: "investor",
      subjectId: id,
      createdBy: session.userId,
      expiresInDays: copy.days,
    });

    const result = await withTenant(session.tenantId, async (tx) => {
      const r = await composeAndSendEmail(tx, {
        tenantId: session.tenantId,
        subject: copy.subject,
        body: copy.body(url),
        category: "transactional",
        recipient: email,
        recipientName: inv.name,
        investorId: id,
        actorUserId: session.userId,
      });
      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "communication.send",
        entityType: "communication",
        entityId: r.communicationId || "—",
        after: { channel: "email", recipient: email, category: "transactional", status: r.status, subject: copy.subject, link: kind },
        ...clientMeta,
      });
      return r;
    });

    if (result.status === "sent" || result.status === "queued") {
      return NextResponse.json({ ok: true, status: result.status, email });
    }
    const why =
      result.reason === "skipped_consent" ? "The client has opted out of email."
      : result.reason === "skipped_compliance" ? "The message was blocked by the compliance check."
      : result.reason?.startsWith("suppressed_") ? "This address is suppressed (it bounced or unsubscribed)."
      : result.reason ?? "The email could not be sent.";
    return NextResponse.json({ error: why, status: result.status }, { status: 422 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
