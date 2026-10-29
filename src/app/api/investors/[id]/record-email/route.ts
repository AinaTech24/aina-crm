/**
 * POST /api/investors/[id]/record-email   { kind: "sip_rejection" | "transaction", recordId }
 *
 * Emails the client about ONE record of theirs — a rejected SIP (SIP Rejections)
 * or a switch / STP / SWP (Transactions) — with that record's own scheme, amount,
 * folio, date and reason (lib/comms/record-email), not the client's latest
 * transaction. The email is the vendor's "SIP — Rejection / Failed Installment"
 * or "Switch / STP / SWP Confirmed" template, installed for the firm the first
 * time it is used, and goes through dispatch() like every outbound: consent, the
 * compliance gate, the RM's own mailbox when connected.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { handleApiError } from "@/lib/api/error-handler";
import { assertInvestorAccess } from "@/lib/investors/access";
import { investors, sipRejections, transactions } from "@/db/schema";
import { dispatch } from "@/lib/comms/pipeline";
import { dispatchFailureMessage } from "@/lib/comms/dispatch-messages";
import { OPEN_SIP_STATUSES, sipRejectionEmail, switchEmail } from "@/lib/comms/record-email";
import { installEmailStarters } from "@/lib/templates/install-client-emails";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";

export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(["sip_rejection", "transaction"]),
  recordId: z.string().uuid(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    const { id } = await params;
    await assertInvestorAccess(session, id);
    // Same gate as sending any message to a client from their record.
    requireCap(session.roles, "investor.note.add", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const { kind, recordId } = parsed.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [inv] = await tx
        .select({ id: investors.id, name: investors.name, email: investors.email })
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .limit(1);
      if (!inv) return { error: "Client not found.", status: 404 } as const;
      if (!inv.email) return { error: "This client has no email address on file.", status: 400 } as const;

      let built: { templateKey: string; variables: Record<string, string> } | null = null;
      if (kind === "sip_rejection") {
        const [rej] = await tx
          .select()
          .from(sipRejections)
          .where(and(eq(sipRejections.id, recordId), eq(sipRejections.tenantId, session.tenantId), eq(sipRejections.investorId, id)))
          .limit(1);
        if (!rej) return { error: "That SIP rejection was not found for this client.", status: 404 } as const;
        // The email says the SIP did not go through and needs action: not for one
        // already recovered, reprocessed or written off.
        if (!(OPEN_SIP_STATUSES as readonly string[]).includes(rej.recoveryStatus)) {
          return { error: "This SIP rejection is already closed, so the client is not emailed about it.", status: 400 } as const;
        }
        built = sipRejectionEmail(rej);
      } else {
        const [t] = await tx
          .select()
          .from(transactions)
          .where(and(eq(transactions.id, recordId), eq(transactions.tenantId, session.tenantId), eq(transactions.investorId, id)))
          .limit(1);
        if (!t) return { error: "That transaction was not found for this client.", status: 404 } as const;
        built = switchEmail(t);
        if (!built) {
          return { error: "Only a switch, STP or SWP that has been processed can be emailed from here.", status: 400 } as const;
        }
      }

      await installEmailStarters(tx, session.tenantId, [built.templateKey], session.userId);

      const sent = await dispatch(tx, {
        tenantId: session.tenantId,
        channel: "email",
        templateKey: built.templateKey,
        recipient: inv.email,
        variables: built.variables,
        category: "transactional",
        investorId: id,
        actorUserId: session.userId,
        // Stable for ten minutes, so a double click or a retry after a slow
        // response is the same send, not a second email.
        idempotencyKey: `record-email:${kind}:${recordId}:${Math.floor(Date.now() / 600_000)}`,
      });

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: "communication.send",
        entityType: "communication",
        entityId: sent.communicationId || "—",
        after: { channel: "email", recipient: inv.email, template: built.templateKey, about: kind, recordId, status: sent.status },
        ...clientMeta,
      });
      return { sent, email: inv.email } as const;
    });

    if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    const { sent, email } = outcome;
    if (sent.status === "skipped" || sent.status === "failed") {
      return NextResponse.json({ ...sent, error: dispatchFailureMessage(sent) }, { status: 422 });
    }
    return NextResponse.json({ ok: true, status: sent.status, email });
  } catch (err) {
    return handleApiError(err);
  }
}
