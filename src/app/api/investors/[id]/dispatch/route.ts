import { assertInvestorAccess } from "@/lib/investors/access";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { withTenant } from "@/db/client";
import { requireSession } from "@/lib/auth/session";
import { require as requireCap } from "@/lib/auth/rbac";
import { assertActiveLicense } from "@/lib/auth/license";
import { handleApiError } from "@/lib/api/error-handler";
import { templates, templateVersions, investors } from "@/db/schema";
import { dispatch } from "@/lib/comms/pipeline";

export const dynamic = "force-dynamic";

// GET /api/investors/[id]/dispatch
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await assertInvestorAccess(session, (await params).id);
    const { id } = await params;

    const data = await withTenant(session.tenantId, async (tx) => {
      const [inv] = await tx
        .select()
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .limit(1);
      // A missing client is a 404, not a server error.
      if (!inv) return null;

      const rows = await tx
        .select({
          id: templates.id,
          key: templates.key,
          channel: templates.channel,
          name: templates.name,
          description: templates.description,
          category: templates.category,
          variables: templateVersions.variables,
        })
        .from(templates)
        .innerJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
        .where(
          and(
            eq(templates.tenantId, session.tenantId),
            eq(templates.status, "approved")
          )
        );
      return rows;
    });

    if (data === null) return NextResponse.json({ error: "Client not found" }, { status: 404 });
    return NextResponse.json(data);
  } catch (err: any) {
    return handleApiError(err);
  }
}

const REASONS: Record<string, string> = {
  skipped_consent: "Not sent - the client has opted out of this channel, or marketing consent is not recorded.",
  skipped_compliance: "Not sent - blocked by the compliance check.",
  skipped_session: "Not sent - the WhatsApp session with this client is not active.",
  skipped_rate_limit: "Not sent - the sending rate limit was reached. Try again shortly.",
  skipped_quota: "Not sent - the monthly message quota is used up.",
  skipped_frequency_cap: "Not sent - this client was messaged too recently.",
  skipped_no_contact: "Not sent - no valid address for this client (missing or suppressed).",
  template_not_approved: "Not sent - the template is not approved.",
};

function dispatchFailureMessage(r: { status: string; error?: string; skipped?: { reason: string; detail?: string } }): string {
  if (r.status === "failed") return r.error ? `The email could not be sent: ${r.error}` : "The message could not be sent.";
  const reason = r.skipped?.reason ?? "";
  // A render error carries the real cause (e.g. no holdings to compare); the others have a standard line.
  if (reason === "render_error") return r.skipped?.detail ?? "The message could not be prepared.";
  const base = REASONS[reason] ?? `Not sent (${reason || "skipped"}).`;
  return reason === "skipped_consent" && r.skipped?.detail ? r.skipped.detail : base;
}

const PostBody = z.object({
  channel: z.enum(["whatsapp", "email", "sms"]),
  templateKey: z.string(),
  variables: z.record(z.string(), z.any()),
});

// POST /api/investors/[id]/dispatch
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession();
    await assertInvestorAccess(session, (await params).id);
    // Sending an outbound message to a client is a client-facing action —
    // gate it to roles that can act on a client (RM/ops/back-office/etc).
    requireCap(session.roles, "investor.note.add", session.permissions);
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;

    const parsed = PostBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { channel, templateKey, variables } = parsed.data;

    // Bad input is the caller's problem, not a server fault — resolve first and
    // map to a real status code instead of throwing into a generic 500.
    const outcome = await withTenant(session.tenantId, async (tx) => {
      const [inv] = await tx
        .select()
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .limit(1);
      if (!inv) return { error: "Client not found", status: 404 } as const;

      let recipient = "";
      if (channel === "email") {
        recipient = inv.email ?? "";
      } else if (channel === "whatsapp") {
        recipient = inv.whatsappPhone ?? inv.phone ?? "";
      } else if (channel === "sms") {
        recipient = inv.phone ?? "";
      }

      if (!recipient) {
        return {
          error: `This client has no ${channel === "email" ? "email address" : "phone number"} on file.`,
          status: 400,
        } as const;
      }

      const [tmpl] = await tx
        .select()
        .from(templates)
        .where(
          and(
            eq(templates.tenantId, session.tenantId),
            eq(templates.key, templateKey),
            eq(templates.channel, channel)
          )
        )
        .limit(1);

      if (!tmpl) {
        return { error: `No approved ${channel} template '${templateKey}'.`, status: 404 } as const;
      }

      const sent = await dispatch(tx, {
        tenantId: session.tenantId,
        channel,
        templateKey,
        recipient,
        variables,
        category: tmpl.category,
        investorId: id,
      });

      return { sent } as const;
    });

    if ("error" in outcome) {
      return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    }
    const result = outcome.sent;

    // dispatch() reports a skipped or failed send as a normal RESULT (the audit row
    // is written either way), so it used to come back as HTTP 200 and the popup
    // showed "dispatched successfully" for an email that never left. Say what
    // happened, with the reason, so the RM can act on it.
    if (result.status === "skipped" || result.status === "failed") {
      return NextResponse.json({ ...result, error: dispatchFailureMessage(result) }, { status: 422 });
    }
    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
