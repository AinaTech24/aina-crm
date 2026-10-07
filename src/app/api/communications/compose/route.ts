import { handleApiError } from "@/lib/api/error-handler";
/**
 * POST /api/communications/compose
 *
 * Ad-hoc 1:1 client email. Routes through the same consent + compliance gate as
 * every other send (via src/lib/comms/compose.ts) and lands an audited
 * `communications` row. Send now, or schedule for later.
 *
 * Recipient: an investorId or leadId (resolves the email + applies consent), or
 * a raw email address (no consent record → flagged, allowed).
 */

import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap, can } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { recordAudit, clientMetaFromHeaders } from "@/lib/audit";
import { investors, leads } from "@/db/schema";
import { composeAndSendEmail, scheduleEmail } from "@/lib/comms/compose";
import { dataWallApplies, loadViewableInvestor } from "@/lib/investors/access";
import { loadViewableLead } from "@/lib/leads/access";

export const dynamic = "force-dynamic";

/** Mail providers cap a message at ~25-40 MB; stay well under, base64 inflates ~4/3. */
const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

const Body = z
  .object({
    investorId: z.string().uuid().optional(),
    leadId: z.string().uuid().optional(),
    toEmail: z.string().email().optional(),
    subject: z.string().min(1).max(300),
    body: z.string().min(1).max(20000),
    category: z.enum(["transactional", "marketing"]).default("transactional"),
    /** ISO datetime; when present + future → scheduled instead of sent now. */
    scheduledAt: z.string().datetime().optional(),
    /** Files to send with the mail (send-now only), base64-encoded. */
    attachments: z
      .array(
        z.object({
          filename: z.string().min(1).max(200),
          contentBase64: z.string().min(1),
        })
      )
      .max(MAX_ATTACHMENTS)
      .optional(),
  })
  .refine((b) => b.investorId || b.leadId || b.toEmail, {
    message: "one of investorId / leadId / toEmail is required",
  });

export async function POST(req: NextRequest) {
  try {
    const session = await requireSession();
    requireCap(session.roles, "communication.send", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);

    const parsed = Body.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const b = parsed.data;
    const clientMeta = clientMetaFromHeaders(req.headers);

    // Managers / ops / compliance may compose to any client in the firm; a plain
    // RM (or marketing) may only email their own clients / leads.
    const seesAll =
      can(session.roles, "investor.view.all", session.permissions) ||
      can(session.roles, "compliance.view", session.permissions) ||
      can(session.roles, "reports.business", session.permissions);

    const scheduledAt = b.scheduledAt ? new Date(b.scheduledAt) : null;
    if (scheduledAt && scheduledAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: "scheduledAt must be in the future" }, { status: 400 });
    }

    // Attachments are sent now or not at all — a scheduled row keeps no bytes.
    const attachments = (b.attachments ?? []).map((a) => ({
      // A bare file name: no path, no control characters.
      filename: a.filename.replace(/[\\/]/g, "_").replace(/[\u0000-\u001f]/g, "").trim() || "attachment",
      content: Buffer.from(a.contentBase64, "base64"),
    }));
    if (attachments.length && scheduledAt) {
      return NextResponse.json({ error: "Attachments can only be sent now, not scheduled." }, { status: 400 });
    }
    if (attachments.reduce((n, a) => n + a.content.length, 0) > MAX_ATTACHMENT_BYTES) {
      return NextResponse.json({ error: "Attachments are larger than 10 MB in total." }, { status: 413 });
    }

    const hasInvestorView =
      can(session.roles, "investor.view.all", session.permissions) ||
      can(session.roles, "investor.view.assigned", session.permissions);

    const out = await withTenant(session.tenantId, async (tx) => {
      // Resolve recipient email + display name.
      let recipient = b.toEmail ?? "";
      let recipientName: string | null = null;
      if (b.investorId) {
        // Tenant predicate is the live cross-tenant guard (RLS-bypass model) —
        // mirror the sibling actions route. Pull rmId to enforce own-client scope.
        const [inv] = await tx
          .select({ email: investors.email, name: investors.name, rmId: investors.rmId })
          .from(investors)
          .where(and(eq(investors.id, b.investorId), eq(investors.tenantId, session.tenantId)))
          .limit(1);
        if (!inv) throw Object.assign(new Error("investor not found"), { status: 404 });
        if (!seesAll && inv.rmId !== session.userId) {
          throw Object.assign(new Error("not your client"), { status: 403 });
        }
        // Under the data wall, oversight viewers compose only within their
        // client scope (a viewer with no client capability has none to apply —
        // loadViewableInvestor would throw a 403).
        if (seesAll && hasInvestorView && (await dataWallApplies(tx, session))
          && !(await loadViewableInvestor(tx, session, b.investorId))) {
          throw Object.assign(new Error("investor not found"), { status: 404 });
        }
        // An address typed in the composer wins (the record may hold none, or
        // an old one); the mail stays linked to the client either way.
        if (!inv.email && !b.toEmail) throw Object.assign(new Error("investor has no email on file"), { status: 400 });
        recipient = b.toEmail ?? inv.email!;
        recipientName = inv.name;
      } else if (b.leadId) {
        const [ld] = await tx
          .select({ email: leads.email, name: leads.name, ownerId: leads.ownerId })
          .from(leads)
          .where(and(eq(leads.id, b.leadId), eq(leads.tenantId, session.tenantId)))
          .limit(1);
        if (!ld) throw Object.assign(new Error("lead not found"), { status: 404 });
        if (!seesAll && ld.ownerId !== session.userId) {
          throw Object.assign(new Error("not your lead"), { status: 403 });
        }
        if (seesAll && (can(session.roles, "lead.view.all", session.permissions) || can(session.roles, "lead.view.assigned", session.permissions))
          && (await dataWallApplies(tx, session))
          && !(await loadViewableLead(tx, session, b.leadId))) {
          throw Object.assign(new Error("lead not found"), { status: 404 });
        }
        if (!ld.email && !b.toEmail) throw Object.assign(new Error("lead has no email on file"), { status: 400 });
        recipient = b.toEmail ?? ld.email!;
        recipientName = ld.name;
      }

      const input = {
        tenantId: session.tenantId,
        subject: b.subject,
        body: b.body,
        category: b.category,
        recipient,
        recipientName,
        investorId: b.investorId ?? null,
        leadId: b.leadId ?? null,
        actorUserId: session.userId,
        attachments,
      };

      const result = scheduledAt
        ? await scheduleEmail(tx, input, scheduledAt)
        : await composeAndSendEmail(tx, input);

      await recordAudit(tx, {
        tenantId: session.tenantId,
        actorUserId: session.userId,
        action: scheduledAt ? "communication.schedule" : "communication.send",
        entityType: "communication",
        entityId: result.communicationId || "—",
        after: { channel: "email", recipient, category: b.category, status: result.status, subject: b.subject },
        ...clientMeta,
      });

      return result;
    });

    // A compliance block is a real, expected outcome — surface it as 422 so the
    // compose UI can show the findings rather than treating it as a 500.
    if (out.status === "skipped" && out.reason === "skipped_compliance") {
      return NextResponse.json({ error: "blocked by compliance", findings: out.findings, ...out }, { status: 422 });
    }
    return NextResponse.json(out, { status: out.status === "scheduled" ? 201 : 200 });
  } catch (err: any) {
    return handleApiError(err);
  }
}
