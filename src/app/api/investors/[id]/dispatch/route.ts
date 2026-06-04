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
    const { id } = await params;

    const data = await withTenant(session.tenantId, async (tx) => {
      const [inv] = await tx
        .select()
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .limit(1);
      if (!inv) {
        throw new Error("Investor not found");
      }

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

    return NextResponse.json(data);
  } catch (err: any) {
    return handleApiError(err);
  }
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
    // Sending an outbound message to a client is a client-facing action —
    // gate it to roles that can act on a client (RM/ops/back-office/etc).
    requireCap(session.roles, "investor.note.add");
    await assertActiveLicense(session.tenantId, session.roles);
    const { id } = await params;

    const parsed = PostBody.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
    }
    const { channel, templateKey, variables } = parsed.data;

    const result = await withTenant(session.tenantId, async (tx) => {
      const [inv] = await tx
        .select()
        .from(investors)
        .where(and(eq(investors.id, id), eq(investors.tenantId, session.tenantId)))
        .limit(1);
      if (!inv) {
        throw new Error("Investor not found");
      }

      let recipient = "";
      if (channel === "email") {
        recipient = inv.email ?? "";
      } else if (channel === "whatsapp") {
        recipient = inv.whatsappPhone ?? inv.phone ?? "";
      } else if (channel === "sms") {
        recipient = inv.phone ?? "";
      }

      if (!recipient) {
        throw new Error(`Recipient details missing for channel: ${channel}`);
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
        throw new Error(`Template '${templateKey}' not found for channel: ${channel}`);
      }

      const dispatchResult = await dispatch(tx, {
        tenantId: session.tenantId,
        channel,
        templateKey,
        recipient,
        variables,
        category: tmpl.category,
        investorId: id,
      });

      return dispatchResult;
    });

    return NextResponse.json(result);
  } catch (err: any) {
    return handleApiError(err);
  }
}
